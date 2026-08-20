// The gpt-5.5 chat tab must stay fully independent of the realtime tab: its own
// server-side conversation chain, its own IPC channels, and no writes into the
// realtime transcript or the persisted session history.

const rendererSends = [];
const createdStreams = [];
let streamCalls = [];

class MockResponseStream {
    constructor(params) {
        this.params = params;
        this.listeners = {};
        this.aborted = false;
        createdStreams.push(this);
    }
    on(event, handler) {
        this.listeners[event] = handler;
        return this;
    }
    emit(event, payload) {
        this.listeners[event]?.(payload);
    }
    abort() {
        this.aborted = true;
        const error = new Error('Request was aborted.');
        error.name = 'APIUserAbortError';
        this._reject?.(error);
    }
    finalResponse() {
        return new Promise((resolve, reject) => {
            this._resolve = resolve;
            this._reject = reject;
        });
    }
}

class MockOpenAI {
    constructor(options) {
        this.options = options;
        this.responses = {
            stream: params => {
                streamCalls.push(params);
                return new MockResponseStream(params);
            },
        };
    }
}

const openaiPath = require.resolve('openai');
require.cache[openaiPath] = { id: openaiPath, filename: openaiPath, loaded: true, exports: MockOpenAI };

const handlers = {};
const electronPath = require.resolve('electron');
require.cache[electronPath] = {
    id: electronPath,
    filename: electronPath,
    loaded: true,
    exports: {
        BrowserWindow: { getAllWindows: vi.fn(() => []) },
        ipcMain: {
            handle: (channel, fn) => {
                handlers[channel] = fn;
            },
            on: vi.fn(),
        },
        desktopCapturer: { getSources: vi.fn(() => Promise.resolve([])) },
        screen: { getPrimaryDisplay: vi.fn(() => ({ size: { width: 1920, height: 1080 } })) },
        shell: { openExternal: vi.fn() },
    },
};

const { setupOpenAICodexIpcHandlers, resetCodexState, getCodexState } = require('../utils/openaiCodex');

setupOpenAICodexIpcHandlers({
    sendToRenderer: (channel, data) => rendererSends.push({ channel, data }),
    getApiKey: async () => 'sk-test',
    getSystemPrompt: () => 'SESSION PROMPT',
});

/** Drives a stream to completion the way the SDK would. */
function completeStream(stream, { text = 'the answer', id = 'resp_1', status = 'completed' } = {}) {
    stream.emit('response.output_text.delta', { delta: text });
    stream._resolve({ id, status, output_text: text, usage: { total_tokens: 10 } });
}

const flush = () => new Promise(resolve => setImmediate(resolve));

describe('Codex (gpt-5.5) chat tab', () => {
    beforeEach(() => {
        rendererSends.length = 0;
        createdStreams.length = 0;
        streamCalls = [];
        resetCodexState();
    });

    it('requests high reasoning effort with a summary so progress is visible during long waits', async () => {
        const pending = handlers['codex-send-message']({}, { text: 'why does this crash?' });
        await flush();

        expect(streamCalls).toHaveLength(1);
        const params = streamCalls[0];
        expect(params.model).toBe('gpt-5.5');
        expect(params.reasoning).toEqual({ effort: 'high', summary: 'auto' });
        expect(params.max_output_tokens).toBe(128000);
        expect(params.store).toBe(true);
        expect(params.instructions).toContain('SESSION PROMPT');
        expect(params.input).toEqual([{ role: 'user', content: [{ type: 'input_text', text: 'why does this crash?' }] }]);
        // First turn has nothing to chain to.
        expect(params.previous_response_id).toBeUndefined();

        completeStream(createdStreams[0]);
        await pending;
    });

    it('chains the next turn with previous_response_id and resends instructions', async () => {
        const first = handlers['codex-send-message']({}, { text: 'turn one' });
        await flush();
        completeStream(createdStreams[0], { id: 'resp_abc' });
        await first;

        const second = handlers['codex-send-message']({}, { text: 'elaborate' });
        await flush();

        expect(streamCalls[1].previous_response_id).toBe('resp_abc');
        // previous_response_id does not carry instructions forward.
        expect(streamCalls[1].instructions).toContain('SESSION PROMPT');

        completeStream(createdStreams[1], { id: 'resp_def' });
        await second;
        expect(getCodexState().previousResponseId).toBe('resp_def');
    });

    it('validates reasoning effort instead of letting the API reject it after a long wait', async () => {
        const bad = await handlers['codex-set-effort']({}, { effort: 'ludicrous' });
        expect(bad.success).toBe(false);

        const good = await handlers['codex-set-effort']({}, { effort: 'xhigh' });
        expect(good).toEqual({ success: true, effort: 'xhigh' });

        const pending = handlers['codex-send-message']({}, { text: 'hi', effort: 'nonsense' });
        await flush();
        // Falls back to the stored effort rather than sending garbage.
        expect(streamCalls[0].reasoning.effort).toBe('xhigh');
        completeStream(createdStreams[0]);
        await pending;
    });

    it('sends screenshots as input_image with a screenshot-specific prompt', async () => {
        const pending = handlers['codex-send-message']({}, { text: 'read this error', imageData: 'BASE64DATA' });
        await flush();

        const content = streamCalls[0].input[0].content;
        expect(content[0].type).toBe('input_text');
        expect(content[0].text).toContain('read this error');
        expect(content[1]).toEqual({ type: 'input_image', image_url: 'data:image/jpeg;base64,BASE64DATA', detail: 'high' });

        completeStream(createdStreams[0]);
        await pending;
    });

    it('replays an aborted turn so the follow-up still has a referent', async () => {
        const first = handlers['codex-send-message']({}, { text: 'a long question' });
        await flush();
        createdStreams[0].emit('response.output_text.delta', { delta: 'partial' });
        createdStreams[0].abort();

        const result = await first;
        expect(result.aborted).toBe(true);
        // The turn never committed server-side, so the chain must not advance.
        expect(getCodexState().previousResponseId).toBeNull();

        const second = handlers['codex-send-message']({}, { text: 'elaborate on that' });
        await flush();

        expect(streamCalls[1].input).toHaveLength(2);
        expect(streamCalls[1].input[0].content[0].text).toBe('a long question');
        expect(streamCalls[1].input[1].content[0].text).toBe('elaborate on that');

        completeStream(createdStreams[1]);
        await second;
        // Once a turn commits, the replay buffer is cleared.
        expect(getCodexState().previousResponseId).toBe('resp_1');
    });

    it('aborts the in-flight request when a new message is sent', async () => {
        const first = handlers['codex-send-message']({}, { text: 'first' });
        await flush();

        const second = handlers['codex-send-message']({}, { text: 'second' });
        await flush();

        expect(createdStreams[0].aborted).toBe(true);
        expect((await first).aborted).toBe(true);

        completeStream(createdStreams[1]);
        await second;
    });

    it('retries once without the chain when the stored response id is stale', async () => {
        const first = handlers['codex-send-message']({}, { text: 'turn one' });
        await flush();
        completeStream(createdStreams[0], { id: 'resp_expired' });
        await first;

        const second = handlers['codex-send-message']({}, { text: 'turn two' });
        await flush();

        const staleError = new Error('Previous response with id resp_expired not found.');
        staleError.status = 404;
        createdStreams[1]._reject(staleError);
        await flush();

        expect(streamCalls).toHaveLength(3);
        expect(streamCalls[2].previous_response_id).toBeUndefined();

        completeStream(createdStreams[2], { id: 'resp_new' });
        await second;
    });

    it('surfaces a truncated response instead of presenting it as complete', async () => {
        const pending = handlers['codex-send-message']({}, { text: 'write a book' });
        await flush();
        createdStreams[0].emit('response.output_text.delta', { delta: 'chapter one...' });
        createdStreams[0]._resolve({ id: 'resp_t', status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } });
        await pending;

        const errorStatus = rendererSends.find(s => s.channel === 'codex-chat-status' && s.data.state === 'error');
        expect(errorStatus.data.message).toContain('max_output_tokens');
    });

    it('never emits on the realtime channels', async () => {
        const pending = handlers['codex-send-message']({}, { text: 'hello' });
        await flush();
        createdStreams[0].emit('response.reasoning_summary_text.delta', { delta: 'thinking about it' });
        completeStream(createdStreams[0]);
        await pending;

        const channels = rendererSends.map(s => s.channel);
        expect(channels).not.toContain('update-response');
        expect(channels).not.toContain('response-complete');
        expect(channels).not.toContain('update-status');
        expect(channels).not.toContain('save-conversation-turn');
        expect(channels).toContain('codex-chat-delta');
        expect(channels).toContain('codex-chat-message');
        expect(channels).toContain('codex-reasoning-delta');
    });

    it('clears the chain and history on clear', async () => {
        const pending = handlers['codex-send-message']({}, { text: 'hello' });
        await flush();
        completeStream(createdStreams[0], { id: 'resp_x' });
        await pending;

        expect(getCodexState().history.length).toBeGreaterThan(0);
        await handlers['codex-clear-history']();

        expect(getCodexState().history).toEqual([]);
        expect(getCodexState().previousResponseId).toBeNull();
    });
});
