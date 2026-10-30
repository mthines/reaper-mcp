"""
Tests for sidecar/separation.py. The Demucs run is skipped unless demucs is installed
(`reaper-mcp setup-sidecar --with-separation`); it downloads the model on first use.
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

import separation  # noqa: E402


def _mix(path: Path, sr: int = 44100, seconds: float = 8.0) -> None:
    import soundfile as sf

    t = np.arange(int(seconds * sr)) / sr
    bass = 0.3 * np.sin(2 * np.pi * 55 * t)
    drums = np.zeros_like(t)
    for k in np.arange(0, seconds, 0.5):
        i, n = int(k * sr), int(0.08 * sr)
        drums[i:i + n] += np.random.default_rng(int(k * 10)).standard_normal(min(n, t.size - i)) \
            * np.exp(-np.arange(min(n, t.size - i)) / (0.015 * sr)) * 0.5
    x = (bass + drums).astype(np.float32)
    sf.write(str(path), np.stack([x, x], axis=1), sr)


def test_refuses_an_unknown_model_or_stem_without_writing():
    with pytest.raises(ValueError, match="Unknown model"):
        separation.separate("/nope.wav", "/tmp/out-never", model_name="spleeter")
    with pytest.raises(ValueError, match="has no stem guitar"):
        separation.separate("/nope.wav", "/tmp/out-never", stems=["guitar"])


@pytest.mark.skipif(not separation.is_installed(), reason="demucs not installed (setup-sidecar --with-separation)")
def test_writes_only_the_asked_stems_as_float_wavs_at_the_model_rate(tmp_path):
    import soundfile as sf

    _mix(tmp_path / "mix.wav")
    r = separation.separate(str(tmp_path / "mix.wav"), str(tmp_path / "stems"), stems=["drums", "bass"])
    assert [s["stem"] for s in r["stems"]] == ["drums", "bass"]
    assert sorted(p.name for p in (tmp_path / "stems").iterdir()) == ["bass.wav", "drums.wav"]
    info = sf.info(str(tmp_path / "stems" / "bass.wav"))
    assert info.subtype == "FLOAT" and info.samplerate == 44100 and info.channels == 2
    assert abs(info.duration - 8.0) < 0.01
    bass = next(s for s in r["stems"] if s["stem"] == "bass")
    assert bass["lufs"] is not None and bass["lufs"] > -40, "the bass line lands in the bass stem"


@pytest.mark.skipif(not separation.is_installed(), reason="demucs not installed (setup-sidecar --with-separation)")
def test_an_accelerator_failure_reruns_on_cpu_and_says_so(tmp_path, monkeypatch):
    import demucs.apply

    real = demucs.apply.apply_model

    def accelerator_lacks_an_op(*args, **kw):
        # Demucs calls apply_model recursively with positional arguments: only the device keyword matters.
        if kw.get("device") == "mps":
            raise RuntimeError("op not implemented for 'mps'")
        return real(*args, **kw)

    monkeypatch.setattr(separation, "_device", lambda: "mps")
    monkeypatch.setattr(demucs.apply, "apply_model", accelerator_lacks_an_op)
    _mix(tmp_path / "mix.wav", seconds=3.0)
    r = separation.separate(str(tmp_path / "mix.wav"), str(tmp_path / "stems"), stems=["bass"])
    assert r["device"] == "cpu_fallback" and r["fallbackFrom"] == "mps"
    assert "not implemented" in r["fallbackError"]
    assert [s["stem"] for s in r["stems"]] == ["bass"]
