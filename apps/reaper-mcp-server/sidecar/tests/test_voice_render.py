"""Public validation and opt-in native SoundFont rendering checks."""

from __future__ import annotations

import ctypes.util
import os
import sys
from pathlib import Path

import numpy as np
import pytest
import soundfile as sf

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def request(tmp_path, **overrides):
    font = tmp_path / "fixture.sf2"
    if not font.exists():
        font.write_bytes(b"validation only, not a SoundFont")
    return {
        "soundfontPath": str(font),
        "outDir": str(tmp_path / "render"),
        "durationSeconds": 2,
        "tracks": [{
            "name": "melody", "channel": 0, "program": 0, "gain": 0.8,
            "notes": [{"time": 0, "duration": 0.5, "pitch": 60, "velocity": 100}],
        }],
        **overrides,
    }


@pytest.mark.parametrize("params", [None, [], "render", 42, {}])
def test_refuses_a_malformed_request_without_creating_output(tmp_path, params):
    from voice_render import render

    with pytest.raises(ValueError):
        render(params)
    assert list(tmp_path.iterdir()) == []


@pytest.mark.parametrize("field,value", [
    ("durationSeconds", 0), ("durationSeconds", 241),
    ("durationSeconds", float("nan")), ("durationSeconds", float("inf")),
    ("durationSeconds", True), ("durationSeconds", "2"),
    ("tracks", []), ("tracks", {}), ("tracks", [None]),
    ("name", "../escape"), ("name", "/absolute"), ("name", "mix"),
    ("name", "Melody"), ("name", "bad\\path"), ("name", ""),
    ("channel", -1), ("channel", 16), ("channel", True), ("channel", 0.5),
    ("program", -1), ("program", 128), ("program", "0"),
    ("gain", -0.1), ("gain", 1.1), ("gain", float("nan")),
    ("notes", None), ("notes", [None]),
    ("time", -1), ("time", float("inf")), ("time", 2),
    ("duration", 0), ("duration", -1), ("duration", 2.1),
    ("duration", float("nan")),
    ("pitch", -1), ("pitch", 128), ("pitch", 60.5),
    ("velocity", 0), ("velocity", 128), ("velocity", True),
])
def test_refuses_invalid_score_fields_before_writing(tmp_path, field, value):
    from voice_render import render

    params = request(tmp_path)
    target = params
    if field in {"name", "channel", "program", "gain", "notes"}:
        target = params["tracks"][0]
    if field in {"time", "duration", "pitch", "velocity"}:
        target = params["tracks"][0]["notes"][0]
    target[field] = value
    with pytest.raises(ValueError, match=field):
        render(params)
    assert not (tmp_path / "render").exists()
    assert sorted(p.name for p in tmp_path.iterdir()) == ["fixture.sf2"]


@pytest.mark.parametrize("case", ["font-relative", "font-missing", "font-directory", "font-extension",
                                  "out-relative", "out-parent", "out-traversal", "out-existing", "out-symlink",
                                  "font-nul", "out-nul"])
def test_refuses_unsafe_paths_and_preserves_existing_files(tmp_path, case):
    from voice_render import render

    params = request(tmp_path)
    sentinel = tmp_path / "keep.txt"
    sentinel.write_text("user data")
    if case == "font-relative":
        params["soundfontPath"] = "fixture.sf2"
    elif case == "font-missing":
        params["soundfontPath"] = str(tmp_path / "missing.sf2")
    elif case == "font-directory":
        (tmp_path / "directory.sf2").mkdir()
        params["soundfontPath"] = str(tmp_path / "directory.sf2")
    elif case == "font-extension":
        params["soundfontPath"] = str(sentinel)
    elif case == "out-relative":
        params["outDir"] = "render"
    elif case == "out-parent":
        params["outDir"] = str(tmp_path / "missing" / "render")
    elif case == "out-traversal":
        params["outDir"] = str(tmp_path / ".." / "render")
    elif case == "out-existing":
        params["outDir"] = str(tmp_path)
    elif case == "out-symlink":
        (tmp_path / "render").symlink_to(tmp_path / "missing-directory")
    elif case == "font-nul":
        params["soundfontPath"] += "\0.sf2"
    else:
        params["outDir"] += "\0"
    before = sorted(p.name for p in tmp_path.iterdir())
    with pytest.raises(ValueError, match="soundfontPath|outDir"):
        render(params)
    assert sorted(p.name for p in tmp_path.iterdir()) == before
    assert sentinel.read_text() == "user data"


@pytest.fixture
def soundfont():
    """Opt in with REAPER_MCP_TEST_SOUNDFONT=/absolute/path/to/a/GM.sf2."""
    path = os.environ.get("REAPER_MCP_TEST_SOUNDFONT")
    if not path or not ctypes.util.find_library("fluidsynth"):
        pytest.skip("set REAPER_MCP_TEST_SOUNDFONT and install libfluidsynth for native checks")
    return path


def test_renders_stereo_float_stems_that_sum_to_the_mix(tmp_path, soundfont):
    from voice_render import render

    params = request(tmp_path, soundfontPath=soundfont)
    params["tracks"].append({
        "name": "drums", "channel": 9, "program": 0, "gain": 0.4,
        "notes": [{"time": 0.6, "duration": 0.1, "pitch": 36, "velocity": 110}],
    })
    result = render(params)
    assert result["engine"] == "FluidSynth"
    assert result["soundfontPath"] == soundfont
    assert result["sampleRate"] == 22050
    assert result["durationSeconds"] == 2
    assert 0 < result["gain"] <= 1
    assert [s["name"] for s in result["stems"]] == ["melody", "drums"]
    assert sorted(p.name for p in (tmp_path / "render").iterdir()) == ["drums.wav", "melody.wav", "mix.wav"]
    stems = [sf.read(s["path"], dtype="float32")[0] for s in result["stems"]]
    mix, sr = sf.read(result["mixPath"], dtype="float32")
    assert sr == 22050 and mix.shape == (44100, 2)
    assert all(sf.info(s["path"]).subtype == "FLOAT" for s in result["stems"])
    assert sf.info(result["mixPath"]).subtype == "FLOAT"
    assert all(np.max(np.abs(stem)) > 0.001 for stem in stems)
    assert np.max(np.abs(stems[1][:int(0.6 * sr)])) == 0
    assert np.max(np.abs(stems[0][int(0.51 * sr):int(0.6 * sr)])) > 0, "note releases are retained"
    np.testing.assert_array_equal(mix, np.sum(stems, axis=0, dtype=np.float32))
    peak = float(np.max(np.abs(mix)))
    assert peak <= 0.9
    assert result["peakDb"] == pytest.approx(20 * np.log10(peak), abs=1e-5)


def test_common_attenuation_preserves_stem_balance_at_the_peak_ceiling(tmp_path, soundfont):
    from voice_render import render

    notes = [{"time": 0, "duration": 0.7, "pitch": pitch, "velocity": 127} for pitch in range(36, 84)]
    tracks = [{"name": f"part{i}", "channel": 0, "program": 19,
               "gain": 0.25 if i == 1 else 1, "notes": notes} for i in range(8)]
    result = render(request(tmp_path, soundfontPath=soundfont, tracks=tracks, durationSeconds=1))
    stems = [sf.read(s["path"], dtype="float32")[0] for s in result["stems"]]
    mix = sf.read(result["mixPath"], dtype="float32")[0]
    assert 0 < result["gain"] < 1, "the loud eight-part chord needs attenuation"
    assert 0.89 < np.max(np.abs(mix)) <= 0.9
    np.testing.assert_allclose(stems[1], stems[0] * 0.25, atol=1e-7)
    np.testing.assert_array_equal(mix, np.sum(stems, axis=0, dtype=np.float32))


def test_adjacent_and_overlapping_repeats_stay_audible_until_their_own_noteoff(tmp_path, soundfont):
    from voice_render import render

    params = request(tmp_path, soundfontPath=soundfont)
    # A sustaining GM organ, not a patch whose natural decay could mimic noteoff.
    params["tracks"][0].update(program=16, notes=[
        {"time": 0.1, "duration": 0.4, "pitch": 60, "velocity": 100},
        {"time": 0.5, "duration": 0.4, "pitch": 60, "velocity": 100},
        {"time": 0.7, "duration": 0.5, "pitch": 60, "velocity": 100},
    ])
    result = render(params)
    audio, sr = sf.read(result["mixPath"])
    held = np.sqrt(np.mean(audio[int(0.75 * sr):int(0.85 * sr)] ** 2))
    after_old_off = np.sqrt(np.mean(audio[int(1.0 * sr):int(1.1 * sr)] ** 2))
    assert held > 0.001
    assert np.sqrt(np.mean(audio[int(0.55 * sr):int(0.65 * sr)] ** 2)) > 0.001
    assert after_old_off > held * 0.5, "the older repeat's 0.9 s noteoff must not silence the new note"
    assert np.max(np.abs(audio[:int(0.1 * sr)])) == 0
    assert np.sqrt(np.mean(audio[int(1.8 * sr):] ** 2)) < held * 0.1


@pytest.mark.parametrize("case", ["track-count", "total-notes", "duplicate-name", "invalid-last-track"])
def test_validates_the_whole_bounded_score_before_any_output(tmp_path, case):
    from voice_render import render

    params = request(tmp_path)
    track = params["tracks"][0]
    if case == "track-count":
        params["tracks"] = [{**track, "name": f"part{i}"} for i in range(9)]
    elif case == "total-notes":
        params["tracks"] = [{**track, "name": f"part{i}", "notes": track["notes"] * 10001} for i in range(2)]
    elif case == "duplicate-name":
        params["tracks"].append(dict(track))
    else:
        params["tracks"].append({**track, "name": "bass", "gain": float("inf")})
    with pytest.raises(ValueError):
        render(params)
    assert not (tmp_path / "render").exists()


@pytest.mark.skipif(not ctypes.util.find_library("fluidsynth"), reason="libfluidsynth is not installed")
def test_failed_soundfont_load_removes_only_the_new_output_folder(tmp_path):
    from voice_render import render

    params = request(tmp_path)
    sentinel = tmp_path / "keep.txt"
    sentinel.write_text("user data")
    for _ in range(2):
        with pytest.raises(RuntimeError, match="SoundFont|soundfontPath"):
            render(params)
        assert not (tmp_path / "render").exists()
        assert sentinel.read_text() == "user data"
        assert (tmp_path / "fixture.sf2").read_bytes() == b"validation only, not a SoundFont"


def test_silent_parts_remain_silent_with_json_safe_metadata(tmp_path, soundfont):
    from voice_render import render

    params = request(tmp_path, soundfontPath=soundfont, durationSeconds=1.00001)
    params["tracks"][0]["gain"] = 0
    params["tracks"].append({**params["tracks"][0], "name": "harmony", "gain": 1, "notes": []})
    result = render(params)
    assert result["gain"] == 1 and result["peakDb"] is None
    assert result["durationSeconds"] == 22051 / 22050
    for path in [result["mixPath"], *(s["path"] for s in result["stems"])]:
        audio, sr = sf.read(path)
        assert audio.shape == (22051, 2) and sr == 22050
        assert np.count_nonzero(audio) == 0


def test_a_write_failure_removes_partial_stems_and_allows_a_clean_retry(tmp_path, soundfont, monkeypatch):
    from voice_render import render

    params = request(tmp_path, soundfontPath=soundfont)
    params["tracks"].append({**params["tracks"][0], "name": "bass"})
    open_wav = sf.SoundFile

    def disk_full(path, mode="r", *args, **kwargs):
        if Path(path).name == "bass.wav" and mode == "w":
            assert (tmp_path / "render" / "melody.wav").is_file()
            raise OSError("No space left on device")
        return open_wav(path, mode, *args, **kwargs)

    # Only the output-file boundary fails. FluidSynth is real throughout.
    with monkeypatch.context() as patch:
        patch.setattr(sf, "SoundFile", disk_full)
        with pytest.raises(OSError, match="No space left"):
            render(params)
    assert not (tmp_path / "render").exists()
    assert (tmp_path / "fixture.sf2").is_file()
    result = render(params)
    assert all(Path(s["path"]).is_file() for s in result["stems"])


@pytest.mark.skipif(bool(ctypes.util.find_library("fluidsynth")), reason="libfluidsynth is installed")
def test_missing_native_library_explains_installation_without_creating_output(tmp_path):
    from voice_render import render

    with pytest.raises(RuntimeError, match="brew install fluid-synth.*apt install libfluidsynth3"):
        render(request(tmp_path))
    assert not (tmp_path / "render").exists()
