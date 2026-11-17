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
MIC_SPACING_S = 0.10        # 100 mm spacing between Mic 1 and Mic 2 (meters)
DIST_TO_SAMPLE_L = 0.27     # 270 mm from Mic 2 to sample front face (meters)
# Keep target frequencies below the 10 cm spacing limit (~1.74 kHz at 28 C).
TARGET_FREQS = [250, 500, 750, 1000, 1250, 1500]

def find_bomge_device():
    """Find matching BMG input and output devices on the same host API."""
    devices = sd.query_devices()
    inputs = [
        (idx, dev) for idx, dev in enumerate(devices)
        if ('bmg-22m' in dev['name'].lower() or 'bomge' in dev['name'].lower())
        and dev['max_input_channels'] >= 2
    ]
    outputs = [
        (idx, dev) for idx, dev in enumerate(devices)
        if ('bmg-22m' in dev['name'].lower() or 'bomge' in dev['name'].lower())
        and dev['max_output_channels'] >= 2
    ]
    for input_idx, input_device in inputs:
        for output_idx, output_device in outputs:
            if input_device['hostapi'] == output_device['hostapi']:
                return input_idx, output_idx
    return None

def generate_log_sweep(fs=48000, duration=5.0, f_start=100, f_end=1500):
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

def parse_complex_spectrum(values):
    if not isinstance(values, list) or len(values) != len(TARGET_FREQS):
        raise ValueError("Calibration data must contain one complex value per target frequency.")

    try:
        spectrum = np.asarray([complex(float(pair[0]), float(pair[1])) for pair in values])
    except (TypeError, ValueError, IndexError) as exc:
        raise ValueError("Each calibration value must be a [real, imaginary] pair.") from exc

    if not np.all(np.isfinite(spectrum.real)) or not np.all(np.isfinite(spectrum.imag)):
        raise ValueError("Calibration values must be finite.")
    return spectrum

def compute_mic_calibration(first_transfer, swapped_transfer):
    """Estimate the correction that cancels mic/channel mismatch after swapping."""
    if np.any(np.abs(first_transfer) < 1e-12) or np.any(np.abs(swapped_transfer) < 1e-12):
        raise ValueError("A transfer value is too small to calibrate reliably.")

    # The square-root ratio cancels the reciprocal mic/channel sensitivities.
    ratio = swapped_transfer / first_transfer
    correction_phase = np.unwrap(np.angle(ratio)) / 2.0
    correction_magnitude = np.sqrt(np.abs(ratio))
    return correction_magnitude * np.exp(1j * correction_phase)

def compute_iso10534_2(mic1, mic2, fs, temp_c=28.0, mic_calibration=None):
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
    raw_alphas = []
    reflection_magnitudes = []
    coherences = []
    transfer_functions = []

    for target_index, target_f in enumerate(TARGET_FREQS):
        idx = np.argmin(np.abs(f - target_f))
        k = (2.0 * np.pi * f[idx]) / c

        # Complex Transfer Function H12 = S12 / S11
        H12 = S12[idx] / (S11[idx] + 1e-18)
        transfer_functions.append(H12)
        if mic_calibration is not None:
            H12 *= mic_calibration[target_index]

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
        raw_alphas.append(float(alpha))
        reflection_magnitudes.append(float(np.abs(R)))
        alphas.append(round(float(np.clip(alpha, 0.0, 1.0)), 2))

    return (
        alphas,
        coherences,
        round(float(c), 1),
        raw_alphas,
        reflection_magnitudes,
        transfer_functions
    )

@app.route('/calibrate', methods=['POST'])
def calibrate_microphones():
    data = request.json or {}
    try:
        first_transfer = parse_complex_spectrum(data.get('firstTransferFunctions'))
        swapped_transfer = parse_complex_spectrum(data.get('swappedTransferFunctions'))
        correction = compute_mic_calibration(first_transfer, swapped_transfer)
    except ValueError as exc:
        return jsonify({"status": "error", "message": str(exc)}), 400

    return jsonify({
        "status": "ok",
        "micCalibration": [[float(value.real), float(value.imag)] for value in correction]
    })

@app.route('/measure', methods=['POST'])
def run_measurement():
    data = request.json or {}
    temp_c = float(data.get('temp', 28.0))
    thickness_mm = float(data.get('thickness', 15.0))
    try:
        mic_calibration = (
            parse_complex_spectrum(data['micCalibration'])
            if data.get('micCalibration') is not None else None
        )
    except ValueError as exc:
        return jsonify({"status": "error", "message": str(exc)}), 400

    device_pair = find_bomge_device()
    if device_pair is None:
        return jsonify({
            "status": "error",
            "message": "Could not find matching two-channel BMG-22M input and output devices. Check the audio interface connection."
        }), 500

    input_idx, output_idx = device_pair
    print(f"Using BMG audio devices: input={input_idx}, output={output_idx}", flush=True)
    sweep = generate_log_sweep(FS, DURATION)
    stereo_out = np.column_stack((sweep, sweep))

    try:
        # Simultaneously play sweep and record 2 discrete channels (Left=Mic1, Right=Mic2)
        recording = sd.playrec(
            stereo_out,
            samplerate=FS,
            channels=2,
            device=device_pair,
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

    (
        alphas,
        coherences,
        speed_of_sound,
        raw_alphas,
        reflection_magnitudes,
        transfer_functions
    ) = compute_iso10534_2(mic1, mic2, FS, temp_c, mic_calibration)
    diagnostics = ", ".join(
        f"{freq} Hz: raw alpha={alpha:.4f}, |R|={magnitude:.4f}"
        for freq, alpha, magnitude in zip(TARGET_FREQS, raw_alphas, reflection_magnitudes)
    )
    print(f"Absorption diagnostics: {diagnostics}", flush=True)
    avg_coherence = float(np.mean(coherences))

    # Calculate propagation time to sample face
    total_dist = DIST_TO_SAMPLE_L + (thickness_mm / 1000.0)
    tof_ms = round((total_dist / speed_of_sound) * 1000.0, 2)

    return jsonify({
        "status": "ok",
        "alphas": alphas,
        "transferFunctions": [[float(value.real), float(value.imag)] for value in transfer_functions],
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