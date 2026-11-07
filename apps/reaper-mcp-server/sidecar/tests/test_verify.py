"""
Tests for sidecar/verify.py (verify_edit): what the agent is told about an edit.

Run with the sidecar venv:
    ~/.reaper-mcp/sidecar-venv/bin/python -m pytest apps/reaper-mcp-server/sidecar/tests -q
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

import verify  # noqa: E402

SR = 44100


@pytest.fixture(scope="module")
def source() -> np.ndarray:
    """3 s of voiced-like material: harmonics under a moving envelope plus a little breath noise."""
    rng = np.random.default_rng(7)
    t = np.arange(3 * SR) / SR
    f0 = 140 + 25 * np.sin(2 * np.pi * 0.7 * t)
    phase = 2 * np.pi * np.cumsum(f0) / SR
    voiced = sum(np.sin(h * phase) / h for h in range(1, 12))
    envelope = 0.5 + 0.5 * np.sin(2 * np.pi * 1.3 * t) ** 2
    breath = np.convolve(rng.standard_normal(len(t)), np.ones(8) / 8, mode="same") * 0.05
    return (0.2 * (envelope * voiced + breath)).astype(np.float64)


def shifted(x: np.ndarray, ms: float) -> np.ndarray:
    n = int(round(SR * ms / 1000))
    return np.concatenate([np.zeros(n), x])[: len(x)]


def test_an_untouched_copy_passes_with_nothing_to_report(source):
    result = verify.verify_edit(source, source.copy(), SR)
    assert result["verdict"] == "ok"
    assert result["checks"]["null"]["residualDb"] <= -100
    assert result["checks"]["null"]["delayMs"] == 0
    assert result["checks"]["null"]["gainDb"] == 0


def test_a_gain_change_is_reported_as_a_number_not_as_damage(source):
    result = verify.verify_edit(source, source * 10 ** (-3 / 20), SR)
    null = result["checks"]["null"]
    assert result["verdict"] == "ok"
    assert null["gainDb"] == pytest.approx(-3.0, abs=0.05)
    assert null["residualDb"] <= -60


def test_a_pure_shift_is_reported_as_its_delay_and_passes(source):
    result = verify.verify_edit(source, shifted(source, 4.0), SR)
    null = result["checks"]["null"]
    assert result["verdict"] == "ok"
    assert null["delayMs"] == pytest.approx(4.0, abs=0.05)
    assert null["residualDb"] <= -50


def test_the_reference_level_is_reported_so_a_noise_floor_residual_can_be_read_in_context(source):
    quiet = source * 10 ** (-40 / 20)
    rounded = np.round(quiet * 32768) / 32768  # a 16-bit bounce of the quiet take
    null = verify.verify_edit(quiet, rounded, SR)["checks"]["null"]
    loud = verify.verify_edit(source, np.round(source * 32768) / 32768, SR)["checks"]["null"]
    assert null["referenceRmsDb"] < loud["referenceRmsDb"] - 30
    assert null["residualDb"] > loud["residualDb"] + 30  # the same rounding is a far bigger share of a quiet take


def test_a_fractional_sample_shift_is_found(source):
    n = 37.4  # samples
    edited = np.fft.irfft(np.fft.rfft(source) * np.exp(-2j * np.pi * np.fft.rfftfreq(len(source)) * n), len(source))
    null = verify.verify_edit(source, edited, SR)["checks"]["null"]
    assert null["delayMs"] == pytest.approx(1000 * n / SR, abs=0.02)
    assert null["residualDb"] <= -40


def test_a_polarity_flip_is_reported_and_passes(source):
    result = verify.verify_edit(source, -source, SR)
    assert result["verdict"] == "ok"
    assert result["checks"]["null"]["polarityInverted"] is True


def test_added_noise_fails_an_edit_that_should_be_transparent(source):
    noise = np.random.default_rng(1).standard_normal(len(source))
    noisy = source + noise * np.sqrt(np.mean(source**2) / 10 ** (25 / 10) / np.mean(noise**2))
    result = verify.verify_edit(source, noisy, SR)
    assert result["verdict"] == "fail"
    assert result["checks"]["null"]["residualDb"] == pytest.approx(-25, abs=1.5)


def test_the_same_difference_is_only_reported_when_the_edit_is_meant_to_change_the_sound(source):
    noise = np.random.default_rng(1).standard_normal(len(source)) * 0.01
    result = verify.verify_edit(source, source + noise, SR, expect="changed")
    assert result["checks"]["null"]["verdict"] == "info"
    assert result["verdict"] == "ok"
    assert result["checks"]["null"]["residualDb"] > verify.NULL_OK_DB


def test_a_hard_splice_is_flagged_where_it_happens(source):
    spliced = source.copy()
    cut = len(source) // 2
    spliced[cut:] *= 0.5
    spliced[cut : cut + 8] += 0.2
    result = verify.verify_edit(source, spliced, SR, expect="changed")
    disc = result["checks"]["discontinuity"]
    assert result["verdict"] == "fail"
    assert disc["verdict"] == "fail"
    assert disc["atSeconds"] == pytest.approx(cut / SR, abs=0.002)


def test_material_that_is_naturally_spiky_is_not_blamed_for_its_own_spikes():
    rng = np.random.default_rng(3)
    spiky = rng.standard_normal(3 * SR) * 0.01
    spiky[::SR // 4] += 0.5  # four hits a second, in the reference and in the edit
    result = verify.verify_edit(spiky, spiky * 0.9, SR)
    assert result["checks"]["discontinuity"]["verdict"] == "ok"


def test_a_delayed_copy_of_material_that_starts_abruptly_is_not_called_a_click():
    t = np.arange(3 * SR) / SR
    abrupt = 0.3 * np.sin(2 * np.pi * 200 * t + 1.2)  # starts mid-wave, so a delayed copy starts with a step
    result = verify.verify_edit(abrupt, shifted(abrupt, 5.0), SR)
    assert result["checks"]["discontinuity"]["verdict"] == "ok"
    assert result["checks"]["null"]["delayMs"] == pytest.approx(5.0, abs=0.05)


def test_a_stretch_skips_the_null_and_still_checks_for_clicks(source):
    stretched = source[: int(len(source) / 1.1)].copy()
    clean = verify.verify_edit(source, stretched, SR, time_scale=1.1)
    assert clean["checks"]["null"]["verdict"] == "skipped"
    assert clean["verdict"] == "ok"

    stretched[len(stretched) // 2 :] *= 0.4
    stretched[len(stretched) // 2 : len(stretched) // 2 + 6] += 0.25
    assert verify.verify_edit(source, stretched, SR, time_scale=1.1)["verdict"] == "fail"


def test_a_stereo_gain_change_passes_and_is_reported_in_dB(source):
    stereo = np.stack([source, source * 0.8])
    result = verify.verify_edit(stereo, stereo * 0.5, SR)
    assert result["checks"]["null"]["gainDb"] == pytest.approx(-6.0, abs=0.05)
    assert result["verdict"] == "ok"


def test_swapping_left_and_right_is_not_hidden_by_the_mono_sum():
    rng = np.random.default_rng(5)
    left = np.convolve(rng.standard_normal(2 * SR), np.ones(16) / 16, mode="same") * 0.2
    right = np.convolve(rng.standard_normal(2 * SR), np.ones(16) / 16, mode="same") * 0.2
    result = verify.verify_edit(np.stack([left, right]), np.stack([right, left]), SR)
    assert result["verdict"] == "fail"
    assert result["checks"]["null"]["residualDb"] > verify.NULL_WARN_DB


def test_a_mono_edit_of_a_stereo_reference_is_compared_on_the_sum(source):
    result = verify.verify_edit(np.stack([source, source]), source, SR)
    assert result["verdict"] == "ok"


@pytest.mark.parametrize("which", ["reference", "edited"])
def test_silence_is_refused_with_a_reason(source, which):
    silent = np.zeros_like(source)
    args = (silent, source) if which == "reference" else (source, silent)
    assert "silent" in verify.verify_edit(*args, SR)["error"]


def test_too_short_audio_is_refused(source):
    assert "too short" in verify.verify_edit(source[:1000], source[:1000], SR)["error"]


def test_an_unknown_expectation_is_refused(source):
    assert "expect" in verify.verify_edit(source, source, SR, expect="better")["error"]
