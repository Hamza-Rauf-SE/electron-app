const WebSocket = require('ws');
const { BrowserWindow, ipcMain } = require('electron');
const { getSystemPrompt } = require('./prompts');
const {
    killExistingSystemAudioDump,
    startMacOSAudioCapture: startSharedMacOSAudioCapture,
    convertStereoToMono,
    stopMacOSAudioCapture: stopSharedMacOSAudioCapture,
} = require('./audioCapture');
const { setupOpenAICodexIpcHandlers, resetCodexState, abortCodexStream } = require('./openaiCodex');

const OPENAI_REALTIME_MODEL = 'gpt-realtime-1.5';
// How many prior turns to replay into a freshly reconnected realtime conversation.
const REALTIME_REPLAY_TURNS = 10;
// History is held in memory and replayed on every reconnect, so it is capped
// rather than allowed to grow for the length of a session.
const MAX_CONVERSATION_TURNS = 15;
// How often the realtime socket is recycled. A long-lived session accumulates
// server-side context; reconnecting drops it, and the last
// REALTIME_REPLAY_TURNS are replayed so the conversation carries over.
// Set to 0 to disable automatic restarts.
const REALTIME_RESTART_INTERVAL_MS = 2 * 60 * 1000;
// How many answers stay rendered in the transcript. Every update re-renders all
// of them, so this bounds both the DOM size and the per-update work.
const MAX_VISIBLE_RESPONSES = 15;

// Conversation tracking variables
let currentSessionId = null;
let currentTranscription = '';
let conversationHistory = [];
let isInitializingSession = false;
let currentOpenAIApiKey = null;
let currentOpenAISystemPrompt = '';

let messageBuffer = '';

// WebSocket connection
let openaiWebSocket = null;
let openaiSessionRef = { current: null };

// Realtime lifecycle state. realtimeConfig must survive a socket close so the
// session can be suspended (Chat tab) and resumed without losing the session.
let realtimeConfig = null; // { apiKey, customPrompt, profile, language, systemPrompt }
let realtimeSuspended = false;
let realtimeAudioActive = false; // did we start SystemAudioDump?
let realtimeResponseActive = false; // a response is currently generating on the socket
let pendingRealtimeUserText = ''; // typed/image prompt awaiting a reply, for saveConversationTurn
let realtimeTransition = null; // serializes suspend/resume against the shared audio process

async function getOpenAIApiKeyFromStorage() {
    if (currentOpenAIApiKey) {
        return currentOpenAIApiKey;
    }

    const windows = BrowserWindow.getAllWindows();
    if (windows.length === 0) {
        return null;
    }

    const apiKey = await windows[0].webContents.executeJavaScript(`
        localStorage.getItem('openaiApiKey')
    `);

    return typeof apiKey === 'string' ? apiKey.trim() : null;
}

function sendToRenderer(channel, data) {
    const windows = BrowserWindow.getAllWindows();
    if (windows.length > 0) {
        windows[0].webContents.send(channel, data);
    }
}

// Conversation management functions
function initializeNewSession() {
    currentSessionId = Date.now().toString();
    currentTranscription = '';
    conversationHistory = [];
    console.log('New OpenAI conversation session started:', currentSessionId);
}

function saveConversationTurn(transcription, aiResponse) {
    if (!currentSessionId) {
        initializeNewSession();
    }

    const conversationTurn = {
        timestamp: Date.now(),
        transcription: transcription.trim(),
        ai_response: aiResponse.trim(),
    };

    conversationHistory.push(conversationTurn);
    if (conversationHistory.length > MAX_CONVERSATION_TURNS) {
        conversationHistory = conversationHistory.slice(-MAX_CONVERSATION_TURNS);
    }
    console.log('Saved conversation turn:', conversationTurn);

    // Send to renderer to save in IndexedDB
    sendToRenderer('save-conversation-turn', {
        sessionId: currentSessionId,
        turn: conversationTurn,
        fullHistory: conversationHistory,
    });
}

function getCurrentSessionData() {
    return {
        sessionId: currentSessionId,
        history: conversationHistory,
    };
}

function getRealtimeConfig() {
    return {
        restartIntervalMs: REALTIME_RESTART_INTERVAL_MS,
        maxVisibleResponses: MAX_VISIBLE_RESPONSES,
        maxConversationTurns: MAX_CONVERSATION_TURNS,
        replayTurns: REALTIME_REPLAY_TURNS,
    };
}

function getRealtimeState() {
    return {
        connected: !!openaiSessionRef.current && openaiSessionRef.current.readyState === WebSocket.OPEN,
        suspended: realtimeSuspended,
        hasConfig: !!(realtimeConfig && realtimeConfig.apiKey),
        audioActive: realtimeAudioActive,
    };
}

/**
 * The realtime conversation lives on OpenAI's side and is lost when the socket
 * closes, even though conversationHistory survives locally. Replaying the last
 * few turns gives a resumed session approximate continuity.
 */
function replayConversationContext(ws) {
    const turns = conversationHistory.slice(-REALTIME_REPLAY_TURNS);
    if (turns.length === 0) return;

    console.log(`Replaying ${turns.length} prior turn(s) into resumed realtime session`);

    for (const turn of turns) {
        if (turn.transcription) {
            ws.send(
                JSON.stringify({
                    type: 'conversation.item.create',
                    item: { type: 'message', role: 'user', content: [{ type: 'input_text', text: turn.transcription }] },
                })
            );
        }
        if (turn.ai_response) {
            ws.send(
                JSON.stringify({
                    type: 'conversation.item.create',
                    item: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: turn.ai_response }] },
                })
            );
        }
    }
}

async function initializeOpenAISession(apiKey, customPrompt = '', profile = 'interview', language = 'en-US', options = {}) {
    if (isInitializingSession) {
        console.log('OpenAI session initialization already in progress');
        return false;
    }

    const { preserveConversation = false } = options;

    isInitializingSession = true;
    sendToRenderer('session-initializing', true);

    // A resume must keep the existing session id and history.
    if (!preserveConversation) {
        initializeNewSession();
    }

    const systemPrompt = getSystemPrompt(profile, customPrompt, false); // OpenAI doesn't support Google Search
    const trimmedKey = typeof apiKey === 'string' ? apiKey.trim() : null;

    realtimeConfig = { apiKey: trimmedKey, customPrompt, profile, language, systemPrompt };
    currentOpenAIApiKey = trimmedKey;
    currentOpenAISystemPrompt = systemPrompt;

    try {
        const url = `wss://api.openai.com/v1/realtime?model=${OPENAI_REALTIME_MODEL}`;
        // Handlers close over this instance rather than reading the module-level
        // openaiWebSocket. During a restart the previous socket's close event
        // arrives *after* the replacement has been assigned, so anything reading
        // the shared variable would act on - or null out - the wrong socket.
        const ws = new WebSocket(url, {
            headers: {
                Authorization: `Bearer ${trimmedKey}`,
            },
        });
        openaiWebSocket = ws;

        /** Events from a socket we have already replaced must be ignored. */
        const isCurrentSocket = () => openaiWebSocket === ws;

        ws.on('open', function open() {
            if (!isCurrentSocket()) {
                console.log('Ignoring open from a superseded OpenAI socket');
                ws.close();
                return;
            }

            console.log('Connected to OpenAI Realtime API');
            sendToRenderer('update-status', 'OpenAI session connected');

            // Text-only output: omit audio.output entirely (including it would
            // require a rate parameter and produce spoken responses).
            const sessionUpdateEvent = {
                type: 'session.update',
                session: {
                    type: 'realtime',
                    model: OPENAI_REALTIME_MODEL,
                    output_modalities: ['text'],
                    audio: {
                        input: {
                            format: {
                                type: 'audio/pcm',
                                rate: 24000,
                            },
                            // No input transcription: the realtime tab only surfaces
                            // the model's answers, so paying to transcribe the
                            // incoming audio would buy nothing.
                            turn_detection: {
                                type: 'semantic_vad',
                            },
                        },
                    },
                    instructions: systemPrompt,
                },
            };

            ws.send(JSON.stringify(sessionUpdateEvent));

            if (preserveConversation) {
                replayConversationContext(ws);
            }

            sendToRenderer('realtime-state', { state: 'active', audioActive: realtimeAudioActive });
        });

        ws.on('message', function incoming(message) {
            if (!isCurrentSocket()) return;
            try {
                const event = JSON.parse(message.toString());
                console.log('OpenAI event:', event.type);

                if (event.type === 'session.created') {
                    console.log('OpenAI session created');
                } else if (event.type === 'session.updated') {
                    console.log('OpenAI session updated');
                }

                // Handle input transcription
                if (event.type === 'input_audio_buffer.speech_started') {
                    console.log('Speech started');
                } else if (event.type === 'input_audio_buffer.speech_stopped') {
                    console.log('Speech stopped');
                } else if (event.type === 'conversation.item.input_audio_transcription.completed') {
                    const transcript = event.transcript;
                    if (transcript) {
                        currentTranscription += transcript + ' ';
                        console.log('Transcription:', transcript);
                    }
                }

                // Handle response events
                if (event.type === 'response.created') {
                    messageBuffer = '';
                    realtimeResponseActive = true;
                } else if (event.type === 'response.output_text.delta') {
                    // Buffer deltas; the UI shows the response once it is complete.
                    const delta = event.delta;
                    if (delta) {
                        messageBuffer += delta;
                    }
                } else if (event.type === 'response.output_text.done') {
                    // Sole emitter for realtime responses.
                    if (event.text) {
                        messageBuffer = event.text;
                    }
                    sendToRenderer('update-response', { text: messageBuffer, animate: false });
                } else if (event.type === 'response.done') {
                    realtimeResponseActive = false;

                    // Fall back to the buffer if output_text.done never arrived.
                    if (messageBuffer) {
                        const turnInput = currentTranscription.trim() || pendingRealtimeUserText;
                        if (turnInput) {
                            saveConversationTurn(turnInput, messageBuffer);
                            currentTranscription = '';
                            pendingRealtimeUserText = '';
                        }
                    }

                    messageBuffer = '';
                    sendToRenderer('response-complete', true);
                    sendToRenderer('update-status', 'Listening...');
                }

                if (event.type === 'error') {
                    console.error('OpenAI error:', event);
                    realtimeResponseActive = false;
                    sendToRenderer('update-status', `Error: ${event.error?.message || event.message || 'Unknown error'}`);
                }
            } catch (error) {
                console.error('Error parsing OpenAI message:', error);
            }
        });

        ws.on('error', function error(err) {
            console.error('OpenAI WebSocket error:', err);
            if (!isCurrentSocket()) return;
            sendToRenderer('update-status', `Error: ${err.message || 'Connection error'}`);
            isInitializingSession = false;
            sendToRenderer('session-initializing', false);
        });

        ws.on('close', function close(code, reason) {
            console.log('OpenAI WebSocket closed:', code, reason);
            // A superseded socket closing must not tear down its replacement.
            if (!isCurrentSocket()) return;

            openaiWebSocket = null;
            openaiSessionRef.current = null;
            realtimeResponseActive = false;
            isInitializingSession = false;
            sendToRenderer('session-initializing', false);

            // realtimeConfig / currentOpenAIApiKey / currentOpenAISystemPrompt are
            // intentionally retained so the session can be resumed. Only
            // close-openai-session clears them.
            if (realtimeSuspended) {
                sendToRenderer('realtime-state', { state: 'suspended', audioActive: false });
            } else {
                sendToRenderer('update-status', 'OpenAI session closed');
                sendToRenderer('realtime-state', { state: 'error', audioActive: false });
            }
        });

        openaiSessionRef.current = ws;
        isInitializingSession = false;
        sendToRenderer('session-initializing', false);
        return true;
    } catch (error) {
        console.error('Failed to initialize OpenAI session:', error);
        isInitializingSession = false;
        sendToRenderer('session-initializing', false);
        sendToRenderer('realtime-state', { state: 'error', audioActive: realtimeAudioActive });
        return false;
    }
}

async function startMacOSAudioCapture(sessionRef) {
    const started = await startSharedMacOSAudioCapture({
        label: 'macOS audio capture for OpenAI',
        sendToRenderer,
        sendAudioChunk: base64Data => sendAudioToOpenAI(base64Data, sessionRef),
    });
    realtimeAudioActive = !!started;
    return started;
}

function stopMacOSAudioCapture() {
    stopSharedMacOSAudioCapture();
    realtimeAudioActive = false;
}

async function sendAudioToOpenAI(base64Data, sessionRef) {
    if (!sessionRef.current || sessionRef.current.readyState !== WebSocket.OPEN) return;

    try {
        if (process.stdout && process.stdout.writable) {
            process.stdout.write('.');
        }

        const event = {
            type: 'input_audio_buffer.append',
            audio: base64Data,
        };

        sessionRef.current.send(JSON.stringify(event));
    } catch (error) {
        console.error('Error sending audio to OpenAI:', error);
    }
}

/**
 * Queues a user message (text and/or image) on the realtime socket and asks for
 * a response. With semantic_vad an audio turn may already be generating, and a
 * second response.create would be rejected, so cancel it first.
 */
function sendRealtimeUserMessage(ws, content, statusText, turnLabel) {
    if (realtimeResponseActive) {
        ws.send(JSON.stringify({ type: 'response.cancel' }));
        realtimeResponseActive = false;
    }

    ws.send(
        JSON.stringify({
            type: 'conversation.item.create',
            item: { type: 'message', role: 'user', content },
        })
    );
    ws.send(JSON.stringify({ type: 'response.create' }));

    pendingRealtimeUserText = turnLabel;
    sendToRenderer('update-status', statusText);
}

function setupOpenAIIpcHandlers(sessionRef) {
    openaiSessionRef = sessionRef;
    global.openaiSessionRef = sessionRef;

    ipcMain.handle('initialize-openai', async (event, apiKey, customPrompt, profile = 'interview', language = 'en-US') => {
        realtimeSuspended = false;
        const success = await initializeOpenAISession(apiKey, customPrompt, profile, language);
        if (success) {
            sessionRef.current = openaiWebSocket;
            return true;
        }
        return false;
    });

    ipcMain.handle('send-audio-content-openai', async (event, { data, mimeType }) => {
        if (!sessionRef.current || sessionRef.current.readyState !== WebSocket.OPEN) {
            return { success: false, error: 'No active OpenAI session' };
        }
        try {
            if (process.stdout && process.stdout.writable) {
                process.stdout.write('.');
            }
            sessionRef.current.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: data }));
            return { success: true };
        } catch (error) {
            console.error('Error sending system audio to OpenAI:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('send-mic-audio-content-openai', async (event, { data, mimeType }) => {
        if (!sessionRef.current || sessionRef.current.readyState !== WebSocket.OPEN) {
            return { success: false, error: 'No active OpenAI session' };
        }
        try {
            if (process.stdout && process.stdout.writable) {
                process.stdout.write(',');
            }
            sessionRef.current.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: data }));
            return { success: true };
        } catch (error) {
            console.error('Error sending mic audio to OpenAI:', error);
            return { success: false, error: error.message };
        }
    });

    // Tab 1: screenshots go to the realtime model, not a separate REST model.
    ipcMain.handle('send-image-content-openai', async (event, { data, prompt } = {}) => {
        const ws = sessionRef.current;
        if (!ws || ws.readyState !== WebSocket.OPEN) {
            return { success: false, error: 'Realtime session is not connected', code: 'REALTIME_NOT_CONNECTED' };
        }

        if (!data || typeof data !== 'string' || data.length < 100) {
            console.error('Invalid image data for realtime send, length:', data?.length);
            return { success: false, error: 'Invalid image data' };
        }

        try {
            const trimmedPrompt = typeof prompt === 'string' ? prompt.trim() : '';
            const content = [];
            if (trimmedPrompt) {
                content.push({ type: 'input_text', text: trimmedPrompt });
            }
            content.push({ type: 'input_image', image_url: `data:image/jpeg;base64,${data}`, detail: 'auto' });

            sendRealtimeUserMessage(ws, content, 'Analyzing screenshot...', trimmedPrompt || '[screenshot]');

            if (process.stdout && process.stdout.writable) {
                process.stdout.write('!');
            }

            return { success: true };
        } catch (error) {
            console.error('Error sending image to OpenAI realtime:', error);
            return { success: false, error: error.message };
        }
    });

    // Tab 1: typed text goes to the realtime model.
    ipcMain.handle('send-text-message-openai', async (event, text) => {
        const ws = sessionRef.current;
        if (!ws || ws.readyState !== WebSocket.OPEN) {
            return { success: false, error: 'Realtime session is not connected', code: 'REALTIME_NOT_CONNECTED' };
        }

        if (!text || typeof text !== 'string' || text.trim().length === 0) {
            return { success: false, error: 'Invalid text message' };
        }

        try {
            const trimmed = text.trim();
            console.log('Sending text to OpenAI realtime:', trimmed);
            sendRealtimeUserMessage(ws, [{ type: 'input_text', text: trimmed }], 'Thinking...', trimmed);
            return { success: true };
        } catch (error) {
            console.error('Error sending text to OpenAI realtime:', error);
            sendToRenderer('update-status', `Error: ${error.message || 'Realtime send failed'}`);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('start-macos-audio-openai', async event => {
        if (process.platform !== 'darwin') {
            return {
                success: false,
                error: 'macOS audio capture only available on macOS',
            };
        }

        try {
            const success = await startMacOSAudioCapture(sessionRef);
            return { success };
        } catch (error) {
            console.error('Error starting macOS audio capture for OpenAI:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('stop-macos-audio-openai', async event => {
        try {
            stopMacOSAudioCapture();
            return { success: true };
        } catch (error) {
            console.error('Error stopping macOS audio capture for OpenAI:', error);
            return { success: false, error: error.message };
        }
    });

    // Pauses the realtime model without tearing down the renderer's screen
    // capture, so resuming never re-prompts for screen access.
    ipcMain.handle('suspend-realtime-openai', async () => {
        if (realtimeTransition) {
            await realtimeTransition.catch(() => {});
        }

        realtimeTransition = (async () => {
            realtimeSuspended = true;

            // Idempotent: the renderer's suspendRealtimeAudio() also stops this.
            stopMacOSAudioCapture();

            const ws = sessionRef.current;
            if (ws) {
                try {
                    ws.close(1000, 'suspended');
                } catch (error) {
                    console.warn('Failed to close realtime socket:', error.message);
                }
            }
            sessionRef.current = null;
            openaiWebSocket = null;
            realtimeResponseActive = false;

            sendToRenderer('realtime-state', { state: 'suspended', audioActive: false });
            sendToRenderer('update-status', 'Realtime paused');
            return { success: true };
        })();

        return realtimeTransition;
    });

    ipcMain.handle('resume-realtime-openai', async () => {
        if (realtimeTransition) {
            await realtimeTransition.catch(() => {});
        }

        realtimeTransition = (async () => {
            if (sessionRef.current && sessionRef.current.readyState === WebSocket.OPEN) {
                realtimeSuspended = false;
                return { success: true, alreadyOpen: true };
            }

            if (!realtimeConfig || !realtimeConfig.apiKey) {
                return { success: false, error: 'No realtime session to resume', code: 'NO_CONFIG' };
            }

            sendToRenderer('realtime-state', { state: 'connecting', audioActive: false });

            realtimeSuspended = false;

            const started = await initializeOpenAISession(
                realtimeConfig.apiKey,
                realtimeConfig.customPrompt,
                realtimeConfig.profile,
                realtimeConfig.language,
                { preserveConversation: true }
            );

            if (!started) {
                realtimeSuspended = true;
                sendToRenderer('realtime-state', { state: 'error', audioActive: false });
                return { success: false, error: 'Failed to reconnect realtime session' };
            }

            sessionRef.current = openaiWebSocket;

            // Audio is restarted by the renderer via start-macos-audio-openai.
            sendToRenderer('realtime-state', { state: 'active', audioActive: realtimeAudioActive });
            return { success: true };
        })();

        return realtimeTransition;
    });

    ipcMain.handle('get-realtime-openai-state', async () => {
        return { success: true, state: getRealtimeState() };
    });

    // The renderer owns the restart timer and the transcript, but the values
    // live here so every realtime tunable sits in one place.
    ipcMain.handle('get-realtime-openai-config', async () => {
        return { success: true, config: getRealtimeConfig() };
    });

    ipcMain.handle('close-openai-session', async event => {
        try {
            abortCodexStream();
            stopMacOSAudioCapture();

            if (sessionRef.current) {
                sessionRef.current.close();
                sessionRef.current = null;
                openaiWebSocket = null;
            }

            realtimeSuspended = false;
            realtimeAudioActive = false;
            realtimeResponseActive = false;
            realtimeConfig = null;
            pendingRealtimeUserText = '';
            currentOpenAIApiKey = null;
            currentOpenAISystemPrompt = '';
            resetCodexState();

            return { success: true };
        } catch (error) {
            console.error('Error closing OpenAI session:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('get-current-openai-session', async event => {
        try {
            return { success: true, data: getCurrentSessionData() };
        } catch (error) {
            console.error('Error getting current OpenAI session:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('start-new-openai-session', async event => {
        try {
            initializeNewSession();
            return { success: true, sessionId: currentSessionId };
        } catch (error) {
            console.error('Error starting new OpenAI session:', error);
            return { success: false, error: error.message };
        }
    });

    // Tab 2 (gpt-5.5) lives in its own module and shares only the key and prompt.
    setupOpenAICodexIpcHandlers({
        sendToRenderer,
        getApiKey: getOpenAIApiKeyFromStorage,
        getSystemPrompt: () => currentOpenAISystemPrompt || realtimeConfig?.systemPrompt || '',
    });
}

module.exports = {
    initializeOpenAISession,
    sendToRenderer,
    initializeNewSession,
    saveConversationTurn,
    getCurrentSessionData,
    getRealtimeState,
    getRealtimeConfig,
    killExistingSystemAudioDump,
    startMacOSAudioCapture,
    convertStereoToMono,
    stopMacOSAudioCapture,
    sendAudioToOpenAI,
    setupOpenAIIpcHandlers,
};
