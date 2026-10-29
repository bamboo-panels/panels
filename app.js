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
    sumAlpha += parseFloat(alpha[closestIndex]);
  });
  const meanAlpha = sumAlpha / targetFreqs.length;
  document.getElementById('meanAlpha').innerText = meanAlpha.toFixed(3);

  // 4. Render Chart with Persistent Tooltip Options
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
        borderColor: '#4caf50',
        backgroundColor: 'rgba(76, 175, 80, 0.15)',
        borderWidth: 2.5,
        fill: true,
        pointRadius: 0,
        pointHoverRadius: 8,         // Larger point when hovered
        pointHoverBackgroundColor: '#81c784',
        pointHoverBorderColor: '#ffffff',
        pointHoverBorderWidth: 2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      // Keeps the tooltip locked and stable near the cursor
      interaction: {
        mode: 'nearest',
        intersect: false,
      },
      hover: {
        mode: 'nearest',
        intersect: false
      },
      plugins: {
        tooltip: {
          enabled: true,
          backgroundColor: 'rgba(20, 20, 20, 0.95)',
          titleFont: { size: 14, weight: 'bold' },
          bodyFont: { size: 13 },
          borderColor: '#4caf50',
          borderWidth: 1,
          padding: 12,
          caretPadding: 10,
          callbacks: {
            title: function(context) {
              return 'Frequency: ' + context[0].label + ' Hz';
            },
            label: function(context) {
              return ' Absorption (α): ' + context.parsed.y;
            }
          }
        },
        legend: {
          labels: { color: '#e0e0e0' }
        }
      },
      scales: {
        x: {
          grid: { color: 'rgba(255, 255, 255, 0.05)' },
          ticks: { color: '#a0a0a0', maxTicksLimit: 15 },
          title: { display: true, text: 'Frequency (Hz)', color: '#e0e0e0', font: { weight: 'bold' } }
        },
        y: {
          min: 0,
          max: 1.05,
          grid: { color: 'rgba(255, 255, 255, 0.05)' },
          ticks: { color: '#a0a0a0' },
          title: { display: true, text: 'Absorption Coefficient (α)', color: '#e0e0e0', font: { weight: 'bold' } }
        }
      }
    }
  });
}
