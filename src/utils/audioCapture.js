const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { saveDebugAudio } = require('../audioUtils');
const { normalizeAudioMode, getAudioCapturePlan } = require('./audioModes');

const CHUNK_DURATION = 0.1;
const SAMPLE_RATE = 24000;
const BYTES_PER_SAMPLE = 2;
const CHANNELS = 2;
const CHUNK_SIZE = SAMPLE_RATE * BYTES_PER_SAMPLE * CHANNELS * CHUNK_DURATION;

let systemAudioProc = null;

function getSystemAudioDumpBinaryName() {
    const systemArch = process.arch === 'x64' ? 'x86_64' : process.arch;
    return systemArch === 'x86_64' ? 'SystemAudioDump_x86' : 'SystemAudioDump';
}

function getSystemAudioDumpPath(app) {
    const binaryName = getSystemAudioDumpBinaryName();
    if (app.isPackaged) {
        return path.join(process.resourcesPath, binaryName);
    }
    return path.join(__dirname, '../assets', binaryName);
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

async function startMacOSAudioCapture({ sendAudioChunk, sendToRenderer, label = 'macOS audio capture' }) {
    if (process.platform !== 'darwin') return false;

    await killExistingSystemAudioDump();

    console.log(`Starting ${label} with SystemAudioDump...`);

    const { app } = require('electron');
    const binaryName = getSystemAudioDumpBinaryName();
    const systemAudioPath = getSystemAudioDumpPath(app);

    console.log(`Detected system architecture: ${process.arch}, using binary: ${binaryName}`);
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
        detached: false,
        windowsHide: false,
    };

    let proc = null;
    try {
        proc = spawn(systemAudioPath, [], spawnOptions);
        systemAudioProc = proc;

        if (!proc.pid) {
            console.error('Failed to start SystemAudioDump - no PID returned');
            sendToRenderer('update-status', 'Error: Failed to start SystemAudioDump');
            return false;
        }
    } catch (error) {
        if (error.code === 'Unknown system error -86' || error.errno === -86) {
            const errorMsg =
                'SystemAudioDump architecture mismatch. The binary is not compatible with your system architecture. ' +
                'Please ensure you have the correct version of SystemAudioDump for your Mac (Intel or Apple Silicon).';
            console.error(errorMsg);
            sendToRenderer('update-status', 'Error: SystemAudioDump architecture mismatch');
        } else {
            console.error('Error spawning SystemAudioDump:', error);
            sendToRenderer('update-status', `Error: Failed to start SystemAudioDump - ${error.message}`);
        }
        return false;
    }

    console.log('SystemAudioDump started with PID:', proc.pid);

    let audioBuffer = Buffer.alloc(0);

    proc.stdout.on('data', data => {
        audioBuffer = Buffer.concat([audioBuffer, data]);

        while (audioBuffer.length >= CHUNK_SIZE) {
            const chunk = audioBuffer.slice(0, CHUNK_SIZE);
            audioBuffer = audioBuffer.slice(CHUNK_SIZE);

            const monoChunk = CHANNELS === 2 ? convertStereoToMono(chunk) : chunk;
            const base64Data = monoChunk.toString('base64');

            Promise.resolve(sendAudioChunk(base64Data)).catch(error => {
                console.error('Error sending SystemAudioDump audio chunk:', error);
            });

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

    proc.stderr.on('data', data => {
        console.error('SystemAudioDump stderr:', data.toString());
    });

    proc.on('close', code => {
        console.log('SystemAudioDump process closed with code:', code);
        if (systemAudioProc === proc) {
            systemAudioProc = null;
        }
    });

    proc.on('error', err => {
        let errorMsg = 'SystemAudioDump process error: ' + err.message;
        if (err.code === 'Unknown system error -86' || err.errno === -86) {
            errorMsg =
                'SystemAudioDump architecture mismatch. The binary is not compatible with your system architecture. ' +
                'Please ensure you have the correct version of SystemAudioDump for your Mac (Intel or Apple Silicon).';
            sendToRenderer('update-status', 'Error: SystemAudioDump architecture mismatch');
        } else {
            sendToRenderer('update-status', `Error: SystemAudioDump failed - ${err.message}`);
        }
        console.error(errorMsg);
        if (systemAudioProc === proc) {
            systemAudioProc = null;
        }
    });

    return true;
}

function convertStereoToMono(stereoBuffer) {
    const samples = Math.floor(stereoBuffer.length / 4);
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

module.exports = {
    normalizeAudioMode,
    getAudioCapturePlan,
    killExistingSystemAudioDump,
    startMacOSAudioCapture,
    convertStereoToMono,
    stopMacOSAudioCapture,
};
