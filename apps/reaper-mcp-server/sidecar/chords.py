"""
Chord recognition for the reaper-mcp sidecar, with lv-chordia (MIT): a large-vocabulary
recognizer that returns chord segments with Harte labels ("C:maj", "A:min7", "C:maj/3",
"N" for no chord, "X" for unknown).

Opt-in: installed by `reaper-mcp setup-sidecar --with-chords`. The labels are passed on
as they are; the TypeScript tool maps them onto the bar/beat grid and its chord names.
"""

from __future__ import annotations

import os
import tempfile
import time
from typing import Any

import analysis

VOCABULARIES = ("submission", "ismir2017", "full")
NOT_INSTALLED = ("The chord model is not installed. Run: reaper-mcp setup-sidecar --with-chords "
                 "(installs lv-chordia, ~135 MB)")


def _load_error() -> str | None:
    """None when the recognizer imports; else why not ("" when lv-chordia is not installed at all)."""
    try:
        import lv_chordia.chord_recognition  # type: ignore  # noqa: F401
    except ModuleNotFoundError as exc:
        return "" if exc.name == "lv_chordia" else str(exc)
    except Exception as exc:  # noqa: BLE001 — any failure while loading means the model is unusable
        return str(exc) or type(exc).__name__
    return None


def status() -> dict[str, Any]:
    """Whether the model loads, and what to do when it does not. A package that is there but fails
    to import (a dependency missing) counts as not installed, so `auto` falls back to the templates."""
    if is_installed():
        return {"installed": True, "message": ""}
    error = _load_error()
    if not error:
        return {"installed": False, "message": NOT_INSTALLED}
    return {"installed": False, "message": f"The chord model is installed but does not load ({error}). "
                                           "Reinstall it: reaper-mcp setup-sidecar --with-chords"}


def is_installed() -> bool:
    return _load_error() is None


def _recognize(path: str, vocabulary: str) -> list[dict[str, Any]]:
    from lv_chordia.chord_recognition import chord_recognition  # type: ignore

    return list(chord_recognition(audio_path=path, chord_dict_name=vocabulary) or [])


def recognize(path: str, start: float = 0.0, end: float | None = None,
              vocabulary: str = "submission") -> dict[str, Any]:
    """
    Chord segments of [start, end) of `path`, in seconds of the file:
    {segments: [{start, end, label}], durationSeconds, vocabulary, seconds}.
    A range is cut to a temporary WAV first (the model reads whole files).
    """
    if vocabulary not in VOCABULARIES:
        raise ValueError(f"Unknown vocabulary {vocabulary}. Use {', '.join(VOCABULARIES)}")
    if not is_installed():
        raise RuntimeError(status()["message"])
    t0 = time.time()
    source, offset, temp = path, 0.0, None
    if start > 0 or end is not None:
        import soundfile as sf  # type: ignore

        audio, sr = analysis.load_audio(path, start, end)
        if audio.shape[1] == 0:
            raise ValueError("The range holds no audio")
        fd, temp = tempfile.mkstemp(suffix=".wav", prefix="reaper-mcp-chords-")
        os.close(fd)
        sf.write(temp, audio.T, sr, subtype="FLOAT")
        source, offset = temp, start
    try:
        raw = _recognize(source, vocabulary)
    finally:
        if temp:
            try:
                os.remove(temp)
            except OSError:
                pass
    segments = []
    for seg in raw:
        a, b = float(seg["start_time"]), float(seg["end_time"])
        if b <= a:
            continue
        segments.append({"start": round(a + offset, 3), "end": round(b + offset, 3), "label": str(seg["chord"])})
    duration = (segments[-1]["end"] - offset) if segments else 0.0
    return {"segments": segments, "durationSeconds": round(duration, 3), "vocabulary": vocabulary,
            "seconds": round(time.time() - t0, 2)}
