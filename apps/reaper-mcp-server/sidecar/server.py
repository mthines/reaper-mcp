#!/usr/bin/env python3
"""
REAPER MCP Python Sidecar — Audiobox Aesthetics JSON-RPC Server

Long-lived process. Reads newline-delimited JSON-RPC 2.0 requests from stdin,
writes responses to stdout. Never crashes — all errors are surfaced as
JSON-RPC error responses.

Model: Meta Audiobox Aesthetics (CC-BY 4.0)
https://huggingface.co/facebook/audiobox-aesthetics

JSON-RPC request format:
    {"jsonrpc":"2.0","id":1,"method":"analyze","params":{"path":"/tmp/foo.wav","startTime":0,"endTime":5}}

JSON-RPC response format (success):
    {"jsonrpc":"2.0","id":1,"result":{"CE":5.15,"CU":5.78,"PC":2.15,"PQ":7.22,"durationSeconds":5.0,"modelVersion":"facebook/audiobox-aesthetics"}}

JSON-RPC error response:
    {"jsonrpc":"2.0","id":1,"error":{"code":-32000,"message":"Audio too short: 0.3s (minimum 0.5s)"}}
"""

from __future__ import annotations

import json
import sys
import os
from typing import Any

import numpy as np

# analysis.py is installed next to this file
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# Minimum audio duration the model can process
MIN_DURATION_SECONDS = 0.5
MODEL_ID = "facebook/audiobox-aesthetics"

# ---------------------------------------------------------------------------
# Predictor singleton — loaded once at first request
# ---------------------------------------------------------------------------

_predictor = None
_predictor_error: str | None = None


def _ensure_predictor() -> None:
    """Load the predictor on first use. Caches result (success or failure)."""
    global _predictor, _predictor_error

    if _predictor is not None or _predictor_error is not None:
        return

    try:
        from audiobox_aesthetics.infer import initialize_predictor  # type: ignore
        _predictor = initialize_predictor()
    except ImportError as exc:
        _predictor_error = (
            f"audiobox-aesthetics not installed: {exc}. "
            f"Run: node dist/apps/reaper-mcp-server/main.js setup-sidecar"
        )
    except Exception as exc:  # noqa: BLE001
        _predictor_error = f"Failed to initialize predictor: {exc}"


# ---------------------------------------------------------------------------
# Duration check helper
# ---------------------------------------------------------------------------

def _load_clip(path: str, start_time: float, end_time: float) -> tuple[Any, int]:
    """Decode [start_time, end_time) of a file as a (channels, frames) float32 array.

    Uses soundfile, not torchaudio: torchaudio 2.9+ dropped info() and moved
    load() to torchcodec, which audiobox-aesthetics' own reader still calls.
    """
    import analysis

    return analysis.load_audio(path, start_time, end_time)


def _get_audio_duration(path: str) -> float:
    """Return audio duration in seconds. Raises RuntimeError if file unreadable."""
    try:
        import soundfile as sf  # type: ignore
        info = sf.info(path)
        return info.duration
    except Exception:
        # Fallback: try torchaudio if soundfile not available
        try:
            import torchaudio  # type: ignore
            info = torchaudio.info(path)
            return info.num_frames / info.sample_rate
        except Exception as exc:
            raise RuntimeError(f"Cannot read audio file: {path}: {exc}") from exc


# ---------------------------------------------------------------------------
# JSON-RPC helpers
# ---------------------------------------------------------------------------

def _json_default(value: Any) -> Any:
    # numpy scalars (float32 survives arithmetic with Python floats in NumPy 2)
    if isinstance(value, np.generic):
        return value.item()
    raise TypeError(f"Object of type {type(value).__name__} is not JSON serializable")


def _ok(request_id: Any, result: dict) -> str:
    return json.dumps({"jsonrpc": "2.0", "id": request_id, "result": result}, default=_json_default)


def _err(request_id: Any, code: int, message: str) -> str:
    return json.dumps({"jsonrpc": "2.0", "id": request_id, "error": {"code": code, "message": message}})


# ---------------------------------------------------------------------------
# Method dispatch
# ---------------------------------------------------------------------------

def handle_analyze(request_id: Any, params: dict) -> str:
    """
    Analyze a WAV file with Audiobox Aesthetics.

    params:
        path      — absolute path to WAV file (required)
        startTime — float seconds, start of region to analyze (default 0)
        endTime   — float seconds, end of region (default = file duration)

    Returns JSON-RPC response string.
    """
    path = params.get("path")
    if not path:
        return _err(request_id, -32602, "Missing required param: path")

    if not os.path.exists(path):
        return _err(request_id, -32000, f"Audio file not found: {path}")

    # Check duration
    try:
        duration = _get_audio_duration(path)
    except RuntimeError as exc:
        return _err(request_id, -32000, str(exc))

    start_time = float(params.get("startTime", 0))
    end_time = float(params.get("endTime", duration))
    normalize_lufs = params.get("normalizeLufs")
    normalize_lufs = None if normalize_lufs is None else float(normalize_lufs)

    clip_duration = end_time - start_time
    if clip_duration < MIN_DURATION_SECONDS:
        return _err(
            request_id,
            -32000,
            f"Audio too short: {clip_duration:.2f}s (minimum {MIN_DURATION_SECONDS}s)",
        )

    # Ensure predictor is loaded
    _ensure_predictor()
    if _predictor_error:
        return _err(request_id, -32000, _predictor_error)

    try:
        wav, sample_rate = _load_clip(path, start_time, end_time)
        input_lufs = None
        gain_db = 0.0
        if normalize_lufs is not None:
            import analysis

            wav, input_lufs, gain_db = analysis.normalize_to_lufs(wav, sample_rate, normalize_lufs)
        if isinstance(wav, np.ndarray):
            import torch  # type: ignore

            wav = torch.from_numpy(wav)
        # A tensor under "path" skips audiobox's own torchaudio.load
        results = _predictor.forward([{"path": wav, "sample_rate": sample_rate}])
        # audiobox-aesthetics returns a list of dicts with keys CE, CU, PC, PQ
        scores = results[0]
        return _ok(request_id, {
            "CE": float(scores.get("CE", 0)),
            "CU": float(scores.get("CU", 0)),
            "PC": float(scores.get("PC", 0)),
            "PQ": float(scores.get("PQ", 0)),
            "durationSeconds": clip_duration,
            "modelVersion": MODEL_ID,
            "normalizeLufs": normalize_lufs,
            "inputLufs": None if input_lufs is None else round(input_lufs, 2),
            "gainDb": round(gain_db, 2),
        })
    except Exception as exc:  # noqa: BLE001
        return _err(request_id, -32000, f"Inference failed: {exc}")


def _check_file(request_id: Any, params: dict, key: str) -> str | None:
    """Return an error response when params[key] is missing or not a file."""
    path = params.get(key)
    if not path:
        return _err(request_id, -32602, f"Missing required param: {key}")
    if not os.path.exists(path):
        return _err(request_id, -32000, f"Audio file not found: {path}")
    return None


def handle_analyze_audio(request_id: Any, params: dict) -> str:
    """
    Loudness (BS.1770 / EBU R128) and spectral analysis of a file, with an
    optional reference file comparison. No model is loaded.

    params: path, startTime?, endTime?, sectionSeconds?, referencePath?,
            referenceStartTime?, referenceEndTime?
    """
    import analysis

    for key in ("path", *(("referencePath",) if params.get("referencePath") else ())):
        error = _check_file(request_id, params, key)
        if error:
            return error
    try:
        audio, sr = analysis.load_audio(params["path"], float(params.get("startTime", 0)),
                                        params.get("endTime"))
        if audio.shape[1] < int(0.4 * sr):
            return _err(request_id, -32000, "Audio too short: need at least 0.4 s")
        ref = None
        if params.get("referencePath"):
            ref = analysis.load_audio(params["referencePath"], float(params.get("referenceStartTime", 0)),
                                      params.get("referenceEndTime"))
        section = params.get("sectionSeconds")
        result = analysis.analyze(audio, sr, float(section) if section else None, ref)
        result["sampleRate"] = sr
        result["channels"] = int(audio.shape[0])
        return _ok(request_id, result)
    except Exception as exc:  # noqa: BLE001
        return _err(request_id, -32000, f"Analysis failed: {exc}")


def handle_align(request_id: Any, params: dict) -> str:
    """
    Delay and polarity of `path` relative to `referencePath` (same length and
    sample rate, e.g. two renders of the same time range).

    params: referencePath, path, maxLagMs? (default 20)
    """
    import analysis

    for key in ("referencePath", "path"):
        error = _check_file(request_id, params, key)
        if error:
            return error
    try:
        ref, ref_sr = analysis.load_audio(params["referencePath"])
        target, sr = analysis.load_audio(params["path"])
        if ref_sr != sr:
            return _err(request_id, -32000, f"Sample rates differ: {ref_sr} vs {sr}")
        return _ok(request_id, analysis.alignment(ref, target, sr, float(params.get("maxLagMs", 20))))
    except Exception as exc:  # noqa: BLE001
        return _err(request_id, -32000, f"Alignment failed: {exc}")


def handle_transients(request_id: Any, params: dict) -> str:
    """
    Transient (onset) times of a file with strength, dominant band and tempo.

    params: path, startTime?, endTime?, band? (full|low|mid|high), sensitivity? (0..1),
            minGapMs? (default 50)
    """
    import analysis

    error = _check_file(request_id, params, "path")
    if error:
        return error
    try:
        start = float(params.get("startTime", 0))
        audio, sr = analysis.load_audio(params["path"], start, params.get("endTime"))
        if audio.shape[1] < int(0.1 * sr):
            return _err(request_id, -32000, "Audio too short: need at least 0.1 s")
        result = analysis.transients(audio, sr, str(params.get("band", "full")),
                                     float(params.get("sensitivity", 0.5)), float(params.get("minGapMs", 50)))
        if start:
            for item in result["transients"]:
                item["time"] = round(item["time"] + start, 4)
        result["sampleRate"] = sr
        return _ok(request_id, result)
    except ValueError as exc:
        return _err(request_id, -32602, str(exc))
    except Exception as exc:  # noqa: BLE001
        return _err(request_id, -32000, f"Transient detection failed: {exc}")


def _load_window(request_id: Any, params: dict, min_seconds: float) -> tuple[Any, int, float] | str:
    """Read params.path over [startTime, endTime), or an error response."""
    import analysis

    error = _check_file(request_id, params, "path")
    if error:
        return error
    start = float(params.get("startTime", 0))
    audio, sr = analysis.load_audio(params["path"], start, params.get("endTime"))
    if audio.shape[1] < int(min_seconds * sr):
        return _err(request_id, -32000, f"Audio too short: need at least {min_seconds:g} s")
    return audio, sr, start


def _shift(span: dict | None, offset: float) -> None:
    if span and offset:
        for key in ("start", "end"):
            if key in span:
                span[key] = round(span[key] + offset, 1)


def handle_loudness_curve(request_id: Any, params: dict) -> str:
    """
    Short-term and momentary loudness over time (bucketed), loudest/quietest
    windows and spans over a target. Times are in the file's own seconds plus
    startTime.

    params: path, startTime?, endTime?, targetLufs?, toleranceLu? (default 1)
    """
    import mixcheck

    try:
        loaded = _load_window(request_id, params, 0.4)
        if isinstance(loaded, str):
            return loaded
        audio, sr, start = loaded
        target = params.get("targetLufs")
        result = mixcheck.loudness_curve(audio, sr, None if target is None else float(target),
                                         float(params.get("toleranceLu", 1.0)))
        for key in ("loudest", "quietest"):
            _shift(result.get(key), start)
        for span in result.get("overTarget", []):
            _shift(span, start)
        result["startTime"] = start
        return _ok(request_id, result)
    except Exception as exc:  # noqa: BLE001
        return _err(request_id, -32000, f"Loudness curve failed: {exc}")


def handle_stereo_bands(request_id: Any, params: dict) -> str:
    """
    Stereo correlation, width and phase problems per frequency band.

    params: path, startTime?, endTime?
    """
    import mixcheck

    try:
        loaded = _load_window(request_id, params, 0.5)
        if isinstance(loaded, str):
            return loaded
        audio, sr, start = loaded
        result = mixcheck.band_correlation(audio, sr)
        result["startTime"] = start
        return _ok(request_id, result)
    except ValueError as exc:
        return _err(request_id, -32602, str(exc))
    except Exception as exc:  # noqa: BLE001
        return _err(request_id, -32000, f"Stereo band analysis failed: {exc}")


def handle_masking(request_id: Any, params: dict) -> str:
    """
    Where 2-8 tracks (renders of the same time range) compete for the same
    third-octave bands, with which one to cut.

    params: tracks: [{name, path}]
    """
    import analysis
    import mixcheck

    tracks = params.get("tracks")
    if not isinstance(tracks, list) or not 2 <= len(tracks) <= 8:
        return _err(request_id, -32602, "tracks must list 2 to 8 {name, path}")
    loaded = []
    rate = None
    try:
        for t in tracks:
            error = _check_file(request_id, t, "path")
            if error:
                return error
            audio, sr = analysis.load_audio(t["path"])
            if rate is not None and sr != rate:
                return _err(request_id, -32000, f"Sample rates differ: {rate} vs {sr}")
            rate = sr
            loaded.append((str(t.get("name") or os.path.basename(t["path"])), audio))
        return _ok(request_id, mixcheck.masking(loaded, rate))
    except ValueError as exc:
        return _err(request_id, -32602, str(exc))
    except Exception as exc:  # noqa: BLE001
        return _err(request_id, -32000, f"Masking analysis failed: {exc}")


def handle_separate(request_id: Any, params: dict) -> str:
    """
    Split a file into stems with Demucs (opt-in install), written as WAVs to outDir.

    params: path, outDir, model? (htdemucs|htdemucs_6s), stems? [names], startTime?, endTime?, maxSeconds?
    """
    import separation

    error = _check_file(request_id, params, "path")
    if error:
        return error
    if not params.get("outDir"):
        return _err(request_id, -32602, "Missing required param: outDir")
    try:
        return _ok(request_id, separation.separate(
            params["path"], params["outDir"], str(params.get("model", "htdemucs")), params.get("stems"),
            float(params.get("startTime", 0)), params.get("endTime"), params.get("maxSeconds")))
    except ValueError as exc:
        return _err(request_id, -32602, str(exc))
    except RuntimeError as exc:
        return _err(request_id, -32000, str(exc))
    except Exception as exc:  # noqa: BLE001
        return _err(request_id, -32000, f"Separation failed: {exc}")


# JSON-RPC method names must stay in sync with the TypeScript client.
# When adding a method here, also reference it from apps/reaper-mcp-server/src/sidecar.ts.
METHODS = {
    "analyze": handle_analyze,
    "analyze_audio": handle_analyze_audio,
    "align": handle_align,
    "transients": handle_transients,
    "loudness_curve": handle_loudness_curve,
    "stereo_bands": handle_stereo_bands,
    "masking": handle_masking,
    "separate": handle_separate,
}


def dispatch(raw: str) -> str:
    """Parse a JSON-RPC request string and dispatch to the appropriate method."""
    request_id = None
    try:
        req = json.loads(raw)
        request_id = req.get("id")
        method = req.get("method")
        params = req.get("params", {})

        if method not in METHODS:
            return _err(request_id, -32601, f"Method not found: {method}")

        return METHODS[method](request_id, params)

    except json.JSONDecodeError as exc:
        return _err(request_id, -32700, f"Parse error: {exc}")
    except Exception as exc:  # noqa: BLE001
        return _err(request_id, -32603, f"Internal error: {exc}")


# ---------------------------------------------------------------------------
# Main loop
# ---------------------------------------------------------------------------

def main() -> None:
    # Disable output buffering so responses are delivered immediately
    sys.stdout = os.fdopen(sys.stdout.fileno(), "w", buffering=1)

    # Log startup to stderr (visible in MCP server logs)
    print(f"[reaper-mcp-sidecar] Starting — Python {sys.version}", file=sys.stderr, flush=True)

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue

        response = dispatch(line)
        print(response, flush=True)

    print("[reaper-mcp-sidecar] stdin closed, exiting", file=sys.stderr, flush=True)


if __name__ == "__main__":
    main()
