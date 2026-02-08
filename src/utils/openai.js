const WebSocket = require('ws');
const { BrowserWindow, ipcMain } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const OpenAI = require('openai');
const { saveDebugAudio } = require('../audioUtils');
const { getSystemPrompt } = require('./prompts');

// Conversation tracking variables
let currentSessionId = null;
let currentTranscription = '';
let conversationHistory = [];
let isInitializingSession = false;

// Audio capture variables
let systemAudioProc = null;
let messageBuffer = '';

// WebSocket connection
let openaiWebSocket = null;
let openaiSessionRef = { current: null };

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

    try {
        const url = 'wss://api.openai.com/v1/realtime?model=gpt-realtime';
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
                    model: 'gpt-realtime',
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
            isInitializingSession = false;
            sendToRenderer('session-initializing', false);
        });

        openaiSessionRef.current = openaiWebSocket;
        isInitializingSession = false;
        sendToRenderer('session-initializing', false);
        return true;
    } catch (error) {
        console.error('Failed to initialize OpenAI session:', error);
        isInitializingSession = false;
        sendToRenderer('session-initializing', false);
        return false;
    }
}

function killExistingSystemAudioDump() {
    return new Promise(resolve => {
        console.log('Checking for existing SystemAudioDump processes...');

        const killProc = spawn('pkill', ['-f', 'SystemAudioDump'], {
            stdio: 'ignore',
        });

        killProc.on('close', code => {
            if (code === 0) {
                console.log('Killed existing SystemAudioDump processes');
            } else {
                console.log('No existing SystemAudioDump processes found');
            }
            resolve();
        });

        killProc.on('error', err => {
            console.log('Error checking for existing processes (this is normal):', err.message);
            resolve();
        });

        setTimeout(() => {
            killProc.kill();
            resolve();
        }, 2000);
    });
}

async function startMacOSAudioCapture(openaiSessionRef) {
    if (process.platform !== 'darwin') return false;

    await killExistingSystemAudioDump();

    console.log('Starting macOS audio capture for OpenAI...');

    const { app } = require('electron');
    const path = require('path');

    const systemArch = process.arch === 'x64' ? 'x86_64' : process.arch;
    const binaryName = systemArch === 'x86_64' ? 'SystemAudioDump_x86' : 'SystemAudioDump';
    console.log(`Detected system architecture: ${systemArch}, using binary: ${binaryName}`);

    let systemAudioPath;
    if (app.isPackaged) {
        systemAudioPath = path.join(process.resourcesPath, binaryName);
    } else {
        systemAudioPath = path.join(__dirname, '../assets', binaryName);
    }

    console.log('SystemAudioDump path:', systemAudioPath);

    if (!fs.existsSync(systemAudioPath)) {
        const errorMsg = `SystemAudioDump binary not found at: ${systemAudioPath}`;
        console.error(errorMsg);
        sendToRenderer('update-status', 'Error: SystemAudioDump binary not found');
        return false;
    }

    const spawnOptions = {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
            ...process.env,
            PROCESS_NAME: 'AudioService',
            APP_NAME: 'System Audio Service',
        },
    };

    if (process.platform === 'darwin') {
        spawnOptions.detached = false;
        spawnOptions.windowsHide = false;
    }

    try {
        systemAudioProc = spawn(systemAudioPath, [], spawnOptions);

        if (!systemAudioProc.pid) {
            console.error('Failed to start SystemAudioDump - no PID returned');
            sendToRenderer('update-status', 'Error: Failed to start SystemAudioDump');
            return false;
        }
    } catch (error) {
        if (error.code === 'Unknown system error -86' || error.errno === -86) {
            const errorMsg =
                'SystemAudioDump architecture mismatch. The binary is not compatible with your system architecture.';
            console.error(errorMsg);
            sendToRenderer('update-status', 'Error: SystemAudioDump architecture mismatch');
        } else {
            console.error('Error spawning SystemAudioDump:', error);
            sendToRenderer('update-status', `Error: Failed to start SystemAudioDump - ${error.message}`);
        }
        return false;
    }

    console.log('SystemAudioDump started with PID:', systemAudioProc.pid);

    const CHUNK_DURATION = 0.1;
    const SAMPLE_RATE = 24000;
    const BYTES_PER_SAMPLE = 2;
    const CHANNELS = 2;
    const CHUNK_SIZE = SAMPLE_RATE * BYTES_PER_SAMPLE * CHANNELS * CHUNK_DURATION;

    let audioBuffer = Buffer.alloc(0);

    systemAudioProc.stdout.on('data', data => {
        audioBuffer = Buffer.concat([audioBuffer, data]);

        while (audioBuffer.length >= CHUNK_SIZE) {
            const chunk = audioBuffer.slice(0, CHUNK_SIZE);
            audioBuffer = audioBuffer.slice(CHUNK_SIZE);

            const monoChunk = CHANNELS === 2 ? convertStereoToMono(chunk) : chunk;
            const base64Data = bufferToBase64(monoChunk);
            sendAudioToOpenAI(base64Data, openaiSessionRef);

            if (process.env.DEBUG_AUDIO) {
                console.log(`Processed audio chunk: ${chunk.length} bytes`);
                saveDebugAudio(monoChunk, 'system_audio');
            }
        }

        const maxBufferSize = SAMPLE_RATE * BYTES_PER_SAMPLE * 1;
        if (audioBuffer.length > maxBufferSize) {
            audioBuffer = audioBuffer.slice(-maxBufferSize);
        }
    });

    systemAudioProc.stderr.on('data', data => {
        console.error('SystemAudioDump stderr:', data.toString());
    });

    systemAudioProc.on('close', code => {
        console.log('SystemAudioDump process closed with code:', code);
        systemAudioProc = null;
    });

    systemAudioProc.on('error', err => {
        let errorMsg = 'SystemAudioDump process error: ' + err.message;
        if (err.code === 'Unknown system error -86' || err.errno === -86) {
            errorMsg =
                'SystemAudioDump architecture mismatch. The binary is not compatible with your system architecture.';
            sendToRenderer('update-status', 'Error: SystemAudioDump architecture mismatch');
        } else {
            sendToRenderer('update-status', `Error: SystemAudioDump failed - ${err.message}`);
        }
        console.error(errorMsg);
        systemAudioProc = null;
    });

    return true;
}

function convertStereoToMono(stereoBuffer) {
    const samples = stereoBuffer.length / 4;
    const monoBuffer = Buffer.alloc(samples * 2);

    for (let i = 0; i < samples; i++) {
        const leftSample = stereoBuffer.readInt16LE(i * 4);
        monoBuffer.writeInt16LE(leftSample, i * 2);
    }

    return monoBuffer;
}

function stopMacOSAudioCapture() {
    if (systemAudioProc) {
        console.log('Stopping SystemAudioDump...');
        systemAudioProc.kill('SIGTERM');
        systemAudioProc = null;
    }
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
        // For OpenAI sessions, use GPT-5.1-Codex-Max for screenshot analysis instead of Realtime API
        console.log('[DEBUG] send-image-content-openai called');
        try {
            if (!data || typeof data !== 'string') {
                console.error('[DEBUG] Invalid image data received, type:', typeof data, 'length:', data?.length);
                return { success: false, error: 'Invalid image data' };
            }
            console.log('[DEBUG] Image data received, length:', data.length, 'characters');

            // Get OpenAI API key from the session or from storage
            console.log('[DEBUG] Getting OpenAI API key...');
            const windows = BrowserWindow.getAllWindows();
            let apiKey = null;
            if (windows.length > 0) {
                apiKey = await windows[0].webContents.executeJavaScript(`
                    localStorage.getItem('openaiApiKey')
                `);
            }

            if (!apiKey) {
                console.error('[DEBUG] OpenAI API key not found');
                return { success: false, error: 'OpenAI API key not found' };
            }
            console.log('[DEBUG] API key retrieved, length:', apiKey.length);

            const openai = new OpenAI({
                apiKey: apiKey.trim(),
            });

            // Use GPT-5.1-Codex-Max for screenshot analysis
            const analysisPrompt = prompt || 'Analyze this screenshot in detail. Describe what you see, identify any code, text, UI elements, or important information. Provide a comprehensive analysis.';
            console.log('[DEBUG] Using prompt:', analysisPrompt);
            console.log('[DEBUG] Sending request to GPT-5.1-Codex-Max...');

            const result = await openai.responses.create({
                model: 'gpt-5.1-codex-max',
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

            // Extract text from response - check multiple possible response formats
            let analysisText = 'No analysis available';
            console.log('[DEBUG] Extracting text from response...');
            if (result.output_text) {
                analysisText = result.output_text;
                console.log('[DEBUG] Found text in result.output_text');
            } else if (result.output && Array.isArray(result.output)) {
                // Try to find text in output array
                console.log('[DEBUG] Checking result.output array, length:', result.output.length);
                for (const outputItem of result.output) {
                    if (outputItem.text) {
                        analysisText = outputItem.text;
                        console.log('[DEBUG] Found text in outputItem.text');
                        break;
                    } else if (typeof outputItem === 'string') {
                        analysisText = outputItem;
                        console.log('[DEBUG] Found string in outputItem');
                        break;
                    }
                }
            } else if (result.text) {
                analysisText = result.text;
                console.log('[DEBUG] Found text in result.text');
            } else if (typeof result === 'string') {
                analysisText = result;
                console.log('[DEBUG] Result is a string');
            }

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

            console.log('Sending text message to OpenAI:', text);

            const event = {
                type: 'conversation.item.create',
                item: {
                    type: 'message',
                    role: 'user',
                    content: [
                        {
                            type: 'input_text',
                            text: text.trim(),
                        },
                    ],
                },
            };

            openaiSessionRef.current.send(JSON.stringify(event));

            // Trigger response
            const responseEvent = {
                type: 'response.create',
            };
            openaiSessionRef.current.send(JSON.stringify(responseEvent));

            return { success: true };
        } catch (error) {
            console.error('Error sending text to OpenAI:', error);
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
