const { ipcMain } = require('electron');
const OpenAI = require('openai');
const { captureScreenJpegBase64 } = require('./screenCapture');

const OPENAI_CODEX_MODEL = 'gpt-5.5';
const CODEX_MAX_OUTPUT_TOKENS = 128000;
// gpt-5.5 at high/xhigh effort can reason for minutes before emitting a token.
const CODEX_TIMEOUT_MS = 10 * 60 * 1000;
const VALID_EFFORTS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'];
const DEFAULT_EFFORT = 'high';

// Injected by openai.js so this module never reaches back into it (no circular require).
let deps = {
    sendToRenderer: () => {},
    getApiKey: async () => null,
    getSystemPrompt: () => '',
};

let codexClient = null;
let codexApiKeyInUse = null;
let codexHistory = []; // render mirror only; the model's own context lives server-side
let codexPreviousResponseId = null;
let codexActiveStream = null;
let codexUncommittedInput = []; // input items from an aborted/failed turn, replayed next request
let codexEffort = DEFAULT_EFFORT;
let messageCounter = 0;

function nextMessageId() {
    messageCounter += 1;
    return `codex-${Date.now()}-${messageCounter}`;
}

function normalizeEffort(effort) {
    return VALID_EFFORTS.includes(effort) ? effort : codexEffort;
}

function buildScreenshotAssistantPrompt(userPrompt) {
    const basePrompt = `You are analyzing a user-provided screenshot.

PRIMARY GOAL:
- If the screenshot contains a question (including MCQ, coding prompt, interview question, error dialog asking what to do, etc.), answer that question directly.

INSTRUCTIONS:
- First, read/identify the exact question(s) visible in the screenshot.
- Answer the question(s) with a complete, usable final answer.
- If it is a coding question: provide (1) a very short approach (max 3–6 bullets) then (2) the full code solution.
- If it is an MCQ: output the correct choice and a 1–2 sentence justification.
- If there is no clear question in the screenshot: briefly describe what's on screen and point out the most important details.

OUTPUT:
- Respond in markdown.
- Do not add meta commentary like "I see a screenshot…" or "I will OCR…". Just answer.
`;

    const trimmedUserPrompt = typeof userPrompt === 'string' ? userPrompt.trim() : '';
    if (!trimmedUserPrompt) return basePrompt;

    return `${basePrompt}\nUser request (optional):\n${trimmedUserPrompt}`;
}

function extractOpenAIResponseText(result, fallbackText = 'No response available') {
    if (result?.output_text) {
        return result.output_text;
    }

    if (result?.text && typeof result.text === 'string') {
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

function buildCodexInstructions() {
    const sessionPrompt = deps.getSystemPrompt();
    const base =
        'You are a direct, high-signal assistant in a chat panel. Answer completely and concretely in markdown. ' +
        'Prefer a short approach followed by the full solution. Do not narrate your process or add meta commentary.';

    if (!sessionPrompt || !sessionPrompt.trim()) {
        return base;
    }

    return `${sessionPrompt.trim()}\n\n---\n\nCHAT PANEL BEHAVIOR:\n${base}`;
}

function isStalePreviousResponseError(error) {
    if (!error) return false;
    if (error.status === 404) return true;
    return error.status === 400 && /previous_response/i.test(error.message || '');
}

function abortCodexStream() {
    if (!codexActiveStream) return false;
    try {
        codexActiveStream.abort();
    } catch (error) {
        console.warn('Failed to abort Codex stream:', error.message);
    }
    codexActiveStream = null;
    return true;
}

async function runCodexStream(params) {
    let accumulated = '';
    const messageId = nextMessageId();

    const stream = codexClient.responses.stream(params);
    codexActiveStream = stream;

    // The client-level timeout only covers the initial HTTP response; once headers
    // arrive a stalled stream would hang forever, so guard it explicitly.
    const stallTimer = setTimeout(() => {
        console.warn('Codex request exceeded local timeout; aborting');
        try {
            stream.abort();
        } catch (error) {
            console.warn('Timeout abort failed:', error.message);
        }
    }, CODEX_TIMEOUT_MS);

    deps.sendToRenderer('codex-chat-status', { state: 'thinking', effort: params.reasoning.effort, id: messageId });

    // Prevents an unhandled 'error' emission; the rejection is handled via finalResponse().
    stream.on('error', () => {});

    stream.on('response.reasoning_summary_text.delta', event => {
        deps.sendToRenderer('codex-reasoning-delta', { id: messageId, delta: event.delta || '' });
    });

    stream.on('response.output_text.delta', event => {
        if (!accumulated) {
            deps.sendToRenderer('codex-chat-status', { state: 'streaming', id: messageId });
        }
        accumulated += event.delta || '';
        deps.sendToRenderer('codex-chat-delta', { id: messageId, delta: event.delta || '', text: accumulated });
    });

    try {
        const final = await stream.finalResponse();
        const text = accumulated || extractOpenAIResponseText(final, 'No response available');

        codexPreviousResponseId = final.id || codexPreviousResponseId;
        codexUncommittedInput = [];
        codexHistory.push({
            id: messageId,
            role: 'assistant',
            text,
            timestamp: Date.now(),
            responseId: final.id,
            effort: params.reasoning.effort,
        });

        deps.sendToRenderer('codex-chat-message', {
            id: messageId,
            role: 'assistant',
            text,
            responseId: final.id,
            usage: final.usage || null,
            effort: params.reasoning.effort,
        });

        // 'incomplete' is an HTTP success, so a truncated answer would otherwise look complete.
        if (final.status === 'incomplete') {
            const reason = final.incomplete_details?.reason || 'unknown';
            deps.sendToRenderer('codex-chat-status', { state: 'error', message: `Response truncated (${reason})`, id: messageId });
        } else {
            deps.sendToRenderer('codex-chat-status', { state: 'done', id: messageId });
        }

        return { success: true, id: messageId, responseId: final.id, response: text };
    } catch (error) {
        const wasAborted = stream.aborted || error?.name === 'APIUserAbortError';

        // The turn never committed server-side, so keep its input for the next request —
        // otherwise a follow-up like "elaborate on that" has no referent.
        codexUncommittedInput = Array.isArray(params.input) ? params.input.slice() : [];

        if (accumulated) {
            codexHistory.push({ id: messageId, role: 'assistant', text: accumulated, timestamp: Date.now(), aborted: true });
        }

        if (wasAborted) {
            deps.sendToRenderer('codex-chat-message', { id: messageId, role: 'assistant', text: accumulated, aborted: true });
            deps.sendToRenderer('codex-chat-status', { state: 'aborted', id: messageId });
            return { success: false, aborted: true, error: 'aborted', code: 'ABORTED' };
        }

        console.error('Codex stream failed:', error.message);

        const code = error.status === 429 ? 'RATE_LIMITED' : error.code || null;
        const retryAfter = error.headers?.['retry-after'] || null;

        deps.sendToRenderer('codex-chat-error', {
            id: messageId,
            error: error.message || 'Codex request failed',
            code,
            retryAfter,
        });
        deps.sendToRenderer('codex-chat-status', { state: 'error', message: error.message || 'Codex request failed', id: messageId });

        return { success: false, error: error.message, code, stale: isStalePreviousResponseError(error) };
    } finally {
        clearTimeout(stallTimer);
        if (codexActiveStream === stream) {
            codexActiveStream = null;
        }
    }
}

async function ensureCodexClient() {
    const apiKey = await deps.getApiKey();
    if (!apiKey) {
        return { error: 'OpenAI API key not found', code: 'NO_API_KEY' };
    }

    const trimmed = apiKey.trim();
    if (!codexClient || codexApiKeyInUse !== trimmed) {
        codexClient = new OpenAI({
            apiKey: trimmed,
            timeout: CODEX_TIMEOUT_MS,
            // The SDK default of 2 retries can burn many minutes on a slow failure.
            maxRetries: 1,
        });
        // The response chain is scoped to the key that created it.
        if (codexApiKeyInUse !== null && codexApiKeyInUse !== trimmed) {
            codexPreviousResponseId = null;
        }
        codexApiKeyInUse = trimmed;
    }

    return { client: codexClient };
}

async function sendCodexMessage({ text, imageData, imageMimeType = 'image/jpeg', effort } = {}) {
    const trimmed = typeof text === 'string' ? text.trim() : '';
    if (!trimmed && !imageData) {
        return { success: false, error: 'Empty message' };
    }

    // One in-flight request at a time.
    abortCodexStream();

    const { client, error, code } = await ensureCodexClient();
    if (!client) {
        deps.sendToRenderer('codex-chat-status', { state: 'error', message: error });
        return { success: false, error, code };
    }

    const requestedEffort = normalizeEffort(effort);
    codexEffort = requestedEffort;

    const content = [];
    if (imageData) {
        content.push({ type: 'input_text', text: buildScreenshotAssistantPrompt(trimmed) });
        content.push({ type: 'input_image', image_url: `data:${imageMimeType};base64,${imageData}`, detail: 'high' });
    } else {
        content.push({ type: 'input_text', text: trimmed });
    }

    const params = {
        model: OPENAI_CODEX_MODEL,
        // 'summary: auto' is what surfaces reasoning progress during the long silent wait.
        reasoning: { effort: requestedEffort, summary: 'auto' },
        max_output_tokens: CODEX_MAX_OUTPUT_TOKENS,
        store: true,
        // instructions are NOT carried over by previous_response_id, so resend every turn.
        instructions: buildCodexInstructions(),
        input: [...codexUncommittedInput, { role: 'user', content }],
    };
    if (codexPreviousResponseId) {
        params.previous_response_id = codexPreviousResponseId;
    }

    const userMessageId = nextMessageId();
    codexHistory.push({
        id: userMessageId,
        role: 'user',
        text: trimmed,
        hasImage: !!imageData,
        timestamp: Date.now(),
    });
    deps.sendToRenderer('codex-chat-message', {
        id: userMessageId,
        role: 'user',
        text: trimmed,
        hasImage: !!imageData,
    });

    let result = await runCodexStream(params);

    // A stored response can expire or belong to a different key; retry once unchained.
    if (!result.success && !result.aborted && result.stale) {
        console.warn('Stale previous_response_id; retrying without conversation chain');
        codexPreviousResponseId = null;
        delete params.previous_response_id;
        result = await runCodexStream(params);
    }

    return result;
}

function getCodexState() {
    return {
        history: codexHistory,
        previousResponseId: codexPreviousResponseId,
        effort: codexEffort,
        busy: !!codexActiveStream,
    };
}

function clearCodexHistory() {
    abortCodexStream();
    codexHistory = [];
    codexPreviousResponseId = null;
    codexUncommittedInput = [];
}

function resetCodexState() {
    clearCodexHistory();
    codexEffort = DEFAULT_EFFORT;
    codexClient = null;
    codexApiKeyInUse = null;
}

function setupOpenAICodexIpcHandlers(dependencies = {}) {
    deps = { ...deps, ...dependencies };

    ipcMain.handle('codex-send-message', async (event, payload = {}) => {
        return await sendCodexMessage(payload);
    });

    ipcMain.handle('codex-capture-and-send', async (event, { text, effort, quality = 85 } = {}) => {
        const shot = await captureScreenJpegBase64({ quality });
        if (!shot.success) {
            deps.sendToRenderer('codex-chat-status', { state: 'error', message: shot.error });
            return { success: false, error: shot.error };
        }

        return await sendCodexMessage({ text, imageData: shot.imageData, imageMimeType: 'image/jpeg', effort });
    });

    ipcMain.handle('codex-capture-screenshot', async () => {
        return await captureScreenJpegBase64({ quality: 85 });
    });

    ipcMain.handle('codex-abort', async () => {
        const aborted = abortCodexStream();
        return { success: true, aborted };
    });

    ipcMain.handle('codex-get-history', async () => {
        return { success: true, ...getCodexState() };
    });

    ipcMain.handle('codex-clear-history', async () => {
        clearCodexHistory();
        return { success: true };
    });

    ipcMain.handle('codex-set-effort', async (event, { effort } = {}) => {
        if (!VALID_EFFORTS.includes(effort)) {
            return { success: false, error: `Invalid reasoning effort: ${effort}`, effort: codexEffort };
        }
        codexEffort = effort;
        return { success: true, effort: codexEffort };
    });
}

module.exports = {
    OPENAI_CODEX_MODEL,
    VALID_EFFORTS,
    setupOpenAICodexIpcHandlers,
    sendCodexMessage,
    abortCodexStream,
    clearCodexHistory,
    resetCodexState,
    getCodexState,
    buildScreenshotAssistantPrompt,
    extractOpenAIResponseText,
};
