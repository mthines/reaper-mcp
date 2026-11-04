"""Voice sketch to monophonic melody + heuristic GM drums. Local, model-free.

YIN rejects aperiodic frames before note segmentation; it does not transcribe
speech or separate simultaneous voices. Beatbox labels are spectral guesses,
not a trained kick/snare/hat classifier. No harmony is invented.
"""
from __future__ import annotations

import math
import numpy as np

import analysis

MAX_SECONDS = 120
MAX_NOTES = 10000


def _pitch_frames(mono: np.ndarray, sr: int, pitch_min: int, pitch_max: int):
    """YIN cumulative mean normalized difference, 10 ms hops, 93 ms windows.

    Low-pass before resampling so high-frequency beatbox noise cannot alias
    into the pitch range. Work a frame at a time to bound FFT memory.
    """
    rate = 11025
    cutoff = min(4500, sr * 0.45)
    taps = np.arange(-48, 49)
    kernel = 2 * cutoff / sr * np.sinc(2 * cutoff / sr * taps) * np.hanning(97)
    filtered = np.convolve(mono, kernel / kernel.sum(), mode="same")
    x = np.interp(np.arange(0, mono.size, sr / rate), np.arange(mono.size), filtered)
    size, hop = 1024, 110
    padded = np.pad(x, (size // 2, size // 2))
    lo = max(2, int(rate / (440 * 2 ** ((pitch_max + 0.5 - 69) / 12))))
    hi = min(size // 2, int(math.ceil(rate / (440 * 2 ** ((pitch_min - 0.5 - 69) / 12)))))
    times, pitches, clarity, levels = [], [], [], []
    gate = max(1e-5, float(np.sqrt(np.mean(x * x))) * 0.08)
    for pos in range(0, x.size, hop):
        frame = padded[pos:pos + size].copy()
        frame -= frame.mean()
        rms = float(np.sqrt(np.mean(frame * frame)))
        pitch, confidence = -1.0, 0.0
        if rms > gate:
            spec = np.fft.rfft(frame, size * 2)
            ac = np.fft.irfft(spec * spec.conj(), size * 2)[:hi + 1]
            sq = np.r_[0, np.cumsum(frame * frame)]
            lag = np.arange(1, hi + 1)
            diff = np.maximum(0, sq[size - lag] + sq[size] - sq[lag] - 2 * ac[1:])
            norm = np.r_[1, diff * lag / np.maximum(np.cumsum(diff), 1e-12)]
            troughs = [i for i in range(lo, hi) if norm[i] < 0.18 and norm[i] <= norm[i - 1]
                       and norm[i] < norm[i + 1]]
            best = troughs[0] if troughs else int(lo + np.argmin(norm[lo:hi + 1]))
            confidence = float(np.clip(1 - norm[best], 0, 1))
            if confidence >= 0.78:
                refined = float(best)
                if 1 < best < hi:
                    a, b, c = norm[best - 1:best + 2]
                    denom = a - 2 * b + c
                    if denom > 1e-9:
                        refined += float(np.clip(0.5 * (a - c) / denom, -0.5, 0.5))
                pitch = 69 + 12 * math.log2(rate / refined / 440)
                if not pitch_min - 0.5 <= pitch <= pitch_max + 0.5:
                    pitch = -1.0
        times.append(pos / rate)
        pitches.append(pitch)
        clarity.append(confidence if pitch >= 0 else 0)
        levels.append(rms)
    return np.array(times), np.array(pitches), np.array(clarity), np.array(levels)


def _melody(mono: np.ndarray, sr: int, pitch_min: int, pitch_max: int, min_note: float):
    times, pitches, clarity, levels = _pitch_frames(mono, sr, pitch_min, pitch_max)
    rounded = np.where(pitches >= 0, np.floor(pitches + 0.5), -1).astype(int)
    # Median among voiced neighbours removes single-frame octave/rounding glitches,
    # but never fills a truly unvoiced frame with a made-up note.
    smooth = rounded.copy()
    for i in range(len(rounded)):
        near = rounded[max(0, i - 2):i + 3]
        voiced = near[near >= 0]
        if rounded[i] >= 0 and voiced.size:
            smooth[i] = int(np.median(voiced))
    for i in range(1, len(smooth) - 2):
        if smooth[i] < 0 and smooth[i - 1] >= 0:
            for gap in (1, 2):
                if smooth[i + gap] == smooth[i - 1]:
                    smooth[i:i + gap] = smooth[i - 1]
                    break
    notes = []
    i = 0
    top = float(np.percentile(levels, 95)) or 1
    hop = 110 / 11025
    while i < len(smooth):
        j = i + 1
        while j < len(smooth) and smooth[j] == smooth[i]:
            j += 1
        if smooth[i] >= 0 and (j - i) * hop >= min_note:
            start = max(0, times[i] - 0.02)
            end = min(mono.size / sr, times[j - 1] + hop - 0.02)
            # Percussion attacks do not rearticulate a continuous voiced run.
            notes.append({"time": round(float(start), 4), "duration": round(float(end - start), 4),
                          "pitch": int(smooth[i]), "velocity": int(np.clip(90 * levels[i:j].mean() / top, 35, 115)),
                          "confidence": round(float(clarity[i:j].mean()), 3)})
        i = j
    return notes, (times, clarity)


def _drums(mono: np.ndarray, sr: int, hits: list, voiced, mode: str):
    notes = []
    for hit in hits:
        t = hit["time"]
        seg = mono[int(t * sr):int((t + 0.06) * sr)]
        if seg.size < 16:
            continue
        power = np.abs(np.fft.rfft(seg * np.hanning(seg.size))) ** 2
        freq = np.fft.rfftfreq(seg.size, 1 / sr)
        total = float(power.sum()) or 1e-12
        low = float(power[freq < 180].sum() / total)
        high = float(power[freq > 3500].sum() / total)
        centre = float((freq * power).sum() / total)
        near = (voiced[0] >= t) & (voiced[0] < t + 0.06)
        periodic = float(voiced[1][near].mean()) if near.any() else 0
        # Pure humming should not become a parallel drum line in auto mode.
        # Pitched plosives can still count as a kick: this is intentionally heuristic.
        crest = float(np.max(np.abs(seg)) / max(np.sqrt(np.mean(seg * seg)), 1e-12))
        if mode == "auto" and periodic > 0.8 and high < 0.08 and crest < 3.5:
            continue
        if high > 0.35 or centre > 3500:
            pitch, label, confidence = 42, "closed_hat", max(high, 0.5)
        elif low > 0.3 and centre < 1800:
            pitch, label, confidence = 36, "kick", low
        else:
            pitch, label, confidence = 38, "snare", 1 - max(low, high)
        notes.append({"time": t, "duration": 0.06, "pitch": pitch, "label": label,
                      "velocity": int(np.clip(40 + 75 * hit["strength"], 1, 127)),
                      "confidence": round(float(confidence), 3)})
    return notes


def _tempo(flux, frame_s: float, hits: list, duration: float, bpm: float | None, threshold: float):
    estimate = analysis.estimate_tempo(flux, frame_s)
    detected = estimate["bpm"]
    if bpm is None and (detected is None or (estimate["confidence"] or 0) < 0.08):
        raise ValueError("No reliable pulse found. Supply bpm, or select a longer rhythmic range (at least 4 s).")
    base = float(bpm or round(detected))
    origin = min((h["time"] for h in hits), default=0.0)
    windows = []
    if bpm is None:
        for start in np.arange(origin, duration - 3.99, 4.0):
            lo, hi = int(start / frame_s), int((start + 4) / frame_s)
            local = analysis.estimate_tempo(flux[lo:hi], frame_s)
            windows.append((float(start), local))
        # The global autocorrelation can favour the longer, later section.
        # Start at the opening pulse when two windows independently agree.
        if len(windows) >= 2:
            a, b = windows[0][1], windows[1][1]
            if a["bpm"] and b["bpm"] and min(a["confidence"] or 0, b["confidence"] or 0) >= 0.2:
                if abs(a["bpm"] / b["bpm"] - 1) < 0.08:
                    base = float(round((a["bpm"] + b["bpm"]) / 2))
    segments = [{"time": origin, "beat": 0.0, "bpm": base}]
    if bpm is None:
        # A change must persist in two adjacent four-second windows. Fold only
        # near-exact octave ambiguities: a genuine 100 -> 150 is not 100 -> 75.
        pending = None
        for start, local in windows:
            value = local["bpm"]
            if value is None or (local["confidence"] or 0) < 0.2:
                pending = None
                continue
            current = segments[-1]["bpm"]
            if abs(value / current - 2) < 0.16:
                value /= 2
            elif abs(value / current - 0.5) < 0.04:
                value *= 2
            if abs(value / current - 1) < threshold:
                pending = None
                continue
            if pending is not None and abs(value / pending[1] - 1) < 0.08:
                change_time = pending[0]
                previous = segments[-1]
                beat = previous["beat"] + (change_time - previous["time"]) * previous["bpm"] / 60
                segments.append({"time": round(float(change_time), 4), "beat": round(beat, 6),
                                 "bpm": float(round((pending[1] + value) / 2))})
                pending = None
            else:
                pending = (float(start), value)
    return {"bpm": base, "detectedBpm": detected, "confidence": estimate["confidence"],
            "source": "manual" if bpm is not None else "estimated", "originSeconds": origin,
            "segments": segments, "alternatives": [base / 2, base * 2]}


def _beat(time: float, segments: list) -> float:
    segment = next((s for s in reversed(segments) if time >= s["time"]), segments[0])
    return max(0, segment["beat"] + (time - segment["time"]) * segment["bpm"] / 60)


def _quantize(notes: list, segments: list, grid: float, melodic: bool):
    by_slot = {}
    for note in notes:
        beat = round(math.floor(_beat(note["time"], segments) / grid + 0.5) * grid, 6)
        end = math.floor(_beat(note["time"] + note["duration"], segments) / grid + 0.5) * grid
        n = {**note, "beat": beat, "lengthBeats": round(max(grid if melodic else min(grid, 0.125), end - beat), 6)}
        key = (beat, 0 if melodic else note["pitch"])
        previous = by_slot.get(key)
        if previous is None or note["confidence"] * note["duration"] > previous["confidence"] * previous["duration"]:
            by_slot[key] = n
    out = sorted(by_slot.values(), key=lambda n: (n["beat"], n["pitch"]))
    if melodic:
        for a, b in zip(out, out[1:]):
            a["lengthBeats"] = round(min(a["lengthBeats"], b["beat"] - a["beat"]), 6)
    return out


def transcribe(audio: np.ndarray, sr: int, *, mode: str = "auto", bpm: float | None = None,
               grid: float = 0.25, pitch_min: int = 36, pitch_max: int = 84,
               min_note_ms: float = 80, tempo_change_threshold: float = 0.2) -> dict:
    """Times are relative to the selected clip; beats start at its first onset.

    Returns full bounded note arrays to the Node client, which pages the agent's
    response and optionally exports all notes. Four-four meter is an assumption,
    never inferred. Timing confidence is not a calibrated probability.
    """
    duration = audio.shape[1] / sr
    if not 0.5 <= duration <= MAX_SECONDS:
        raise ValueError(f"Select between 0.5 and {MAX_SECONDS} seconds")
    if mode not in ("auto", "melody", "drums"):
        raise ValueError("mode must be auto, melody or drums")
    if bpm is not None and (not math.isfinite(bpm) or not 40 <= bpm <= 240):
        raise ValueError("bpm must be between 40 and 240")
    if not math.isfinite(grid) or not 1 / 12 <= grid <= 1:
        raise ValueError("grid must be between 1/12 and 1 beat")
    if not 24 <= pitch_min < pitch_max <= 96:
        raise ValueError("pitchMin must be below pitchMax, both between 24 and 96")
    if not 40 <= min_note_ms <= 500 or not 0.1 <= tempo_change_threshold <= 0.5:
        raise ValueError("minNoteMs must be 40..500; tempoChangeThreshold must be 0.1..0.5")
    if not np.isfinite(audio).all():
        raise ValueError("Audio contains non-finite samples")
    mono = audio.mean(axis=0).astype(np.float32)
    if float(np.max(np.abs(mono))) < 1e-5:
        raise ValueError("No audible content in the selected range")
    detected = analysis.transients(audio, sr, sensitivity=0.6, min_gap_ms=80)
    hits = detected["transients"]
    melody, voiced = ([], (np.array([]), np.array([])))
    if mode != "drums":
        melody, voiced = _melody(mono, sr, pitch_min, pitch_max, min_note_ms / 1000)
    drums = _drums(mono, sr, hits, voiced, mode) if mode != "melody" else []
    flux, _, frame_s = analysis._band_flux(mono, sr)
    tempo = _tempo(flux["full"], frame_s, hits, duration, bpm, tempo_change_threshold)
    # Pitch-class evidence must not change when a coarse grid merges note onsets.
    profile = [0.0] * 12
    for note in melody:
        profile[note["pitch"] % 12] += note["duration"] * note["confidence"]
    melody = _quantize(melody, tempo["segments"], grid, True)
    drums = _quantize(drums, tempo["segments"], grid, False)
    if not melody and not drums:
        raise ValueError("No notes detected. Try a different mode, pitch range or minNoteMs.")
    if len(melody) + len(drums) > MAX_NOTES:
        raise ValueError(f"Too many notes (max {MAX_NOTES}); select a shorter range")
    # Group exact repeated four-beat drum bars without inventing missing hits.
    bars = {}
    for n in drums:
        bar = int(n["beat"] // 4)
        bars.setdefault(bar, []).append((round(n["beat"] % 4, 6), n["pitch"]))
    patterns = {}
    for bar, pattern in bars.items():
        patterns.setdefault(tuple(pattern), []).append(bar + 1)
    warnings = ["Experimental transcription: review pitches, octaves and kick/snare/hat guesses.",
                "Speech is not removed; use startTime/endTime to exclude spoken cues.",
                "4/4 meter and the first onset as beat zero are assumptions, not detected downbeats.",
                "Half/double tempo is ambiguous; supply bpm to choose the intended pulse."]
    if bpm is None and (tempo["confidence"] or 0) < 0.25:
        warnings.append("Weak tempo evidence; audition the result and consider supplying bpm.")
    if not melody and mode != "drums":
        warnings.append("No stable melody found in the selected pitch range.")
    return {"durationSeconds": round(duration, 4), "mode": mode, "grid": grid, "tempo": tempo,
            "chroma": profile, "melody": melody, "drums": drums, "warnings": warnings,
            "patterns": [{"bars": bars, "hits": [{"beat": b, "pitch": p} for b, p in pattern]}
                         for pattern, bars in patterns.items()]}
