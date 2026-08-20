const { desktopCapturer, screen } = require('electron');

/**
 * Silently captures the primary screen and returns it as base64-encoded JPEG.
 *
 * Uses desktopCapturer rather than a renderer mediaStream, so it works
 * independently of whether a realtime capture session is running.
 *
 * @param {Object} [options]
 * @param {number} [options.quality=85] JPEG quality, 1-100.
 * @param {number} [options.maxWidth=1920]
 * @param {number} [options.maxHeight=1080]
 * @returns {Promise<{success: boolean, imageData?: string, error?: string}>}
 */
async function captureScreenJpegBase64({ quality = 85, maxWidth = 1920, maxHeight = 1080 } = {}) {
    try {
        const primaryDisplay = screen.getPrimaryDisplay();
        const { width, height } = primaryDisplay.size;

        const sources = await desktopCapturer.getSources({
            types: ['screen'],
            thumbnailSize: { width: Math.min(width, maxWidth), height: Math.min(height, maxHeight) },
            fetchWindowIcons: false, // faster, and avoids touching window metadata
        });

        if (sources.length === 0) {
            return { success: false, error: 'No screen sources found' };
        }

        const screenshot = sources[0].thumbnail;
        const base64Data = screenshot.toJPEG(quality).toString('base64');

        // Drop the pixel buffer as soon as we no longer need it.
        screenshot.clear && screenshot.clear();

        return { success: true, imageData: base64Data };
    } catch (error) {
        // Deliberately vague: this app avoids leaking capture details to logs.
        return { success: false, error: 'Capture failed' };
    }
}

module.exports = { captureScreenJpegBase64 };
