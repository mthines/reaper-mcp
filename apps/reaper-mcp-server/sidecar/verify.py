"""
Checks an agent can run on the result of an edit (verify_edit).

The agent cannot listen, so after an edit it compares the edited audio with the
audio from before the edit. Two checks held up across a vocal and a bass in the
experiment behind the tool (github.com/mthines/reaper-mcp issue 69):

* Compensated null: estimate the delay (sub-sample), gain and polarity between the
  two, remove them, and measure what is left. A plain null test calls a pure 4 ms
  shift or a -3 dB gain "damage"; the compensated one reports them as numbers and
  leaves only what changed besides them (noise, a splice, a different waveform).
* Discontinuity: the largest sample-to-sample jump against a high percentile. A hard
  splice or a click scores far above anything a clean edit produces. Judged against
  the reference's own score, so a source that is naturally spiky is not flagged.

When the timing changed (a stretch, `time_scale` != 1) the null cannot run, so three
"character" checks compare the edit with the reference warped through the known time
map instead (experiment: github.com/mthines/reaper-mcp issue 81). They only ever warn:

* Pitch drift: median cents between matching voiced frames. The pitch range comes from
  the reference itself; material without a stable pitch is skipped, with the reason.
* Tone: rms dB difference of the long-term spectrum (40 mel bands, gain removed). Catches
  varispeed, pitch shifts and added noise; blind to a phase vocoder's smearing.
* Transients: log ratio of spectral-flux peakiness. Only a drop counts (smearing lowers
  it); blind on drum-like material.
"""

from __future__ import annotations

from typing import Any

import numpy as np

# Compensated null: residual (dB below the reference) for an edit that should be transparent
NULL_OK_DB = -50.0
NULL_WARN_DB = -35.0
# Discontinuity: a score is a clear click from this value up, and relative to the reference's own score
CLICK_FAIL_SCORE = 8.0
CLICK_FAIL_RATIO = 2.5
CLICK_WARN_SCORE = 6.0
CLICK_WARN_RATIO = 2.0

SILENCE = 1e-6

# Character checks (only when the timing changed): warn lines from the issue 81 experiment
PITCH_WARN_CENTS = 20.0
TONE_WARN_DB = 1.5
# A drift this close to what the speed change alone predicts is a plain speed change (varispeed), reported, not warned
VARISPEED_TOLERANCE_CENTS = 35.0
# Slow-downs below this rate stretch audible artifacts into a vocal (listening test, issue 81 follow-up: 0.80, 0.85
# and 0.88 had them, 0.90 and up did not). The dropout check runs only there; the line is provisional (one phrase).
DROPOUT_MAX_RATE = 0.9
DROPOUT_WARN_DB = 12.0
TRANSIENT_WARN_LOG = -0.25
MIN_VOICED_FRAMES = 12
MIN_VOICED_SHARE = 0.25


def _mono(audio: np.ndarray) -> np.ndarray:
    """(channels, samples) or (samples,) to float64 mono."""
    a = np.asarray(audio, dtype=np.float64)
    return a if a.ndim == 1 else a.mean(axis=0)


def _channels(audio: np.ndarray) -> np.ndarray:
    """(channels, samples) float64, whatever the input shape."""
    a = np.asarray(audio, dtype=np.float64)
    return a[None, :] if a.ndim == 1 else a


def _db(x: float, floor: float = -150.0) -> float:
    return float(max(floor, 10.0 * np.log10(max(x, 1e-15))))


def _fractional_delay(x: np.ndarray, lag: float) -> np.ndarray:
    """Delay x by `lag` samples (negative = advance) with an FFT phase ramp."""
    spectrum = np.fft.rfft(x)
    freqs = np.fft.rfftfreq(len(x))
    return np.fft.irfft(spectrum * np.exp(-2j * np.pi * freqs * lag), len(x))


def compensated_null(reference: np.ndarray, edited: np.ndarray, sample_rate: int,
                     max_lag_ms: float = 20.0) -> dict[str, Any]:
    """
    Delay (ms; positive = the edit is later), gain (dB), polarity and the residual
    (dB relative to the reference) once those are removed. The inputs are cut to the
    shorter one's length; the lag margin at both ends is left out of the residual.
    """
    ref_ch, edit_ch = _channels(reference), _channels(edited)
    ref, edit = _mono(reference), _mono(edited)
    n = min(len(ref), len(edit))
    ref, edit = ref[:n], edit[:n]
    # Delay and gain come from the mono sum. When both have the same channels the residual is measured on each,
    # so swapping left and right (or any change only to the stereo image) is not hidden by the sum.
    per_channel = ref_ch.shape[0] == edit_ch.shape[0] and ref_ch.shape[0] > 1
    if n < int(0.1 * sample_rate):
        return {"error": "Audio too short: need at least 0.1 s"}
    if np.max(np.abs(ref_ch)) < SILENCE:
        return {"error": "The reference is silent over this range"}
    if np.max(np.abs(edit_ch)) < SILENCE:
        return {"error": "The edited audio is silent over this range"}

    lag_max = max(1, int(sample_rate * max_lag_ms / 1000.0))
    size = 1 << (2 * n - 1).bit_length()
    corr = np.fft.irfft(np.fft.rfft(edit, size) * np.conj(np.fft.rfft(ref, size)), size)
    window = np.concatenate([corr[-lag_max:], corr[: lag_max + 1]])  # lags -lag_max..+lag_max
    peak = int(np.argmax(np.abs(window)))
    lag = float(peak - lag_max)
    if 0 < peak < len(window) - 1:  # parabolic refinement of the correlation peak
        a, b, c = np.abs(window[peak - 1]), np.abs(window[peak]), np.abs(window[peak + 1])
        denom = a - 2 * b + c
        if abs(denom) > 1e-12:
            lag += 0.5 * (a - c) / denom

    aligned = _fractional_delay(edit, -lag)  # undo the delay: bring the edit back onto the reference
    gain = float(np.dot(ref, aligned) / (np.dot(aligned, aligned) + 1e-15))
    margin = lag_max * 2
    span = slice(margin, n - margin) if n > 4 * margin else slice(0, n)
    if per_channel:
        pairs = [(r[:n], _fractional_delay(e[:n], -lag)) for r, e in zip(ref_ch, edit_ch)]
        residual_power = float(np.mean([np.mean((r[span] - gain * a[span]) ** 2) for r, a in pairs]))
        ref_power = float(np.mean([np.mean(r[span] ** 2) for r, _ in pairs])) + 1e-15
    else:
        residual_power = float(np.mean((ref - gain * aligned)[span] ** 2))
        ref_power = float(np.mean(ref[span] ** 2)) + 1e-15
    return {
        "delayMs": round(1000.0 * lag / sample_rate, 3),
        # gain that maps the edit back to the reference; the edit is 1/gain times as loud
        "gainDb": round(-20.0 * np.log10(abs(gain) + 1e-15), 2),
        "polarityInverted": bool(gain < 0),
        "residualDb": round(_db(residual_power / ref_power), 1),
        # The residual is relative to this: with a quiet reference, rounding noise of a 16-bit file can set it
        "referenceRmsDb": round(_db(ref_power), 1),
    }


def discontinuity_score(audio: np.ndarray, edge_samples: int = 0) -> dict[str, Any]:
    """
    Largest second difference against its 99.5th percentile, and where it happens.
    The first and last `edge_samples` are left out: the ends of a rendered window are
    not edit points (a delayed copy starts with a step there that is not a click).
    """
    x = _mono(audio)
    if len(x) < 16 or np.max(np.abs(x)) < SILENCE:
        return {"score": None, "atSample": None}
    d2 = np.abs(np.diff(x, 2))
    offset = edge_samples if len(d2) > 4 * edge_samples + 16 else 0
    inner = d2[offset: len(d2) - offset]
    scale = float(np.percentile(inner, 99.5))
    if scale < 1e-12:  # a pure DC or a perfectly smooth signal: any jump is an outlier
        scale = 1e-12
    k = int(np.argmax(inner))
    return {"score": round(float(inner[k] / scale), 2), "atSample": offset + k + 1}


_VERDICT_RANK = {"unknown": 0, "ok": 1, "warn": 2, "fail": 3}


def _worst_channel(reference: np.ndarray, edited: np.ndarray, edge_samples: int) -> tuple[dict, dict, int | None]:
    """
    Discontinuity of the channel that scores highest in the edit, with the reference's score for the same channel.
    A click on one channel, or opposite clicks on left and right, would shrink or cancel in a mono sum.
    Channel counts that differ are compared as mono sums.
    """
    ref_ch, edit_ch = _channels(reference), _channels(edited)
    if ref_ch.shape[0] != edit_ch.shape[0]:
        ref_ch, edit_ch = _mono(reference)[None, :], _mono(edited)[None, :]
    best: tuple[dict, dict, int | None] | None = None
    best_key: tuple[int, float] | None = None
    for index, (ref, edit) in enumerate(zip(ref_ch, edit_ch)):
        edit_disc, ref_disc = discontinuity_score(edit, edge_samples), discontinuity_score(ref, edge_samples)
        if edit_disc["score"] is None:
            continue
        # Worst verdict first, then the biggest jump over the channel's own reference: a naturally spiky,
        # unchanged channel must not hide a click on the other one.
        rank = _VERDICT_RANK[_click_verdict(edit_disc["score"], ref_disc["score"])]
        ratio = edit_disc["score"] / max(ref_disc["score"] or 1.0, 1.0)
        if best_key is None or (rank, ratio) > best_key:
            best, best_key = (edit_disc, ref_disc, index if len(edit_ch) > 1 else None), (rank, ratio)
    return best or (discontinuity_score(edit_ch[0]), discontinuity_score(ref_ch[0]), None)


def _stft_power(x: np.ndarray, n_fft: int = 2048, hop: int = 512) -> np.ndarray:
    """(frames, bins) power spectrum with a Hann window; zero-padded to at least one frame."""
    if len(x) < n_fft:
        x = np.pad(x, (0, n_fft - len(x)))
    frames = np.lib.stride_tricks.sliding_window_view(x, n_fft)[::hop]
    return np.abs(np.fft.rfft(frames * np.hanning(n_fft), axis=1)) ** 2


def _normalised(x: np.ndarray) -> np.ndarray:
    """Peak 0.5, so level-dependent measures compare like with like."""
    return x / (np.max(np.abs(x)) + 1e-12) * 0.5


def _f0_track(x: np.ndarray, sample_rate: int, lo: float, hi: float,
              frame: int = 4096, hop: int = 1024) -> tuple[np.ndarray, np.ndarray]:
    """
    Per-frame f0 (Hz) and a voiced mask from the normalised square difference function:
    the first peak within 10% of the highest in the lag range [sr/hi, sr/lo], parabolic
    interpolation, voiced above 0.8. Frames hop by `hop` samples.
    """
    if len(x) < frame:
        x = np.pad(x, (0, frame - len(x)))
    frames = np.lib.stride_tricks.sliding_window_view(x, frame)[::hop] * np.hanning(frame)
    size = 2 * frame
    spec = np.fft.rfft(frames, size, axis=1)
    acf = np.fft.irfft(np.abs(spec) ** 2, size, axis=1)[:, :frame]
    sq = np.cumsum(frames ** 2, axis=1)
    total = sq[:, -1:]
    # m[tau] = sum_{i<N-tau} (x_i^2 + x_{i+tau}^2): the energy left after dropping the last tau and the first tau samples
    head = np.concatenate([np.zeros((len(frames), 1)), sq[:, :-1]], axis=1)
    tail = total - sq[:, ::-1]  # sum of the last tau squares, indexed by tau-1
    tail = np.concatenate([np.zeros((len(frames), 1)), tail[:, :-1]], axis=1)
    m = (total - tail) + (total - head)
    nsdf = 2 * acf / (m + 1e-12)
    lag_lo, lag_hi = max(2, int(sample_rate / hi)), min(frame - 2, int(sample_rate / lo))
    window = nsdf[:, lag_lo:lag_hi]
    f0 = np.full(len(frames), np.nan)
    voiced = np.zeros(len(frames), dtype=bool)
    for i, row in enumerate(window):
        top = float(row.max())
        if top < 0.8:
            continue
        peaks = np.where((row[1:-1] > row[:-2]) & (row[1:-1] >= row[2:]) & (row[1:-1] >= 0.9 * top))[0]
        if len(peaks) == 0:
            continue
        k = int(peaks[0]) + 1
        a, b, c = row[k - 1], row[k], row[k + 1]
        denom = a - 2 * b + c
        shift = 0.5 * (a - c) / denom if abs(denom) > 1e-12 else 0.0
        f0[i] = sample_rate / (lag_lo + k + shift)
        voiced[i] = True
    return f0, voiced


def pitch_drift(reference: np.ndarray, edited: np.ndarray, sample_rate: int, rate: float) -> dict[str, Any]:
    """
    Median cents between the edit and the reference at matching voiced frames (`rate` > 1: the edit is
    shorter, so edit time t is reference time t * rate). The range comes from the reference; a pass
    that finds no stable pitch is skipped with the reason.
    """
    wide_f0, wide_voiced = _f0_track(reference, sample_rate, 50.0, 1000.0)
    if wide_voiced.mean() < MIN_VOICED_SHARE or wide_voiced.sum() < MIN_VOICED_FRAMES:
        return {"verdict": "skipped", "reason": "no stable pitch in the reference (unpitched material)"}
    centre = float(np.median(wide_f0[wide_voiced]))
    lo, hi = max(40.0, centre / 2.0), min(1500.0, centre * 2.0)
    if centre < 50.0 * 1.05 or centre > 1000.0 * 0.95:
        return {"verdict": "skipped", "reason": "the pitch tracker stayed at the edge of its range (no reliable pitch)"}
    ref_f0, ref_voiced = _f0_track(reference, sample_rate, lo, hi)
    edit_f0, edit_voiced = _f0_track(edited, sample_rate, lo, hi)
    index = np.round(np.arange(len(edit_f0)) * rate).astype(int)
    inside = index < len(ref_f0)
    index, edit_f0, edit_voiced = index[inside], edit_f0[inside], edit_voiced[inside]
    both = ref_voiced[index] & edit_voiced
    if both.sum() < MIN_VOICED_FRAMES:
        return {"verdict": "skipped", "reason": "too few voiced frames in both to compare"}
    cents = 1200.0 * np.log2(edit_f0[both] / ref_f0[index][both])
    drift = float(np.median(cents))
    expected = 1200.0 * np.log2(rate)  # what a plain speed change (pitch follows the speed) would do
    varispeed = abs(expected) >= PITCH_WARN_CENTS and abs(drift - expected) <= VARISPEED_TOLERANCE_CENTS
    return {
        "verdict": "info" if varispeed else "warn" if abs(drift) >= PITCH_WARN_CENTS else "ok",
        "driftCents": round(drift, 1),
        "referenceHz": round(centre, 1),
        "framesCompared": int(both.sum()),
        **({"varispeed": True, "expectedCents": round(expected, 1)} if varispeed else {}),
    }


def _mel_filterbank(sample_rate: int, n_fft: int = 2048, bands: int = 40) -> np.ndarray:
    """Triangular mel filters, 60 Hz to 10 kHz (or 95% of Nyquist): (bands, bins)."""
    to_mel = lambda f: 2595.0 * np.log10(1.0 + f / 700.0)
    from_mel = lambda m: 700.0 * (10.0 ** (m / 2595.0) - 1.0)
    points = from_mel(np.linspace(to_mel(60.0), to_mel(min(10000.0, sample_rate / 2.0 * 0.95)), bands + 2))
    freqs = np.fft.rfftfreq(n_fft, 1.0 / sample_rate)
    bank = np.zeros((bands, len(freqs)))
    for i in range(bands):
        left, centre, right = points[i:i + 3]
        bank[i] = np.maximum(0.0, np.minimum((freqs - left) / (centre - left), (right - freqs) / (right - centre)))
    return bank


def _long_term_bands(x: np.ndarray, sample_rate: int) -> np.ndarray:
    """Mean dB per mel band over the frames within 40 dB of the loudest (a mean of dB, so sparse bursts do not dominate)."""
    levels = 10.0 * np.log10(_stft_power(x) @ _mel_filterbank(sample_rate).T + 1e-10)
    frame_level = levels.mean(axis=1)
    return levels[frame_level > frame_level.max() - 40.0].mean(axis=0)


def tone_difference(reference: np.ndarray, edited: np.ndarray, sample_rate: int, varispeed: bool = False) -> dict[str, Any]:
    """
    Rms dB difference of the long-term spectrum, overall gain removed. After a plain speed change the whole
    spectrum moves with the pitch by design, so a distance over the line is reported, not warned.
    """
    delta = _long_term_bands(reference, sample_rate) - _long_term_bands(edited, sample_rate)
    distance = float(np.sqrt(np.mean((delta - delta.mean()) ** 2)))
    over = distance >= TONE_WARN_DB
    return {
        "verdict": ("info" if varispeed else "warn") if over else "ok",
        "distanceDb": round(distance, 2),
        **({"reason": "the spectrum moves with the pitch after a plain speed change"} if over and varispeed else {}),
    }


def _flux_peakiness(x: np.ndarray) -> float:
    power = _stft_power(x, 1024, 256)
    logged = np.log1p(np.sqrt(power) * 20.0)
    flux = np.maximum(np.diff(logged, axis=0), 0.0).sum(axis=1)
    return float(np.percentile(flux, 99) / (np.mean(flux) + 1e-9))


def transient_change(reference: np.ndarray, edited: np.ndarray) -> dict[str, Any]:
    """Log ratio of spectral-flux peakiness, edit over reference; only a drop (smeared attacks) warns."""
    ratio = float(np.log(_flux_peakiness(_normalised(edited)) / _flux_peakiness(_normalised(reference))))
    return {"verdict": "warn" if ratio <= TRANSIENT_WARN_LOG else "ok", "fluxLogRatio": round(ratio, 3)}


def _envelope_db(x: np.ndarray, sample_rate: int, window: float = 0.03, hop: float = 0.01) -> np.ndarray:
    w, h = int(window * sample_rate), int(hop * sample_rate)
    frames = (len(x) - w) // h
    return 10.0 * np.log10(np.array([np.mean(x[i * h:i * h + w] ** 2) for i in range(frames)]) + 1e-12)


def slowdown_dropout(reference: np.ndarray, edited: np.ndarray, sample_rate: int, rate: float) -> dict[str, Any]:
    """
    Where does the edit go quiet while the reference, warped through the speed change, does not? A big slow-down
    can drop or smear a piece of the signal: the loudness (30 ms frames, level matched, small lag searched)
    falls far below the reference at one spot. Reports the deepest dip in dB; only slow-downs below
    DROPOUT_MAX_RATE are checked. Unvalidated beyond one vocal phrase, and a steep onset moved a few ms also dips.
    """
    hop = 0.01
    ref_env, edit_env = _envelope_db(reference, sample_rate, hop=hop), _envelope_db(edited, sample_rate, hop=hop)
    if len(ref_env) < 10 or len(edit_env) < 10:
        return {"verdict": "skipped", "reason": "too short for a loudness comparison"}
    best: tuple[float, np.ndarray] | None = None
    for lag in np.arange(-0.03, 0.0301, hop):
        positions = ((np.arange(len(edit_env)) * hop * rate + lag) / hop).clip(0, len(ref_env) - 1)
        warped = np.interp(positions, np.arange(len(ref_env)), ref_env)
        active = warped > warped.max() - 30.0
        if active.sum() < 10:
            return {"verdict": "skipped", "reason": "too quiet for a loudness comparison"}
        diff = (edit_env - warped)[active]
        diff = diff - np.median(diff)
        score = float(np.sqrt(np.mean(diff ** 2)))
        if best is None or score < best[0]:
            best = (score, diff)
    dip = float(-best[1].min())
    return {"verdict": "warn" if dip >= DROPOUT_WARN_DB else "ok", "deepestDipDb": round(dip, 1)}


def _click_verdict(edit_score: float | None, ref_score: float | None) -> str:
    if edit_score is None:
        return "unknown"
    ratio = edit_score / max(ref_score or 1.0, 1.0)
    if edit_score >= CLICK_FAIL_SCORE and ratio >= CLICK_FAIL_RATIO:
        return "fail"
    if edit_score >= CLICK_WARN_SCORE and ratio >= CLICK_WARN_RATIO:
        return "warn"
    return "ok"


def _null_verdict(residual_db: float, expect: str) -> str:
    if expect != "identical":
        return "info"
    if residual_db <= NULL_OK_DB:
        return "ok"
    return "warn" if residual_db <= NULL_WARN_DB else "fail"


def verify_edit(reference: np.ndarray, edited: np.ndarray, sample_rate: int, *,
                expect: str = "identical", time_scale: float = 1.0,
                max_lag_ms: float = 20.0) -> dict[str, Any]:
    """
    Run the checks. `expect` is "identical" (the edit should leave the sound alone apart
    from level, delay and polarity: alignment, gain, a split, a crossfade) or "changed"
    (EQ, compression, stretch: the null residual is reported without a verdict).
    `time_scale` != 1 means the edit changed the timing (a stretch), so the two cannot
    be nulled against each other and only the discontinuity check runs.
    """
    if expect not in ("identical", "changed"):
        return {"error": f"expect must be 'identical' or 'changed', got {expect!r}"}
    ref_len, edit_len = np.asarray(reference).shape[-1], np.asarray(edited).shape[-1]
    if min(ref_len, edit_len) < int(0.1 * sample_rate):
        return {"error": "Audio too short: need at least 0.1 s"}
    for name, audio in (("reference", reference), ("edited audio", edited)):
        if np.max(np.abs(audio)) < SILENCE:
            return {"error": f"The {name} is silent over this range"}
    if abs(time_scale - 1.0) <= 1e-6 and abs(ref_len - edit_len) > sample_rate * max_lag_ms / 1000.0:
        return {"error": f"The reference is {ref_len / sample_rate:.2f} s and the edited audio {edit_len / sample_rate:.2f} s: "
                         "they must cover the same range (cut the reference file to the window, or use referenceTrack)"}
    checks: dict[str, Any] = {}

    edge = int(sample_rate * max_lag_ms / 1000.0)
    edit_disc, ref_disc, channel = _worst_channel(reference, edited, edge)
    checks["discontinuity"] = {
        "verdict": _click_verdict(edit_disc["score"], ref_disc["score"]),
        "score": edit_disc["score"],
        "referenceScore": ref_disc["score"],
        "atSeconds": None if edit_disc["atSample"] is None else round(edit_disc["atSample"] / sample_rate, 3),
        **({"channel": channel} if channel is not None else {}),
    }

    if abs(time_scale - 1.0) > 1e-6:
        checks["null"] = {"verdict": "skipped", "reason": "timing changed (timeScale != 1): a waveform null needs the same timing"}
        ref_mono, edit_mono = _mono(reference), _mono(edited)
        checks["pitch"] = pitch_drift(ref_mono, edit_mono, sample_rate, time_scale)
        checks["tone"] = tone_difference(ref_mono, edit_mono, sample_rate, bool(checks["pitch"].get("varispeed")))
        checks["transients"] = transient_change(ref_mono, edit_mono)
        if time_scale < DROPOUT_MAX_RATE:
            checks["dropout"] = slowdown_dropout(ref_mono, edit_mono, sample_rate, time_scale)
    else:
        null = compensated_null(reference, edited, sample_rate, max_lag_ms)
        if "error" in null:
            return null
        checks["null"] = {"verdict": _null_verdict(null["residualDb"], expect), **null}

    verdicts = [c["verdict"] for c in checks.values()]
    overall = "fail" if "fail" in verdicts else "warn" if "warn" in verdicts else "ok"
    return {"verdict": overall, "expect": expect, "sampleRate": sample_rate, "checks": checks}
