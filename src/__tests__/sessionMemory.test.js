// @vitest-environment jsdom

// Long sessions used to degrade the whole machine: updateResponseContent()
// re-renders every kept answer on each update (a marked.parse, a throwaway
// DOMParser document, and one <span data-word> per word), so an uncapped
// transcript grows the work quadratically and the live DOM without bound.
//
// Both the rendered transcript and the in-memory conversation history are capped,
// and the realtime socket is recycled on a timer.

const electronPath = require.resolve('electron');
require.cache[electronPath] = {
    id: electronPath,
    filename: electronPath,
    loaded: true,
    exports: {
        BrowserWindow: { getAllWindows: vi.fn(() => []) },
        ipcMain: { handle: vi.fn(), on: vi.fn() },
        desktopCapturer: { getSources: vi.fn() },
        screen: { getPrimaryDisplay: vi.fn(() => ({ size: { width: 100, height: 100 } })) },
        shell: { openExternal: vi.fn() },
    },
};

const { initializeNewSession, saveConversationTurn, getCurrentSessionData } = require('../utils/openai');

describe('realtime conversation history', () => {
    beforeEach(() => {
        initializeNewSession();
    });

    it('keeps only the most recent turns', () => {
        for (let i = 0; i < 40; i++) {
            saveConversationTurn(`question ${i}`, `answer ${i}`);
        }

        const { history } = getCurrentSessionData();
        expect(history).toHaveLength(15);
        // Oldest dropped, newest kept.
        expect(history[0].transcription).toBe('question 25');
        expect(history[14].transcription).toBe('question 39');
    });

    it('leaves a short session untouched', () => {
        saveConversationTurn('only question', 'only answer');

        const { history } = getCurrentSessionData();
        expect(history).toHaveLength(1);
        expect(history[0].ai_response).toBe('only answer');
    });
});

describe('rendered transcript cap', () => {
    let app;

    beforeEach(async () => {
        const { AudioProcessApp } = await import('../components/app/AudioProcessApp.js');
        app = new AudioProcessApp();
        // Keep Lit's scheduling out of it; only the reducer is under test.
        app.requestUpdate = () => {};
        app.responses = [];
        app.currentResponseIndex = -1;
    });

    /** Mirrors an answer arriving over IPC. */
    function arrive(app, text) {
        app._awaitingNewResponse = true;
        app.setResponse({ text, animate: false });
    }

    it('caps how many answers stay rendered', () => {
        for (let i = 0; i < 50; i++) {
            arrive(app, `answer ${i}`);
        }

        expect(app.responses).toHaveLength(15);
        expect(app.responses[0]).toBe('answer 35');
        expect(app.responses[14]).toBe('answer 49');
    });

    it('leaves the index on the newest answer after trimming', () => {
        for (let i = 0; i < 50; i++) {
            arrive(app, `answer ${i}`);
        }

        expect(app.currentResponseIndex).toBe(14);
        expect(app.responses[app.currentResponseIndex]).toBe('answer 49');
    });

    // The index shifting is unit-tested directly: setResponse always jumps the
    // index to the newest answer when one arrives (pre-existing behavior), so it
    // never exercises the shift on its own.
    it('shifts the index so it keeps pointing at the same answer', () => {
        app.responses = Array.from({ length: 18 }, (_, i) => `answer ${i}`);
        app.currentResponseIndex = 5;
        const viewed = app.responses[5];

        app.trimResponses();

        expect(app.responses).toHaveLength(15);
        expect(app.responses[app.currentResponseIndex]).toBe(viewed);
    });

    it('clamps rather than going negative when the viewed answer is dropped', () => {
        app.responses = Array.from({ length: 18 }, (_, i) => `answer ${i}`);
        // Viewing an answer that the trim is about to discard.
        app.currentResponseIndex = 1;

        app.trimResponses();

        expect(app.currentResponseIndex).toBe(0);
        expect(app.responses).toHaveLength(15);
        expect(app.responses[0]).toBe('answer 3');
    });

    it('does not trim a session that stays under the cap', () => {
        for (let i = 0; i < 15; i++) {
            arrive(app, `answer ${i}`);
        }

        expect(app.responses).toHaveLength(15);
        expect(app.responses[0]).toBe('answer 0');
    });
});

describe('periodic realtime restart', () => {
    let app;

    beforeEach(async () => {
        const { AudioProcessApp } = await import('../components/app/AudioProcessApp.js');
        app = new AudioProcessApp();
        app.requestUpdate = () => {};
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('recycles the socket after the interval', async () => {
        const calls = [];
        app.realtimeActive = true;
        app.currentView = 'assistant';
        app.stopRealtime = async () => calls.push('stop');
        app.startRealtime = async () => calls.push('start');

        app.scheduleRealtimeRestart();
        await vi.advanceTimersByTimeAsync(15 * 60 * 1000);

        expect(calls).toEqual(['stop', 'start']);
    });

    it('does not fire before the interval elapses', async () => {
        let fired = false;
        app.realtimeActive = true;
        app.currentView = 'assistant';
        app.stopRealtime = async () => (fired = true);
        app.startRealtime = async () => {};

        app.scheduleRealtimeRestart();
        await vi.advanceTimersByTimeAsync(14 * 60 * 1000);

        expect(fired).toBe(false);
    });

    it('skips the restart when realtime is already stopped', async () => {
        let fired = false;
        app.realtimeActive = false;
        app.currentView = 'assistant';
        app.stopRealtime = async () => (fired = true);

        app.scheduleRealtimeRestart();
        await vi.advanceTimersByTimeAsync(15 * 60 * 1000);

        expect(fired).toBe(false);
    });

    it('defers instead of interleaving with an in-flight transition', async () => {
        const calls = [];
        app.realtimeActive = true;
        app.realtimeBusy = true;
        app.currentView = 'assistant';
        app.stopRealtime = async () => calls.push('stop');
        app.startRealtime = async () => calls.push('start');

        app.scheduleRealtimeRestart();
        await vi.advanceTimersByTimeAsync(15 * 60 * 1000);
        expect(calls).toEqual([]);

        app.realtimeBusy = false;
        await vi.advanceTimersByTimeAsync(30 * 1000);
        expect(calls).toEqual(['stop', 'start']);
    });

    it('cancels the timer when the session closes', async () => {
        let fired = false;
        app.realtimeActive = true;
        app.currentView = 'assistant';
        app.stopRealtime = async () => (fired = true);

        app.scheduleRealtimeRestart();
        app.clearRealtimeRestart();
        await vi.advanceTimersByTimeAsync(20 * 60 * 1000);

        expect(fired).toBe(false);
    });
});

describe('realtime tunables come from openai.js', () => {
    // Values are deliberately not asserted: these constants exist to be tuned,
    // so pinning them here would make editing them look like a broken test.
    it('exposes every knob the renderer needs', () => {
        const { getRealtimeConfig } = require('../utils/openai');
        const config = getRealtimeConfig();

        expect(Object.keys(config).sort()).toEqual(['maxConversationTurns', 'maxVisibleResponses', 'replayTurns', 'restartIntervalMs']);

        // 0 is meaningful for these two: never restart / keep every answer.
        expect(config.restartIntervalMs).toBeGreaterThanOrEqual(0);
        expect(config.maxVisibleResponses).toBeGreaterThanOrEqual(0);
        expect(config.maxConversationTurns).toBeGreaterThan(0);
        expect(config.replayTurns).toBeGreaterThan(0);
    });

    it('never replays more turns than it keeps', () => {
        const { getRealtimeConfig } = require('../utils/openai');
        const config = getRealtimeConfig();

        // Replaying more than MAX_CONVERSATION_TURNS would silently replay fewer.
        expect(config.replayTurns).toBeLessThanOrEqual(config.maxConversationTurns);
    });

    it('honors a config fetched from the main process', async () => {
        const { AudioProcessApp } = await import('../components/app/AudioProcessApp.js');
        const app = new AudioProcessApp();
        app.requestUpdate = () => {};

        app._realtimeConfig = { restartIntervalMs: 60 * 1000, maxVisibleResponses: 3 };
        app.responses = ['a', 'b', 'c', 'd', 'e'];
        app.currentResponseIndex = 4;
        app.trimResponses();

        expect(app.responses).toEqual(['c', 'd', 'e']);
    });

    it('treats a zero interval as "never restart automatically"', async () => {
        const { AudioProcessApp } = await import('../components/app/AudioProcessApp.js');
        const app = new AudioProcessApp();
        app.requestUpdate = () => {};
        app._realtimeConfig = { restartIntervalMs: 0, maxVisibleResponses: 15 };

        app.scheduleRealtimeRestart();

        expect(app._realtimeRestartTimer).toBeNull();
    });

    it('treats a zero cap as "keep every answer"', async () => {
        const { AudioProcessApp } = await import('../components/app/AudioProcessApp.js');
        const app = new AudioProcessApp();
        app.requestUpdate = () => {};
        app._realtimeConfig = { restartIntervalMs: 0, maxVisibleResponses: 0 };
        app.responses = Array.from({ length: 40 }, (_, i) => `answer ${i}`);

        app.trimResponses();

        expect(app.responses).toHaveLength(40);
    });
});
