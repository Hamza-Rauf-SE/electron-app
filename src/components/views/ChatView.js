import { html, css, LitElement } from '../../assets/lit-core-2.7.4.min.js';

export class ChatView extends LitElement {
    static styles = css`
        :host {
            height: 100%;
            display: flex;
            flex-direction: column;
        }

        * {
            font-family: 'Inter', sans-serif;
            cursor: default;
        }

        .chat-container {
            flex: 1;
            overflow-y: auto;
            padding: 10px;
            display: flex;
            flex-direction: column;
            gap: 6px;
            background: var(--main-content-background);
            border-radius: 10px;
            margin-bottom: 10px;
        }

        .chat-message {
            display: flex;
            flex-direction: column;
            gap: 6px;
            animation: fadeIn 0.3s ease-in;
        }

        @keyframes fadeIn {
            from {
                opacity: 0;
                transform: translateY(10px);
            }
            to {
                opacity: 1;
                transform: translateY(0);
            }
        }

        .message-header {
            display: none;
            align-items: center;
            gap: 8px;
            font-size: 12px;
            color: var(--description-color);
        }

        .message-role {
            font-weight: 600;
            color: var(--text-color);
        }

        .message-role.user {
            color: var(--text-color);
        }

        .message-role.model {
            color: var(--text-color);
        }

        .message-content {
            background: var(--input-background);
            padding: 6px 10px;
            border-radius: 8px;
            color: var(--text-color);
            font-size: 12px;
            line-height: 1.0;
            user-select: text;
            cursor: text;
        }

        .message-content.user {
            background: transparent;
            border: 1px solid transparent;
        }

        .message-content.model {
            background: var(--input-background);
            border: 1px solid var(--button-border);
        }

        .message-content * {
            user-select: text;
            cursor: text;
        }

        .message-image-indicator {
            font-size: 11px;
            color: var(--description-color);
            font-style: italic;
        }

        .empty-state {
            flex: 1;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            color: var(--description-color);
            gap: 12px;
        }

        .empty-state-icon {
            font-size: 48px;
            opacity: 0.5;
        }

        .empty-state-text {
            font-size: 16px;
        }

        .input-container {
            display: flex;
            gap: 10px;
            align-items: flex-end;
        }

        .input-wrapper {
            flex: 1;
            display: flex;
            flex-direction: column;
            gap: 8px;
        }

        .preview-container {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            padding: 8px 12px;
            background: transparent;
            border: 1px solid transparent;
            border-radius: 8px;
            color: var(--text-color);
        }

        .screenshot-icon {
            font-size: 20px;
        }

        .screenshot-text {
            font-size: 14px;
            font-weight: 500;
        }

        .remove-preview {
            background: transparent;
            color: var(--text-color);
            border: none;
            border-radius: 50%;
            width: 20px;
            height: 20px;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            font-size: 18px;
            margin-left: 4px;
        }

        .remove-preview:hover {
            background: transparent;
            opacity: 0.7;
        }

        textarea {
            background: var(--input-background);
            color: var(--text-color);
            border: 1px solid var(--button-border);
            padding: 10px 14px;
            border-radius: 8px;
            font-size: 14px;
            font-family: 'Inter', sans-serif;
            resize: vertical;
            min-height: 60px;
            max-height: 200px;
        }

        textarea:focus {
            outline: none;
            border-color: var(--focus-border-color);
            box-shadow: 0 0 0 3px var(--focus-box-shadow);
            background: var(--input-focus-background);
        }

        textarea::placeholder {
            color: var(--placeholder-color);
        }

        .button-group {
            display: flex;
            flex-direction: column;
            gap: 4px;
        }

        button {
            background: transparent;
            color: var(--text-color);
            border: 1px solid var(--button-border);
            padding: 6px;
            border-radius: 8px;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all 0.2s ease;
        }

        button svg {
            width: 16px;
            height: 16px;
        }

        button:hover:not(:disabled) {
            background: transparent;
            border-color: transparent;
        }

        button:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }

        .send-button {
            background: transparent;
            color: var(--text-color);
        }

        .send-button:hover:not(:disabled) {
            background: var(--start-button-hover);
        }

        .chat-container::-webkit-scrollbar {
            width: 8px;
        }

        .chat-container::-webkit-scrollbar-track {
            background: var(--scrollbar-track);
            border-radius: 4px;
        }

        .chat-container::-webkit-scrollbar-thumb {
            background: var(--scrollbar-thumb);
            border-radius: 4px;
        }

        .chat-container::-webkit-scrollbar-thumb:hover {
            background: var(--scrollbar-thumb-hover);
        }

        /* Markdown styling */
        .message-content h1,
        .message-content h2,
        .message-content h3,
        .message-content h4,
        .message-content h5,
        .message-content h6 {
            margin: 0.8em 0 0.4em 0;
            font-weight: 600;
        }

        .message-content p {
            margin: 0.5em 0;
        }

        .message-content code {
            background: rgba(255, 255, 255, 0.1);
            padding: 0.2em 0.4em;
            border-radius: 3px;
            font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
            font-size: 0.85em;
        }

        .message-content pre {
            background: rgba(0, 0, 0, 0.3);
            border-radius: 6px;
            padding: 1em;
            overflow-x: auto;
            margin: 0.5em 0;
        }

        .message-content pre code {
            background: none;
            padding: 0;
        }

        .message-content ul,
        .message-content ol {
            margin: 0.5em 0;
            padding-left: 2em;
        }

        .message-content li {
            margin: 0.3em 0;
        }

        .loading-indicator {
            display: flex;
            align-items: center;
            gap: 8px;
            color: var(--description-color);
            font-size: 14px;
            padding: 8px 16px;
            background: var(--input-background);
            border-radius: 8px;
            width: fit-content;
        }

        .loading-dots {
            display: flex;
            gap: 4px;
        }

        .loading-dot {
            width: 6px;
            height: 6px;
            border-radius: 50%;
            background: var(--focus-border-color);
            animation: pulse 1.4s ease-in-out infinite;
        }

        .loading-dot:nth-child(2) {
            animation-delay: 0.2s;
        }

        .loading-dot:nth-child(3) {
            animation-delay: 0.4s;
        }

        @keyframes pulse {
            0%,
            80%,
            100% {
                opacity: 0.3;
                transform: scale(0.8);
            }
            40% {
                opacity: 1;
                transform: scale(1);
            }
        }
    `;

    static properties = {
        chatHistory: { type: Array },
        isLoading: { type: Boolean },
        capturedImage: { type: String },
        isChatStarted: { type: Boolean },
        screenshotCount: { type: Number },
    };

    constructor() {
        super();
        this.chatHistory = [];
        this.isLoading = false;
        this.capturedImage = null;
        this.isChatStarted = false;
        this.screenshotCount = 0;
    }

    connectedCallback() {
        super.connectedCallback();
        if (window.require) {
            const { ipcRenderer } = window.require('electron');
            this.handleQuickScreenshot = () => this.quickScreenshotAndSend();
            ipcRenderer.on('quick-screenshot-and-send', this.handleQuickScreenshot);
        }
    }

    disconnectedCallback() {
        super.disconnectedCallback();
        if (window.require) {
            const { ipcRenderer } = window.require('electron');
            if (this.handleQuickScreenshot) {
                ipcRenderer.removeListener('quick-screenshot-and-send', this.handleQuickScreenshot);
            }
        }
    }

    async startChat() {
        const apiKey = localStorage.getItem('apiKey')?.trim();
        if (!apiKey) {
            alert('Please set your API key in settings first.');
            return;
        }

        const { ipcRenderer } = window.require('electron');
        const result = await ipcRenderer.invoke('initialize-standard-chat', apiKey);

        if (result.success) {
            this.isChatStarted = true;
            console.log('Standard chat initialized');
        } else {
            alert('Failed to initialize chat: ' + result.error);
        }
    }

    async captureScreenshot() {
        try {
            const { ipcRenderer } = window.require('electron');

            const result = await ipcRenderer.invoke('capture-screenshot-for-chat');

            if (result.success) {
                this.capturedImage = result.imageData;
                this.screenshotCount++;
                // Silent capture - no logs for stealth
            } else {
                // Show error only in development
                if (process.env.NODE_ENV === 'development') {
                    alert('Failed to capture screenshot: ' + result.error);
                }
            }
        } catch (error) {
            // Silent error handling for stealth
            if (process.env.NODE_ENV === 'development') {
                console.error('Error capturing screenshot:', error);
            }
        }
    }

    async quickScreenshotAndSend() {
        try {
            if (!this.isChatStarted) {
                await this.startChat();
            }

            this.isLoading = true;

            const { ipcRenderer } = window.require('electron');

            // Capture screenshot
            const captureResult = await ipcRenderer.invoke('capture-screenshot-for-chat');

            if (!captureResult.success) {
                if (process.env.NODE_ENV === 'development') {
                    alert('Failed to capture screenshot: ' + captureResult.error);
                }
                this.isLoading = false;
                return;
            }

            // Send immediately with default message
            const result = await ipcRenderer.invoke('send-standard-chat-message', {
                message: 'Analyze this screenshot',
                imageData: captureResult.imageData,
            });

            if (result.success) {
                // Fetch updated history
                const historyResult = await ipcRenderer.invoke('get-standard-chat-history');
                if (historyResult.success) {
                    this.chatHistory = historyResult.history;
                    this.scrollToBottom();
                }
            } else {
                alert('Failed to send message: ' + result.error);
            }
        } catch (error) {
            console.error('Error in quick screenshot and send:', error);
            alert('Error: ' + error.message);
        } finally {
            this.isLoading = false;
        }
    }

    removePreview() {
        this.capturedImage = null;
        this.screenshotCount = 0;
    }

    renderMarkdown(content) {
        if (typeof window !== 'undefined' && window.marked) {
            try {
                window.marked.setOptions({
                    breaks: true,
                    gfm: true,
                    sanitize: false,
                });
                return window.marked.parse(content);
            } catch (error) {
                console.warn('Error parsing markdown:', error);
                return content;
            }
        }
        return content;
    }

    async sendMessage() {
        const textarea = this.shadowRoot.querySelector('textarea');
        const message = textarea?.value.trim();

        if (!message && !this.capturedImage) {
            return;
        }

        if (!this.isChatStarted) {
            await this.startChat();
        }

        this.isLoading = true;

        try {
            const { ipcRenderer } = window.require('electron');
            const result = await ipcRenderer.invoke('send-standard-chat-message', {
                message: message || 'What do you see in this image?',
                imageData: this.capturedImage,
            });

            if (result.success) {
                // Fetch updated history
                const historyResult = await ipcRenderer.invoke('get-standard-chat-history');
                if (historyResult.success) {
                    this.chatHistory = historyResult.history;
                    this.scrollToBottom();
                }

                // Clear input, image, and counter
                if (textarea) textarea.value = '';
                this.capturedImage = null;
                this.screenshotCount = 0;
            } else {
                alert('Failed to send message: ' + result.error);
            }
        } catch (error) {
            console.error('Error sending message:', error);
            alert('Error: ' + error.message);
        } finally {
            this.isLoading = false;
        }
    }

    handleKeydown(e) {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            this.sendMessage();
        }
    }

    scrollToBottom() {
        setTimeout(() => {
            const container = this.shadowRoot.querySelector('.chat-container');
            if (container) {
                container.scrollTop = container.scrollHeight;
            }
        }, 100);
    }

    async clearChat() {
        const { ipcRenderer } = window.require('electron');
        await ipcRenderer.invoke('clear-standard-chat-history');
        this.chatHistory = [];
        this.capturedImage = null;
        this.screenshotCount = 0;
    }

    formatTimestamp(timestamp) {
        const date = new Date(timestamp);
        return date.toLocaleTimeString();
    }

    render() {
        return html`
            <div class="chat-container">
                ${this.chatHistory.length === 0
                    ? html`
                          <div class="empty-state">
                              <div class="empty-state-icon">💬</div>
                              <div class="empty-state-text">Start chatting with Gemini!</div>
                              <div class="empty-state-text" style="font-size: 14px;">Type a message or capture a screenshot to begin.</div>
                          </div>
                      `
                    : this.chatHistory.map(
                          msg => html`
                              <div class="chat-message">
                                  <div class="message-header">
                                      <span class="message-role ${msg.role}">${msg.role === 'user' ? 'You' : 'Gemini'}</span>
                                      <span>•</span>
                                      <span>${this.formatTimestamp(msg.timestamp)}</span>
                                      ${msg.hasImage ? html`<span class="message-image-indicator">📷 with image</span>` : ''}
                                  </div>
                                  <div class="message-content ${msg.role}" .innerHTML=${this.renderMarkdown(msg.message)}></div>
                              </div>
                          `
                      )}
                ${this.isLoading
                    ? html`
                          <div class="loading-indicator">
                              <span>Gemini is thinking</span>
                              <div class="loading-dots">
                                  <div class="loading-dot"></div>
                                  <div class="loading-dot"></div>
                                  <div class="loading-dot"></div>
                              </div>
                          </div>
                      `
                    : ''}
            </div>

            <div class="input-container">
                <div class="input-wrapper">
                    ${this.capturedImage
                        ? html`
                              <div class="preview-container">
                                  <span class="screenshot-icon">📷</span>
                                  <span class="screenshot-text">Screenshot ${this.screenshotCount}</span>
                                  <button class="remove-preview" @click=${this.removePreview}>×</button>
                              </div>
                          `
                        : ''}
                    <textarea
                        placeholder="Type your message... (Ctrl/Cmd + Enter to send)"
                        @keydown=${this.handleKeydown}
                        ?disabled=${this.isLoading}
                    ></textarea>
                </div>

                <div class="button-group">
                    <button @click=${this.captureScreenshot} ?disabled=${this.isLoading} title="Capture Screenshot">
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

                    <button @click=${this.quickScreenshotAndSend} ?disabled=${this.isLoading} title="Quick Screenshot & Send">
                        <svg width="20px" height="20px" stroke-width="1.7" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path
                                d="M13 2L3 14H12L11 22L21 10H12L13 2Z"
                                stroke="currentColor"
                                stroke-width="1.7"
                                stroke-linecap="round"
                                stroke-linejoin="round"
                            ></path>
                        </svg>
                    </button>

                    <button class="send-button" @click=${this.sendMessage} ?disabled=${this.isLoading} title="Send Message">
                        <svg width="20px" height="20px" stroke-width="1.7" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path
                                d="M22 12L3 20L7 12L3 4L22 12Z"
                                stroke="currentColor"
                                stroke-width="1.7"
                                stroke-linecap="round"
                                stroke-linejoin="round"
                            ></path>
                        </svg>
                    </button>

                    ${this.chatHistory.length > 0
                        ? html`
                              <button @click=${this.clearChat} ?disabled=${this.isLoading} title="Clear Chat">
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
                        : ''}
                </div>
            </div>
        `;
    }
}

customElements.define('chat-view', ChatView);
