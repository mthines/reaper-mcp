"""
pytest unit tests for the Python sidecar server.

Strategy: mock audiobox_aesthetics.infer.initialize_predictor and
soundfile.info so tests run without the actual model or audio files.

Run:
    pytest apps/reaper-mcp-server/sidecar/tests/test_server.py -v

Or with the venv installed by setup-sidecar:
    ~/.reaper-mcp/sidecar-venv/bin/python -m pytest ...
"""

from __future__ import annotations

import json
import sys
import os
from pathlib import Path
from unittest.mock import MagicMock, patch, PropertyMock

# Add the sidecar directory to sys.path so we can import server directly
sys.path.insert(0, str(Path(__file__).parent.parent))

import server  # noqa: E402  (must come after sys.path manipulation)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def parse_response(raw: str) -> dict:
    return json.loads(raw)


def make_mock_predictor(scores: dict | None = None) -> MagicMock:
    """Return a mock predictor whose .forward() returns a one-element list."""
    scores = scores or {"CE": 5.15, "CU": 5.78, "PC": 2.15, "PQ": 7.22}
    mock = MagicMock()
    mock.forward.return_value = [scores]
    return mock


def make_sf_info(duration: float = 5.0) -> MagicMock:
    """Return a mock soundfile.info result."""
    info = MagicMock()
    info.duration = duration
    return info


# ---------------------------------------------------------------------------
# Reset predictor state between tests
# ---------------------------------------------------------------------------

def setup_function():
    """Reset the global predictor cache before each test."""
    server._predictor = None
    server._predictor_error = None


# ---------------------------------------------------------------------------
# Test 1: Valid WAV input returns 4 float scores with correct JSON-RPC shape
# ---------------------------------------------------------------------------

def test_analyze_success(tmp_path):
    wav = tmp_path / "test.wav"
    wav.write_bytes(b"")  # file must exist; duration is mocked

    mock_pred = make_mock_predictor()
    # Pre-populate the predictor cache so server._get_predictor() returns the
    # mock without ever importing audiobox_aesthetics (avoids requiring the
    # package to be installed for unit tests).
    server._predictor = mock_pred

    with patch("server._get_audio_duration", return_value=5.0):

        raw = server.dispatch(json.dumps({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "analyze",
            "params": {"path": str(wav), "startTime": 0, "endTime": 5.0},
        }))

    resp = parse_response(raw)
    assert resp["jsonrpc"] == "2.0"
    assert resp["id"] == 1
    assert "result" in resp
    assert "error" not in resp

    result = resp["result"]
    assert isinstance(result["CE"], float)
    assert isinstance(result["CU"], float)
    assert isinstance(result["PC"], float)
    assert isinstance(result["PQ"], float)
    assert result["modelVersion"] == "facebook/audiobox-aesthetics"
    assert result["durationSeconds"] == 5.0


# ---------------------------------------------------------------------------
# Test 2: initialize_predictor ImportError → JSON-RPC error
# ---------------------------------------------------------------------------

def test_model_not_found_import_error(tmp_path):
    wav = tmp_path / "test.wav"
    wav.write_bytes(b"")

    with patch("server._get_audio_duration", return_value=5.0), \
         patch.dict("sys.modules", {"audiobox_aesthetics": None, "audiobox_aesthetics.infer": None}):

        # Force the import inside _ensure_predictor to fail by patching the module
        import builtins
        real_import = builtins.__import__

        def mock_import(name, *args, **kwargs):
            if "audiobox_aesthetics" in name:
                raise ImportError("No module named 'audiobox_aesthetics'")
            return real_import(name, *args, **kwargs)

        with patch("builtins.__import__", side_effect=mock_import):
            raw = server.dispatch(json.dumps({
                "jsonrpc": "2.0",
                "id": 2,
                "method": "analyze",
                "params": {"path": str(wav)},
            }))

    resp = parse_response(raw)
    assert "error" in resp
    assert "audiobox-aesthetics" in resp["error"]["message"].lower() or \
           "not installed" in resp["error"]["message"].lower() or \
           "No module named" in resp["error"]["message"]


# ---------------------------------------------------------------------------
# Test 3: Audio file not found → JSON-RPC error response
# ---------------------------------------------------------------------------

def test_audio_file_not_found():
    raw = server.dispatch(json.dumps({
        "jsonrpc": "2.0",
        "id": 3,
        "method": "analyze",
        "params": {"path": "/nonexistent/definitely/not/there.wav"},
    }))

    resp = parse_response(raw)
    assert "error" in resp
    assert "not found" in resp["error"]["message"].lower()


# ---------------------------------------------------------------------------
# Test 4: Audio too short (<0.5s) → JSON-RPC error with duration in message
# ---------------------------------------------------------------------------

def test_audio_too_short(tmp_path):
    wav = tmp_path / "short.wav"
    wav.write_bytes(b"")

    with patch("server._get_audio_duration", return_value=0.3):
        raw = server.dispatch(json.dumps({
            "jsonrpc": "2.0",
            "id": 4,
            "method": "analyze",
            "params": {"path": str(wav), "startTime": 0, "endTime": 0.3},
        }))

    resp = parse_response(raw)
    assert "error" in resp
    msg = resp["error"]["message"]
    assert "0.30" in msg or "0.3" in msg
    assert "short" in msg.lower() or "minimum" in msg.lower()


# ---------------------------------------------------------------------------
# Test 5: start_time/end_time passed through to predictor
# ---------------------------------------------------------------------------

def test_start_end_time_passthrough(tmp_path):
    wav = tmp_path / "long.wav"
    wav.write_bytes(b"")

    mock_pred = make_mock_predictor()
    server._predictor = mock_pred  # bypass import; see test_analyze_success

    with patch("server._get_audio_duration", return_value=30.0):

        raw = server.dispatch(json.dumps({
            "jsonrpc": "2.0",
            "id": 5,
            "method": "analyze",
            "params": {"path": str(wav), "startTime": 10.0, "endTime": 15.0},
        }))

    resp = parse_response(raw)
    assert "result" in resp

    # Verify predictor was called with the correct time bounds
    call_args = mock_pred.forward.call_args[0][0]
    assert call_args[0]["start_time"] == 10.0
    assert call_args[0]["end_time"] == 15.0
    result = resp["result"]
    assert result["durationSeconds"] == 5.0  # 15.0 - 10.0


# ---------------------------------------------------------------------------
# Test 6: Unknown method → -32601 error
# ---------------------------------------------------------------------------

def test_unknown_method():
    raw = server.dispatch(json.dumps({
        "jsonrpc": "2.0",
        "id": 6,
        "method": "nonexistent",
        "params": {},
    }))

    resp = parse_response(raw)
    assert "error" in resp
    assert resp["error"]["code"] == -32601


# ---------------------------------------------------------------------------
# Test 7: Malformed JSON → -32700 parse error
# ---------------------------------------------------------------------------

def test_parse_error():
    raw = server.dispatch("{not valid json")
    resp = parse_response(raw)
    assert "error" in resp
    assert resp["error"]["code"] == -32700


# ---------------------------------------------------------------------------
# Test 8: Missing required path param
# ---------------------------------------------------------------------------

def test_missing_path_param():
    raw = server.dispatch(json.dumps({
        "jsonrpc": "2.0",
        "id": 8,
        "method": "analyze",
        "params": {},
    }))

    resp = parse_response(raw)
    assert "error" in resp
    assert "path" in resp["error"]["message"].lower()
