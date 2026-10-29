"""
Tests for sidecar/analysis.py against the EBU loudness reference signals.

Run with the sidecar venv (numpy, torch, soundfile):
    ~/.reaper-mcp/sidecar-venv/bin/python -m pytest apps/reaper-mcp-server/sidecar/tests -q
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent.parent))

import analysis  # noqa: E402

SR = 48000


def sine(freq: float, dbfs: float, seconds: float, channels: int = 2, sr: int = SR) -> np.ndarray:
    t = np.arange(int(seconds * sr)) / sr
    wave = (10 ** (dbfs / 20) * np.sin(2 * np.pi * freq * t)).astype(np.float32)
    return np.tile(wave, (channels, 1))


def test_integrated_loudness_ebu3341_sine():
    # EBU Tech 3341 case 1: stereo 1 kHz sine at -23 dBFS reads -23 LUFS
    lufs = analysis.integrated_loudness(sine(1000, -23, 20), SR)
    assert abs(lufs - (-23.0)) <= 0.3


def test_integrated_loudness_other_sample_rate():
    lufs = analysis.integrated_loudness(sine(1000, -23, 10, sr=44100), 44100)
    assert abs(lufs - (-23.0)) <= 0.3


def test_integrated_loudness_silence_is_minus_inf():
    assert analysis.integrated_loudness(np.zeros((2, SR * 2), dtype=np.float32), SR) == float("-inf")


def test_loudness_range_ebu3342_two_levels():
    # EBU Tech 3342 case 1: 20 s at -20 dBFS then 20 s at -30 dBFS → LRA 10 LU
    audio = np.concatenate([sine(1000, -20, 20), sine(1000, -30, 20)], axis=1)
    lra = analysis.loudness_range(audio, SR)
    assert lra is not None and abs(lra - 10.0) <= 1.0


def test_true_peak_exceeds_sample_peak():
    # fs/4 sine at 45° phase: every sample sits at 0.707 of the real peak
    n = np.arange(SR)
    wave = np.sin(np.pi / 2 * n + np.pi / 4).astype(np.float32) * 0.5
    audio = np.tile(wave, (2, 1))
    sample_peak = float(np.abs(audio).max())
    tp = analysis.true_peak(audio, SR)
    assert tp > sample_peak * 1.2


def test_reference_treble_delta_positive_when_brighter():
    rng = np.random.default_rng(1)
    noise = rng.standard_normal((2, SR * 6)).astype(np.float32) * 0.05
    # The "mix" adds strong high-frequency content on top of the same noise
    brighter = noise + sine(9000, -12, 6)
    result = analysis.compare_to_reference(brighter, SR, noise, SR)
    # Band figures are shares of total energy, so more treble means less of the rest
    assert result["bandDeltaDb"]["brilliance"] > 0.5
    assert result["bandDeltaDb"]["bass"] < 0
    assert result["loudnessDeltaLu"] > 0
    top = result["largestDifferences"][0]
    assert 8000 <= top["hz"] <= 11000 and top["deltaDb"] > 6


def test_alignment_detects_delay_and_inverted_polarity():
    rng = np.random.default_rng(7)
    ref = rng.standard_normal((1, SR)).astype(np.float32)
    delayed = np.zeros_like(ref)
    delayed[:, 37:] = -ref[:, :-37]
    result = analysis.alignment(ref, delayed, SR, max_lag_ms=5)
    assert result["delaySamples"] == 37
    assert result["polarityInverted"] is True
    assert result["correlation"] > 0.9


def test_alignment_reports_negative_lag_when_target_is_early():
    rng = np.random.default_rng(3)
    ref = rng.standard_normal((2, SR)).astype(np.float32)
    early = np.zeros_like(ref)
    early[:, :-12] = ref[:, 12:]
    result = analysis.alignment(ref, early, SR, max_lag_ms=5)
    assert result["delaySamples"] == -12
    assert result["polarityInverted"] is False


def test_normalize_to_lufs_hits_target():
    audio = sine(1000, -30, 5)
    out, measured, gain = analysis.normalize_to_lufs(audio, SR, -18.0)
    assert abs(measured - (-30.0)) <= 0.3
    assert abs(gain - 12.0) <= 0.3
    assert abs(analysis.integrated_loudness(out, SR) - (-18.0)) <= 0.1


def test_normalize_leaves_silence_alone():
    silent = np.zeros((2, SR), dtype=np.float32)
    out, measured, gain = analysis.normalize_to_lufs(silent, SR, -18.0)
    assert measured is None and gain == 0.0 and out is silent


def test_analyze_reports_sections_and_resonance():
    rng = np.random.default_rng(5)
    audio = rng.standard_normal((2, SR * 8)).astype(np.float32) * 0.05 + sine(3150, -14, 8)
    result = analysis.analyze(audio, SR, section_s=4)
    assert len(result["loudness"]["sections"]) == 2
    hzs = [r["hz"] for r in result["spectrum"]["resonances"]]
    assert any(abs(h - 3150) < 40 for h in hzs)


def test_alignment_names_the_silent_signal():
    ref = sine(1000, -20, 1, channels=1)
    result = analysis.alignment(ref, np.zeros_like(ref), SR)
    assert result["delaySamples"] is None
    assert result["error"].startswith("The track is silent")


def test_sibilance_on_silence_has_the_same_keys():
    power, freqs = analysis._stft_power(np.zeros((2, SR * 2), dtype=np.float32), SR)
    assert analysis.sibilance_hint(power, freqs, 2048 / SR)["spikeCount"] == 0


def test_sibilance_reports_each_burst_once():
    rng = np.random.default_rng(2)
    audio = sine(200, -20, 6)
    for start in (1.0, 3.0):  # two 0.3 s hiss bursts
        i = int(start * SR)
        audio[:, i:i + int(0.3 * SR)] += rng.standard_normal((2, int(0.3 * SR))).astype(np.float32) * 0.3
    power, freqs = analysis._stft_power(audio, SR)
    hint = analysis.sibilance_hint(power, freqs, 2048 / SR)
    assert hint["spikeCount"] == 2
    assert [round(t) for t in hint["spikeSeconds"]] == [1, 3]


def test_chunked_k_weighting_and_true_peak_match_one_piece(monkeypatch):
    rng = np.random.default_rng(11)
    audio = (rng.standard_normal((2, SR * 7)) * 0.1).astype(np.float32)
    whole_kw = analysis.k_weight(audio, SR)
    whole_tp = analysis.true_peak(audio, SR)
    monkeypatch.setattr(analysis, "CHUNK_S", 2.0)  # 4 chunks, the last one short
    assert np.max(np.abs(analysis.k_weight(audio, SR) - whole_kw)) < 1e-9
    assert abs(analysis.true_peak(audio, SR) - whole_tp) < 1e-3
