const { normalizeAudioMode, getAudioCapturePlan } = require('../utils/audioModes');

describe('audio mode helpers', () => {
    it('normalizes unknown modes to speaker_only', () => {
        expect(normalizeAudioMode('speaker_only')).toBe('speaker_only');
        expect(normalizeAudioMode('mic_only')).toBe('mic_only');
        expect(normalizeAudioMode('both')).toBe('both');
        expect(normalizeAudioMode('unknown')).toBe('speaker_only');
        expect(normalizeAudioMode(undefined)).toBe('speaker_only');
    });

    it('maps audio modes to capture plans', () => {
        expect(getAudioCapturePlan('speaker_only')).toEqual({
            audioMode: 'speaker_only',
            captureSystemAudio: true,
            captureMicrophone: false,
        });

        expect(getAudioCapturePlan('mic_only')).toEqual({
            audioMode: 'mic_only',
            captureSystemAudio: false,
            captureMicrophone: true,
        });

        expect(getAudioCapturePlan('both')).toEqual({
            audioMode: 'both',
            captureSystemAudio: true,
            captureMicrophone: true,
        });
    });
});
