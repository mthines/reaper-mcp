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


def _stereo_tone(seed: int = 2) -> np.ndarray:
    rng = np.random.default_rng(seed)
    t = np.arange(3 * SR) / SR
    tone = 0.2 * np.sin(2 * np.pi * 220 * t) + 0.01 * rng.standard_normal(len(t))
    return np.stack([tone, tone])


def test_a_click_on_one_channel_is_found_and_the_channel_is_named():
    reference = _stereo_tone()
    clicked = reference.copy()
    clicked[1, len(reference[0]) // 2] += 0.5
    disc = verify.verify_edit(reference, clicked, SR, expect="changed")["checks"]["discontinuity"]
    assert disc["verdict"] == "fail"
    assert disc["channel"] == 1
    assert disc["atSeconds"] == pytest.approx(1.5, abs=0.002)


def test_opposite_clicks_on_left_and_right_do_not_cancel_out():
    reference = _stereo_tone()
    clicked = reference.copy()
    k = len(reference[0]) // 2
    clicked[0, k] += 0.5
    clicked[1, k] -= 0.5
    assert verify.verify_edit(reference, clicked, SR, expect="changed")["checks"]["discontinuity"]["verdict"] == "fail"


def test_a_spiky_unchanged_channel_does_not_hide_a_click_on_the_other():
    t = np.arange(3 * SR) / SR
    left = 0.2 * np.sin(2 * np.pi * 220 * t)
    left[::9000] += 0.5  # naturally spiky, identical in the edit
    right = 0.2 * np.sin(2 * np.pi * 330 * t) + 0.002 * np.random.default_rng(4).standard_normal(len(t))
    clicked = right.copy()
    clicked[SR:] += 0.3  # a step
    disc = verify.verify_edit(np.stack([left, right]), np.stack([left, clicked]), SR, expect="changed")["checks"]["discontinuity"]
    assert disc["verdict"] == "fail"
    assert disc["channel"] == 1


def test_a_clean_stereo_edit_names_no_channel_problem():
    reference = _stereo_tone()
    result = verify.verify_edit(reference, reference * 0.7, SR)
    assert result["verdict"] == "ok"
    assert result["checks"]["discontinuity"]["verdict"] == "ok"


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


def test_a_silent_edit_is_refused_even_when_the_timing_changed(source):
    assert "silent" in verify.verify_edit(source, np.zeros(int(len(source) / 1.1)), SR, time_scale=1.1)["error"]


def test_a_reference_covering_another_range_is_refused_not_failed(source):
    longer = np.concatenate([source[: 5 * SR // 2], source])
    assert "same range" in verify.verify_edit(longer, source, SR)["error"]


def test_a_polarity_flip_of_one_channel_fails_instead_of_being_called_silent():
    reference = _stereo_tone()
    flipped = reference.copy()
    flipped[1] *= -1  # the mono sum of the edit cancels to nothing
    result = verify.verify_edit(reference, flipped, SR)
    assert "error" not in result
    assert result["verdict"] == "fail"


def test_empty_audio_is_refused_as_too_short():
    assert "too short" in verify.verify_edit(np.zeros(0), np.zeros(0), SR)["error"]


# --- stretch character checks (timeScale != 1): pitch drift, tone, transients -------------------

def _voice(seconds: float, pitch_scale: float = 1.0, rate: float = 1.0) -> np.ndarray:
    """A harmonic tone with a slow pitch contour. `rate` > 1 plays the same contour faster (shorter) at the same pitch."""
    t = np.arange(int(seconds / rate * SR)) / SR
    f0 = pitch_scale * (150 + 30 * np.sin(2 * np.pi * 0.5 * t * rate))
    phase = 2 * np.pi * np.cumsum(f0) / SR
    return 0.2 * sum(np.sin(h * phase) / h for h in range(1, 10))


def _resampled(x: np.ndarray, rate: float) -> np.ndarray:
    """Varispeed: plays x `rate` times faster, so pitch moves with the speed."""
    return np.interp(np.arange(0, len(x) - 1, rate), np.arange(len(x)), x)


def _character(reference, edited, rate):
    return verify.verify_edit(reference, edited, SR, time_scale=rate)["checks"]


def test_a_stretch_that_keeps_the_pitch_passes_every_character_check():
    checks = _character(_voice(4), _voice(4, rate=1.1), 1.1)
    assert checks["pitch"]["verdict"] == "ok"
    assert abs(checks["pitch"]["driftCents"]) < 10
    assert checks["tone"]["verdict"] == "ok"
    assert checks["transients"]["verdict"] == "ok"


def test_a_plain_speed_change_is_reported_as_pitch_drift_in_cents_not_warned():
    reference = _voice(4)
    checks = _character(reference, _resampled(reference, 1.1), 1.1)
    assert checks["pitch"]["verdict"] == "info"
    assert checks["pitch"]["varispeed"] is True
    assert checks["pitch"]["driftCents"] == pytest.approx(1200 * np.log2(1.1), abs=15)
    assert checks["pitch"]["expectedCents"] == pytest.approx(1200 * np.log2(1.1), abs=0.2)


def test_a_slow_down_that_moves_the_pitch_is_also_a_plain_speed_change():
    reference = _voice(4)
    checks = _character(reference, _resampled(reference, 0.92), 0.92)
    assert checks["pitch"]["verdict"] == "info"
    assert checks["pitch"]["driftCents"] < -100


def test_a_pitch_error_the_speed_change_does_not_explain_still_warns_after_a_speed_change():
    reference = _voice(4)
    off = _resampled(_voice(4, pitch_scale=2 ** (1.0 / 12)), 1.1)  # a semitone further up than the speed alone
    checks = _character(reference, off, 1.1)
    assert checks["pitch"]["verdict"] == "warn"
    assert "varispeed" not in checks["pitch"]


def test_the_tone_shift_of_a_speed_change_is_reported_not_warned():
    reference = _voice(4)
    checks = _character(reference, _resampled(reference, 1.25), 1.25)
    assert checks["tone"]["distanceDb"] >= verify.TONE_WARN_DB
    assert checks["tone"]["verdict"] == "info"


def test_a_half_semitone_error_is_found():
    checks = _character(_voice(4), _voice(4, pitch_scale=2 ** (0.5 / 12), rate=1.1), 1.1)
    assert checks["pitch"]["verdict"] == "warn"
    assert checks["pitch"]["driftCents"] == pytest.approx(50, abs=12)


def test_unpitched_material_skips_the_pitch_check_and_says_why():
    noise = np.random.default_rng(0).standard_normal(4 * SR) * 0.1
    checks = _character(noise, noise[: int(len(noise) / 1.1)], 1.1)
    assert checks["pitch"]["verdict"] == "skipped"
    assert "pitch" in checks["pitch"]["reason"]


def test_added_noise_changes_the_tone_and_warns():
    reference = _voice(4)
    rng = np.random.default_rng(3)
    noisy = _voice(4, rate=1.1) + rng.standard_normal(len(_voice(4, rate=1.1))) * 0.02
    assert _character(reference, noisy, 1.1)["tone"]["verdict"] == "warn"


def test_smeared_attacks_lower_the_transient_score_and_warn():
    rng = np.random.default_rng(1)
    hits = np.zeros(4 * SR)
    for position in range(0, 4 * SR, SR // 4):
        hits[position:position + 600] = rng.standard_normal(600) * np.exp(-np.arange(600) / 120)
    hits += rng.standard_normal(len(hits)) * 0.002
    smeared = np.convolve(hits, np.hanning(int(0.04 * SR)) / np.hanning(int(0.04 * SR)).sum(), mode="same")
    assert _character(hits, smeared[: int(len(hits) / 1.1)], 1.1)["transients"]["verdict"] == "warn"


def test_character_checks_only_run_when_the_timing_changed(source):
    assert "pitch" not in verify.verify_edit(source, source.copy(), SR)["checks"]


def test_a_character_warning_makes_the_verdict_a_warning_never_a_fail():
    reference = _voice(4)
    off = _resampled(_voice(4, pitch_scale=2 ** (1.0 / 12)), 1.1)
    result = verify.verify_edit(reference, off, SR, time_scale=1.1)
    assert result["verdict"] == "warn"


def _slowed(rate):
    return _voice(4, rate=rate)


def test_a_clean_big_slow_down_reports_a_shallow_dip_and_passes():
    checks = _character(_voice(4), _slowed(0.8), 0.8)
    assert checks["dropout"]["verdict"] == "ok"
    assert checks["dropout"]["deepestDipDb"] < verify.DROPOUT_WARN_DB


def test_a_piece_of_a_slow_down_that_went_missing_is_found():
    edited = _slowed(0.8).copy()
    mid = len(edited) // 2
    edited[mid:mid + int(0.08 * SR)] *= 0.02  # 80 ms gone while the original keeps sounding there
    checks = _character(_voice(4), edited, 0.8)
    assert checks["dropout"]["verdict"] == "warn"
    assert checks["dropout"]["deepestDipDb"] >= verify.DROPOUT_WARN_DB


def test_mild_slow_downs_and_speed_ups_are_not_checked_for_dropouts():
    assert "dropout" not in _character(_voice(4), _slowed(0.92), 0.92)
    assert "dropout" not in _character(_voice(4), _voice(4, rate=1.1), 1.1)


def test_a_pitch_error_on_a_nearly_unchanged_speed_still_warns():
    reference = _voice(4)
    off = _resampled(_voice(4, pitch_scale=2 ** (0.25 / 12)), 1.02)  # a quarter tone further than the speed alone
    checks = _character(reference, off, 1.02)
    assert checks["pitch"]["verdict"] == "warn"
    assert "varispeed" not in checks["pitch"]


def test_a_pitch_kept_stretch_of_a_couple_of_percent_is_ok_not_a_speed_change():
    checks = _character(_voice(4), _voice(4, rate=1.02), 1.02)
    assert checks["pitch"]["verdict"] == "ok"
    assert "varispeed" not in checks["pitch"]
