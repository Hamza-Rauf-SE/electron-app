const VALID_AUDIO_MODES = new Set(['speaker_only', 'mic_only', 'both']);

function normalizeAudioMode(audioMode) {
    return VALID_AUDIO_MODES.has(audioMode) ? audioMode : 'speaker_only';
}

function getAudioCapturePlan(audioMode) {
    const normalizedMode = normalizeAudioMode(audioMode);

    return {
        audioMode: normalizedMode,
        captureSystemAudio: normalizedMode === 'speaker_only' || normalizedMode === 'both',
        captureMicrophone: normalizedMode === 'mic_only' || normalizedMode === 'both',
    };
}

module.exports = {
    normalizeAudioMode,
    getAudioCapturePlan,
};
