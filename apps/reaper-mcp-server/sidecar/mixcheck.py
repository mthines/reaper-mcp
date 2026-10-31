"""
Mix checks for the reaper-mcp sidecar: loudness over time, stereo correlation
per band, and frequency masking between tracks.

Same conventions as analysis.py: float32 numpy arrays shaped (channels, frames),
numpy and torch only, results bounded in size whatever the input length.
Levels used for balance decisions are perceived (K-weighted, LU / kDb), per
knowledge/reference/perceived-loudness.md.
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np

import analysis

# ---------------------------------------------------------------------------
# Loudness curve
# ---------------------------------------------------------------------------

# A curve never returns more points than this, whatever the length.
CURVE_POINTS = 240


def _lufs_series(powers: np.ndarray) -> np.ndarray:
    with np.errstate(divide="ignore"):
        return np.where(powers > 0, -0.691 + 10.0 * np.log10(np.maximum(powers, 1e-30)), -math.inf)


def _bucket(values: np.ndarray, points: int) -> np.ndarray:
    """Downsample to at most `points` values, keeping each bucket's maximum (a peak is never lost)."""
    if values.size <= points:
        return values
    edges = np.linspace(0, values.size, points + 1).astype(int)
    return np.array([values[a:b].max() for a, b in zip(edges[:-1], edges[1:])])


def _floor(values: np.ndarray) -> list[float]:
    return [round(float(max(v, analysis.SILENCE_LUFS)), 1) for v in values]


def loudness_curve(audio: np.ndarray, sample_rate: int, target_lufs: float | None = None,
                   tolerance_lu: float = 1.0, points: int = CURVE_POINTS) -> dict[str, Any]:
    """
    Short-term (3 s) and momentary (400 ms) loudness over time, bucketed to at most
    `points` values each (bucket maximum), with the loudest and quietest short-term
    windows and, with a target, the spans whose short-term loudness exceeds it.
    """
    weighted = analysis.k_weight(audio, sample_rate)
    integrated = analysis.integrated_loudness(audio, sample_rate, weighted)
    duration = audio.shape[1] / sample_rate
    st_hop = 0.5
    st = _lufs_series(analysis._block_powers(weighted, sample_rate, 3.0, st_hop))
    mom = _lufs_series(analysis._block_powers(weighted, sample_rate, 0.4, 0.1))
    tp = analysis.true_peak(audio, sample_rate)

    result: dict[str, Any] = {
        "durationSeconds": round(duration, 2),
        "integratedLufs": analysis._round(integrated if math.isfinite(integrated) else analysis.SILENCE_LUFS, 2),
        "truePeakDbtp": analysis._round(analysis._db(tp), 2),
        "loudnessRangeLu": analysis._round(analysis.loudness_range(audio, sample_rate, weighted), 1),
    }
    if math.isfinite(integrated):
        result["plrDb"] = analysis._round(analysis._db(tp) - integrated, 1)

    if mom.size:
        m = _bucket(mom, points)
        result["momentary"] = {"step": round(duration / m.size, 3), "lufs": _floor(m)}
        result["maxMomentaryLufs"] = analysis._round(float(mom.max()) if np.isfinite(mom.max()) else None, 1)
    if st.size:
        s = _bucket(st, points)
        result["shortTerm"] = {"step": round(duration / s.size, 3), "lufs": _floor(s)}
        audible = np.where(np.isfinite(st) & (st > analysis.ABSOLUTE_GATE_LUFS))[0]
        if audible.size:
            loud, quiet = audible[np.argmax(st[audible])], audible[np.argmin(st[audible])]
            result["loudest"] = {"start": round(loud * st_hop, 1), "end": round(loud * st_hop + 3, 1),
                                 "lufs": round(float(st[loud]), 1)}
            result["quietest"] = {"start": round(quiet * st_hop, 1), "end": round(quiet * st_hop + 3, 1),
                                  "lufs": round(float(st[quiet]), 1)}
    else:
        result["warning"] = "Shorter than one 3 s short-term window: only momentary loudness is reported"

    if target_lufs is not None and st.size:
        result["targetLufs"] = target_lufs
        over = st > target_lufs + tolerance_lu
        spans: list[dict[str, Any]] = []
        i = 0
        while i < over.size and len(spans) < 20:
            if over[i]:
                j = i
                while j + 1 < over.size and over[j + 1]:
                    j += 1
                spans.append({"start": round(i * st_hop, 1), "end": round(j * st_hop + 3, 1),
                              "maxLufs": round(float(st[i:j + 1].max()), 1)})
                i = j + 1
            else:
                i += 1
        result["overTarget"] = spans
        result["overTargetSeconds"] = round(float(over.sum()) * st_hop, 1)
    return result


# ---------------------------------------------------------------------------
# Stereo correlation per band
# ---------------------------------------------------------------------------

STEREO_BANDS: list[tuple[str, float, float]] = [
    ("low", 20, 120),
    ("lowMid", 120, 500),
    ("mid", 500, 2000),
    ("high", 2000, 8000),
    ("air", 8000, 20000),
]
BAND_SERIES_POINTS = 60
STEREO_FFT = 4096


def _stereo_spectra(audio: np.ndarray, n_fft: int = STEREO_FFT) -> tuple[np.ndarray, np.ndarray]:
    import torch  # type: ignore

    x = torch.from_numpy(np.ascontiguousarray(audio[:2], dtype=np.float32))
    if x.shape[1] < n_fft:
        x = torch.nn.functional.pad(x, (0, n_fft - x.shape[1]))
    spec = torch.stft(x, n_fft=n_fft, hop_length=n_fft // 2, window=torch.hann_window(n_fft),
                      return_complex=True, center=False).numpy()
    return spec[0], spec[1]


def band_correlation(audio: np.ndarray, sample_rate: int) -> dict[str, Any]:
    """
    Per band: energy-weighted correlation (+1 mono, 0 wide, <0 out of phase), the worst
    ~1 s window, the share of time below 0, side-to-mid level, and a bucketed series.
    Low end below 0 is what collapses in mono; a flag says so.
    """
    if audio.shape[0] < 2:
        raise ValueError("Needs a stereo source: this one has 1 channel")
    left, right = _stereo_spectra(audio)
    freqs = np.fft.rfftfreq(STEREO_FFT, 1.0 / sample_rate)
    frame_s = (STEREO_FFT // 2) / sample_rate
    # ~1 s windows of frames for the worst-window and time-share figures
    per_window = max(1, int(round(1.0 / frame_s)))
    cross = (left * np.conj(right)).real
    pl, pr = np.abs(left) ** 2, np.abs(right) ** 2
    mid_p, side_p = np.abs(left + right) ** 2 / 4, np.abs(left - right) ** 2 / 4

    bands: list[dict[str, Any]] = []
    flags: list[str] = []
    for name, lo, hi in STEREO_BANDS:
        sel = (freqs >= lo) & (freqs < min(hi, sample_rate / 2))
        if not sel.any():
            continue
        c, a, b = cross[sel].sum(axis=0), pl[sel].sum(axis=0), pr[sel].sum(axis=0)
        energy = a + b
        total = energy.sum()
        if total <= 1e-12:
            bands.append({"band": name, "fromHz": lo, "toHz": hi, "silent": True})
            continue
        overall = float(c.sum() / math.sqrt(a.sum() * b.sum())) if a.sum() > 0 and b.sum() > 0 else 0.0
        n = c.size // per_window
        windows: list[float] = []
        weights: list[float] = []
        for k in range(max(n, 1)):
            sl = slice(k * per_window, (k + 1) * per_window if n else c.size)
            wa, wb = a[sl].sum(), b[sl].sum()
            if wa > 0 and wb > 0:
                windows.append(float(c[sl].sum() / math.sqrt(wa * wb)))
                weights.append(float(energy[sl].sum()))
        w = np.array(windows)
        loud = np.array(weights) > total / max(len(weights), 1) * 0.01  # ignore near-silent windows
        audible = w[loud] if loud.any() else w
        side, mid = side_p[sel].sum(), mid_p[sel].sum()
        row: dict[str, Any] = {
            "band": name, "fromHz": lo, "toHz": hi,
            "correlation": round(overall, 3),
            "worst": round(float(audible.min()), 3) if audible.size else None,
            "negativeShare": round(float((audible < 0).mean()), 3) if audible.size else 0.0,
            "sideToMidDb": analysis._round(10 * math.log10(side / mid), 1) if side > 0 and mid > 0 else None,
            "series": [round(float(v), 2) for v in _bucket_mean(w, BAND_SERIES_POINTS)],
        }
        bands.append(row)
        if name == "low" and (overall < 0.5 or row["negativeShare"] > 0.1):
            flags.append("low end is wide or out of phase: it loses level in mono — narrow it below ~120 Hz")
        elif overall < 0:
            words = {"lowMid": "the low mids", "mid": "the mids", "high": "the highs", "air": "the air band"}.get(name, name)
            flags.append(f"{words} ({lo:g}–{hi:g} Hz) out of phase overall (correlation {overall:.2f}): it cancels in mono")
    return {"bands": bands, "windowSeconds": round(per_window * frame_s, 2), "flags": flags,
            "durationSeconds": round(audio.shape[1] / sample_rate, 2)}


def _bucket_mean(values: np.ndarray, points: int) -> np.ndarray:
    if values.size <= points:
        return values
    edges = np.linspace(0, values.size, points + 1).astype(int)
    return np.array([values[a:b].mean() for a, b in zip(edges[:-1], edges[1:])])


# ---------------------------------------------------------------------------
# Masking between tracks
# ---------------------------------------------------------------------------

# Third-octave centres from 40 Hz to 16 kHz, and the nominal labels engineers use (IEC 61260)
MASK_CENTERS = 1000.0 * 2.0 ** (np.arange(-14, 13) / 3.0)
MASK_LABELS = [40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600,
               2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000, 12500, 16000]
MASK_FFT = 4096
# Two tracks mask each other in a band when both are active and within this many dB
MASK_CLOSE_DB = 6.0
# A band is active for a track in a frame when within this of the track's own loudest band-frame
MASK_ACTIVE_DB = 30.0
MAX_CONFLICTS = 10


def _k_gain_db(freqs: np.ndarray, sample_rate: int) -> np.ndarray:
    """K-weighting magnitude response at `freqs` (dB), from analysis's own coefficients."""
    z = np.exp(-2j * np.pi * freqs / sample_rate)
    h = np.ones_like(z)
    for b, a in analysis._k_weighting_coeffs(sample_rate):
        h *= (b[0] + b[1] * z + b[2] * z * z) / (a[0] + a[1] * z + a[2] * z * z)
    return 20 * np.log10(np.maximum(np.abs(h), 1e-12))


def _band_levels(audio: np.ndarray, sample_rate: int) -> np.ndarray:
    """Perceived (K-weighted) third-octave levels in dB, shape (bands, frames)."""
    power, freqs = analysis._stft_power(audio, sample_rate, MASK_FFT)
    k = 10 ** (_k_gain_db(freqs, sample_rate) / 10)
    power = power * k[:, None]
    out = np.empty((MASK_CENTERS.size, power.shape[1]))
    for i, c in enumerate(MASK_CENTERS):
        sel = (freqs >= c / 2 ** (1 / 6)) & (freqs < c * 2 ** (1 / 6))
        e = power[sel].sum(axis=0) if sel.any() else np.zeros(power.shape[1])
        out[i] = 10 * np.log10(np.maximum(e, 1e-15))
    return out


def masking(tracks: list[tuple[str, np.ndarray]], sample_rate: int) -> dict[str, Any]:
    """
    Where tracks compete for the same third-octave bands at the same time.

    Per pair and band, `score` is the share of frames in which both tracks are active
    and within MASK_CLOSE_DB of each other (0..1). Conflicts are the highest-scoring
    pair/band cells, each with which track to cut there: the one for which the band
    matters less (further below that track's own loudest band).
    """
    if len(tracks) < 2:
        raise ValueError("Needs at least 2 tracks")
    levels = [_band_levels(a, sample_rate) for _, a in tracks]
    frames = min(lv.shape[1] for lv in levels)
    levels = [lv[:, :frames] for lv in levels]
    active = []
    profile = []
    for lv in levels:
        peak = lv.max()
        active.append((lv > peak - MASK_ACTIVE_DB) & (lv > -100))
        # Each band's typical level relative to the track's loudest band (its own spectrum shape)
        mean_db = 10 * np.log10(np.maximum((10 ** (lv / 10)).mean(axis=1), 1e-15))
        profile.append(mean_db - mean_db.max())

    pairs: list[dict[str, Any]] = []
    cells: list[tuple[float, float, int, int, int]] = []
    for i in range(len(tracks)):
        for j in range(i + 1, len(tracks)):
            both = active[i] & active[j]
            close = both & (np.abs(levels[i] - levels[j]) <= MASK_CLOSE_DB)
            score = close.sum(axis=1) / frames if frames else np.zeros(MASK_CENTERS.size)
            pairs.append({"a": tracks[i][0], "b": tracks[j][0],
                          "scores": [round(float(s), 2) for s in score],
                          "overall": round(float(score.mean()), 3)})
            for k, s in enumerate(score):
                if s >= 0.2:
                    # Ties (a tone also leaks into the next band) go to the louder band
                    level = float(np.mean((levels[i][k] + levels[j][k])[both[k]])) if both[k].any() else -300.0
                    cells.append((round(float(s), 2), level, i, j, k))

    cells.sort(reverse=True)
    conflicts = []
    for s, _, i, j, k in cells[:MAX_CONFLICTS]:
        both = active[i][k] & active[j][k]
        diff = float(np.median(levels[i][k][both] - levels[j][k][both])) if both.any() else 0.0
        # Cut the track for which this band is less central to its own sound
        cut, keep = (i, j) if profile[i][k] < profile[j][k] else (j, i)
        conflicts.append({
            "a": tracks[i][0], "b": tracks[j][0], "hz": MASK_LABELS[k], "score": s,
            "levelDiffDb": round(diff, 1),
            "suggestion": f"cut {tracks[cut][0]} around {MASK_LABELS[k]} Hz (it matters more to {tracks[keep][0]})",
        })
    return {
        "bandsHz": MASK_LABELS,
        "tracks": [name for name, _ in tracks],
        "pairs": pairs,
        "conflicts": conflicts,
        "frameSeconds": round((MASK_FFT // 2) / sample_rate, 3),
    }
