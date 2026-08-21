import { html, css, LitElement } from '../../assets/lit-core-2.7.4.min.js';
import { AssistantView } from './AssistantView.js';
import { CodexChatView } from './CodexChatView.js';
import { resizeLayout } from '../../utils/windowResize.js';

/**
 * Two-tab shell for an OpenAI session: the realtime pane (gpt-realtime) and the
 * gpt-5.5 chat pane.
 *
 * Both panes stay mounted and are toggled with a CSS class. Swapping them with a
 * lit-html ternary would tear down AssistantView, whose word-reveal animation
 * would then replay the entire last response from scratch on every tab switch.
 */
export class OpenAISessionView extends LitElement {
    static styles = css`
        :host {
            height: 100%;
            min-height: 0;
            display: flex;
            flex-direction: column;
        }

        * {
            font-family: 'Inter', sans-serif;
            cursor: default;
        }

        .tabs-container {
            -webkit-app-region: no-drag;
            display: flex;
            align-items: center;
            gap: 8px;
            flex: 0 0 auto;
            margin-bottom: 8px;
            padding-bottom: 6px;
            border-bottom: 1px solid var(--button-border);
        }

        .tab {
            background: transparent;
            color: var(--description-color);
            border: none;
            padding: 6px 14px;
            border-radius: 6px 6px 0 0;
            font-size: var(--header-font-size-small);
            font-weight: 500;
            cursor: pointer;
            white-space: nowrap;
            display: flex;
            align-items: center;
            gap: 6px;
            transition:
                background 0.15s ease,
                color 0.15s ease;
        }

        .tab:hover {
            background: var(--hover-background);
            color: var(--text-color);
        }

        .tab.active {
            background: var(--focus-box-shadow);
            color: var(--text-color);
            border-bottom: 2px solid var(--focus-border-color);
        }

        .tab:focus-visible {
            outline: 2px solid var(--focus-border-color);
            outline-offset: 1px;
        }

        .tab-dot {
            width: 6px;
            height: 6px;
            border-radius: 50%;
            background: var(--description-color);
            flex: 0 0 auto;
        }

        .tab-dot.live {
            background: #4caf50;
            animation: livePulse 1.8s ease-in-out infinite;
        }

        @keyframes livePulse {
            0%,
            100% {
                opacity: 0.35;
            }
            50% {
                opacity: 1;
            }
        }

        .tab-badge {
            background: var(--key-background);
            color: var(--description-color);
            border-radius: 8px;
            padding: 0 5px;
            font-size: 10px;
            line-height: 15px;
            min-width: 15px;
            text-align: center;
        }

        .tab-spacer {
            flex: 1;
        }

        .realtime-toggle {
            -webkit-app-region: no-drag;
            background: var(--button-background);
            color: var(--text-color);
            border: 1px solid var(--button-border);
            padding: 4px 10px;
            border-radius: 8px;
            font-size: var(--header-font-size-small);
            font-weight: 500;
            display: flex;
            align-items: center;
            gap: 6px;
            cursor: pointer;
            white-space: nowrap;
            transition: background 0.15s ease;
        }

        .realtime-toggle:hover:not(:disabled) {
            background: var(--hover-background);
        }

        .realtime-toggle:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }

        .realtime-toggle.live {
            border-color: rgba(76, 175, 80, 0.5);
        }

        .realtime-toggle svg {
            width: 14px;
            height: 14px;
            stroke: currentColor !important;
        }

        .toggle-spinner {
            width: 6px;
            height: 6px;
            border-radius: 50%;
            background: var(--focus-border-color);
            animation: livePulse 1s ease-in-out infinite;
        }

        /* Click-through mode: remove every hover affordance so the overlay reads as inert. */
        :host([isclickthrough]) .tab:hover,
        :host([isclickthrough]) .tab.active:hover,
        :host([isclickthrough]) .realtime-toggle:hover {
            background: transparent;
            color: var(--description-color);
        }

        .panes {
            flex: 1;
            min-height: 0;
            display: flex;
        }

        .pane {
            display: none;
            flex: 1;
            min-height: 0;
        }

        .pane.active {
            display: flex;
            flex-direction: column;
        }

        /* Don't depend on the child declaring height: 100%. */
        .pane > * {
            flex: 1;
            min-height: 0;
        }

        :host([compact]) .tabs-container {
            gap: 4px;
            margin-bottom: 4px;
            padding-bottom: 4px;
        }

        :host([compact]) .tab {
            padding: 4px 8px;
        }

        :host([compact]) .realtime-toggle {
            padding: 3px 8px;
        }
    `;

    static properties = {
        activeTab: { type: String },
        isClickThrough: { type: Boolean, reflect: true },
        compact: { type: Boolean, reflect: true },

        // Realtime pane
        responses: { type: Array },
        currentResponseIndex: { type: Number },
        selectedProfile: { type: String },
        shouldAnimateResponse: { type: Boolean },
        realtimeActive: { type: Boolean },
        realtimeBusy: { type: Boolean },

        // Codex pane
        codexMessages: { type: Array },
        codexLoading: { type: Boolean },
        codexPendingImage: { type: String },
        codexReasoningEffort: { type: String },
        codexReasoningText: { type: String },
        codexErrorText: { type: String },
        codexElapsedSeconds: { type: Number },
        codexUnread: { type: Number },

        // Callbacks
        onTabChange: { type: Function },
        onToggleRealtime: { type: Function },
        onSendRealtimeText: { type: Function },
        onResponseIndexChanged: { type: Function },
        onCodexSend: { type: Function },
        onCodexScreenshot: { type: Function },
        onCodexRemoveImage: { type: Function },
        onCodexClear: { type: Function },
        onCodexAbort: { type: Function },
        onCodexEffortChange: { type: Function },
    };

    constructor() {
        super();
        this.activeTab = 'realtime';
        this.isClickThrough = false;
        this.compact = false;

        this.responses = [];
        this.currentResponseIndex = -1;
        this.selectedProfile = 'interview';
        this.shouldAnimateResponse = false;
        this.realtimeActive = false;
        this.realtimeBusy = false;

        this.codexMessages = [];
        this.codexLoading = false;
        this.codexPendingImage = null;
        this.codexReasoningEffort = 'high';
        this.codexReasoningText = '';
        this.codexErrorText = '';
        this.codexElapsedSeconds = 0;
        this.codexUnread = 0;

        this.onTabChange = () => {};
        this.onToggleRealtime = () => {};
        this.onSendRealtimeText = () => {};
        this.onResponseIndexChanged = () => {};
        this.onCodexSend = () => {};
        this.onCodexScreenshot = () => {};
        this.onCodexRemoveImage = () => {};
        this.onCodexClear = () => {};
        this.onCodexAbort = () => {};
        this.onCodexEffortChange = () => {};
    }

    connectedCallback() {
        super.connectedCallback();

        // A local capture-phase listener rather than a global shortcut: registering
        // Cmd+1/Cmd+2 globally would steal browser tab switching machine-wide.
        this._onKeydown = e => {
            if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
            if (e.key === '1') {
                e.preventDefault();
                this.switchTab('realtime');
            } else if (e.key === '2') {
                e.preventDefault();
                this.switchTab('codex');
            }
        };
        window.addEventListener('keydown', this._onKeydown, true);
    }

    disconnectedCallback() {
        super.disconnectedCallback();
        if (this._onKeydown) {
            window.removeEventListener('keydown', this._onKeydown, true);
            this._onKeydown = null;
        }
    }

    firstUpdated() {
        super.firstUpdated();
        // Deferred so the resize animation doesn't collide with the screen-capture prompt.
        requestAnimationFrame(() => resizeLayout());
    }

    willUpdate(changedProperties) {
        // Runs before render, while the outgoing pane still has layout and a
        // readable scrollTop. By updated() it is display:none and reads zero.
        if (changedProperties.has('activeTab') && changedProperties.get('activeTab') === 'realtime') {
            this.shadowRoot?.querySelector('assistant-view')?.captureScrollPosition?.();
        }
    }

    updated(changedProperties) {
        super.updated(changedProperties);

        // display:none discards scrollTop, so put the reader back where they were.
        if (changedProperties.has('activeTab') && this.activeTab === 'realtime') {
            const assistantView = this.shadowRoot?.querySelector('assistant-view');
            requestAnimationFrame(() => assistantView?.restoreScrollPosition?.());
        }
    }

    switchTab(tab) {
        if (tab === this.activeTab) return;
        this.onTabChange(tab);
    }

    getActivePane() {
        const selector = this.activeTab === 'codex' ? 'codex-chat-view' : 'assistant-view';
        return this.shadowRoot?.querySelector(selector) || null;
    }

    /** Text currently typed in the active tab, used by the Cmd+Enter screenshot path. */
    getPendingPrompt() {
        return this.getActivePane()?.getPendingPrompt?.() || '';
    }

    clearActiveInput() {
        this.getActivePane()?.clearInput?.();
    }

    renderRealtimeToggle() {
        if (this.realtimeBusy) {
            return html`
                <button class="realtime-toggle" disabled title="Realtime session is changing state">
                    <span class="toggle-spinner"></span>
                    ${this.realtimeActive ? 'Stopping…' : 'Starting…'}
                </button>
            `;
        }

        if (this.realtimeActive) {
            return html`
                <button class="realtime-toggle live" @click=${() => this.onToggleRealtime()} title="Pause the realtime session and stop listening">
                    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <rect x="6" y="6" width="12" height="12" rx="2" stroke="currentColor" stroke-width="1.7"></rect>
                    </svg>
                    Stop realtime
                </button>
            `;
        }

        return html`
            <button class="realtime-toggle" @click=${() => this.onToggleRealtime()} title="Reconnect the realtime session and resume listening">
                <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M6 4.5L19 12L6 19.5V4.5Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"></path>
                </svg>
                Start realtime
            </button>
        `;
    }

    render() {
        const realtimeActiveTab = this.activeTab !== 'codex';

        return html`
            <div class="tabs-container">
                <button
                    class="tab ${realtimeActiveTab ? 'active' : ''}"
                    @click=${() => this.switchTab('realtime')}
                    title="Realtime session (Cmd/Ctrl+1)"
                >
                    <span class="tab-dot ${this.realtimeActive ? 'live' : ''}"></span>
                    Realtime
                </button>
                <button class="tab ${!realtimeActiveTab ? 'active' : ''}" @click=${() => this.switchTab('codex')} title="GPT-5.5 chat (Cmd/Ctrl+2)">
                    Chat · GPT-5.5 ${this.codexUnread > 0 && realtimeActiveTab ? html`<span class="tab-badge">${this.codexUnread}</span>` : ''}
                </button>
                <span class="tab-spacer"></span>
                ${this.renderRealtimeToggle()}
            </div>

            <div class="panes">
                <div class="pane ${realtimeActiveTab ? 'active' : ''}">
                    <assistant-view
                        .responses=${this.responses}
                        .currentResponseIndex=${this.currentResponseIndex}
                        .selectedProfile=${this.selectedProfile}
                        .shouldAnimateResponse=${this.shouldAnimateResponse}
                        .paneActive=${realtimeActiveTab}
                        .screenshotTarget=${'openai-realtime'}
                        .followLatest=${true}
                        .onSendText=${message => this.onSendRealtimeText(message)}
                        @response-index-changed=${e => this.onResponseIndexChanged(e)}
                    ></assistant-view>
                </div>
                <div class="pane ${!realtimeActiveTab ? 'active' : ''}">
                    <codex-chat-view
                        .messages=${this.codexMessages}
                        .isLoading=${this.codexLoading}
                        .pendingImage=${this.codexPendingImage}
                        .reasoningEffort=${this.codexReasoningEffort}
                        .reasoningText=${this.codexReasoningText}
                        .errorText=${this.codexErrorText}
                        .elapsedSeconds=${this.codexElapsedSeconds}
                        .isClickThrough=${this.isClickThrough}
                        .onSend=${message => this.onCodexSend(message)}
                        .onCaptureScreenshot=${() => this.onCodexScreenshot()}
                        .onRemoveImage=${() => this.onCodexRemoveImage()}
                        .onClear=${() => this.onCodexClear()}
                        .onAbort=${() => this.onCodexAbort()}
                        .onEffortChange=${effort => this.onCodexEffortChange(effort)}
                    ></codex-chat-view>
                </div>
            </div>
        `;
    }
}

customElements.define('openai-session-view', OpenAISessionView);
