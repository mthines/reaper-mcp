"""
Tests for sidecar/chords.py and the server's chords methods, with a fake lv_chordia
(the real model is not installed in CI).

Run with the sidecar venv:
    ~/.reaper-mcp/sidecar-venv/bin/python -m pytest apps/reaper-mcp-server/sidecar/tests/test_chords.py -q
"""

from __future__ import annotations

import json
import sys
import types
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

import chords  # noqa: E402
import server  # noqa: E402

SR = 22050


@pytest.fixture
def wav(tmp_path):
    import soundfile as sf

    path = tmp_path / "song.wav"
    t = np.arange(SR * 8) / SR
    sf.write(path, (0.2 * np.sin(2 * np.pi * 220 * t)).astype(np.float32), SR)
    return str(path)


@pytest.fixture
def fake_model(monkeypatch):
    """A fake lv_chordia that labels every 2 s of whatever file it gets, and records the call."""
    calls = []

    def chord_recognition(audio_path, chord_dict_name="submission"):
        import soundfile as sf

        seconds = sf.info(audio_path).duration
        calls.append({"path": audio_path, "vocab": chord_dict_name, "seconds": round(seconds, 2)})
        labels = ["A:min", "F:maj", "C:maj/3", "N"]
        out, t, i = [], 0.0, 0
        while t < seconds - 1e-6:
            out.append({"start_time": t, "end_time": min(t + 2, seconds), "chord": labels[i % 4]})
            t, i = t + 2, i + 1
        return out

    package = types.ModuleType("lv_chordia")
    module = types.ModuleType("lv_chordia.chord_recognition")
    module.chord_recognition = chord_recognition
    package.chord_recognition = module
    monkeypatch.setitem(sys.modules, "lv_chordia", package)
    monkeypatch.setitem(sys.modules, "lv_chordia.chord_recognition", module)
    monkeypatch.setattr(chords, "is_installed", lambda: True)
    return calls


def call(method, **params):
    return json.loads(server.dispatch(json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params})))


def test_returns_the_models_segments_in_file_seconds(wav, fake_model):
    result = call("chords", path=wav)["result"]
    assert [s["label"] for s in result["segments"]] == ["A:min", "F:maj", "C:maj/3", "N"]
    assert result["segments"][1] == {"start": 2.0, "end": 4.0, "label": "F:maj"}
    assert result["durationSeconds"] == pytest.approx(8.0)
    assert fake_model[0]["vocab"] == "submission"


def test_a_range_is_cut_out_and_its_times_stay_in_file_seconds(wav, fake_model):
    result = call("chords", path=wav, startTime=3, endTime=7, vocabulary="ismir2017")["result"]
    assert fake_model[0]["seconds"] == pytest.approx(4.0)
    assert fake_model[0]["path"] != wav
    assert not Path(fake_model[0]["path"]).exists()
    assert result["segments"][0]["start"] == pytest.approx(3.0)
    assert result["segments"][-1]["end"] == pytest.approx(7.0)
    assert result["vocabulary"] == "ismir2017"


def test_refuses_an_unknown_vocabulary_and_a_missing_file(wav, fake_model):
    assert call("chords", path=wav, vocabulary="jazz")["error"]["code"] == -32602
    assert "not found" in call("chords", path="/nope/missing.wav")["error"]["message"]
    assert fake_model == []


def test_without_the_model_says_how_to_install_it(wav, monkeypatch):
    monkeypatch.setattr(chords, "is_installed", lambda: False)
    error = call("chords", path=wav)["error"]
    assert "--with-chords" in error["message"]
    status = call("chords_status")["result"]
    assert status["installed"] is False and "--with-chords" in status["message"]
