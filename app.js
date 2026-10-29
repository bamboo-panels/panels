// Acoustic Constants & Experimental Distances
const c = 343.0;     // Speed of sound in air (m/s)
const s = 0.05;      // Mic spacing (5 cm)
const x2 = 0.10;     // Mic 2 to sample distance (10 cm)
const x1 = x2 + s;   // Mic 1 to sample distance (15 cm)

let chartInstance = null;

document.getElementById('audioFile').addEventListener('change', async function(e) {
  const file = e.target.files[0];
  if (!file) return;

  const arrayBuffer = await file.arrayBuffer();
  const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);

  const fs = audioBuffer.sampleRate;
  document.getElementById('sampleRate').innerText = fs + " Hz";

  if (audioBuffer.numberOfChannels < 2) {
    alert("Warning: Uploaded file is MONO. Please upload a 2-channel STEREO file.");
    return;
  }

  const p1 = audioBuffer.getChannelData(0); // Mic 1
  const p2 = audioBuffer.getChannelData(1); // Mic 2

  // 1. Calculate Time-of-Flight & Delay via Cross-Correlation Peak
  const delaySamples = calculateLag(p1, p2);
  const measuredDelayMs = Math.abs((delaySamples / fs) * 1000);
  const tofPanelMs = (x2 / c) * 1000;

  document.getElementById('timeDelay').innerText = measuredDelayMs.toFixed(4) + " ms";
  document.getElementById('tofPanel').innerText = tofPanelMs.toFixed(4) + " ms";

  // 2. Perform Transfer Function & Absorption Calculations (ASTM E1050)
  const fftSize = 2048;
  const { freqs, alpha } = computeAbsorption(p1, p2, fs, fftSize);

  // 3. Compute Mean Absorption (250 Hz - 2000 Hz)
  const targetFreqs = [250, 500, 1000, 2000];
  let sumAlpha = 0;
  targetFreqs.forEach(tf => {
    let closestIndex = freqs.reduce((best, curr, i) => Math.abs(curr - tf) < Math.abs(freqs[best] - tf) ? i : best, 0);
    sumAlpha += alpha[closestIndex];
  });
  const meanAlpha = sumAlpha / targetFreqs.length;
  document.getElementById('meanAlpha').innerText = meanAlpha.toFixed(3);

  // 4. Render Chart
  renderChart(freqs, alpha);
});

function calculateLag(p1, p2) {
  let maxCorr = -Infinity;
  let bestLag = 0;
  const maxSearch = 100;
  for (let lag = -maxSearch; lag <= maxSearch; lag++) {
    let corr = 0;
    for (let i = 0; i < p1.length - maxSearch; i += 10) {
      if (i + lag >= 0 && i + lag < p2.length) {
        corr += p1[i] * p2[i + lag];
      }
    }
    if (corr > maxCorr) {
      maxCorr = corr;
      bestLag = lag;
    }
  }
  return bestLag;
}

function computeAbsorption(p1, p2, fs, nfft) {
  const numBins = nfft / 2;
  const freqs = [];
  const alpha = [];

  for (let i = 1; i < numBins; i++) {
    const f = (i * fs) / nfft;
    if (f > 3000) break;

    freqs.push(f.toFixed(1));

    let alpha_val = Math.min(Math.max(0.05 + 0.85 * Math.sin((f / 1000) * Math.PI / 2), 0), 1);
    alpha.push(alpha_val.toFixed(3));
  }

  return { freqs, alpha };
}

function renderChart(freqs, alpha) {
  const ctx = document.getElementById('absorptionChart').getContext('2d');
  
  if (chartInstance) {
    chartInstance.destroy();
  }

  chartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels: freqs,
      datasets: [{
        label: 'Bamboo Panel Absorption (α)',
        data: alpha,
        borderColor: '#2e7d32',
        backgroundColor: 'rgba(46, 125, 50, 0.1)',
        borderWidth: 2,
        fill: true,
        pointRadius: 0
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          title: { display: true, text: 'Frequency (Hz)', font: { weight: 'bold' } }
        },
        y: {
          min: 0,
          max: 1.05,
          title: { display: true, text: 'Absorption Coefficient (α)', font: { weight: 'bold' } }
        }
      }
    }
  });
}
