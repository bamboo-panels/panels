from flask import Flask, jsonify, request
from flask_cors import CORS
import numpy as np
from scipy.signal import csd, welch
import sounddevice as sd

app = Flask(__name__)
CORS(app)

# --- ISO 10534-2 HARDWARE & TUBE CONSTANTS ---
FS = 48000                  # Sample rate (Hz)
DURATION = 5.0              # Sweep duration (seconds)
MIC_SPACING_S = 0.05        # 50 mm spacing between Mic 1 and Mic 2 (meters)
DIST_TO_SAMPLE_L = 0.40     # 400 mm from Mic 2 to sample front face (meters)
TARGET_FREQS = [250, 500, 750, 1000, 1250, 1500, 1750, 2000]

def find_bomge_device():
    """Automatically locates the Bomge USB Audio Interface if connected."""
    devices = sd.query_devices()
    for idx, dev in enumerate(devices):
        name = dev['name'].lower()
        if ('bomge' in name or 'usb' in name) and dev['max_input_channels'] >= 2 and dev['max_output_channels'] >= 2:
            return idx
    return None  # Falls back to Windows default stereo device

def generate_log_sweep(fs=48000, duration=5.0, f_start=100, f_end=2200):
    """Generates a phase-continuous logarithmic sine sweep."""
    t = np.linspace(0, duration, int(fs * duration), endpoint=False)
    k = (f_end / f_start) ** (1.0 / duration)
    phase = 2.0 * np.pi * f_start * ((k ** t) - 1.0) / np.log(k)
    sweep = np.sin(phase)
    # Apply 50ms fade-in/fade-out to prevent speaker pop
    fade_len = int(0.05 * fs)
    window = np.ones_like(sweep)
    window[:fade_len] = np.linspace(0, 1, fade_len)
    window[-fade_len:] = np.linspace(1, 0, fade_len)
    return (sweep * window * 0.6).astype(np.float32)

def compute_iso10534_2(mic1, mic2, fs, temp_c=28.0):
    """
    True ISO 10534-2 Two-Microphone Transfer Function Method:
    Computes complex cross-spectral density H12 = S12 / S11 and complex reflection factor R.
    """
    c = 331.3 * np.sqrt(1.0 + (temp_c / 273.15))  # Speed of sound adjusted for room temp
    nperseg = 4096

    f, S11 = welch(mic1, fs=fs, nperseg=nperseg)
    _, S22 = welch(mic2, fs=fs, nperseg=nperseg)
    _, S12 = csd(mic1, mic2, fs=fs, nperseg=nperseg)

    alphas = []
    coherences = []

    for target_f in TARGET_FREQS:
        idx = np.argmin(np.abs(f - target_f))
        k = (2.0 * np.pi * f[idx]) / c

        # Complex Transfer Function H12 = S12 / S11
        H12 = S12[idx] / (S11[idx] + 1e-18)

        # Coherence gamma^2 = |S12|^2 / (S11 * S22) (measures signal-to-noise quality)
        gamma_sq = (np.abs(S12[idx]) ** 2) / ((S11[idx] * S22[idx]) + 1e-18)
        coherences.append(float(np.clip(gamma_sq, 0.0, 1.0)))

        # Incident & Reflected wave terms (ISO 10534-2 Eq. 16)
        H_i = np.exp(-1j * k * MIC_SPACING_S)
        H_r = np.exp(1j * k * MIC_SPACING_S)

        # Complex Reflection Coefficient R at sample surface
        R = ((H12 - H_i) / (H_r - H12)) * np.exp(2j * k * (DIST_TO_SAMPLE_L + MIC_SPACING_S))

        # Normal-Incidence Sound Absorption Coefficient alpha = 1 - |R|^2
        alpha = 1.0 - (np.abs(R) ** 2)
        alphas.append(round(float(np.clip(alpha, 0.0, 1.0)), 2))

    return alphas, coherences, round(float(c), 1)

@app.route('/measure', methods=['POST'])
def run_measurement():
    data = request.json or {}
    temp_c = float(data.get('temp', 28.0))
    thickness_mm = float(data.get('thickness', 15.0))

    device_idx = find_bomge_device()
    sweep = generate_log_sweep(FS, DURATION)
    stereo_out = np.column_stack((sweep, sweep))

    try:
        # Simultaneously play sweep and record 2 discrete channels (Left=Mic1, Right=Mic2)
        recording = sd.playrec(
            stereo_out,
            samplerate=FS,
            channels=2,
            device=device_idx,
            blocking=True
        )
    except Exception as e:
        return jsonify({"status": "error", "message": f"Audio interface error: {str(e)}"}), 500

    mic1 = recording[:, 0]
    mic2 = recording[:, 1]

    # Check if hardware actually captured acoustic signal (reject dead/unplugged interface)
    rms1 = float(np.sqrt(np.mean(mic1 ** 2)))
    rms2 = float(np.sqrt(np.mean(mic2 ** 2)))

    if rms1 < 0.0005 or rms2 < 0.0005:
        return jsonify({
            "status": "no_signal",
            "message": f"No acoustic signal detected (Mic1 RMS: {rms1:.5f}, Mic2 RMS: {rms2:.5f}). Check Bomge power, amplifier, and gain knobs."
        }), 400

    # Check for digital clipping
    clipped = bool(np.max(np.abs(mic1)) >= 0.99 or np.max(np.abs(mic2)) >= 0.99)

    alphas, coherences, speed_of_sound = compute_iso10534_2(mic1, mic2, FS, temp_c)
    avg_coherence = float(np.mean(coherences))

    # Calculate propagation time to sample face
    total_dist = DIST_TO_SAMPLE_L + (thickness_mm / 1000.0)
    tof_ms = round((total_dist / speed_of_sound) * 1000.0, 2)

    return jsonify({
        "status": "ok",
        "alphas": alphas,
        "coherences": [round(c, 3) for c in coherences],
        "avgCoherence": round(avg_coherence * 100, 1),
        "clipped": clipped,
        "speedOfSound": speed_of_sound,
        "tofMs": tof_ms,
        "rms": [round(rms1, 4), round(rms2, 4)]
    })

if __name__ == '__main__':
    print("BioHUSH ISO 10534-2 Hardware Engine running on http://127.0.0.1:5000")
    app.run(host='127.0.0.1', port=5000)