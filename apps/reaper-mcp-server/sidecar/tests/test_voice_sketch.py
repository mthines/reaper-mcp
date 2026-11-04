"""Synthetic sources with known pitches/timing, independent of the detector."""
import json
import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from voice_sketch import transcribe
from server import dispatch

SR = 22050


def tone(pitch, seconds):
    t = np.arange(int(seconds * SR)) / SR
    f = 440 * 2 ** ((pitch - 69) / 12)
    # Strong second harmonic catches octave mistakes on a voice-like signal.
    return (0.24 * np.sin(2 * np.pi * f * t) + 0.3 * np.sin(4 * np.pi * f * t)).astype(np.float32)


def test_hummed_phrase_keeps_pitch_order_repeated_notes_and_silences():
    audio = np.zeros((1, SR * 5), dtype=np.float32)
    for start, pitch in [(0.23, 57), (0.97, 60), (1.72, 64), (2.48, 64), (3.98, 59)]:
        sound = tone(pitch, 0.4)
        audio[0, int(start * SR):int(start * SR) + len(sound)] = sound
    result = transcribe(audio, SR, mode="melody", bpm=120)
    assert [n["pitch"] for n in result["melody"]] == [57, 60, 64, 64, 59]
    assert result["drums"] == []
    beats = [n["beat"] for n in result["melody"]]
    assert beats == pytest.approx([0, 1.5, 3, 4.5, 7.5], abs=0.25)
    assert all(a["beat"] + a["lengthBeats"] <= b["beat"] for a, b in zip(result["melody"], result["melody"][1:]))
    coarse = transcribe(audio, SR, mode="melody", bpm=60, grid=1)
    # Key evidence belongs to the voice, not to notes discarded by a coarse grid.
    assert coarse["chroma"] == pytest.approx(result["chroma"])


def percussion(times, length=18):
    audio = np.zeros((1, SR * length), dtype=np.float32)
    rng = np.random.default_rng(17)
    for i, start in enumerate(times):
        t = np.arange(int(0.08 * SR)) / SR
        # Low-frequency kicks alternate with mid-band noise snares. Unfiltered
        # white noise is high-frequency dominated and represents a hat instead.
        noise = np.convolve(rng.normal(0, 0.3, len(t)), np.ones(5) / 5, mode="same")
        sound = (np.sin(2 * np.pi * 75 * t) if i % 2 == 0 else noise) * np.exp(-t * 55)
        pos = int(start * SR)
        audio[0, pos:pos + len(t)] += sound
    return audio


def test_stable_tempo_streamlines_jitter_without_inventing_a_melody():
    times = [0.3 + i * 0.5 + (0.012 if i % 3 == 0 else -0.009) for i in range(32)]
    result = transcribe(percussion(times), SR, mode="drums")
    assert result["tempo"]["bpm"] == pytest.approx(120, abs=2)
    assert len(result["tempo"]["segments"]) == 1
    assert result["melody"] == []
    assert {n["pitch"] for n in result["drums"]} >= {36, 38}
    assert len(result["drums"]) == pytest.approx(32, abs=2)
    assert all(n["beat"] * 4 == round(n["beat"] * 4) for n in result["drums"])


def test_sustained_large_tempo_change_is_kept_but_manual_bpm_stays_fixed():
    times = list(np.arange(0.3, 8.3, 0.6)) + list(np.arange(8.3, 24.3, 0.4))
    audio = percussion(times, length=25)
    result = transcribe(audio, SR, mode="drums")
    bpms = [s["bpm"] for s in result["tempo"]["segments"]]
    assert len(bpms) >= 2
    assert any(abs(b - 100) < 4 for b in bpms)
    assert any(abs(b - 150) < 4 for b in bpms)
    fixed = transcribe(audio, SR, mode="drums", bpm=110)
    assert [s["bpm"] for s in fixed["tempo"]["segments"]] == [110]


def test_silence_and_unreliable_tempo_do_not_make_up_music():
    with pytest.raises(ValueError, match="No audible content"):
        transcribe(np.zeros((1, SR)), SR, bpm=120)
    with pytest.raises(ValueError, match="Supply bpm"):
        transcribe(tone(60, 1)[None, :], SR, mode="melody")
    result = transcribe(tone(60, 1)[None, :], SR, bpm=100)
    assert [n["pitch"] for n in result["melody"]] == [60]
    assert result["drums"] == []


def test_mixed_voice_keeps_a_pitched_layer_and_overlapping_percussion():
    audio = percussion(np.arange(0.2, 6.2, 0.5), length=7)
    for start, pitch in [(0.6, 57), (2.6, 62), (4.6, 60)]:
        sound = tone(pitch, 1.2)
        pos = int(start * SR)
        audio[0, pos:pos + len(sound)] += sound
    result = transcribe(audio, SR, bpm=120)
    assert {n["pitch"] for n in result["melody"]} >= {57, 60, 62}
    assert len(result["drums"]) >= 6
    assert any(m["time"] <= d["time"] < m["time"] + m["duration"]
               for m in result["melody"] for d in result["drums"])


def test_percussion_attacks_do_not_rearticulate_a_held_hummed_note():
    audio = np.zeros((1, SR * 3), dtype=np.float32)
    sound = tone(60, 2.6)
    audio[0, int(0.2 * SR):int(0.2 * SR) + len(sound)] = sound
    burst_times = [0.7, 1.2, 1.7, 2.2]
    t = np.arange(int(0.04 * SR)) / SR
    burst = 0.65 * np.sin(2 * np.pi * 6000 * t) * np.exp(-t * 60)
    for start in burst_times:
        pos = int(start * SR)
        audio[0, pos:pos + len(burst)] += burst
    result = transcribe(audio, SR, bpm=120)
    assert [n["pitch"] for n in result["melody"]] == [60]
    assert result["melody"][0]["duration"] == pytest.approx(2.6, abs=0.1)
    assert [n["time"] for n in result["drums"]] == pytest.approx(burst_times, abs=0.05)


def test_rpc_validates_range_before_reading_and_reports_file_times(tmp_path):
    import soundfile as sf
    path = tmp_path / "sketch.wav"
    sf.write(path, np.r_[np.zeros(SR), tone(62, 1), np.zeros(SR)], SR)
    request = {"jsonrpc": "2.0", "id": 7, "method": "transcribe_voice_sketch",
               "params": {"path": str(path), "startTime": 1, "endTime": 2, "bpm": 100, "mode": "melody"}}
    result = json.loads(dispatch(json.dumps(request)))
    assert result["result"]["startTime"] == 1
    assert result["result"]["melody"][0]["time"] >= 1
    assert result["result"]["melody"][0]["pitch"] == 62
    request["params"]["endTime"] = 200
    assert "120" in json.loads(dispatch(json.dumps(request)))["error"]["message"]
