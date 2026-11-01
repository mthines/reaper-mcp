"""
Offline audio analysis for the reaper-mcp sidecar.

Everything here works on float32 numpy arrays shaped (channels, frames) and
uses only numpy and torch / torchaudio.functional (already installed for the
Audiobox model). torchaudio.load/info are never used: torchaudio 2.9+ moved
them to torchcodec.

- Loudness follows ITU-R BS.1770-4 (K-weighting, 400 ms blocks, absolute and
  relative gating) and EBU Tech 3342 for loudness range (LRA).
- True peak follows BS.1770 Annex 2: 4x oversampling, then the sample peak.
- Spectral figures come from a long-term average spectrum (Welch-style STFT).
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np

ABSOLUTE_GATE_LUFS = -70.0
SILENCE_LUFS = -70.0

# Bands for the tonal balance summary (Hz). Names are what a mix engineer says.
BANDS: list[tuple[str, float, float]] = [
    ("sub", 20, 60),
    ("bass", 60, 250),
    ("lowMid", 250, 500),
    ("mid", 500, 2000),
    ("upperMid", 2000, 4000),
    ("presence", 4000, 6000),
    ("brilliance", 6000, 20000),
]

SIBILANCE_BAND = (5000.0, 10000.0)


# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------

def _db(x: float, floor: float = -150.0) -> float:
    return 20.0 * math.log10(x) if x > 0 else floor


def _round(x: float | None, digits: int = 2) -> float | None:
    if x is None or not math.isfinite(x):
        return None
    return round(float(x), digits)


def _power_to_lufs(mean_square_sum: float) -> float:
    return -0.691 + 10.0 * math.log10(mean_square_sum) if mean_square_sum > 0 else -math.inf


def load_audio(path: str, start: float = 0.0, end: float | None = None) -> tuple[np.ndarray, int]:
    """Read [start, end) seconds of a file as (channels, frames) float32."""
    import soundfile as sf  # type: ignore

    sample_rate = sf.info(path).samplerate
    stop = None if end is None else int(end * sample_rate)
    data, sample_rate = sf.read(path, start=int(start * sample_rate), stop=stop,
                                dtype="float32", always_2d=True)
    return np.ascontiguousarray(data.T), int(sample_rate)


# ---------------------------------------------------------------------------
# K-weighting (BS.1770-4) — coefficients derived for any sample rate
# ---------------------------------------------------------------------------

def _k_weighting_coeffs(sample_rate: int) -> list[tuple[list[float], list[float]]]:
    """Return [(b, a), (b, a)] for the shelf and high-pass stages."""
    # Stage 1: high shelf (pyloudnorm / libebur128 derivation)
    f0, gain_db, q = 1681.974450955533, 3.999843853973347, 0.7071752369554196
    k = math.tan(math.pi * f0 / sample_rate)
    vh = 10 ** (gain_db / 20)
    vb = vh ** 0.4996667741545416
    a0 = 1 + k / q + k * k
    shelf_b = [(vh + vb * k / q + k * k) / a0, 2 * (k * k - vh) / a0, (vh - vb * k / q + k * k) / a0]
    shelf_a = [1.0, 2 * (k * k - 1) / a0, (1 - k / q + k * k) / a0]
    # Stage 2: RLB high-pass
    f0, q = 38.13547087602444, 0.5003270373238773
    k = math.tan(math.pi * f0 / sample_rate)
    a0 = 1 + k / q + k * k
    hp_b = [1.0, -2.0, 1.0]
    hp_a = [1.0, 2 * (k * k - 1) / a0, (1 - k / q + k * k) / a0]
    return [(shelf_b, shelf_a), (hp_b, hp_a)]


# Long renders are processed in chunks so memory stays flat: a 900 s stereo
# render filtered or oversampled in one piece peaked at ~7 GB.
CHUNK_S = 30.0
# The K-weighting filters settle in milliseconds; 1 s of preroll before each
# chunk makes the chunked output match the one-piece output.
K_PREROLL_S = 1.0
# Resampler context on each side of a true-peak chunk.
TP_PAD_S = 0.05


def k_weight(audio: np.ndarray, sample_rate: int) -> np.ndarray:
    import torch  # type: ignore
    import torchaudio.functional as F  # type: ignore

    coeffs = [(torch.tensor(a, dtype=torch.float64), torch.tensor(b, dtype=torch.float64))
              for b, a in _k_weighting_coeffs(sample_rate)]
    frames = audio.shape[1]
    chunk = int(CHUNK_S * sample_rate)
    preroll = int(K_PREROLL_S * sample_rate)
    out = np.empty(audio.shape, dtype=np.float64)
    for start in range(0, frames, chunk):
        lo = max(0, start - preroll)
        hi = min(frames, start + chunk)
        x = torch.from_numpy(np.ascontiguousarray(audio[:, lo:hi], dtype=np.float64))
        for a, b in coeffs:
            x = F.lfilter(x, a, b, clamp=False)
        out[:, start:hi] = x.numpy()[:, start - lo:]
    return out


def _block_powers(weighted: np.ndarray, sample_rate: int, block_s: float, hop_s: float) -> np.ndarray:
    """Channel-summed mean square per block (BS.1770 z_i summed with G=1)."""
    block = int(round(block_s * sample_rate))
    hop = int(round(hop_s * sample_rate))
    frames = weighted.shape[1]
    if frames < block:
        return np.zeros(0)
    # Channels are summed (G=1; the 1.41 surround weights do not apply to stereo
    # renders), so sum the squares first; cumulative sums make every window O(1)
    power = np.einsum("ij,ij->j", weighted, weighted)
    csum = np.concatenate([[0.0], np.cumsum(power)])
    starts = np.arange(0, frames - block + 1, hop)
    return (csum[starts + block] - csum[starts]) / block


# ---------------------------------------------------------------------------
# Loudness
# ---------------------------------------------------------------------------

def integrated_loudness(audio: np.ndarray, sample_rate: int, weighted: np.ndarray | None = None) -> float:
    """BS.1770-4 gated integrated loudness in LUFS (-inf for silence)."""
    w = k_weight(audio, sample_rate) if weighted is None else weighted
    powers = _block_powers(w, sample_rate, 0.4, 0.1)
    if powers.size == 0:
        return -math.inf
    loud = np.array([_power_to_lufs(p) for p in powers])
    gated = powers[loud > ABSOLUTE_GATE_LUFS]
    if gated.size == 0:
        return -math.inf
    relative_gate = _power_to_lufs(gated.mean()) - 10.0
    final = powers[(loud > ABSOLUTE_GATE_LUFS) & (loud > relative_gate)]
    return _power_to_lufs(final.mean()) if final.size else -math.inf


def loudness_range(audio: np.ndarray, sample_rate: int, weighted: np.ndarray | None = None) -> float | None:
    """EBU Tech 3342 LRA in LU (None when the clip is shorter than one 3 s block)."""
    w = k_weight(audio, sample_rate) if weighted is None else weighted
    powers = _block_powers(w, sample_rate, 3.0, 1.0)
    if powers.size == 0:
        return None
    st = np.array([_power_to_lufs(p) for p in powers])
    st = st[st > ABSOLUTE_GATE_LUFS]
    if st.size == 0:
        return 0.0
    relative_gate = _power_to_lufs(np.mean(10 ** ((st + 0.691) / 10))) - 20.0
    st = st[st > relative_gate]
    if st.size < 2:
        return 0.0
    return float(np.percentile(st, 95) - np.percentile(st, 10))


def true_peak(audio: np.ndarray, sample_rate: int) -> float:
    """Linear true peak via 4x oversampling (BS.1770-4 Annex 2)."""
    import torch  # type: ignore
    import torchaudio.functional as F  # type: ignore

    frames = audio.shape[1]
    chunk = int(CHUNK_S * sample_rate)
    pad = int(TP_PAD_S * sample_rate)
    peak = float(np.abs(audio).max(initial=0.0))
    for start in range(0, frames, chunk):
        lo = max(0, start - pad)
        hi = min(frames, start + chunk + pad)
        x = torch.from_numpy(np.ascontiguousarray(audio[:, lo:hi], dtype=np.float32))
        up = F.resample(x, orig_freq=sample_rate, new_freq=sample_rate * 4)
        # Keep only this chunk's own span; the padding is context for the filter
        keep = up[:, (start - lo) * 4:(min(start + chunk, frames) - lo) * 4]
        if keep.numel():
            peak = max(peak, float(keep.abs().max().item()))
    return peak


def section_loudness(weighted: np.ndarray, sample_rate: int, section_s: float) -> list[dict[str, Any]]:
    """Loudness per consecutive section (ungated mean of 400 ms blocks)."""
    hop = int(section_s * sample_rate)
    out = []
    for i, start in enumerate(range(0, weighted.shape[1], hop)):
        chunk = weighted[:, start:start + hop]
        if chunk.shape[1] < int(0.4 * sample_rate):
            break
        powers = _block_powers(chunk, sample_rate, 0.4, 0.1)
        lufs = _power_to_lufs(powers.mean()) if powers.size else -math.inf
        out.append({
            "start": _round(start / sample_rate, 1),
            "end": _round(min(start + hop, weighted.shape[1]) / sample_rate, 1),
            "lufs": _round(max(lufs, SILENCE_LUFS), 1),
        })
    return out


def loudness_stats(audio: np.ndarray, sample_rate: int, section_s: float | None = None) -> dict[str, Any]:
    weighted = k_weight(audio, sample_rate)
    integrated = integrated_loudness(audio, sample_rate, weighted)
    sample_peak = float(np.abs(audio).max(initial=0.0))
    tp = true_peak(audio, sample_rate)
    rms = float(np.sqrt(np.mean(audio.astype(np.float64) ** 2))) if audio.size else 0.0
    st_powers = _block_powers(weighted, sample_rate, 3.0, 1.0)
    st = [_power_to_lufs(p) for p in st_powers]
    stats: dict[str, Any] = {
        "integratedLufs": _round(integrated if math.isfinite(integrated) else SILENCE_LUFS, 2),
        "loudnessRangeLu": _round(loudness_range(audio, sample_rate, weighted), 1),
        "maxShortTermLufs": _round(max(st), 1) if st else None,
        "truePeakDbtp": _round(_db(tp), 2),
        "samplePeakDbfs": _round(_db(sample_peak), 2),
        "rmsDbfs": _round(_db(rms), 2),
        "crestFactorDb": _round(_db(sample_peak) - _db(rms), 2) if rms > 0 else None,
        "durationSeconds": _round(audio.shape[1] / sample_rate, 2),
    }
    if section_s:
        stats["sections"] = section_loudness(weighted, sample_rate, section_s)
    return stats


# ---------------------------------------------------------------------------
# Spectrum
# ---------------------------------------------------------------------------

def _stft_power(audio: np.ndarray, sample_rate: int, n_fft: int = 4096) -> tuple[np.ndarray, np.ndarray]:
    """Mono STFT power, shape (bins, frames), plus bin frequencies."""
    import torch  # type: ignore

    mono = torch.from_numpy(np.ascontiguousarray(audio.mean(axis=0), dtype=np.float32))
    if mono.numel() < n_fft:
        mono = torch.nn.functional.pad(mono, (0, n_fft - mono.numel()))
    spec = torch.stft(mono, n_fft=n_fft, hop_length=n_fft // 2, window=torch.hann_window(n_fft),
                      return_complex=True, center=False)
    power = (spec.abs() ** 2).numpy()
    freqs = np.fft.rfftfreq(n_fft, 1.0 / sample_rate)
    return power, freqs


# Below ~110 Hz an 8192-point bin (5.4 Hz at 44.1 kHz) is wider than a semitone and lands on the
# wrong pitch class; a bass note still counts through its harmonics above the floor.
CHROMA_LOW_HZ, CHROMA_HIGH_HZ = 110.0, 4200.0


def chroma(audio: np.ndarray, sample_rate: int, n_fft: int = 8192, segments: list | None = None) -> dict:
    """
    Pitch-class energy (C first), for key and chord detection.

    Each STFT bin from 110 Hz to 4.2 kHz adds its magnitude to the pitch class nearest its
    frequency; every frame is normalized to its own largest class so loud passages do not
    outweigh quiet ones, frames more than 60 dB under the loudest are skipped as silence,
    and the average is scaled so the largest class is 1.

    With `segments` ([start, end] seconds into `audio`), also each segment's chroma: the same
    average over the frames whose centre falls inside it (12 zeros for a silent segment).
    """
    power, freqs = _stft_power(audio, sample_rate, n_fft)
    band = (freqs >= CHROMA_LOW_HZ) & (freqs <= CHROMA_HIGH_HZ)
    classes = np.mod(np.round(12 * np.log2(freqs[band] / 440.0) + 69).astype(int), 12)
    mags = np.sqrt(power[band])
    frames = np.zeros((12, mags.shape[1]))
    for pc in range(12):
        frames[pc] = mags[classes == pc].sum(axis=0)
    energy = power[band].sum(axis=0)
    loud = energy > (energy.max() * 1e-6 if energy.size and energy.max() > 0 else np.inf)
    normed = frames / np.maximum(frames.max(axis=0, keepdims=True), 1e-12)

    def average(mask: np.ndarray) -> list[float]:
        if not mask.any():
            return [0.0] * 12
        avg = normed[:, mask].mean(axis=1)
        top = avg.max()
        return [_round(float(v / top), 4) if top > 0 else 0.0 for v in avg]

    out = {"chroma": average(loud), "frames": int(loud.sum()), "durationSeconds": _round(audio.shape[1] / sample_rate, 3)}
    if segments is not None:
        hop = n_fft // 2
        centres = (np.arange(frames.shape[1]) * hop + n_fft / 2) / sample_rate
        out["segments"] = [average(loud & (centres >= float(a)) & (centres < float(b))) for a, b in segments]
    return out


def band_balance(avg_power: np.ndarray, freqs: np.ndarray) -> dict[str, float | None]:
    """Each band's share of total energy in dB (0 dB = all energy in that band)."""
    total = avg_power[(freqs >= 20) & (freqs < 20000)].sum()
    out: dict[str, float | None] = {}
    for name, lo, hi in BANDS:
        e = avg_power[(freqs >= lo) & (freqs < hi)].sum()
        out[name] = _round(10 * math.log10(e / total), 1) if total > 0 and e > 0 else None
    return out


def _third_octave_db(avg_power: np.ndarray, freqs: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    centers = 1000.0 * 2.0 ** (np.arange(-17, 14) / 3.0)  # ~20 Hz .. ~20 kHz
    levels = []
    for c in centers:
        lo, hi = c / 2 ** (1 / 6), c * 2 ** (1 / 6)
        e = avg_power[(freqs >= lo) & (freqs < hi)].sum()
        levels.append(10 * math.log10(e) if e > 0 else -150.0)
    return centers, np.array(levels)


def resonance_hints(avg_power: np.ndarray, freqs: np.ndarray, limit: int = 5) -> list[dict[str, float]]:
    """Narrow peaks standing above the smoothed long-term spectrum (80 Hz-12 kHz)."""
    db = 10 * np.log10(avg_power + 1e-20)
    # Smooth on a log-frequency scale: ±1/3 octave moving median
    hints = []
    for i in range(1, len(freqs) - 1):
        f = freqs[i]
        if f < 80 or f > 12000:
            continue
        if not (db[i] > db[i - 1] and db[i] >= db[i + 1]):
            continue
        win = (freqs >= f / 2 ** (1 / 3)) & (freqs <= f * 2 ** (1 / 3))
        excess = float(db[i]) - float(np.median(db[win]))
        if excess >= 6.0:
            hints.append({"hz": round(float(f)), "excessDb": round(excess, 1)})
    hints.sort(key=lambda h: h["excessDb"], reverse=True)
    # Keep only peaks at least 1/6 octave apart
    kept: list[dict[str, float]] = []
    for h in hints:
        if all(abs(math.log2(h["hz"] / k["hz"])) > 1 / 6 for k in kept):
            kept.append(h)
        if len(kept) == limit:
            break
    return kept


def sibilance_hint(power: np.ndarray, freqs: np.ndarray, frame_s: float) -> dict[str, Any]:
    """Share of energy in 5-10 kHz over time; spikes suggest de-essing."""
    band = (freqs >= SIBILANCE_BAND[0]) & (freqs < SIBILANCE_BAND[1])
    total = power[(freqs >= 20) & (freqs < 20000)].sum(axis=0)
    loud = total > total.max(initial=0) * 1e-3  # ignore near-silent frames
    if not loud.any():
        return {"medianDb": None, "peakDb": None, "spikeCount": 0, "spikeSeconds": []}
    ratio_db = 10 * np.log10(power[band].sum(axis=0)[loud] / total[loud] + 1e-20)
    times = np.nonzero(loud)[0] * frame_s
    median = float(np.median(ratio_db))
    # One entry per event: frames closer than 0.5 s belong to the same spike
    events: list[float] = []
    for t in times[ratio_db > median + 9.0]:
        if not events or t - events[-1] >= 0.5:
            events.append(float(t))
    return {
        "medianDb": round(median, 1),
        "peakDb": round(float(ratio_db.max()), 1),
        "spikeCount": len(events),
        "spikeSeconds": [round(t, 1) for t in events[:10]],
    }


def spectral_stats(audio: np.ndarray, sample_rate: int) -> dict[str, Any]:
    n_fft = 4096
    power, freqs = _stft_power(audio, sample_rate, n_fft)
    avg = power.mean(axis=1)
    centroid = float((avg * freqs).sum() / avg.sum()) if avg.sum() > 0 else None
    return {
        "bandBalanceDb": band_balance(avg, freqs),
        "spectralCentroidHz": round(centroid) if centroid else None,
        "resonances": resonance_hints(avg, freqs),
        "sibilance": sibilance_hint(power, freqs, (n_fft // 2) / sample_rate),
    }


# ---------------------------------------------------------------------------
# Reference comparison
# ---------------------------------------------------------------------------

def compare_to_reference(audio: np.ndarray, sample_rate: int, ref: np.ndarray, ref_rate: int) -> dict[str, Any]:
    """Tonal balance and loudness of `audio` relative to `ref` (positive = more than the reference)."""
    a_lufs = integrated_loudness(audio, sample_rate)
    r_lufs = integrated_loudness(ref, ref_rate)
    a_pow, a_f = _stft_power(audio, sample_rate)
    r_pow, r_f = _stft_power(ref, ref_rate)
    a_avg, r_avg = a_pow.mean(axis=1), r_pow.mean(axis=1)
    a_bal, r_bal = band_balance(a_avg, a_f), band_balance(r_avg, r_f)
    band_delta = {
        k: (_round(a_bal[k] - r_bal[k], 1) if a_bal[k] is not None and r_bal[k] is not None else None)
        for k in a_bal
    }
    # Third-octave curve difference with the overall level offset (the median
    # band difference) removed, so one loud band does not shift all the others
    centers, a_curve = _third_octave_db(a_avg, a_f)
    _, r_curve = _third_octave_db(r_avg, r_f)
    valid = (a_curve > -140) & (r_curve > -140)
    diff = a_curve - r_curve
    if valid.any():
        diff = diff - float(np.median(diff[valid]))
    curve = [
        {"hz": round(float(c)), "deltaDb": round(float(d), 1)}
        for c, d, ok in zip(centers, diff, valid)
        if ok
    ]
    biggest = sorted(curve, key=lambda p: abs(p["deltaDb"]), reverse=True)[:3]
    return {
        "loudnessDeltaLu": _round(a_lufs - r_lufs, 1) if math.isfinite(a_lufs) and math.isfinite(r_lufs) else None,
        "referenceIntegratedLufs": _round(r_lufs, 2) if math.isfinite(r_lufs) else None,
        "bandDeltaDb": band_delta,
        "thirdOctaveDeltaDb": curve,
        "largestDifferences": biggest,
    }


def analyze(audio: np.ndarray, sample_rate: int, section_s: float | None = None,
            ref: tuple[np.ndarray, int] | None = None) -> dict[str, Any]:
    result: dict[str, Any] = {"loudness": loudness_stats(audio, sample_rate, section_s),
                              "spectrum": spectral_stats(audio, sample_rate)}
    if ref is not None:
        result["reference"] = compare_to_reference(audio, sample_rate, ref[0], ref[1])
    return result


# ---------------------------------------------------------------------------
# Normalization (for level-matched scoring)
# ---------------------------------------------------------------------------

def normalize_to_lufs(audio: np.ndarray, sample_rate: int, target_lufs: float) -> tuple[np.ndarray, float | None, float]:
    """Scale audio to target integrated loudness. Returns (audio, input LUFS, gain dB).

    Silence (no block above the absolute gate) is returned unchanged with gain 0.
    """
    measured = integrated_loudness(audio, sample_rate)
    if not math.isfinite(measured):
        return audio, None, 0.0
    gain_db = target_lufs - measured
    return (audio * 10 ** (gain_db / 20)).astype(np.float32), measured, gain_db


# ---------------------------------------------------------------------------
# Alignment
# ---------------------------------------------------------------------------

def alignment(reference: np.ndarray, target: np.ndarray, sample_rate: int, max_lag_ms: float = 20.0) -> dict[str, Any]:
    """Delay of `target` relative to `reference` via FFT cross-correlation of mono sums.

    A positive delay means `target` arrives later than `reference` (move it earlier
    by that amount, i.e. a negative playback offset, to align).
    """
    a = reference.mean(axis=0).astype(np.float64)
    b = target.mean(axis=0).astype(np.float64)
    n = min(a.size, b.size)
    a, b = a[:n] - a[:n].mean(), b[:n] - b[:n].mean()
    silent = [name for name, x in (("reference", a), ("track", b)) if n == 0 or not np.any(x)]
    if silent:
        return {"delaySamples": None, "delayMs": None, "correlation": None, "polarityInverted": None,
                "error": f"The {' and '.join(silent)} {'is' if len(silent) == 1 else 'are'} silent in this window; "
                         "pick a range where both tracks play"}
    norm = math.sqrt(float((a * a).sum() * (b * b).sum()))
    size = 1 << (2 * n - 1).bit_length()
    xc = np.fft.irfft(np.fft.rfft(b, size) * np.conj(np.fft.rfft(a, size)), size)
    max_lag = max(1, int(sample_rate * max_lag_ms / 1000.0))
    lags = np.concatenate([np.arange(0, max_lag + 1), np.arange(-max_lag, 0)])
    values = np.concatenate([xc[:max_lag + 1], xc[-max_lag:]])
    best = int(np.argmax(np.abs(values)))
    lag = int(lags[best])
    corr = float(values[best] / norm)
    return {
        "delaySamples": lag,
        "delayMs": round(lag * 1000.0 / sample_rate, 3),
        "correlation": round(abs(corr), 3),
        "polarityInverted": corr < 0,
        "sampleRate": sample_rate,
        "maxLagMs": max_lag_ms,
    }


# ---------------------------------------------------------------------------
# Transients (onsets)
# ---------------------------------------------------------------------------

# Bands transients are detected in (Hz). low ~ kick/bass, mid ~ snare/vocal/keys
# body, high ~ hats/cymbals/clicks. "full" is the whole spectrum.
TRANSIENT_BANDS: dict[str, tuple[float, float]] = {
    "low": (20.0, 150.0),
    "mid": (150.0, 4000.0),
    "high": (4000.0, 16000.0),
    "full": (20.0, 16000.0),
}
ONSET_FFT = 1024
ONSET_HOP = 256
# Frames back the rise is measured against (~12 ms): catches softer attacks
ONSET_LAG = 2
# Frames per STFT chunk: bounds memory on long renders (15 min at 44.1 kHz)
ONSET_CHUNK_FRAMES = 8192


def _band_flux(mono: np.ndarray, sample_rate: int) -> tuple[dict[str, np.ndarray], dict[str, np.ndarray], float]:
    """Onset strength per band, one value per hop.

    Returns (envelopes, rises, frame seconds): envelopes drive detection, rises
    (mean log-magnitude rise per bin, unscaled) say which band a hit is in.

    Frames are centred (the signal is padded by half a window), so frame t sits at
    t * hop / sample_rate. mid/high are log-magnitude spectral flux (the rise
    against ONSET_LAG frames back, summed over the band's bins); low, which
    spans only a few bins, is the rise of the band's log energy, which beating
    bass notes disturb less. Each band is scaled to its own 99th percentile and
    "full" is their mean, so a kick counts as much as a broadband hat.
    """
    pad = ONSET_FFT // 2
    x = np.pad(mono.astype(np.float32), (pad, pad))
    n_frames = max(1, 1 + (x.size - ONSET_FFT) // ONSET_HOP)
    window = np.hanning(ONSET_FFT).astype(np.float32)
    freqs = np.fft.rfftfreq(ONSET_FFT, 1.0 / sample_rate)
    bands = [name for name in TRANSIENT_BANDS if name != "full"]
    masks = {name: (freqs >= TRANSIENT_BANDS[name][0]) & (freqs < TRANSIENT_BANDS[name][1]) for name in bands}
    flux = {name: np.zeros(n_frames, dtype=np.float32) for name in bands}
    rises = {name: np.zeros(n_frames, dtype=np.float32) for name in bands}
    tail: np.ndarray | None = None  # last ONSET_LAG frames of the previous chunk
    for start in range(0, n_frames, ONSET_CHUNK_FRAMES):
        stop = min(n_frames, start + ONSET_CHUNK_FRAMES)
        idx = (np.arange(start, stop)[:, None] * ONSET_HOP) + np.arange(ONSET_FFT)[None, :]
        mag = np.abs(np.fft.rfft(x[idx] * window, axis=1)).astype(np.float32)
        low_energy = np.log1p(100.0 * (mag[:, masks["low"]] ** 2).sum(axis=1, keepdims=True))
        feats = np.hstack([np.log1p(100.0 * mag), low_energy])
        head = np.repeat(feats[:1], ONSET_LAG, axis=0) if tail is None else tail
        before = np.vstack([head, feats])[: feats.shape[0]]
        rise = np.maximum(feats - before, 0.0)
        flux["low"][start:stop] = rise[:, -1]
        for name in bands:
            if name != "low":
                flux[name][start:stop] = rise[:, :-1][:, masks[name]].sum(axis=1)
            rises[name][start:stop] = rise[:, :-1][:, masks[name]].mean(axis=1)
        tail = feats[-ONSET_LAG:]
    for name in bands:
        scale = float(np.percentile(flux[name], 99))
        if scale > 0:
            flux[name] /= scale
    flux["full"] = np.mean([flux[name] for name in bands], axis=0).astype(np.float32)
    return flux, rises, ONSET_HOP / sample_rate


def _pick_peaks(env: np.ndarray, frame_s: float, sensitivity: float, min_gap_s: float) -> np.ndarray:
    """Frames that are local maxima above an adaptive threshold (moving median + delta)."""
    if env.size < 3 or not np.any(env > 0):
        return np.zeros(0, dtype=int)
    # Moving median over ~0.4 s around each frame tracks the local busyness
    half = max(1, int(0.2 / frame_s))
    padded = np.pad(env, (half, half), mode="edge")
    windows = np.lib.stride_tricks.sliding_window_view(padded, 2 * half + 1)
    local = np.median(windows, axis=1)
    scale = float(np.percentile(env, 99)) or float(env.max())
    # sensitivity 0..1: 0 keeps only the biggest hits, 1 nearly every bump
    delta = scale * (0.6 - 0.55 * sensitivity)
    floor = scale * (0.2 - 0.18 * sensitivity)
    above = (env > local + delta) & (env > floor)
    # Local maximum within +-~30 ms
    w = max(1, int(0.03 / frame_s))
    padded_max = np.pad(env, (w, w), mode="constant")
    local_max = np.lib.stride_tricks.sliding_window_view(padded_max, 2 * w + 1).max(axis=1)
    candidates = np.flatnonzero(above & (env >= local_max))
    # Enforce the minimum gap, keeping the stronger of two close peaks
    gap = max(1, int(round(min_gap_s / frame_s)))
    kept: list[int] = []
    for c in candidates:
        if kept and c - kept[-1] < gap:
            if env[c] > env[kept[-1]]:
                kept[-1] = int(c)
            continue
        kept.append(int(c))
    return np.asarray(kept, dtype=int)


def _refine_onset(mono: np.ndarray, sample_rate: int, centre: int) -> int:
    """Sample where the amplitude rises fastest within a window around a flux peak."""
    lo = max(0, centre - ONSET_FFT // 2)
    hi = min(mono.size, centre + ONSET_FFT // 4)
    seg = np.abs(mono[lo:hi])
    if seg.size < 16:
        return centre
    # 1 ms smoothed envelope, then its steepest rise
    k = max(1, sample_rate // 1000)
    env = np.convolve(seg, np.ones(k, dtype=np.float32) / k, mode="same")
    rise = np.diff(env)
    return lo + int(np.argmax(rise)) if rise.size else centre


def estimate_tempo(env: np.ndarray, frame_s: float) -> dict[str, float | None]:
    """BPM from the autocorrelation of the onset envelope (60-200 BPM)."""
    x = env.astype(np.float64) - env.mean()
    if x.size < int(4.0 / frame_s) or not np.any(x):
        return {"bpm": None, "confidence": None}
    size = 1 << (2 * x.size - 1).bit_length()
    spec = np.fft.rfft(x, size)
    ac = np.fft.irfft(spec * np.conj(spec), size)[: x.size]
    ac /= ac[0]
    lo, hi = int(60.0 / 200.0 / frame_s), int(60.0 / 60.0 / frame_s)
    if hi >= ac.size:
        return {"bpm": None, "confidence": None}
    # Weight towards ~120 BPM so a half/double tempo does not win on noise
    lags = np.arange(lo, hi + 1)
    bpms = 60.0 / (lags * frame_s)
    weight = np.exp(-0.5 * (np.log2(bpms / 120.0) / 1.0) ** 2)
    best = int(np.argmax(ac[lo:hi + 1] * weight))
    lag = lo + best
    # Parabolic interpolation for a sub-frame lag
    if lo < lag < hi:
        a, b, c = ac[lag - 1], ac[lag], ac[lag + 1]
        denom = a - 2 * b + c
        lag_f = lag + (0.5 * (a - c) / denom if denom else 0.0)
    else:
        lag_f = float(lag)
    return {"bpm": _round(60.0 / (lag_f * frame_s), 1), "confidence": _round(max(0.0, float(ac[lag])), 2)}


def transients(audio: np.ndarray, sample_rate: int, band: str = "full", sensitivity: float = 0.5,
               min_gap_ms: float = 50.0) -> dict[str, Any]:
    """Transient (onset) times with a 0..1 strength and the band that dominates each.

    band: "full" (default), "low", "mid", "high" — the band the onsets are picked in.
    sensitivity: 0..1, higher finds softer hits. min_gap_ms: closest two onsets may be.
    Times are seconds from the start of `audio`.
    """
    if band not in TRANSIENT_BANDS:
        raise ValueError(f"band must be one of {', '.join(TRANSIENT_BANDS)}")
    sensitivity = min(1.0, max(0.0, float(sensitivity)))
    mono = audio.mean(axis=0).astype(np.float32)
    duration = mono.size / sample_rate
    flux, rises, frame_s = _band_flux(mono, sample_rate)
    env = flux[band]
    peaks = _pick_peaks(env, frame_s, sensitivity, max(0.005, min_gap_ms / 1000.0))
    # Strength: flux relative to the loudest hits of this band (99th pct of peaks)
    ref = float(np.percentile(env[peaks], 95)) if peaks.size else 1.0
    peak_abs = float(np.abs(mono).max()) or 1.0
    items: list[dict[str, Any]] = []
    for p in peaks:
        onset = _refine_onset(mono, sample_rate, int(p * ONSET_HOP))
        seg = mono[onset: onset + int(0.05 * sample_rate)]
        level = float(np.abs(seg).max()) if seg.size else 0.0
        # Dominant band: the largest rise per bin within +-1 frame of the peak
        near = slice(max(0, p - 1), p + 2)
        shares = {name: float(r[near].max()) for name, r in rises.items()}
        items.append({
            "time": round(onset / sample_rate, 4),
            "strength": round(min(1.0, float(env[p]) / ref), 3) if ref > 0 else 0.0,
            "band": max(shares, key=shares.get),
            "peakDb": _round(_db(level / peak_abs), 1),
        })
    counts = {name: sum(1 for t in items if t["band"] == name) for name in rises}
    return {
        "durationSeconds": round(duration, 3),
        "band": band,
        "sensitivity": sensitivity,
        "minGapMs": min_gap_ms,
        "count": len(items),
        "bandCounts": counts,
        "tempo": estimate_tempo(flux["full"], frame_s),
        "transients": items,
    }
