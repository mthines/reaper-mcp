"""
Tests for sidecar/mixcheck.py: loudness curve, per-band stereo correlation, masking.

Run with the sidecar venv (numpy, torch, soundfile):
    ~/.reaper-mcp/sidecar-venv/bin/python -m pytest apps/reaper-mcp-server/sidecar/tests -q
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

import mixcheck  # noqa: E402

SR = 48000


def tone(freq: float, dbfs: float, seconds: float, sr: int = SR) -> np.ndarray:
    t = np.arange(int(seconds * sr)) / sr
    return (10 ** (dbfs / 20) * np.sin(2 * np.pi * freq * t)).astype(np.float32)


def stereo(left: np.ndarray, right: np.ndarray) -> np.ndarray:
    return np.stack([left, right])


def noise(seconds: float, seed: int, sr: int = SR) -> np.ndarray:
    return (np.random.default_rng(seed).standard_normal(int(seconds * sr)) * 0.1).astype(np.float32)


# --- loudness curve ---------------------------------------------------------

def test_curve_follows_a_quiet_then_loud_song_and_finds_the_loud_part():
    quiet, loud = tone(1000, -33, 10), tone(1000, -13, 10)
    audio = stereo(np.concatenate([quiet, loud]), np.concatenate([quiet, loud]))
    r = mixcheck.loudness_curve(audio, SR)
    st = r["shortTerm"]["lufs"]
    assert abs(st[0] - (-33)) < 0.5 and abs(st[-1] - (-13)) < 0.5
    assert r["loudest"]["start"] >= 10 and abs(r["loudest"]["lufs"] - (-13)) < 0.5
    assert r["quietest"]["start"] < 7


def test_curve_never_returns_more_points_than_its_cap_and_keeps_the_peak():
    audio = stereo(tone(1000, -30, 300), tone(1000, -30, 300))
    audio[:, 150 * SR:151 * SR] *= 10  # a 1 s burst 20 dB up
    r = mixcheck.loudness_curve(audio, SR)
    assert len(r["shortTerm"]["lufs"]) <= mixcheck.CURVE_POINTS
    assert len(r["momentary"]["lufs"]) <= mixcheck.CURVE_POINTS
    assert max(r["momentary"]["lufs"]) > -12, "a bucket keeps its loudest value"


def test_curve_reports_the_spans_over_a_target():
    quiet, loud = tone(1000, -20, 10), tone(1000, -10, 6)
    audio = stereo(np.concatenate([quiet, loud, quiet]), np.concatenate([quiet, loud, quiet]))
    r = mixcheck.loudness_curve(audio, SR, target_lufs=-14)
    assert len(r["overTarget"]) == 1
    span = r["overTarget"][0]
    assert 7 <= span["start"] <= 10 and 15 <= span["end"] <= 19
    assert r["overTargetSeconds"] > 4


def test_curve_of_a_clip_shorter_than_3_s_says_only_momentary_is_reported():
    r = mixcheck.loudness_curve(stereo(tone(1000, -20, 2), tone(1000, -20, 2)), SR)
    assert "shortTerm" not in r and r["momentary"]["lufs"]
    assert "momentary" in r["warning"]


# --- stereo correlation per band -------------------------------------------

def test_mono_source_correlates_fully_in_every_band():
    n = noise(5, 1)
    r = mixcheck.band_correlation(stereo(n, n), SR)
    assert all(b["correlation"] > 0.99 for b in r["bands"])
    assert r["flags"] == []


def test_out_of_phase_low_end_is_flagged_while_the_highs_stay_mono():
    low = tone(60, -12, 5)
    high = tone(4000, -12, 5)
    r = mixcheck.band_correlation(stereo(low + high, -low + high), SR)
    by = {b["band"]: b for b in r["bands"]}
    assert by["low"]["correlation"] < -0.9
    assert by["high"]["correlation"] > 0.9
    assert any("low end" in f for f in r["flags"])


def test_wide_uncorrelated_mids_read_near_zero_with_side_close_to_mid():
    r = mixcheck.band_correlation(stereo(noise(5, 1), noise(5, 2)), SR)
    mid = next(b for b in r["bands"] if b["band"] == "mid")
    assert abs(mid["correlation"]) < 0.1
    assert abs(mid["sideToMidDb"]) < 1.5
    assert len(mid["series"]) <= mixcheck.BAND_SERIES_POINTS


def test_band_correlation_refuses_a_mono_file():
    with pytest.raises(ValueError, match="stereo"):
        mixcheck.band_correlation(tone(100, -12, 2)[None, :], SR)


# --- masking -----------------------------------------------------------------

def test_two_tracks_in_the_same_band_at_the_same_level_conflict_there():
    bass = stereo(tone(100, -12, 5), tone(100, -12, 5))
    kick = stereo(tone(100, -13, 5) + tone(3000, -30, 5), tone(100, -13, 5) + tone(3000, -30, 5))
    r = mixcheck.masking([("Bass", bass), ("Kick", kick)], SR)
    top = r["conflicts"][0]
    assert top["hz"] == 100 and top["score"] > 0.8
    assert {top["a"], top["b"]} == {"Bass", "Kick"}
    assert "cut" in top["suggestion"]
    assert len(r["pairs"]) == 1 and len(r["pairs"][0]["scores"]) == len(r["bandsHz"])


def test_tracks_in_different_bands_do_not_conflict():
    low = stereo(tone(80, -12, 5), tone(80, -12, 5))
    high = stereo(tone(5000, -12, 5), tone(5000, -12, 5))
    r = mixcheck.masking([("Bass", low), ("Hat", high)], SR)
    assert r["conflicts"] == []


def test_masking_suggests_cutting_the_track_the_band_matters_less_to():
    # The guitar's energy is mostly at 1 kHz; at 250 Hz it is a minor part of it,
    # while the 250 Hz tone is the whole of the pad
    pad = tone(250, -18, 5)
    guitar = tone(1000, -6, 5) + tone(250, -18, 5)
    r = mixcheck.masking([("Pad", stereo(pad, pad)), ("Guitar", stereo(guitar, guitar))], SR)
    at250 = next(c for c in r["conflicts"] if c["hz"] == 250)
    assert at250["suggestion"].startswith("cut Guitar")


def test_masking_needs_two_tracks():
    with pytest.raises(ValueError):
        mixcheck.masking([("Solo", stereo(noise(1, 1), noise(1, 1)))], SR)


# --- speed ------------------------------------------------------------------
# Bounds sit ~10× over what these take on a laptop (900 s curve ≈ 1.6 s, stereo ≈ 1.4 s, masking ≈ 0.15 s),
# so only a real regression (a per-sample loop, a quadratic step) trips them.


def test_the_longest_inputs_each_check_accepts_finish_in_seconds():
    import time

    song = stereo(noise(900, 1), noise(900, 2))
    t0 = time.perf_counter()
    curve = mixcheck.loudness_curve(song, SR, -14)
    curve_s = time.perf_counter() - t0
    t0 = time.perf_counter()
    bands = mixcheck.band_correlation(song, SR)
    bands_s = time.perf_counter() - t0
    tracks = [(f"T{i}", stereo(noise(60, 10 + i), noise(60, 20 + i))) for i in range(8)]
    t0 = time.perf_counter()
    masking = mixcheck.masking(tracks, SR)
    masking_s = time.perf_counter() - t0

    assert len(curve["shortTerm"]["lufs"]) <= 240
    assert len(bands["bands"]) == 5
    assert len(masking["pairs"]) == 28
    assert curve_s < 20 and bands_s < 20 and masking_s < 5, (curve_s, bands_s, masking_s)
