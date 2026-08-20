import { html, css, LitElement } from '../../assets/lit-core-2.7.4.min.js';
import { ChatView } from './ChatView.js';

const EFFORT_OPTIONS = ['low', 'medium', 'high', 'xhigh'];

/**
 * The gpt-5.5 chat pane of an OpenAI session.
 *
 * Deliberately a controlled component: all state and IPC live in
 * AudioProcessApp, whose disconnectedCallback calls removeAllListeners and
 * would otherwise tear down listeners registered here.
 */
export class CodexChatView extends LitElement {
    // Reuse ChatView's bubble/preview/loading styling without inheriting its
    // Gemini-specific behavior.
    static styles = [
        ChatView.styles,
        css`
            .message-role.assistant {
                color: #4caf50;
            }

            .message-content.assistant {
                background: var(--input-background);
                border: 1px solid var(--button-border);
            }

            .message-content.aborted {
                border-style: dashed;
                opacity: 0.85;
            }

            .reasoning-row {
                display: flex;
                align-items: center;
                gap: 8px;
                flex-wrap: wrap;
            }

            .reasoning-pill {
                display: inline-flex;
                align-items: center;
                gap: 6px;
                background: var(--key-background);
                color: var(--description-color);
                border-radius: 8px;
                padding: 2px 8px;
                font-size: 11px;
                white-space: nowrap;
            }

            .reasoning-pill select {
                background: transparent;
                color: var(--text-color);
                border: none;
                font-size: 11px;
                font-family: 'Inter', sans-serif;
                cursor: pointer;
            }

            .reasoning-summary {
                font-size: 12px;
                color: var(--description-color);
                font-style: italic;
                max-height: 3.6em;
                overflow: hidden;
                user-select: text;
                cursor: text;
            }

            .inline-error {
                font-size: 12px;
                color: #ff6b6b;
                background: rgba(255, 107, 107, 0.1);
                border: 1px solid rgba(255, 107, 107, 0.35);
                border-radius: 8px;
                padding: 8px 12px;
                user-select: text;
                cursor: text;
            }

            .clear-button.confirming {
                border-color: rgba(255, 107, 107, 0.7);
                color: #ff6b6b;
            }

            .streaming-caret::after {
                content: '▍';
                opacity: 0.6;
            }

            :host([isclickthrough]) button:hover:not(:disabled) {
                background: transparent;
                border-color: var(--button-border);
            }
        `,
    ];

    static properties = {
        messages: { type: Array },
        isLoading: { type: Boolean },
        pendingImage: { type: String },
        reasoningEffort: { type: String },
        reasoningText: { type: String },
        errorText: { type: String },
        elapsedSeconds: { type: Number },
        isClickThrough: { type: Boolean, reflect: true },
        onSend: { type: Function },
        onCaptureScreenshot: { type: Function },
        onRemoveImage: { type: Function },
        onClear: { type: Function },
        onAbort: { type: Function },
        onEffortChange: { type: Function },
        _confirmingClear: { state: true },
    };

    constructor() {
        super();
        this.messages = [];
        this.isLoading = false;
        this.pendingImage = null;
        this.reasoningEffort = 'high';
        this.reasoningText = '';
        this.errorText = '';
        this.elapsedSeconds = 0;
        this.isClickThrough = false;
        this.onSend = () => {};
        this.onCaptureScreenshot = () => {};
        this.onRemoveImage = () => {};
        this.onClear = () => {};
        this.onAbort = () => {};
        this.onEffortChange = () => {};
        this._confirmingClear = false;
        this._clearConfirmTimer = null;
    }

    disconnectedCallback() {
        super.disconnectedCallback();
        if (this._clearConfirmTimer) {
            clearTimeout(this._clearConfirmTimer);
            this._clearConfirmTimer = null;
        }
    }

    updated(changedProperties) {
        super.updated(changedProperties);
        if (changedProperties.has('messages') || changedProperties.has('isLoading')) {
            this.scrollToBottom();
        }
    }

    scrollToBottom() {
        const container = this.shadowRoot?.querySelector('.chat-container');
        if (container) {
            requestAnimationFrame(() => {
                container.scrollTop = container.scrollHeight;
            });
        }
    }

    getPendingPrompt() {
        return this.shadowRoot?.querySelector('textarea')?.value?.trim() || '';
    }

    clearInput() {
        const textarea = this.shadowRoot?.querySelector('textarea');
        if (textarea) textarea.value = '';
    }

    handleKeydown(e) {
        // Enter sends, Shift+Enter inserts a newline. Cmd/Ctrl+Enter is claimed
        // by the app's global shortcut and never reaches here.
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            this.handleSend();
        }
    }

    handleSend() {
        const message = this.getPendingPrompt();
        if (!message && !this.pendingImage) return;
        this.clearInput();
        this.onSend(message);
    }

    handleClearClick() {
        if (!this._confirmingClear) {
            // Two-click confirm: a native confirm() would steal focus and show up
            // in screen recordings of this always-on-top overlay.
            this._confirmingClear = true;
            this._clearConfirmTimer = setTimeout(() => {
                this._confirmingClear = false;
                this._clearConfirmTimer = null;
            }, 3000);
            return;
        }

        if (this._clearConfirmTimer) {
            clearTimeout(this._clearConfirmTimer);
            this._clearConfirmTimer = null;
        }
        this._confirmingClear = false;
        this.onClear();
    }

    handleEffortChange(e) {
        this.onEffortChange(e.target.value);
    }

    formatTimestamp(timestamp) {
        return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    renderMarkdown(content) {
        if (typeof window !== 'undefined' && window.marked) {
            try {
                window.marked.setOptions({ breaks: true, gfm: true, sanitize: false });
                return window.marked.parse(content);
            } catch (error) {
                console.warn('Error parsing markdown:', error);
                return content;
            }
        }
        return content;
    }

    renderMessage(msg) {
        const roleLabel = msg.role === 'user' ? 'You' : `GPT-5.5${msg.effort ? ` · ${msg.effort}` : ''}`;
        const contentClasses = `message-content ${msg.role}${msg.aborted ? ' aborted' : ''}`;

        return html`
            <div class="chat-message">
                <div class="message-header">
                    <span class="message-role ${msg.role}">${roleLabel}</span>
                    <span>•</span>
                    <span>${this.formatTimestamp(msg.timestamp)}</span>
                    ${msg.hasImage ? html`<span class="message-image-indicator">📷 with screenshot</span>` : ''}
                    ${msg.aborted ? html`<span class="message-image-indicator">stopped</span>` : ''}
                </div>
                <div class="${contentClasses}" .innerHTML=${this.renderMarkdown(msg.text || '')}></div>
            </div>
        `;
    }

    renderLoading() {
        return html`
            <div class="chat-message">
                <div class="loading-indicator">
                    <span>GPT-5.5 is reasoning${this.elapsedSeconds > 0 ? ` · ${this.elapsedSeconds}s` : ''}</span>
                    <div class="loading-dots">
                        <div class="loading-dot"></div>
                        <div class="loading-dot"></div>
                        <div class="loading-dot"></div>
                    </div>
                </div>
                ${this.reasoningText ? html`<div class="reasoning-summary">${this.reasoningText}</div>` : ''}
            </div>
        `;
    }

    render() {
        const hasMessages = this.messages.length > 0;

        return html`
            <div class="chat-container">
                ${
                    !hasMessages && !this.isLoading
                        ? html`
                              <div class="empty-state">
                                  <div class="empty-state-icon">🧠</div>
                                  <div class="empty-state-text">Ask GPT-5.5 anything, or send a screenshot.</div>
                              </div>
                          `
                        : this.messages.map(msg => this.renderMessage(msg))
                }
                ${this.isLoading ? this.renderLoading() : ''}
            </div>

            <div class="input-container">
                <div class="input-wrapper">
                    ${this.errorText ? html`<div class="inline-error">${this.errorText}</div>` : ''}
                    ${
                        this.pendingImage
                            ? html`
                                  <div class="preview-container">
                                      <img class="preview-image" src="data:image/jpeg;base64,${this.pendingImage}" alt="Screenshot preview" />
                                      <button class="remove-preview" @click=${() => this.onRemoveImage()} title="Remove screenshot">×</button>
                                  </div>
                              `
                            : ''
                    }
                    <div class="reasoning-row">
                        <span class="reasoning-pill">
                            reasoning
                            <select .value=${this.reasoningEffort} @change=${this.handleEffortChange} ?disabled=${this.isLoading}>
                                ${EFFORT_OPTIONS.map(
                                    option => html`<option value=${option} ?selected=${option === this.reasoningEffort}>${option}</option>`
                                )}
                            </select>
                        </span>
                    </div>
                    <textarea placeholder="Message GPT-5.5... (Enter to send, Shift+Enter for a new line)" @keydown=${this.handleKeydown}></textarea>
                </div>

                <div class="button-group">
                    <button @click=${() => this.onCaptureScreenshot()} ?disabled=${this.isLoading} title="Attach screenshot">
                        <svg width="20px" height="20px" stroke-width="1.7" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path
                                d="M21 9V7.8C21 6.11984 21 5.27976 20.673 4.63803C20.3854 4.07354 19.9265 3.6146 19.362 3.32698C18.7202 3 17.8802 3 16.2 3H7.8C6.11984 3 5.27976 3 4.63803 3.32698C4.07354 3.6146 3.6146 4.07354 3.32698 4.63803C3 5.27976 3 6.11984 3 7.8V16.2C3 17.8802 3 18.7202 3.32698 19.362C3.6146 19.9265 4.07354 20.3854 4.63803 20.673C5.27976 21 6.11984 21 7.8 21H16.2C17.8802 21 18.7202 21 19.362 20.673C19.9265 20.3854 20.3854 19.9265 20.673 19.362C21 18.7202 21 17.8802 21 16.2V14"
                                stroke="currentColor"
                                stroke-width="1.7"
                                stroke-linecap="round"
                                stroke-linejoin="round"
                            ></path>
                            <path
                                d="M9 12C9 13.6569 10.3431 15 12 15C13.6569 15 15 13.6569 15 12C15 10.3431 13.6569 9 12 9C10.3431 9 9 10.3431 9 12Z"
                                stroke="currentColor"
                                stroke-width="1.7"
                                stroke-linecap="round"
                                stroke-linejoin="round"
                            ></path>
                        </svg>
                    </button>

                    ${
                        this.isLoading
                            ? html`
                                  <button @click=${() => this.onAbort()} title="Stop generating">
                                      <svg width="20px" height="20px" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                          <rect x="6" y="6" width="12" height="12" rx="2" stroke="currentColor" stroke-width="1.7"></rect>
                                      </svg>
                                  </button>
                              `
                            : html`
                                  <button class="send-button" @click=${this.handleSend} title="Send message">
                                      <svg
                                          width="20px"
                                          height="20px"
                                          stroke-width="1.7"
                                          viewBox="0 0 24 24"
                                          fill="none"
                                          xmlns="http://www.w3.org/2000/svg"
                                      >
                                          <path
                                              d="M22 12L3 20L7 12L3 4L22 12Z"
                                              stroke="currentColor"
                                              stroke-width="1.7"
                                              stroke-linecap="round"
                                              stroke-linejoin="round"
                                          ></path>
                                      </svg>
                                  </button>
                              `
                    }
                    ${
                        hasMessages
                            ? html`
                                  <button
                                      class="clear-button ${this._confirmingClear ? 'confirming' : ''}"
                                      @click=${this.handleClearClick}
                                      ?disabled=${this.isLoading}
                                      title=${this._confirmingClear ? 'Click again to clear this chat' : 'Clear chat'}
                                  >
                                      <svg
                                          width="20px"
                                          height="20px"
                                          stroke-width="1.7"
                                          viewBox="0 0 24 24"
                                          fill="none"
                                          xmlns="http://www.w3.org/2000/svg"
                                      >
                                          <path
                                              d="M20 9L18.005 20.3463C17.8369 21.3026 17.0062 22 16.0353 22H7.96474C6.99379 22 6.1631 21.3026 5.99496 20.3463L4 9"
                                              stroke="currentColor"
                                              stroke-width="1.7"
                                              stroke-linecap="round"
                                              stroke-linejoin="round"
                                          ></path>
                                          <path
                                              d="M21 6H15.375M3 6H8.625M8.625 6V4C8.625 2.89543 9.52043 2 10.625 2H13.375C14.4796 2 15.375 2.89543 15.375 4V6M8.625 6H15.375"
                                              stroke="currentColor"
                                              stroke-width="1.7"
                                              stroke-linecap="round"
                                              stroke-linejoin="round"
                                          ></path>
                                      </svg>
                                  </button>
                              `
                            : ''
                    }
                </div>
            </div>
        `;
    }
}

customElements.define('codex-chat-view', CodexChatView);
