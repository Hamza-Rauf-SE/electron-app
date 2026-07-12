const WebSocket = require('ws');
const { BrowserWindow, ipcMain } = require('electron');
const OpenAI = require('openai');
const { getSystemPrompt } = require('./prompts');
const {
    killExistingSystemAudioDump,
    startMacOSAudioCapture: startSharedMacOSAudioCapture,
    convertStereoToMono,
    stopMacOSAudioCapture: stopSharedMacOSAudioCapture,
} = require('./audioCapture');

const OPENAI_REALTIME_MODEL = 'gpt-realtime-1.5';
const OPENAI_CODEX_MODEL = 'gpt-5.1-codex-max';

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

function buildScreenshotAssistantPrompt(userPrompt) {
    const basePrompt = `You are analyzing a user-provided screenshot.

PRIMARY GOAL:
- If the screenshot contains a question (including MCQ, coding prompt, interview question, error dialog asking what to do, etc.), answer that question directly.

INSTRUCTIONS:
- First, read/identify the exact question(s) visible in the screenshot.
- Answer the question(s) with a complete, usable final answer.
- If it is a coding question: provide (1) a very short approach (max 3–6 bullets) then (2) the full code solution.
- If it is an MCQ: output the correct choice and a 1–2 sentence justification.
- If there is no clear question in the screenshot: briefly describe what’s on screen and point out the most important details.

OUTPUT:
- Respond in markdown.
- Do not add meta commentary like “I see a screenshot…” or “I will OCR…”. Just answer.
`;

    const trimmedUserPrompt = typeof userPrompt === 'string' ? userPrompt.trim() : '';
    if (!trimmedUserPrompt) return basePrompt;

    return `${basePrompt}\nUser request (optional):\n${trimmedUserPrompt}`;
}

function buildCodexChatPrompt(text) {
    const recentHistory = conversationHistory
        .slice(-8)
        .map((turn, index) => [`Turn ${index + 1}:`, `User/audio transcript: ${turn.transcription}`, `Assistant: ${turn.ai_response}`].join('\n'))
        .join('\n\n');

    const historySection = recentHistory ? `RECENT CONTEXT:\n${recentHistory}\n\n` : '';

    return `${currentOpenAISystemPrompt || 'You are a helpful real-time assistant. Respond clearly and directly in markdown.'}

${historySection}USER CHAT MESSAGE:
${text.trim()}`;
}

function extractOpenAIResponseText(result, fallbackText = 'No response available') {
    if (result?.output_text) {
        return result.output_text;
    }

    if (result?.text) {
        return result.text;
    }

    if (typeof result === 'string') {
        return result;
    }

    if (!Array.isArray(result?.output)) {
        return fallbackText;
    }

    const textParts = [];

    for (const outputItem of result.output) {
        if (typeof outputItem === 'string') {
            textParts.push(outputItem);
            continue;
        }

        if (outputItem?.text) {
            textParts.push(outputItem.text);
        }

        if (Array.isArray(outputItem?.content)) {
            for (const contentPart of outputItem.content) {
                if (contentPart?.text) {
                    textParts.push(contentPart.text);
                } else if (typeof contentPart === 'string') {
                    textParts.push(contentPart);
                }
            }
        }
    }

    return textParts.join('\n').trim() || fallbackText;
}

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

// Convert Float32Array to PCM16 for OpenAI (24kHz, mono)
function convertFloat32ToPCM16(float32Array) {
    const buffer = new ArrayBuffer(float32Array.length * 2);
    const view = new DataView(buffer);
    let offset = 0;
    for (let i = 0; i < float32Array.length; i++, offset += 2) {
        let s = Math.max(-1, Math.min(1, float32Array[i]));
        view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
    return buffer;
}

// Convert PCM16 ArrayBuffer to base64 (Node.js version using Buffer)
function arrayBufferToBase64(buffer) {
    if (Buffer.isBuffer(buffer)) {
        return buffer.toString('base64');
    }
    return Buffer.from(buffer).toString('base64');
}

// Convert Buffer to base64 (Node.js)
function bufferToBase64(buffer) {
    return buffer.toString('base64');
}

async function initializeOpenAISession(apiKey, customPrompt = '', profile = 'interview', language = 'en-US') {
    if (isInitializingSession) {
        console.log('OpenAI session initialization already in progress');
        return false;
    }

    isInitializingSession = true;
    sendToRenderer('session-initializing', true);

    // Initialize new conversation session
    initializeNewSession();

    const systemPrompt = getSystemPrompt(profile, customPrompt, false); // OpenAI doesn't support Google Search
    currentOpenAIApiKey = typeof apiKey === 'string' ? apiKey.trim() : null;
    currentOpenAISystemPrompt = systemPrompt;

    try {
        const url = `wss://api.openai.com/v1/realtime?model=${OPENAI_REALTIME_MODEL}`;
        openaiWebSocket = new WebSocket(url, {
            headers: {
                Authorization: `Bearer ${apiKey}`,
            },
        });

        openaiWebSocket.on('open', function open() {
            console.log('Connected to OpenAI Realtime API');
            sendToRenderer('update-status', 'OpenAI session connected');

            // Update session configuration
            // Note: output_modalities is set to ['text'] to receive only text responses
            // Audio input is enabled to listen to user's audio
            // When using text-only output, we should NOT include audio.output config
            // However, if audio.output is included, it requires rate parameter
            const sessionUpdateEvent = {
                type: 'session.update',
                session: {
                    type: 'realtime',
                    model: OPENAI_REALTIME_MODEL,
                    output_modalities: ['text'], // Text output only - no audio responses
                    audio: {
                        input: {
                            format: {
                                type: 'audio/pcm',
                                rate: 24000,
                            },
                            turn_detection: {
                                type: 'semantic_vad', // Voice activity detection - automatically detects when user speaks
                            },
                        },
                        // Remove audio.output when using text-only output
                        // The API will generate text responses instead of audio
                    },
                    instructions: systemPrompt,
                },
            };

            openaiWebSocket.send(JSON.stringify(sessionUpdateEvent));
        });

        openaiWebSocket.on('message', function incoming(message) {
            try {
                const event = JSON.parse(message.toString());
                console.log('OpenAI event:', event.type);

                // Handle session events
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
                } else if (event.type === 'response.output_text.delta') {
                    // Text output delta - buffer but don't display until complete
                    const delta = event.delta;
                    if (delta) {
                        messageBuffer += delta;
                        // Don't send update-response here - wait for complete response
                    }
                } else if (event.type === 'response.output_text.done') {
                    // Text output is complete - send the full response now
                    sendToRenderer('update-response', { text: messageBuffer, animate: false });
                } else if (event.type === 'response.done') {
                    // Extract text from response if available in the output
                    if (event.response && event.response.output) {
                        for (const outputItem of event.response.output) {
                            if (outputItem.type === 'message' && outputItem.content) {
                                for (const contentPart of outputItem.content) {
                                    if (contentPart.type === 'text' && contentPart.text) {
                                        messageBuffer = contentPart.text;
                                        sendToRenderer('update-response', { text: messageBuffer, animate: false });
                                    }
                                }
                            }
                        }
                    }

                    // If we still have buffered text but didn't get it from response.output, use the buffer
                    if (messageBuffer && !event.response?.output) {
                        sendToRenderer('update-response', { text: messageBuffer, animate: false });
                    }

                    // Save conversation turn when we have both transcription and AI response
                    if (currentTranscription && messageBuffer) {
                        saveConversationTurn(currentTranscription, messageBuffer);
                        currentTranscription = '';
                    }

                    messageBuffer = '';
                    sendToRenderer('response-complete', true);
                    sendToRenderer('update-status', 'Listening...');
                }

                // Handle errors
                if (event.type === 'error') {
                    console.error('OpenAI error:', event);
                    sendToRenderer('update-status', `Error: ${event.message || 'Unknown error'}`);
                }
            } catch (error) {
                console.error('Error parsing OpenAI message:', error);
            }
        });

        openaiWebSocket.on('error', function error(err) {
            console.error('OpenAI WebSocket error:', err);
            sendToRenderer('update-status', `Error: ${err.message || 'Connection error'}`);
            isInitializingSession = false;
            sendToRenderer('session-initializing', false);
        });

        openaiWebSocket.on('close', function close(code, reason) {
            console.log('OpenAI WebSocket closed:', code, reason);
            sendToRenderer('update-status', 'OpenAI session closed');
            openaiWebSocket = null;
            openaiSessionRef.current = null;
            currentOpenAIApiKey = null;
            currentOpenAISystemPrompt = '';
            isInitializingSession = false;
            sendToRenderer('session-initializing', false);
        });

        openaiSessionRef.current = openaiWebSocket;
        isInitializingSession = false;
        sendToRenderer('session-initializing', false);
        return true;
    } catch (error) {
        console.error('Failed to initialize OpenAI session:', error);
        currentOpenAIApiKey = null;
        currentOpenAISystemPrompt = '';
        isInitializingSession = false;
        sendToRenderer('session-initializing', false);
        return false;
    }
}

async function startMacOSAudioCapture(openaiSessionRef) {
    return startSharedMacOSAudioCapture({
        label: 'macOS audio capture for OpenAI',
        sendToRenderer,
        sendAudioChunk: base64Data => sendAudioToOpenAI(base64Data, openaiSessionRef),
    });
}

function stopMacOSAudioCapture() {
    stopSharedMacOSAudioCapture();
}

async function sendAudioToOpenAI(base64Data, openaiSessionRef) {
    if (!openaiSessionRef.current || openaiSessionRef.current.readyState !== WebSocket.OPEN) return;

    try {
        if (process.stdout && process.stdout.writable) {
            process.stdout.write('.');
        }

        // Send audio using input_audio_buffer.append event
        const event = {
            type: 'input_audio_buffer.append',
            audio: base64Data,
        };

        openaiSessionRef.current.send(JSON.stringify(event));
    } catch (error) {
        console.error('Error sending audio to OpenAI:', error);
    }
}

function setupOpenAIIpcHandlers(openaiSessionRef) {
    global.openaiSessionRef = openaiSessionRef;

    ipcMain.handle('initialize-openai', async (event, apiKey, customPrompt, profile = 'interview', language = 'en-US') => {
        const success = await initializeOpenAISession(apiKey, customPrompt, profile, language);
        if (success) {
            openaiSessionRef.current = openaiWebSocket;
            return true;
        }
        return false;
    });

    ipcMain.handle('send-audio-content-openai', async (event, { data, mimeType }) => {
        if (!openaiSessionRef.current || openaiSessionRef.current.readyState !== WebSocket.OPEN) {
            return { success: false, error: 'No active OpenAI session' };
        }
        try {
            if (process.stdout && process.stdout.writable) {
                process.stdout.write('.');
            }
            const event = {
                type: 'input_audio_buffer.append',
                audio: data,
            };
            openaiSessionRef.current.send(JSON.stringify(event));
            return { success: true };
        } catch (error) {
            console.error('Error sending system audio to OpenAI:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('send-mic-audio-content-openai', async (event, { data, mimeType }) => {
        if (!openaiSessionRef.current || openaiSessionRef.current.readyState !== WebSocket.OPEN) {
            return { success: false, error: 'No active OpenAI session' };
        }
        try {
            if (process.stdout && process.stdout.writable) {
                process.stdout.write(',');
            }
            const event = {
                type: 'input_audio_buffer.append',
                audio: data,
            };
            openaiSessionRef.current.send(JSON.stringify(event));
            return { success: true };
        } catch (error) {
            console.error('Error sending mic audio to OpenAI:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('send-image-content-openai', async (event, { data, debug, prompt }) => {
        // For OpenAI sessions, use Codex for screenshot analysis instead of Realtime API.
        console.log('[DEBUG] send-image-content-openai called');
        try {
            if (!data || typeof data !== 'string') {
                console.error('[DEBUG] Invalid image data received, type:', typeof data, 'length:', data?.length);
                return { success: false, error: 'Invalid image data' };
            }
            console.log('[DEBUG] Image data received, length:', data.length, 'characters');

            console.log('[DEBUG] Getting OpenAI API key...');
            const apiKey = await getOpenAIApiKeyFromStorage();

            if (!apiKey) {
                console.error('[DEBUG] OpenAI API key not found');
                return { success: false, error: 'OpenAI API key not found' };
            }
            console.log('[DEBUG] API key retrieved, length:', apiKey.length);

            const openai = new OpenAI({
                apiKey: apiKey.trim(),
            });

            // Use Codex for screenshot analysis
            const analysisPrompt = buildScreenshotAssistantPrompt(prompt);
            console.log('[DEBUG] Using prompt:', analysisPrompt);
            console.log(`[DEBUG] Sending request to ${OPENAI_CODEX_MODEL}...`);

            const result = await openai.responses.create({
                model: OPENAI_CODEX_MODEL,
                input: [
                    {
                        role: 'user',
                        content: [
                            {
                                type: 'input_text',
                                text: analysisPrompt,
                            },
                            {
                                type: 'input_image',
                                image_url: `data:image/jpeg;base64,${data}`,
                            },
                        ],
                    },
                ],
            });

            console.log('[DEBUG] Codex API response received:', JSON.stringify(result, null, 2));

            console.log('[DEBUG] Extracting text from response...');
            const analysisText = extractOpenAIResponseText(result, 'No analysis available');

            console.log('[DEBUG] Codex analysis result length:', analysisText.length);
            console.log('[DEBUG] Codex analysis result preview:', analysisText.substring(0, 100) + '...');

            // Send the analysis result back to the renderer
            console.log('[DEBUG] Sending analysis to renderer...');
            sendToRenderer('update-response', { text: analysisText, animate: false });
            sendToRenderer('response-complete', true);
            sendToRenderer('update-status', 'Screenshot analyzed');
            console.log('[DEBUG] Analysis sent to renderer successfully');

            if (process.stdout && process.stdout.writable) {
                process.stdout.write('!');
            }

            return { success: true, analysis: analysisText };
        } catch (error) {
            console.error('Error analyzing screenshot with Codex:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('send-text-message-openai', async (event, text) => {
        if (!openaiSessionRef.current || openaiSessionRef.current.readyState !== WebSocket.OPEN) {
            return { success: false, error: 'No active OpenAI session' };
        }

        try {
            if (!text || typeof text !== 'string' || text.trim().length === 0) {
                return { success: false, error: 'Invalid text message' };
            }

            const apiKey = await getOpenAIApiKeyFromStorage();
            if (!apiKey) {
                return { success: false, error: 'OpenAI API key not found' };
            }

            console.log(`Sending chat message to ${OPENAI_CODEX_MODEL}:`, text);
            sendToRenderer('update-status', 'Thinking with Codex...');

            const openai = new OpenAI({
                apiKey,
            });

            const codexPrompt = buildCodexChatPrompt(text);
            const result = await openai.responses.create({
                model: OPENAI_CODEX_MODEL,
                input: [
                    {
                        role: 'user',
                        content: [
                            {
                                type: 'input_text',
                                text: codexPrompt,
                            },
                        ],
                    },
                ],
            });

            const responseText = extractOpenAIResponseText(result);
            sendToRenderer('update-response', { text: responseText, animate: false });
            sendToRenderer('response-complete', true);
            sendToRenderer('update-status', 'Listening...');
            saveConversationTurn(text, responseText);

            return { success: true, response: responseText };
        } catch (error) {
            console.error('Error sending text to Codex:', error);
            sendToRenderer('update-status', `Error: ${error.message || 'Codex chat failed'}`);
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
            const success = await startMacOSAudioCapture(openaiSessionRef);
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

    ipcMain.handle('close-openai-session', async event => {
        try {
            stopMacOSAudioCapture();

            if (openaiSessionRef.current) {
                openaiSessionRef.current.close();
                openaiSessionRef.current = null;
                openaiWebSocket = null;
            }
            currentOpenAIApiKey = null;
            currentOpenAISystemPrompt = '';

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
}

module.exports = {
    initializeOpenAISession,
    sendToRenderer,
    initializeNewSession,
    saveConversationTurn,
    getCurrentSessionData,
    killExistingSystemAudioDump,
    startMacOSAudioCapture,
    convertStereoToMono,
    stopMacOSAudioCapture,
    sendAudioToOpenAI,
    setupOpenAIIpcHandlers,
};
