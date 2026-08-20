import { html, css, LitElement } from '../../assets/lit-core-2.7.4.min.js';
import { AppHeader } from './AppHeader.js';
import { MainView } from '../views/MainView.js';
import { CustomizeView } from '../views/CustomizeView.js';
import { HelpView } from '../views/HelpView.js';
import { HistoryView } from '../views/HistoryView.js';
import { AssistantView } from '../views/AssistantView.js';
import { OnboardingView } from '../views/OnboardingView.js';
import { AdvancedView } from '../views/AdvancedView.js';
import { ChatView } from '../views/ChatView.js';
import { OpenAISessionView } from '../views/OpenAISessionView.js';
import { CodexChatView } from '../views/CodexChatView.js';

export class AudioProcessApp extends LitElement {
    static styles = css`
        * {
            box-sizing: border-box;
            font-family:
                'Inter',
                -apple-system,
                BlinkMacSystemFont,
                sans-serif;
            margin: 0px;
            padding: 0px;
            cursor: default;
            user-select: none;
        }

        :host {
            display: block;
            width: 100%;
            height: 100vh;
            background-color: var(--background-transparent);
            color: var(--text-color);
        }

        .window-container {
            height: 100vh;
            border-radius: 7px;
            overflow: hidden;
        }

        .container {
            display: flex;
            flex-direction: column;
            height: 100%;
        }

        .main-content {
            flex: 1;
            padding: var(--main-content-padding);
            overflow-y: auto;
            margin-top: var(--main-content-margin-top);
            border-radius: var(--content-border-radius);
            transition: all 0.15s ease-out;
            background: var(--main-content-background);
        }

        .main-content.with-border {
            border: 1px solid var(--border-color);
        }

        .main-content.assistant-view {
            padding: 10px;
            border: none;
        }

        .main-content.onboarding-view {
            padding: 0;
            border: none;
            background: transparent;
        }

        .view-container {
            opacity: 1;
            transform: translateY(0);
            transition:
                opacity 0.15s ease-out,
                transform 0.15s ease-out;
            height: 100%;
        }

        .view-container.entering {
            opacity: 0;
            transform: translateY(10px);
        }

        ::-webkit-scrollbar {
            width: 6px;
            height: 6px;
        }

        ::-webkit-scrollbar-track {
            background: var(--scrollbar-background);
            border-radius: 3px;
        }

        ::-webkit-scrollbar-thumb {
            background: var(--scrollbar-thumb);
            border-radius: 3px;
        }

        ::-webkit-scrollbar-thumb:hover {
            background: var(--scrollbar-thumb-hover);
        }
    `;

    static properties = {
        currentView: { type: String },
        statusText: { type: String },
        startTime: { type: Number },
        isRecording: { type: Boolean },
        sessionActive: { type: Boolean },
        selectedProfile: { type: String },
        selectedLanguage: { type: String },
        responses: { type: Array },
        currentResponseIndex: { type: Number },
        selectedScreenshotInterval: { type: String },
        sendScreenshotsEnabled: { type: Boolean },
        selectedImageQuality: { type: String },
        layoutMode: { type: String },
        advancedMode: { type: Boolean },
        themeMode: { type: String },
        _viewInstances: { type: Object, state: true },
        _isClickThrough: { state: true },
        _awaitingNewResponse: { state: true },
        shouldAnimateResponse: { type: Boolean },

        // Which provider owns the current session. Deliberately not derived from
        // audioprocess.getCurrentProvider(), which is session-scoped and stale.
        sessionProvider: { type: String },
        activeSessionTab: { type: String },
        realtimeActive: { type: Boolean },
        realtimeBusy: { state: true },

        codexMessages: { type: Array },
        codexLoading: { type: Boolean },
        codexPendingImage: { type: String },
        codexStatusText: { type: String },
        codexReasoningText: { type: String },
        codexErrorText: { type: String },
        codexReasoningEffort: { type: String },
        codexElapsedSeconds: { type: Number },
        codexUnread: { type: Number },
    };

    constructor() {
        super();
        this.currentView = localStorage.getItem('onboardingCompleted') ? 'main' : 'onboarding';
        this.statusText = '';
        this.startTime = null;
        this.isRecording = false;
        this.sessionActive = false;
        this.selectedProfile = localStorage.getItem('selectedProfile') || 'interview';
        this.selectedLanguage = localStorage.getItem('selectedLanguage') || 'en-US';
        this.selectedScreenshotInterval = localStorage.getItem('selectedScreenshotInterval') || '5';
        this.sendScreenshotsEnabled = localStorage.getItem('sendScreenshotsEnabled') !== 'false';
        this.selectedImageQuality = localStorage.getItem('selectedImageQuality') || 'medium';
        this.layoutMode = localStorage.getItem('layoutMode') || 'normal';
        this.advancedMode = localStorage.getItem('advancedMode') === 'true';
        this.themeMode = localStorage.getItem('themeMode') || 'dark';
        this.responses = [];
        this.currentResponseIndex = -1;
        this._viewInstances = new Map();
        this._isClickThrough = false;
        this._awaitingNewResponse = false;
        this._currentResponseIsComplete = true;
        this.shouldAnimateResponse = false;

        this.sessionProvider = null;
        this.activeSessionTab = 'realtime';
        this.realtimeActive = false;
        this.realtimeBusy = false;
        this.realtimeSuspended = false;

        this.codexMessages = [];
        this.codexLoading = false;
        this.codexPendingImage = null;
        this.codexStatusText = '';
        this.codexReasoningText = '';
        this.codexErrorText = '';
        this.codexReasoningEffort = localStorage.getItem('codexReasoningEffort') || 'high';
        this.codexElapsedSeconds = 0;
        this.codexUnread = 0;
        this._codexTimer = null;
        this._codexStartedAt = null;

        // Apply layout mode and theme to document root
        this.updateLayoutMode();
        this.updateThemeMode();
    }

    connectedCallback() {
        super.connectedCallback();

        // Set up IPC listeners if needed
        if (window.require) {
            const { ipcRenderer } = window.require('electron');
            ipcRenderer.on('update-response', (_, response) => {
                this.setResponse(response);
            });
            ipcRenderer.on('update-status', (_, status) => {
                this.setStatus(status);
            });
            ipcRenderer.on('click-through-toggled', (_, isEnabled) => {
                this._isClickThrough = isEnabled;
            });
            ipcRenderer.on('response-complete', () => {
                console.log('[response-complete] Received signal - marking for new response');
                this._awaitingNewResponse = true;
                this._currentResponseIsComplete = true;
                console.log(
                    '[response-complete] Flags set - _awaitingNewResponse:',
                    this._awaitingNewResponse,
                    '_currentResponseIsComplete:',
                    this._currentResponseIsComplete
                );
            });
            ipcRenderer.on('increase-transparency', () => {
                this.increaseTransparency();
            });
            ipcRenderer.on('decrease-transparency', () => {
                this.decreaseTransparency();
            });
            ipcRenderer.on('toggle-theme', () => {
                this.toggleTheme();
            });

            // Realtime lifecycle (was emitted but never consumed).
            ipcRenderer.on('session-initializing', (_, initializing) => {
                this.realtimeBusy = !!initializing;
            });
            ipcRenderer.on('realtime-state', (_, payload) => {
                this.handleRealtimeState(payload);
            });

            // Tab 2 (gpt-5.5) uses its own channels so it can never contaminate
            // the realtime transcript reducer in setResponse().
            ipcRenderer.on('codex-chat-status', (_, payload) => {
                this.handleCodexStatus(payload);
            });
            ipcRenderer.on('codex-reasoning-delta', (_, payload) => {
                this.codexReasoningText = (this.codexReasoningText + (payload?.delta || '')).slice(-400);
            });
            ipcRenderer.on('codex-chat-delta', (_, payload) => {
                this.upsertCodexMessage({ id: payload.id, role: 'assistant', text: payload.text, streaming: true });
            });
            ipcRenderer.on('codex-chat-message', (_, payload) => {
                this.upsertCodexMessage({ ...payload, streaming: false });
                if (payload?.role === 'assistant') {
                    this.stopCodexTimer();
                    this.codexLoading = false;
                    this.codexReasoningText = '';
                    if (this.activeSessionTab !== 'codex') {
                        this.codexUnread = this.codexUnread + 1;
                    }
                }
            });
            ipcRenderer.on('codex-chat-error', (_, payload) => {
                this.stopCodexTimer();
                this.codexLoading = false;
                this.codexErrorText = payload?.retryAfter
                    ? `${payload.error} (retry in ${payload.retryAfter}s)`
                    : payload?.error || 'GPT-5.5 request failed';
            });
        }
    }

    increaseTransparency() {
        let currentTransparency = parseFloat(localStorage.getItem('backgroundTransparency') || '0.8');
        currentTransparency = Math.max(0, currentTransparency - 0.1);
        localStorage.setItem('backgroundTransparency', currentTransparency.toString());
        this.updateBackgroundTransparency(currentTransparency);
        console.log('Transparency increased to:', currentTransparency);
    }

    decreaseTransparency() {
        let currentTransparency = parseFloat(localStorage.getItem('backgroundTransparency') || '0.8');
        currentTransparency = Math.min(1, currentTransparency + 0.1);
        localStorage.setItem('backgroundTransparency', currentTransparency.toString());
        this.updateBackgroundTransparency(currentTransparency);
        console.log('Transparency decreased to:', currentTransparency);
    }

    updateBackgroundTransparency(transparency) {
        const root = document.documentElement;
        root.style.setProperty('--header-background', `rgba(0, 0, 0, ${transparency})`);
        root.style.setProperty('--main-content-background', `rgba(0, 0, 0, ${transparency})`);
        root.style.setProperty('--card-background', `rgba(255, 255, 255, ${transparency * 0.05})`);
        root.style.setProperty('--input-background', `rgba(0, 0, 0, ${transparency * 0.375})`);
        root.style.setProperty('--input-focus-background', `rgba(0, 0, 0, ${transparency * 0.625})`);
        root.style.setProperty('--button-background', `rgba(0, 0, 0, ${transparency * 0.625})`);
        root.style.setProperty('--preview-video-background', `rgba(0, 0, 0, ${transparency * 1.125})`);
        root.style.setProperty('--screen-option-background', `rgba(0, 0, 0, ${transparency * 0.5})`);
        root.style.setProperty('--screen-option-hover-background', `rgba(0, 0, 0, ${transparency * 0.75})`);
        root.style.setProperty('--scrollbar-background', `rgba(0, 0, 0, ${transparency * 0.5})`);
    }

    disconnectedCallback() {
        super.disconnectedCallback();
        if (window.require) {
            const { ipcRenderer } = window.require('electron');
            ipcRenderer.removeAllListeners('update-response');
            ipcRenderer.removeAllListeners('update-status');
            ipcRenderer.removeAllListeners('click-through-toggled');
            ipcRenderer.removeAllListeners('response-complete');
            ipcRenderer.removeAllListeners('increase-transparency');
            ipcRenderer.removeAllListeners('decrease-transparency');
            ipcRenderer.removeAllListeners('toggle-theme');
            ipcRenderer.removeAllListeners('session-initializing');
            ipcRenderer.removeAllListeners('realtime-state');
            ipcRenderer.removeAllListeners('codex-chat-status');
            ipcRenderer.removeAllListeners('codex-reasoning-delta');
            ipcRenderer.removeAllListeners('codex-chat-delta');
            ipcRenderer.removeAllListeners('codex-chat-message');
            ipcRenderer.removeAllListeners('codex-chat-error');
        }
        this.stopCodexTimer();
    }

    setStatus(text) {
        this.statusText = text;
        // Note: We no longer set _currentResponseIsComplete here
        // because we now rely on explicit 'response-complete' events
    }

    setResponse(responsePayload) {
        let responseText = responsePayload;
        let shouldAnimate = true;

        // Check if response is an object with text and animate properties
        if (typeof responsePayload === 'object' && responsePayload !== null && responsePayload.text !== undefined) {
            responseText = responsePayload.text;
            if (responsePayload.animate !== undefined) {
                shouldAnimate = responsePayload.animate;
            }
        }

        const preview = responseText.substring(0, 50).replace(/\n/g, ' ');
        console.log(
            '[setResponse] Called with:',
            preview +
                '... (len=' +
                responseText.length +
                ') awaiting=' +
                this._awaitingNewResponse +
                ' complete=' +
                this._currentResponseIsComplete +
                ' animate=' +
                shouldAnimate
        );

        if (this._awaitingNewResponse || this.responses.length === 0) {
            // Always add as new response when explicitly waiting for one or if no responses exist
            this.responses = [...this.responses, responseText];
            this.currentResponseIndex = this.responses.length - 1;
            this._awaitingNewResponse = false;
            this._currentResponseIsComplete = false;
            console.log('[setResponse] → PUSHED NEW response #' + this.responses.length);
        } else if (!this._currentResponseIsComplete && this.responses.length > 0) {
            // Update the last response (streaming behavior)
            // Only update if the current response is not marked as complete
            this.responses = [...this.responses.slice(0, this.responses.length - 1), responseText];
            console.log('[setResponse] → UPDATED existing response #' + this.responses.length);
        } else {
            // When current response is complete, add as new
            this.responses = [...this.responses, responseText];
            this.currentResponseIndex = this.responses.length - 1;
            this._currentResponseIsComplete = false;
            console.log('[setResponse] → ADDED NEW (complete was true) #' + this.responses.length);
        }
        this.shouldAnimateResponse = shouldAnimate;
        this.requestUpdate();
    }

    // Header event handlers
    handleCustomizeClick() {
        this.currentView = 'customize';
        this.requestUpdate();
    }

    handleHelpClick() {
        this.currentView = 'help';
        this.requestUpdate();
    }

    handleHistoryClick() {
        this.currentView = 'history';
        this.requestUpdate();
    }

    handleAdvancedClick() {
        this.currentView = 'advanced';
        this.requestUpdate();
    }

    async handleClose() {
        if (this.currentView === 'customize' || this.currentView === 'help' || this.currentView === 'history') {
            this.currentView = 'main';
        } else if (this.currentView === 'assistant') {
            audioprocess.stopCapture();

            // Close the session (check which type)
            if (window.require) {
                const { ipcRenderer } = window.require('electron');
                await ipcRenderer.invoke('codex-abort').catch(() => {});
                // Try to close both session types (only one will be active)
                await ipcRenderer.invoke('close-session').catch(() => {});
                await ipcRenderer.invoke('close-openai-session').catch(() => {});
                await ipcRenderer.invoke('codex-clear-history').catch(() => {});
            }
            this.sessionActive = false;
            this.resetSessionState();
            this.currentView = 'main';
            console.log('Session closed');
        } else if (this.currentView === 'chat') {
            // Close chat view and return to main
            if (window.require) {
                const { ipcRenderer } = window.require('electron');
                await ipcRenderer.invoke('clear-standard-chat-history');
            }
            this.currentView = 'main';
            console.log('Chat closed');
        } else {
            // Quit the entire application
            if (window.require) {
                const { ipcRenderer } = window.require('electron');
                await ipcRenderer.invoke('quit-application');
            }
        }
    }

    async handleHideToggle() {
        if (window.require) {
            const { ipcRenderer } = window.require('electron');
            await ipcRenderer.invoke('toggle-window-visibility');
        }
    }

    // Main view event handlers
    async handleStart() {
        // check if api key is empty do nothing
        const apiKey = localStorage.getItem('apiKey')?.trim();
        if (!apiKey || apiKey === '') {
            // Trigger the red blink animation on the API key input
            const mainView = this.shadowRoot.querySelector('main-view');
            if (mainView && mainView.triggerApiKeyError) {
                mainView.triggerApiKeyError();
            }
            return;
        }

        this.sessionProvider = 'gemini';
        await audioprocess.initializeGemini(this.selectedProfile, this.selectedLanguage);
        // Pass the screenshot interval as string (including 'manual' option)
        audioprocess.startCapture(this.selectedScreenshotInterval, this.selectedImageQuality);
        this.responses = [];
        this.currentResponseIndex = -1;
        this._awaitingNewResponse = false;
        this._currentResponseIsComplete = false;
        this.startTime = Date.now();
        this.currentView = 'assistant';
        console.log('[handleStart] Session started - flags reset');
    }

    async handleStartOpenAI() {
        // check if api key is empty do nothing
        const apiKey = localStorage.getItem('openaiApiKey')?.trim();
        if (!apiKey || apiKey === '') {
            // Trigger the red blink animation on the API key input
            const mainView = this.shadowRoot.querySelector('main-view');
            if (mainView && mainView.triggerOpenAIApiKeyError) {
                mainView.triggerOpenAIApiKeyError();
            }
            return;
        }

        this.sessionProvider = 'openai';
        this.activeSessionTab = 'realtime';
        this.realtimeActive = true;
        this.realtimeSuspended = false;

        // A new session starts with a clean chat tab.
        this.codexMessages = [];
        this.codexPendingImage = null;
        this.codexReasoningText = '';
        this.codexErrorText = '';
        this.codexStatusText = '';
        this.codexUnread = 0;
        this.stopCodexTimer();
        this.codexLoading = false;

        if (window.require) {
            const { ipcRenderer } = window.require('electron');
            await ipcRenderer.invoke('codex-clear-history').catch(() => {});
            await ipcRenderer.invoke('codex-set-effort', { effort: this.codexReasoningEffort }).catch(() => {});
        }

        await audioprocess.initializeOpenAI(this.selectedProfile, this.selectedLanguage);
        // Pass the screenshot interval as string (including 'manual' option)
        audioprocess.startCapture(this.selectedScreenshotInterval, this.selectedImageQuality, 'openai');
        this.responses = [];
        this.currentResponseIndex = -1;
        this._awaitingNewResponse = false;
        this._currentResponseIsComplete = false;
        this.startTime = Date.now();
        this.currentView = 'assistant';
        console.log('[handleStartOpenAI] OpenAI session started - flags reset');
    }

    resetSessionState() {
        this.sessionProvider = null;
        this.activeSessionTab = 'realtime';
        this.realtimeActive = false;
        this.realtimeBusy = false;
        this.realtimeSuspended = false;
        this.stopCodexTimer();
        this.codexMessages = [];
        this.codexLoading = false;
        this.codexPendingImage = null;
        this.codexStatusText = '';
        this.codexReasoningText = '';
        this.codexErrorText = '';
        this.codexElapsedSeconds = 0;
        this.codexUnread = 0;
    }

    // ---- Realtime tab lifecycle ----

    handleRealtimeState(payload) {
        const state = payload?.state;
        if (state === 'active') {
            this.realtimeActive = true;
            this.realtimeSuspended = false;
            this.realtimeBusy = false;
        } else if (state === 'suspended') {
            this.realtimeActive = false;
            this.realtimeSuspended = true;
            this.realtimeBusy = false;
        } else if (state === 'connecting') {
            this.realtimeBusy = true;
        } else if (state === 'error') {
            this.realtimeActive = false;
            this.realtimeBusy = false;
        }
    }

    async handleSessionTabChange(tab) {
        if (tab === this.activeSessionTab) return;
        this.activeSessionTab = tab;

        if (tab === 'codex') {
            this.codexUnread = 0;
            return;
        }

        // Switching back to the realtime tab transparently resumes a paused session.
        if (tab === 'realtime' && this.realtimeSuspended && !this.realtimeBusy) {
            await this.startRealtime();
        }
    }

    async handleToggleRealtime() {
        if (this.realtimeBusy) return;
        if (this.realtimeActive) {
            await this.stopRealtime();
        } else {
            await this.startRealtime();
        }
    }

    async stopRealtime() {
        if (!window.require || this.realtimeBusy) return;
        this.realtimeBusy = true;
        this.setStatus('Pausing realtime...');

        try {
            const { ipcRenderer } = window.require('electron');
            // Suspends audio only; mediaStream stays alive so screenshots keep
            // working and resuming never re-prompts for screen access.
            await window.audioprocess.suspendRealtimeAudio().catch(() => {});
            await ipcRenderer.invoke('suspend-realtime-openai').catch(() => {});
            this.realtimeActive = false;
            this.realtimeSuspended = true;
            this.setStatus('Realtime paused');
        } finally {
            this.realtimeBusy = false;
        }
    }

    async startRealtime() {
        if (!window.require || this.realtimeBusy) return;
        this.realtimeBusy = true;
        this.setStatus('Resuming realtime...');

        try {
            const { ipcRenderer } = window.require('electron');
            const result = await ipcRenderer.invoke('resume-realtime-openai').catch(err => ({ success: false, error: err.message }));

            if (!result || !result.success) {
                this.setStatus('Failed to resume realtime: ' + (result?.error || 'unknown error'));
                this.realtimeActive = false;
                return;
            }

            await window.audioprocess.resumeRealtimeAudio('openai').catch(() => {});
            this.realtimeActive = true;
            this.realtimeSuspended = false;
            this.setStatus('Listening...');
        } finally {
            this.realtimeBusy = false;
        }
    }

    // ---- Codex (gpt-5.5) tab ----

    startCodexTimer() {
        this.stopCodexTimer();
        this._codexStartedAt = Date.now();
        this.codexElapsedSeconds = 0;
        this._codexTimer = setInterval(() => {
            this.codexElapsedSeconds = Math.floor((Date.now() - this._codexStartedAt) / 1000);
        }, 1000);
    }

    stopCodexTimer() {
        if (this._codexTimer) {
            clearInterval(this._codexTimer);
            this._codexTimer = null;
        }
        this._codexStartedAt = null;
    }

    handleCodexStatus(payload) {
        const state = payload?.state;
        this.codexStatusText = payload?.message || '';

        if (state === 'thinking') {
            this.codexLoading = true;
            this.codexErrorText = '';
            this.codexReasoningText = '';
            this.startCodexTimer();
        } else if (state === 'streaming') {
            this.codexLoading = true;
        } else if (state === 'done' || state === 'aborted') {
            this.stopCodexTimer();
            this.codexLoading = false;
            this.codexReasoningText = '';
        } else if (state === 'error') {
            this.stopCodexTimer();
            this.codexLoading = false;
            if (payload?.message) this.codexErrorText = payload.message;
        }
    }

    upsertCodexMessage(message) {
        if (!message || !message.id) return;

        const index = this.codexMessages.findIndex(existing => existing.id === message.id);
        if (index === -1) {
            this.codexMessages = [...this.codexMessages, { timestamp: Date.now(), ...message }];
            return;
        }

        const merged = { ...this.codexMessages[index], ...message };
        this.codexMessages = [...this.codexMessages.slice(0, index), merged, ...this.codexMessages.slice(index + 1)];
    }

    async handleCodexSend(message) {
        if (!window.require) return;
        const text = (message || '').trim();
        const imageData = this.codexPendingImage;
        if (!text && !imageData) return;

        this.codexErrorText = '';
        this.codexPendingImage = null;
        this.codexLoading = true;
        this.startCodexTimer();

        const { ipcRenderer } = window.require('electron');
        const result = await ipcRenderer
            .invoke('codex-send-message', { text, imageData, effort: this.codexReasoningEffort })
            .catch(err => ({ success: false, error: err.message }));

        if (result && !result.success && !result.aborted) {
            this.stopCodexTimer();
            this.codexLoading = false;
            this.codexErrorText = result.error || 'GPT-5.5 request failed';
        }
    }

    /** Camera button: attach a screenshot preview the user can send with a prompt. */
    async handleCodexScreenshot() {
        if (!window.require) return;
        this.codexErrorText = '';

        const { ipcRenderer } = window.require('electron');
        const result = await ipcRenderer.invoke('codex-capture-screenshot').catch(err => ({ success: false, error: err.message }));

        if (!result || !result.success) {
            this.codexErrorText = result?.error || 'Screenshot capture failed';
            return;
        }
        this.codexPendingImage = result.imageData;
    }

    /** Cmd/Ctrl+Enter in the chat tab: capture and send in one step. */
    async handleCodexCaptureAndSend() {
        if (!window.require) return;

        const sessionView = this.shadowRoot?.querySelector('openai-session-view');
        const text = sessionView?.getPendingPrompt?.() || '';
        sessionView?.clearActiveInput?.();

        this.codexErrorText = '';
        this.codexLoading = true;
        this.startCodexTimer();

        const { ipcRenderer } = window.require('electron');
        const result = await ipcRenderer
            .invoke('codex-capture-and-send', { text, effort: this.codexReasoningEffort })
            .catch(err => ({ success: false, error: err.message }));

        if (result && !result.success && !result.aborted) {
            this.stopCodexTimer();
            this.codexLoading = false;
            this.codexErrorText = result.error || 'GPT-5.5 request failed';
        }
    }

    async handleCodexAbort() {
        if (!window.require) return;
        const { ipcRenderer } = window.require('electron');
        await ipcRenderer.invoke('codex-abort').catch(() => {});
    }

    async handleCodexClear() {
        if (!window.require) return;
        const { ipcRenderer } = window.require('electron');
        await ipcRenderer.invoke('codex-clear-history').catch(() => {});
        this.stopCodexTimer();
        this.codexMessages = [];
        this.codexLoading = false;
        this.codexPendingImage = null;
        this.codexReasoningText = '';
        this.codexErrorText = '';
        this.codexUnread = 0;
    }

    async handleCodexEffortChange(effort) {
        this.codexReasoningEffort = effort;
        localStorage.setItem('codexReasoningEffort', effort);
        if (window.require) {
            const { ipcRenderer } = window.require('electron');
            await ipcRenderer.invoke('codex-set-effort', { effort }).catch(() => {});
        }
    }

    /** Used by renderer.js handleShortcut to build the screenshot prompt. */
    getActiveTabPrompt() {
        return this.shadowRoot?.querySelector('openai-session-view')?.getPendingPrompt?.() || '';
    }

    async handleAPIKeyHelp() {
        if (window.require) {
            const { ipcRenderer } = window.require('electron');
            await ipcRenderer.invoke('open-external', 'https://example.com/help/api-key');
        }
    }

    // Customize view event handlers
    handleProfileChange(profile) {
        this.selectedProfile = profile;
    }

    handleLanguageChange(language) {
        this.selectedLanguage = language;
    }

    handleScreenshotIntervalChange(interval) {
        this.selectedScreenshotInterval = interval;
    }

    handleSendScreenshotsChange(enabled) {
        this.sendScreenshotsEnabled = enabled;
    }

    handleImageQualityChange(quality) {
        this.selectedImageQuality = quality;
        localStorage.setItem('selectedImageQuality', quality);
    }

    handleAdvancedModeChange(advancedMode) {
        this.advancedMode = advancedMode;
        localStorage.setItem('advancedMode', advancedMode.toString());
    }

    handleBackClick() {
        this.currentView = 'main';
        this.requestUpdate();
    }

    // Help view event handlers
    async handleExternalLinkClick(url) {
        if (window.require) {
            const { ipcRenderer } = window.require('electron');
            await ipcRenderer.invoke('open-external', url);
        }
    }

    // Assistant view event handlers.
    // Routing is explicit: a failed OpenAI send must never fall through to Gemini,
    // which is what happened whenever the realtime socket was not connected.
    async handleSendText(message) {
        const provider = this.sessionProvider || (window.audioprocess.getCurrentProvider?.() === 'openai' ? 'openai' : 'gemini');

        const result =
            provider === 'openai'
                ? await window.audioprocess.sendTextMessageOpenAI(message).catch(err => ({ success: false, error: err.message }))
                : await window.audioprocess.sendTextMessage(message).catch(err => ({ success: false, error: err.message }));

        if (!result || !result.success) {
            if (result?.code === 'REALTIME_NOT_CONNECTED') {
                this.setStatus('Realtime is paused - press Start realtime to resume');
                return;
            }
            console.error('Failed to send message:', result?.error);
            this.setStatus('Error sending message: ' + (result?.error || 'unknown error'));
            return;
        }

        this.setStatus('Message sent...');
        this._awaitingNewResponse = true;
    }

    handleResponseIndexChanged(e) {
        this.currentResponseIndex = e.detail.index;
        this.shouldAnimateResponse = false;
        this.requestUpdate();
    }

    // Onboarding event handlers
    handleOnboardingComplete() {
        this.currentView = 'main';
    }

    updated(changedProperties) {
        super.updated(changedProperties);

        // Only notify main process of view change if the view actually changed
        if (changedProperties.has('currentView') && window.require) {
            const { ipcRenderer } = window.require('electron');
            ipcRenderer.send('view-changed', this.currentView);

            // Add a small delay to smooth out the transition
            const viewContainer = this.shadowRoot?.querySelector('.view-container');
            if (viewContainer) {
                viewContainer.classList.add('entering');
                requestAnimationFrame(() => {
                    viewContainer.classList.remove('entering');
                });
            }
        }

        // Only update localStorage when these specific properties change
        if (changedProperties.has('selectedProfile')) {
            localStorage.setItem('selectedProfile', this.selectedProfile);
        }
        if (changedProperties.has('selectedLanguage')) {
            localStorage.setItem('selectedLanguage', this.selectedLanguage);
        }
        if (changedProperties.has('selectedScreenshotInterval')) {
            localStorage.setItem('selectedScreenshotInterval', this.selectedScreenshotInterval);
        }
        if (changedProperties.has('sendScreenshotsEnabled')) {
            localStorage.setItem('sendScreenshotsEnabled', this.sendScreenshotsEnabled ? 'true' : 'false');
        }
        if (changedProperties.has('selectedImageQuality')) {
            localStorage.setItem('selectedImageQuality', this.selectedImageQuality);
        }
        if (changedProperties.has('layoutMode')) {
            this.updateLayoutMode();
        }
        if (changedProperties.has('advancedMode')) {
            localStorage.setItem('advancedMode', this.advancedMode.toString());
        }
        if (changedProperties.has('themeMode')) {
            this.updateThemeMode();
        }
    }

    renderCurrentView() {
        // Only re-render the view if it hasn't been cached or if critical properties changed
        const viewKey = `${this.currentView}-${this.selectedProfile}-${this.selectedLanguage}`;

        switch (this.currentView) {
            case 'onboarding':
                return html`
                    <onboarding-view .onComplete=${() => this.handleOnboardingComplete()} .onClose=${() => this.handleClose()}></onboarding-view>
                `;

            case 'main':
                return html`
                    <main-view
                        .onStart=${() => this.handleStart()}
                        .onStartChat=${() => this.handleStartChat()}
                        .onStartOpenAI=${() => this.handleStartOpenAI()}
                        .onAPIKeyHelp=${() => this.handleAPIKeyHelp()}
                        .onLayoutModeChange=${layoutMode => this.handleLayoutModeChange(layoutMode)}
                    ></main-view>
                `;

            case 'customize':
                return html`
                    <customize-view
                        .selectedProfile=${this.selectedProfile}
                        .selectedLanguage=${this.selectedLanguage}
                        .selectedScreenshotInterval=${this.selectedScreenshotInterval}
                        .sendScreenshotsEnabled=${this.sendScreenshotsEnabled}
                        .selectedImageQuality=${this.selectedImageQuality}
                        .layoutMode=${this.layoutMode}
                        .advancedMode=${this.advancedMode}
                        .onProfileChange=${profile => this.handleProfileChange(profile)}
                        .onLanguageChange=${language => this.handleLanguageChange(language)}
                        .onScreenshotIntervalChange=${interval => this.handleScreenshotIntervalChange(interval)}
                        .onSendScreenshotsChange=${enabled => this.handleSendScreenshotsChange(enabled)}
                        .onImageQualityChange=${quality => this.handleImageQualityChange(quality)}
                        .onLayoutModeChange=${layoutMode => this.handleLayoutModeChange(layoutMode)}
                        .onAdvancedModeChange=${advancedMode => this.handleAdvancedModeChange(advancedMode)}
                        .themeMode=${this.themeMode}
                        .onThemeModeChange=${themeMode => this.handleThemeModeChange(themeMode)}
                    ></customize-view>
                `;

            case 'help':
                return html` <help-view .onExternalLinkClick=${url => this.handleExternalLinkClick(url)}></help-view> `;

            case 'history':
                return html` <history-view></history-view> `;

            case 'advanced':
                return html` <advanced-view></advanced-view> `;

            case 'assistant':
                return this.sessionProvider === 'openai' ? this.renderOpenAISessionView() : this.renderAssistantView();

            case 'chat':
                return html` <chat-view></chat-view> `;

            default:
                return html`<div>Unknown view: ${this.currentView}</div>`;
        }
    }

    handleResponseAnimationComplete() {
        this.shouldAnimateResponse = false;
        this._currentResponseIsComplete = true;
        console.log('[response-animation-complete] Marked current response as complete');
        this.requestUpdate();
    }

    // Gemini sessions keep the single-pane assistant view unchanged.
    renderAssistantView() {
        return html`
            <assistant-view
                .responses=${this.responses}
                .currentResponseIndex=${this.currentResponseIndex}
                .selectedProfile=${this.selectedProfile}
                .onSendText=${message => this.handleSendText(message)}
                .shouldAnimateResponse=${this.shouldAnimateResponse}
                @response-index-changed=${this.handleResponseIndexChanged}
                @response-animation-complete=${() => this.handleResponseAnimationComplete()}
            ></assistant-view>
        `;
    }

    renderOpenAISessionView() {
        return html`
            <openai-session-view
                .activeTab=${this.activeSessionTab}
                ?isClickThrough=${this._isClickThrough}
                ?compact=${this.layoutMode === 'compact'}
                .responses=${this.responses}
                .currentResponseIndex=${this.currentResponseIndex}
                .selectedProfile=${this.selectedProfile}
                .shouldAnimateResponse=${this.shouldAnimateResponse}
                .realtimeActive=${this.realtimeActive}
                .realtimeBusy=${this.realtimeBusy}
                .codexMessages=${this.codexMessages}
                .codexLoading=${this.codexLoading}
                .codexPendingImage=${this.codexPendingImage}
                .codexReasoningEffort=${this.codexReasoningEffort}
                .codexReasoningText=${this.codexReasoningText}
                .codexErrorText=${this.codexErrorText}
                .codexElapsedSeconds=${this.codexElapsedSeconds}
                .codexUnread=${this.codexUnread}
                .onTabChange=${tab => this.handleSessionTabChange(tab)}
                .onToggleRealtime=${() => this.handleToggleRealtime()}
                .onSendRealtimeText=${message => this.handleSendText(message)}
                .onResponseIndexChanged=${e => this.handleResponseIndexChanged(e)}
                .onCodexSend=${message => this.handleCodexSend(message)}
                .onCodexScreenshot=${() => this.handleCodexScreenshot()}
                .onCodexRemoveImage=${() => {
                    this.codexPendingImage = null;
                }}
                .onCodexClear=${() => this.handleCodexClear()}
                .onCodexAbort=${() => this.handleCodexAbort()}
                .onCodexEffortChange=${effort => this.handleCodexEffortChange(effort)}
                @response-animation-complete=${() => this.handleResponseAnimationComplete()}
            ></openai-session-view>
        `;
    }

    handleStartChat() {
        this.currentView = 'chat';
    }

    render() {
        const mainContentClass = `main-content ${
            this.currentView === 'assistant' || this.currentView === 'chat'
                ? 'assistant-view'
                : this.currentView === 'onboarding'
                  ? 'onboarding-view'
                  : 'with-border'
        }`;

        return html`
            <div class="window-container">
                <div class="container">
                    <app-header
                        .currentView=${this.currentView}
                        .statusText=${this.statusText}
                        .startTime=${this.startTime}
                        .advancedMode=${this.advancedMode}
                        .onCustomizeClick=${() => this.handleCustomizeClick()}
                        .onHelpClick=${() => this.handleHelpClick()}
                        .onHistoryClick=${() => this.handleHistoryClick()}
                        .onAdvancedClick=${() => this.handleAdvancedClick()}
                        .onCloseClick=${() => this.handleClose()}
                        .onBackClick=${() => this.handleBackClick()}
                        .onHideToggleClick=${() => this.handleHideToggle()}
                        .sessionProvider=${this.sessionProvider}
                        .sessionTab=${this.activeSessionTab}
                        .realtimeActive=${this.realtimeActive}
                        .codexLoading=${this.codexLoading}
                        .codexReasoningEffort=${this.codexReasoningEffort}
                        ?isClickThrough=${this._isClickThrough}
                    ></app-header>
                    <div class="${mainContentClass}">
                        <div class="view-container">${this.renderCurrentView()}</div>
                    </div>
                </div>
            </div>
        `;
    }

    updateLayoutMode() {
        // Apply or remove compact layout class to document root
        if (this.layoutMode === 'compact') {
            document.documentElement.classList.add('compact-layout');
        } else {
            document.documentElement.classList.remove('compact-layout');
        }
    }

    async handleLayoutModeChange(layoutMode) {
        this.layoutMode = layoutMode;
        localStorage.setItem('layoutMode', layoutMode);
        this.updateLayoutMode();

        // Notify main process about layout change for window resizing
        if (window.require) {
            try {
                const { ipcRenderer } = window.require('electron');
                await ipcRenderer.invoke('update-sizes');
            } catch (error) {
                console.error('Failed to update sizes in main process:', error);
            }
        }

        this.requestUpdate();
    }

    updateThemeMode() {
        // Apply or remove light mode class to document root
        if (this.themeMode === 'light') {
            document.documentElement.classList.add('light-mode');
        } else {
            document.documentElement.classList.remove('light-mode');
        }
    }

    async handleThemeModeChange(themeMode) {
        this.themeMode = themeMode;
        localStorage.setItem('themeMode', themeMode);
        this.updateThemeMode();
        this.requestUpdate();
    }

    toggleTheme() {
        // Toggle between light and dark mode
        this.themeMode = this.themeMode === 'light' ? 'dark' : 'light';
        localStorage.setItem('themeMode', this.themeMode);
        this.updateThemeMode();
        this.requestUpdate();
        console.log('Theme toggled to:', this.themeMode);
    }
}

customElements.define('audio-process-app', AudioProcessApp);
