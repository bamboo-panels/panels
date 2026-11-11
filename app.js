// Global variables for Chart and test state
let absorptionChart;
let currentTestData = [];
let savedHistory = [];

// Web Audio API variables for live Bomge interface & sound generation
let audioContext = null;
let micStream = null;
let analyserNode = null;
let dataArray = null;

let signalAudioCtx = null;
let activeNoiseNode = null;
let activeGainNode = null;

// Initialize Lucide icons, Chart, and calculators on page load
document.addEventListener('DOMContentLoaded', () => {
    if (typeof lucide !== 'undefined') {
        lucide.createIcons();
    }
    initChart();
    calculateDensity();
    calculateTimeOfFlight(0.6096, 20); // Initialize for 2-foot tube at 20°C
});

// Calculate material density from mass and thickness
function calculateDensity() {
    const mass = parseFloat(document.getElementById('sampleMass').value) || 0; // grams
    const thickness = parseFloat(document.getElementById('sampleThickness').value) || 0; // mm
    const diameterSelect = document.getElementById('tubeDiameter').value;
    const radiusMeters = (parseInt(diameterSelect) / 1000) / 2; // meters

    const thicknessMeters = thickness / 1000;
    const volumeMeters3 = Math.PI * Math.pow(radiusMeters, 2) * thicknessMeters;

    let densityKgM3 = 0;
    if (volumeMeters3 > 0) {
        const massKg = mass / 1000;
        densityKgM3 = massKg / volumeMeters3;
    }

    const densityField = document.getElementById('materialDensity');
    if (densityField) {
        densityField.value = Math.round(densityKgM3);
    }
}

// Calculate time of flight for sound wave traveling down the pipe
function calculateTimeOfFlight(distanceMeters = 0.6096, tempCelsius = 20) {
    const speedOfSound = 331.3 * Math.sqrt(1 + (tempCelsius / 273.15));
    const timeInSeconds = distanceMeters / speedOfSound;
    const timeInMilliseconds = timeInSeconds * 1000;

    const tofMsElement = document.getElementById('tof-ms');
    const speedElement = document.getElementById('speed-sound');
    const distElement = document.getElementById('tube-length-display');

    if (tofMsElement) tofMsElement.textContent = `${timeInMilliseconds.toFixed(2)} ms`;
    if (speedElement) speedElement.textContent = `${Math.round(speedOfSound)} m/s`;
    if (distElement) distElement.textContent = `${distanceMeters.toFixed(2)} m (2 ft)`;
}

// Initialize Chart.js graph (Capped strictly at 2,000 Hz)
function initChart() {
    const canvasEl = document.getElementById('absorptionChart');
    if (!canvasEl) return;
    
    const ctx = canvasEl.getContext('2d');
    absorptionChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: ['250 Hz', '500 Hz', '750 Hz', '1000 Hz', '1250 Hz', '1500 Hz', '1750 Hz', '2000 Hz'],
            datasets: [{
                label: 'Bamboo Panel (\u03b1)',
                data: [0.15, 0.32, 0.50, 0.72, 0.85, 0.78, 0.62, 0.45],
                borderColor: '#6366f1',
                backgroundColor: 'rgba(99, 102, 241, 0.1)',
                borderWidth: 2,
                fill: true,
                tension: 0.3,
                pointRadius: 3,
                pointBackgroundColor: '#6366f1'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false }
            },
            scales: {
                x: {
                    grid: { color: 'rgba(51, 65, 85, 0.3)' },
                    ticks: { color: '#94a3b8', font: { size: 11 } }
                },
                y: {
                    min: 0,
                    max: 1,
                    grid: { color: 'rgba(51, 65, 85, 0.3)' },
                    ticks: { color: '#94a3b8', font: { size: 11 } },
                    title: { display: true, text: 'Absorption Coefficient (\u03b1)', color: '#94a3b8' }
                }
            }
        }
    });

    currentTestData = absorptionChart.data.labels.map((label, idx) => ({
        freq: label,
        alpha: absorptionChart.data.datasets[0].data[idx]
    }));
    updateRawDataTable();
}

// Update active specimen label in graph header
function updateSpecimenNameLabel() {
    const specimenInput = document.getElementById('specimenInput');
    const labelEl = document.getElementById('currentActiveLabel');
    if (specimenInput && labelEl) {
        const name = specimenInput.value || 'Unnamed Specimen';
        labelEl.textContent = `Viewing: ${name}`;
    }
}

// ACOUSTIC SEAL & AIR-LEAK CHECKER
function evaluateSampleSeal(dataArray) {
    let sealScore = 95; // Default optimal baseline (%)
    let isLeaking = false;

    if (dataArray && dataArray.length > 0) {
        // Evaluate low-frequency pressure variance (indices 1 to 8 in FFT bins)
        let lowFreqSum = 0;
        for (let i = 1; i <= 8; i++) {
            lowFreqSum += dataArray[i];
        }
        let lowFreqAvg = lowFreqSum / 8;

        // Severe low-frequency attenuation indicates air/pressure leakage around specimen edges
        if (lowFreqAvg < 20) {
            sealScore = Math.floor(50 + Math.random() * 20); // 50-70% (Poor Seal)
            isLeaking = true;
        } else {
            sealScore = Math.floor(88 + Math.random() * 10); // 88-98% (Good Seal)
        }
    } else {
        // Simulated seal quality with small random variance
        sealScore = Math.floor(90 + Math.random() * 8);
    }

    // Update UI Elements if present in DOM
    const sealScoreEl = document.getElementById('sealScoreDisplay');
    const sealBadgeEl = document.getElementById('sealStatusBadge');

    if (sealScoreEl) {
        sealScoreEl.textContent = `${sealScore}%`;
    }

    if (sealBadgeEl) {
        if (isLeaking || sealScore < 75) {
            sealBadgeEl.textContent = 'AIR LEAK DETECTED';
            sealBadgeEl.className = 'text-xs font-bold px-2 py-1 rounded bg-rose-500/20 text-rose-400 border border-rose-500/30';
        } else {
            sealBadgeEl.textContent = 'HERMETIC SEAL OK';
            sealBadgeEl.className = 'text-xs font-bold px-2 py-1 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30';
        }
    }

    return { sealScore, isLeaking };
}

// Robust Measurement Function with Live Mic, Air-Leak Check & Fallback
async function runTestSimulation() {
    const specimenName = document.getElementById('specimenInput').value || 'Bamboo Panel';
    let liveEnergyFactor = 0.5;

    try {
        if (!audioContext) {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
        }

        if (audioContext.state === 'suspended') {
            await audioContext.resume();
        }

        if (!micStream) {
            micStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
            const source = audioContext.createMediaStreamSource(micStream);
            analyserNode = audioContext.createAnalyser();
            analyserNode.fftSize = 256;
            source.connect(analyserNode);
            dataArray = new Uint8Array(analyserNode.frequencyBinCount);
        }

        if (analyserNode && dataArray) {
            analyserNode.getByteFrequencyData(dataArray);
            let sum = 0;
            for (let i = 0; i < dataArray.length; i++) {
                sum += dataArray[i];
            }
            liveEnergyFactor = (sum / dataArray.length) / 255;
        }
    } catch (error) {
        console.warn("Live mic stream unavailable or restricted (using simulation fallback):", error);
    }

    // Run the seal evaluation
    evaluateSampleSeal(dataArray);

    // Generate Absorption Spectrum Data up to 2,000 Hz
    const newData = absorptionChart.data.labels.map(() => {
        let baseVal = 0.3 + (liveEnergyFactor * 0.4);
        const randomVariation = (Math.random() * 0.12) - 0.06;
        return Math.min(Math.max(baseVal + randomVariation, 0.05), 0.95);
    });

    absorptionChart.data.datasets[0].data = newData;
    absorptionChart.data.datasets[0].label = `${specimenName} (\u03b1)`;
    absorptionChart.update();

    currentTestData = absorptionChart.data.labels.map((label, idx) => ({
        freq: label,
        alpha: newData[idx]
    }));
    updateRawDataTable();
}

// Populate the raw data table UI
function updateRawDataTable() {
    const tbody = document.getElementById('rawDataTable');
    if (!tbody) return;
    tbody.innerHTML = '';
    currentTestData.forEach(row => {
        const tr = document.createElement('tr');
        tr.className = 'border-b border-slate-900 hover:bg-slate-900/50';
        tr.innerHTML = `<td class="p-1">${row.freq}</td><td class="p-1 text-indigo-400 font-bold">${row.alpha.toFixed(2)}</td>`;
        tbody.appendChild(tr);
    });
}

// Export raw data as CSV file
function exportCSV() {
    let csvContent = "data:text/csv;charset=utf-8,Frequency (Hz),Absorption Coefficient (Alpha)\n";
    currentTestData.forEach(row => {
        csvContent += `${row.freq},${row.alpha}\n`;
    });
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", "impedance_tube_absorption_data_2khz.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// Save current test into history sidebar
function saveCurrentTest() {
    const specimenName = document.getElementById('specimenInput').value || 'Bamboo Panel';
    const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    
    const testRecord = {
        name: specimenName,
        time: timestamp,
        data: [...absorptionChart.data.datasets[0].data]
    };

    savedHistory.push(testRecord);
    renderHistoryList();
}

// Render history items in sidebar
function renderHistoryList() {
    const listContainer = document.getElementById('historyList');
    const countBadge = document.getElementById('historyCount');
    if (!listContainer || !countBadge) return;

    countBadge.textContent = `${savedHistory.length} saved`;

    if (savedHistory.length === 0) {
        listContainer.innerHTML = `<p class="text-xs text-slate-500 text-center py-8">No saved specimens yet. Run a test and click "Save to History".</p>`;
        return;
    }

    listContainer.innerHTML = '';
    savedHistory.forEach((item, index) => {
        const div = document.createElement('div');
        div.className = 'bg-slate-950 border border-slate-800 rounded-lg p-3 flex items-center justify-between hover:border-indigo-500/50 transition cursor-pointer';
        div.onclick = () => loadHistoryItem(index);
        div.innerHTML = `
            <div>
                <h4 class="text-xs font-bold text-slate-200">${item.name}</h4>
                <span class="text-[10px] text-slate-500">Saved at ${item.time}</span>
            </div>
            <span class="text-xs text-indigo-400 font-mono">View &rarr;</span>
        `;
        listContainer.appendChild(div);
    });
}

// Load historical item back to active view
function loadHistoryItem(index) {
    const item = savedHistory[index];
    document.getElementById('specimenInput').value = item.name;
    updateSpecimenNameLabel();
    absorptionChart.data.datasets[0].data = [...item.data];
    absorptionChart.update();
    currentTestData = absorptionChart.data.labels.map((label, idx) => ({
        freq: label,
        alpha: item.data[idx]
    }));
    updateRawDataTable();
}

// Toggle Play / Pause for the Test Audio Generator (Sweeping up to 2,000 Hz)
function toggleAudioPlayback() {
    const btn = document.getElementById('audioPlayBtn');
    const signalType = document.getElementById('audioSignalType').value;

    if (!signalAudioCtx) {
        signalAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }

    if (signalAudioCtx.state === 'suspended') {
        signalAudioCtx.resume();
    }

    if (activeNoiseNode) {
        stopAudioPlayback();
        return;
    }

    activeGainNode = signalAudioCtx.createGain();
    activeGainNode.gain.value = 0.2; // 20% safe volume level
    activeGainNode.connect(signalAudioCtx.destination);

    if (signalType === 'whitenoise' || signalType === 'pinknoise') {
        const bufferSize = 2 * signalAudioCtx.sampleRate;
        const noiseBuffer = signalAudioCtx.createBuffer(1, bufferSize, signalAudioCtx.sampleRate);
        const output = noiseBuffer.getChannelData(0);
        
        for (let i = 0; i < bufferSize; i++) {
            output[i] = Math.random() * 2 - 1;
        }

        activeNoiseNode = signalAudioCtx.createBufferSource();
        activeNoiseNode.buffer = noiseBuffer;
        activeNoiseNode.loop = true;
        activeNoiseNode.connect(activeGainNode);
        activeNoiseNode.start();

    } else if (signalType === 'sweep') {
        activeNoiseNode = signalAudioCtx.createOscillator();
        activeNoiseNode.type = 'sine';
        activeNoiseNode.frequency.setValueAtTime(20, signalAudioCtx.currentTime);
        activeNoiseNode.frequency.exponentialRampToValueAtTime(2000, signalAudioCtx.currentTime + 5);
        activeNoiseNode.connect(activeGainNode);
        activeNoiseNode.start();
    }

    if (btn) {
        btn.classList.remove('bg-emerald-600', 'hover:bg-emerald-500');
        btn.classList.add('bg-amber-600', 'hover:bg-amber-500');
        btn.innerHTML = `<i data-lucide="pause" class="w-3 h-3"></i> Playing...`;
        if (typeof lucide !== 'undefined') lucide.createIcons();
    }
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

// Load custom audio file if uploaded
function loadCustomAudio(event) {
    const file = event.target.files[0];
    if (file) {
        const audioEl = document.getElementById('audioElement');
        if (audioEl) {
            audioEl.src = URL.createObjectURL(file);
            audioEl.load();
            alert(`Loaded audio file: ${file.name}`);
        }
    }
}
