const { convertStereoToMono } = require('../utils/audioCapture');

describe('macOS audio capture helpers', () => {
    it('converts interleaved stereo PCM16 to mono using the left channel', () => {
        const stereoBuffer = Buffer.alloc(8);
        stereoBuffer.writeInt16LE(1000, 0);
        stereoBuffer.writeInt16LE(-1000, 2);
        stereoBuffer.writeInt16LE(-1234, 4);
        stereoBuffer.writeInt16LE(1234, 6);

        const monoBuffer = convertStereoToMono(stereoBuffer);

        expect(monoBuffer.length).toBe(4);
        expect(monoBuffer.readInt16LE(0)).toBe(1000);
        expect(monoBuffer.readInt16LE(2)).toBe(-1234);
    });

    it('ignores incomplete trailing stereo frames', () => {
        const stereoBuffer = Buffer.alloc(6);
        stereoBuffer.writeInt16LE(250, 0);
        stereoBuffer.writeInt16LE(500, 2);
        stereoBuffer.writeInt16LE(750, 4);

        const monoBuffer = convertStereoToMono(stereoBuffer);

        expect(monoBuffer.length).toBe(2);
        expect(monoBuffer.readInt16LE(0)).toBe(250);
    });
});
