// Pins the exact wire format sent to the OpenAI Realtime API. These frames are
// the contract for the Realtime tab: text and screenshots must travel over the
// WebSocket, not through a separate REST model.

const sentFrames = [];
const rendererSends = [];

const WS_OPEN = 1;
const mockSocket = { readyState: WS_OPEN, send: frame => sentFrames.push(JSON.parse(frame)), close: vi.fn() };

const constructedSockets = [];

class MockWebSocket {
    constructor() {
        this.readyState = WS_OPEN;
        this.handlers = {};
        this.frames = [];
        constructedSockets.push(this);
    }
    on(event, handler) {
        this.handlers[event] = handler;
    }
    send(frame) {
        this.frames.push(JSON.parse(frame));
    }
    close() {}
}
MockWebSocket.OPEN = WS_OPEN;

const wsPath = require.resolve('ws');
require.cache[wsPath] = { id: wsPath, filename: wsPath, loaded: true, exports: MockWebSocket };

const handlers = {};
const electronPath = require.resolve('electron');
require.cache[electronPath] = {
    id: electronPath,
    filename: electronPath,
    loaded: true,
    exports: {
        BrowserWindow: {
            getAllWindows: vi.fn(() => [
                {
                    webContents: {
                        send: (channel, data) => rendererSends.push({ channel, data }),
                        executeJavaScript: vi.fn(() => Promise.resolve('sk-test')),
                    },
                },
            ]),
        },
        ipcMain: {
            handle: (channel, fn) => {
                handlers[channel] = fn;
            },
            on: vi.fn(),
        },
        desktopCapturer: { getSources: vi.fn() },
        screen: { getPrimaryDisplay: vi.fn(() => ({ size: { width: 100, height: 100 } })) },
        shell: { openExternal: vi.fn() },
    },
};

const { setupOpenAIIpcHandlers } = require('../utils/openai');

const sessionRef = { current: mockSocket };
setupOpenAIIpcHandlers(sessionRef);

const BASE64_IMAGE = 'a'.repeat(200);

describe('OpenAI realtime text and image frames', () => {
    beforeEach(() => {
        sentFrames.length = 0;
        rendererSends.length = 0;
        sessionRef.current = mockSocket;
        mockSocket.readyState = WS_OPEN;
    });

    it('sends typed text as a realtime conversation item followed by response.create', async () => {
        const result = await handlers['send-text-message-openai']({}, '  explain this bug  ');

        expect(result).toEqual({ success: true });
        expect(sentFrames).toHaveLength(2);
        expect(sentFrames[0]).toEqual({
            type: 'conversation.item.create',
            item: {
                type: 'message',
                role: 'user',
                content: [{ type: 'input_text', text: 'explain this bug' }],
            },
        });
        expect(sentFrames[1]).toEqual({ type: 'response.create' });
    });

    it('sends screenshots as an input_image conversation item alongside the prompt', async () => {
        const result = await handlers['send-image-content-openai']({}, { data: BASE64_IMAGE, prompt: 'what is wrong here?' });

        expect(result).toEqual({ success: true });
        expect(sentFrames).toHaveLength(2);
        expect(sentFrames[0].item.content).toEqual([
            { type: 'input_text', text: 'what is wrong here?' },
            { type: 'input_image', image_url: `data:image/jpeg;base64,${BASE64_IMAGE}`, detail: 'auto' },
        ]);
        expect(sentFrames[1]).toEqual({ type: 'response.create' });
    });

    it('omits the text part when no prompt was typed', async () => {
        await handlers['send-image-content-openai']({}, { data: BASE64_IMAGE, prompt: '   ' });

        expect(sentFrames[0].item.content).toEqual([{ type: 'input_image', image_url: `data:image/jpeg;base64,${BASE64_IMAGE}`, detail: 'auto' }]);
    });

    it('reports a distinguishable code when the socket is closed so callers never fall back to another provider', async () => {
        sessionRef.current = null;

        const textResult = await handlers['send-text-message-openai']({}, 'hello');
        const imageResult = await handlers['send-image-content-openai']({}, { data: BASE64_IMAGE });

        expect(textResult.success).toBe(false);
        expect(textResult.code).toBe('REALTIME_NOT_CONNECTED');
        expect(imageResult.code).toBe('REALTIME_NOT_CONNECTED');
        expect(sentFrames).toHaveLength(0);
    });

    it('rejects empty text and undersized image payloads without touching the socket', async () => {
        expect((await handlers['send-text-message-openai']({}, '   ')).success).toBe(false);
        expect((await handlers['send-image-content-openai']({}, { data: 'tiny' })).success).toBe(false);
        expect(sentFrames).toHaveLength(0);
    });

    it('opens a text-only listening session with no input transcription', async () => {
        constructedSockets.length = 0;

        const { initializeOpenAISession } = require('../utils/openai');
        await initializeOpenAISession('sk-test', 'my context', 'interview', 'fr-FR');

        const socket = constructedSockets.at(-1);
        socket.handlers.open();

        const sessionUpdate = socket.frames.find(frame => frame.type === 'session.update');
        expect(sessionUpdate).toBeDefined();
        expect(sessionUpdate.session.output_modalities).toEqual(['text']);
        // audio.output is deliberately absent: including it would require a rate
        // parameter and produce spoken responses.
        expect(sessionUpdate.session.audio.output).toBeUndefined();
        // The tab only surfaces answers, so we never pay to transcribe the input.
        expect(sessionUpdate.session.audio.input.transcription).toBeUndefined();
        expect(sessionUpdate.session.audio.input.format).toEqual({ type: 'audio/pcm', rate: 24000 });
        expect(sessionUpdate.session.audio.input.turn_detection).toEqual({ type: 'semantic_vad' });
        expect(sessionUpdate.session.instructions).toContain('my context');
    });

    it('keeps the session resumable after the socket closes', async () => {
        constructedSockets.length = 0;

        const { initializeOpenAISession, saveConversationTurn, getCurrentSessionData, getRealtimeState } = require('../utils/openai');
        await initializeOpenAISession('sk-test', '', 'interview', 'en-US');
        saveConversationTurn('a question', 'an answer');

        const sessionId = getCurrentSessionData().sessionId;
        constructedSockets.at(-1).handlers.close(1000, 'bye');

        // The close handler must not wipe the credentials or history, or a resume
        // would silently start a brand new session.
        expect(getRealtimeState().hasConfig).toBe(true);
        expect(getCurrentSessionData().sessionId).toBe(sessionId);
        expect(getCurrentSessionData().history).toHaveLength(1);
    });

    it('replays prior turns into a resumed session', async () => {
        const { initializeOpenAISession, initializeNewSession, saveConversationTurn } = require('../utils/openai');
        initializeNewSession();
        saveConversationTurn('earlier question', 'earlier answer');

        constructedSockets.length = 0;
        await initializeOpenAISession('sk-test', '', 'interview', 'en-US', { preserveConversation: true });

        const socket = constructedSockets.at(-1);
        socket.handlers.open();

        const items = socket.frames.filter(frame => frame.type === 'conversation.item.create');
        expect(items).toHaveLength(2);
        expect(items[0].item.role).toBe('user');
        expect(items[0].item.content[0].text).toBe('earlier question');
        expect(items[1].item.role).toBe('assistant');
    });

    // Reproduces the crash seen after an automatic restart:
    //   TypeError: Cannot read properties of null (reading 'send')
    // The previous socket's close event lands *after* the replacement has been
    // assigned. When handlers read the shared module variable, that close nulled
    // out the new socket and its open handler then called .send() on null.
    describe('socket replacement during a restart', () => {
        it('survives the old socket closing after the new one is created', async () => {
            constructedSockets.length = 0;
            const { initializeOpenAISession } = require('../utils/openai');

            await initializeOpenAISession('sk-test', '', 'interview', 'en-US');
            const oldSocket = constructedSockets.at(-1);

            // Restart: a fresh socket is created while the old one is still closing.
            await initializeOpenAISession('sk-test', '', 'interview', 'en-US', { preserveConversation: true });
            const newSocket = constructedSockets.at(-1);
            expect(newSocket).not.toBe(oldSocket);

            // The stale close arrives now, after the replacement exists.
            oldSocket.handlers.close(1000, 'suspended');

            // This used to throw; the session.update must still go out.
            expect(() => newSocket.handlers.open()).not.toThrow();
            expect(newSocket.frames.find(frame => frame.type === 'session.update')).toBeDefined();
        });

        it('ignores messages and errors from a superseded socket', async () => {
            constructedSockets.length = 0;
            const { initializeOpenAISession } = require('../utils/openai');

            await initializeOpenAISession('sk-test', '', 'interview', 'en-US');
            const oldSocket = constructedSockets.at(-1);
            await initializeOpenAISession('sk-test', '', 'interview', 'en-US', { preserveConversation: true });

            rendererSends.length = 0;
            oldSocket.handlers.message(JSON.stringify({ type: 'response.output_text.done', text: 'stale answer' }));
            oldSocket.handlers.error(new Error('stale failure'));

            // Nothing from the old socket may reach the UI.
            expect(rendererSends).toHaveLength(0);
        });

        it('closes a socket that connects after it was replaced', async () => {
            constructedSockets.length = 0;
            const { initializeOpenAISession } = require('../utils/openai');

            await initializeOpenAISession('sk-test', '', 'interview', 'en-US');
            const oldSocket = constructedSockets.at(-1);
            oldSocket.close = vi.fn();

            await initializeOpenAISession('sk-test', '', 'interview', 'en-US', { preserveConversation: true });

            // A late connect on the stale socket should hang up, not configure itself.
            oldSocket.handlers.open();
            expect(oldSocket.close).toHaveBeenCalled();
            expect(oldSocket.frames.find(frame => frame.type === 'session.update')).toBeUndefined();
        });
    });
});
