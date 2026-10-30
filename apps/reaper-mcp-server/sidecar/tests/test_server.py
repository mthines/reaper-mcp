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

    with patch("server._get_audio_duration", return_value=5.0), \
         patch("server._load_clip", return_value=("WAV", 44100)):

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

    with patch("server._get_audio_duration", return_value=30.0), \
         patch("server._load_clip", return_value=("WAV", 44100)) as load_clip:

        raw = server.dispatch(json.dumps({
            "jsonrpc": "2.0",
            "id": 5,
            "method": "analyze",
            "params": {"path": str(wav), "startTime": 10.0, "endTime": 15.0},
        }))

    resp = parse_response(raw)
    assert "result" in resp

    # The clip is decoded here and handed to the predictor as a tensor
    load_clip.assert_called_once_with(str(wav), 10.0, 15.0)
    call_args = mock_pred.forward.call_args[0][0]
    assert call_args[0] == {"path": "WAV", "sample_rate": 44100}
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


# ---------------------------------------------------------------------------
# _load_clip decodes the requested slice without torchaudio
# ---------------------------------------------------------------------------

def test_load_clip_slices_stereo_wav(tmp_path):
    import numpy as np
    import numpy as np
    import soundfile as sf

    wav = tmp_path / "stereo.wav"
    sf.write(str(wav), np.zeros((44100 * 3, 2), dtype="float32"), 44100)

    clip, sample_rate = server._load_clip(str(wav), 1.0, 2.5)

    assert sample_rate == 44100
    assert tuple(clip.shape) == (2, int(44100 * 1.5))


# ---------------------------------------------------------------------------
# normalizeLufs: the clip reaches the model at the target loudness
# ---------------------------------------------------------------------------

def _write_sine(path, dbfs: float, seconds: float = 3.0, sr: int = 44100, delay: int = 0, sign: float = 1.0):
    import numpy as np
    import numpy as np
    import soundfile as sf

    t = np.arange(int(seconds * sr)) / sr
    rng = np.random.default_rng(11)
    wave = 10 ** (dbfs / 20) * (np.sin(2 * np.pi * 1000 * t) + 0.3 * rng.standard_normal(t.size))
    wave = np.concatenate([np.zeros(delay), wave])[: t.size] * sign
    sf.write(str(path), np.stack([wave, wave], axis=1).astype("float32"), sr)


def test_analyze_normalize_scales_clip_before_scoring(tmp_path):
    import analysis

    wav = tmp_path / "quiet.wav"
    _write_sine(wav, -30)
    mock_pred = make_mock_predictor()
    server._predictor = mock_pred

    raw = server.dispatch(json.dumps({
        "jsonrpc": "2.0", "id": 6, "method": "analyze",
        "params": {"path": str(wav), "normalizeLufs": -18},
    }))

    result = parse_response(raw)["result"]
    scored = mock_pred.forward.call_args[0][0][0]["path"].numpy()
    assert abs(analysis.integrated_loudness(scored, 44100) - (-18.0)) < 0.2
    assert result["normalizeLufs"] == -18.0
    assert abs(result["gainDb"] - (-18.0 - result["inputLufs"])) < 0.01


def test_analyze_without_normalize_keeps_level(tmp_path):
    wav = tmp_path / "quiet.wav"
    _write_sine(wav, -30)
    mock_pred = make_mock_predictor()
    server._predictor = mock_pred

    result = parse_response(server.dispatch(json.dumps({
        "jsonrpc": "2.0", "id": 7, "method": "analyze", "params": {"path": str(wav)},
    })))["result"]

    assert result["gainDb"] == 0.0 and result["inputLufs"] is None


# ---------------------------------------------------------------------------
# analyze_audio / align run end to end on real files, without the model
# ---------------------------------------------------------------------------

def test_analyze_audio_with_reference(tmp_path):
    mix, ref = tmp_path / "mix.wav", tmp_path / "ref.wav"
    _write_sine(mix, -14, seconds=6)
    _write_sine(ref, -20, seconds=6)

    resp = parse_response(server.dispatch(json.dumps({
        "jsonrpc": "2.0", "id": 8, "method": "analyze_audio",
        "params": {"path": str(mix), "referencePath": str(ref), "sectionSeconds": 3},
    })))

    result = resp["result"]
    assert result["loudness"]["integratedLufs"] > -20
    assert len(result["loudness"]["sections"]) == 2
    assert abs(result["reference"]["loudnessDeltaLu"] - 6.0) < 0.5
    assert server._predictor is None  # no model load for offline analysis


def test_analyze_audio_missing_reference_is_an_error(tmp_path):
    mix = tmp_path / "mix.wav"
    _write_sine(mix, -14)
    resp = parse_response(server.dispatch(json.dumps({
        "jsonrpc": "2.0", "id": 9, "method": "analyze_audio",
        "params": {"path": str(mix), "referencePath": "/nope/ref.wav"},
    })))
    assert "not found" in resp["error"]["message"]


def test_align_method_reports_delay_and_polarity(tmp_path):
    ref, late = tmp_path / "ref.wav", tmp_path / "late.wav"
    _write_sine(ref, -12)
    _write_sine(late, -12, delay=37, sign=-1.0)

    result = parse_response(server.dispatch(json.dumps({
        "jsonrpc": "2.0", "id": 10, "method": "align",
        "params": {"referencePath": str(ref), "path": str(late), "maxLagMs": 5},
    })))["result"]

    assert result["delaySamples"] == 37
    assert result["polarityInverted"] is True


def test_transients_method_reports_onsets_in_file_time(tmp_path):
    import numpy as np
    import soundfile as sf

    sr = 44100
    x = np.zeros(sr * 4, dtype=np.float32)
    for t in (1.0, 2.0, 3.0):
        n = int(0.05 * sr)
        x[int(t * sr):int(t * sr) + n] = 0.5 * np.exp(-np.arange(n) / sr * 80) * np.sign(np.sin(np.arange(n) * 0.3))
    path = tmp_path / "clicks.wav"
    sf.write(str(path), x, sr)

    result = parse_response(server.dispatch(json.dumps({
        "jsonrpc": "2.0", "id": 11, "method": "transients",
        "params": {"path": str(path), "startTime": 1.5},
    })))["result"]

    times = [t["time"] for t in result["transients"]]
    assert len(times) == 2
    assert abs(times[0] - 2.0) < 0.005 and abs(times[1] - 3.0) < 0.005


def test_transients_method_refuses_an_unknown_band(tmp_path):
    path = tmp_path / "tone.wav"
    _write_sine(path, -12)
    resp = parse_response(server.dispatch(json.dumps({
        "jsonrpc": "2.0", "id": 12, "method": "transients",
        "params": {"path": str(path), "band": "treble"},
    })))
    assert "band must be one of" in resp["error"]["message"]


def _call(method: str, params: dict) -> dict:
    return parse_response(server.dispatch(json.dumps({"jsonrpc": "2.0", "id": 20, "method": method, "params": params})))


def test_loudness_curve_method_reports_windows_in_project_time(tmp_path):
    import numpy as np
    import soundfile as sf

    sr = 44100
    t = np.arange(sr * 12) / sr
    level = np.where(t < 6, 10 ** (-30 / 20), 10 ** (-12 / 20))
    x = (level * np.sin(2 * np.pi * 1000 * t)).astype("float32")
    path = tmp_path / "song.wav"
    sf.write(str(path), np.stack([x, x], axis=1), sr)

    result = _call("loudness_curve", {"path": str(path), "startTime": 2, "targetLufs": -14})["result"]
    assert result["loudest"]["start"] >= 6 + 0, "after the step, shifted by startTime"
    assert result["overTarget"] and result["overTarget"][0]["start"] >= 5
    assert result["startTime"] == 2


def test_stereo_bands_method_refuses_a_mono_file(tmp_path):
    import numpy as np
    import soundfile as sf

    path = tmp_path / "mono.wav"
    sf.write(str(path), (0.1 * np.random.default_rng(1).standard_normal(44100)).astype("float32"), 44100)
    resp = _call("stereo_bands", {"path": str(path)})
    assert "stereo" in resp["error"]["message"]


def test_masking_method_needs_two_to_eight_tracks_and_reports_conflicts(tmp_path):
    a, b = tmp_path / "a.wav", tmp_path / "b.wav"
    _write_sine(a, -12)
    _write_sine(b, -13)
    result = _call("masking", {"tracks": [{"name": "Gtr", "path": str(a)}, {"name": "Keys", "path": str(b)}]})["result"]
    assert result["tracks"] == ["Gtr", "Keys"]
    assert any(c["hz"] == 1000 for c in result["conflicts"])

    assert "2 to 8" in _call("masking", {"tracks": [{"name": "Gtr", "path": str(a)}]})["error"]["message"]
    missing = _call("masking", {"tracks": [{"name": "Gtr", "path": str(a)}, {"name": "X", "path": str(tmp_path / "nope.wav")}]})
    assert "not found" in missing["error"]["message"]


def test_separate_method_refuses_an_unknown_stem_before_loading_anything(tmp_path):
    path = tmp_path / "mix.wav"
    _write_sine(path, -12)
    resp = _call("separate", {"path": str(path), "outDir": str(tmp_path / "out"), "stems": ["kazoo"]})
    assert "has no stem kazoo" in resp["error"]["message"]
    assert not (tmp_path / "out").exists()


def test_separate_method_says_how_to_install_when_demucs_is_missing(tmp_path, monkeypatch):
    import separation

    monkeypatch.setattr(separation, "is_installed", lambda: False)
    path = tmp_path / "mix.wav"
    _write_sine(path, -12)
    resp = _call("separate", {"path": str(path), "outDir": str(tmp_path / "out")})
    assert "setup-sidecar --with-separation" in resp["error"]["message"]
