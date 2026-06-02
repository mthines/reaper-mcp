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

def _ok(request_id: Any, result: dict) -> str:
    return json.dumps({"jsonrpc": "2.0", "id": request_id, "result": result})


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
        results = _predictor.forward([{
            "path": path,
            "start_time": start_time,
            "end_time": end_time,
        }])
        # audiobox-aesthetics returns a list of dicts with keys CE, CU, PC, PQ
        scores = results[0]
        return _ok(request_id, {
            "CE": float(scores.get("CE", 0)),
            "CU": float(scores.get("CU", 0)),
            "PC": float(scores.get("PC", 0)),
            "PQ": float(scores.get("PQ", 0)),
            "durationSeconds": clip_duration,
            "modelVersion": MODEL_ID,
        })
    except Exception as exc:  # noqa: BLE001
        return _err(request_id, -32000, f"Inference failed: {exc}")


# JSON-RPC method names must stay in sync with the TypeScript client.
# When adding a method here, also reference it from apps/reaper-mcp-server/src/sidecar.ts.
METHODS = {
    "analyze": handle_analyze,
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
