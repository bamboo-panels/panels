// Web Audio API Sound Generator variables
let signalAudioCtx = null;
let activeNoiseNode = null;
let activeGainNode = null;

// Toggle Play / Pause for the Test Audio Generator
function toggleAudioPlayback() {
    const btn = document.getElementById('audioPlayBtn');
    const signalType = document.getElementById('audioSignalType').value;

    if (!signalAudioCtx) {
        signalAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }

    if (signalAudioCtx.state === 'suspended') {
        signalAudioCtx.resume();
    }

    // If already playing, stop it
    if (activeNoiseNode) {
        stopAudioPlayback();
        return;
    }

    // 1. Create Gain (Volume) Node - kept moderate to avoid speaker distortion
    activeGainNode = signalAudioCtx.createGain();
    activeGainNode.gain.value = 0.2; // 20% volume (safe and clean)
    activeGainNode.connect(signalAudioCtx.destination);

    // 2. Generate Selected Signal Type
    if (signalType === 'whitenoise' || signalType === 'pinknoise') {
        // Generate White Noise Buffer
        const bufferSize = 2 * signalAudioCtx.sampleRate;
        const noiseBuffer = signalAudioCtx.createBuffer(1, bufferSize, signalAudioCtx.sampleRate);
        const output = noiseBuffer.getChannelData(0);
        
        for (let i = 0; i < bufferSize; i++) {
            output[i] = Math.random() * 2 - 1; // Random noise
        }

        activeNoiseNode = signalAudioCtx.createBufferSource();
        activeNoiseNode.buffer = noiseBuffer;
        activeNoiseNode.loop = true;
        activeNoiseNode.connect(activeGainNode);
        activeNoiseNode.start();

    } else if (signalType === 'sweep') {
        // Generate Sine Sweep (20 Hz to 5000 Hz)
        activeNoiseNode = signalAudioCtx.createOscillator();
        activeNoiseNode.type = 'sine';
        activeNoiseNode.frequency.setValueAtTime(20, signalAudioCtx.currentTime);
        // Ramp frequency up over 5 seconds
        activeNoiseNode.frequency.exponentialRampToValueAtTime(5000, signalAudioCtx.currentTime + 5);
        activeNoiseNode.connect(activeGainNode);
        activeNoiseNode.start();
    }

    // Update Button UI to "Playing"
    btn.classList.remove('bg-emerald-600', 'hover:bg-emerald-500');
    btn.classList.add('bg-amber-600', 'hover:bg-amber-500');
    btn.innerHTML = `<i data-lucide="pause" class="w-3 h-3"></i> Playing...`;
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

// Stop Audio Playback
function stopAudioPlayback() {
    if (activeNoiseNode) {
        try {
            activeNoiseNode.stop();
            activeNoiseNode.disconnect();
        } catch (e) {
            // Ignore if already stopped
        }
        activeNoiseNode = null;
    }

    const btn = document.getElementById('audioPlayBtn');
    if (btn) {
        btn.classList.remove('bg-amber-600', 'hover:bg-amber-500');
        btn.classList.add('bg-emerald-600', 'hover:bg-emerald-500');
        btn.innerHTML = `<i data-lucide="play" class="w-3 h-3"></i> Play Signal`;
        if (typeof lucide !== 'undefined') lucide.createIcons();
    }
}
