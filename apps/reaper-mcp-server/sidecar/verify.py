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

Pitch, formant and transient checks were source-dependent in the experiment (they
need a pitch range and a baseline per source), so they are not part of this module.
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


def _mono(audio: np.ndarray) -> np.ndarray:
    """(channels, samples) or (samples,) to float64 mono."""
    a = np.asarray(audio, dtype=np.float64)
    return a if a.ndim == 1 else a.mean(axis=0)


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
    ref, edit = _mono(reference), _mono(edited)
    n = min(len(ref), len(edit))
    ref, edit = ref[:n], edit[:n]
    if n < int(0.1 * sample_rate):
        return {"error": "Audio too short: need at least 0.1 s"}
    if np.max(np.abs(ref)) < SILENCE:
        return {"error": "The reference is silent over this range"}
    if np.max(np.abs(edit)) < SILENCE:
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
    residual = ref - gain * aligned
    margin = lag_max * 2
    span = slice(margin, n - margin) if n > 4 * margin else slice(0, n)
    ref_power = float(np.mean(ref[span] ** 2)) + 1e-15
    return {
        "delayMs": round(1000.0 * lag / sample_rate, 3),
        # gain that maps the edit back to the reference; the edit is 1/gain times as loud
        "gainDb": round(-20.0 * np.log10(abs(gain) + 1e-15), 2),
        "polarityInverted": bool(gain < 0),
        "residualDb": round(_db(float(np.mean(residual[span] ** 2)) / ref_power), 1),
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
    checks: dict[str, Any] = {}

    edge = int(sample_rate * max_lag_ms / 1000.0)
    edit_disc = discontinuity_score(edited, edge)
    ref_disc = discontinuity_score(reference, edge)
    checks["discontinuity"] = {
        "verdict": _click_verdict(edit_disc["score"], ref_disc["score"]),
        "score": edit_disc["score"],
        "referenceScore": ref_disc["score"],
        "atSeconds": None if edit_disc["atSample"] is None else round(edit_disc["atSample"] / sample_rate, 3),
    }

    if abs(time_scale - 1.0) > 1e-6:
        checks["null"] = {"verdict": "skipped", "reason": "timing changed (timeScale != 1): a waveform null needs the same timing"}
    else:
        null = compensated_null(reference, edited, sample_rate, max_lag_ms)
        if "error" in null:
            return null
        checks["null"] = {"verdict": _null_verdict(null["residualDb"], expect), **null}

    verdicts = [c["verdict"] for c in checks.values()]
    overall = "fail" if "fail" in verdicts else "warn" if "warn" in verdicts else "ok"
    return {"verdict": overall, "expect": expect, "sampleRate": sample_rate, "checks": checks}
