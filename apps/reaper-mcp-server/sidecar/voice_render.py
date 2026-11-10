"""Offline GM SoundFont rendering through an optional native FluidSynth library."""

from __future__ import annotations

import ctypes
import ctypes.util
import math
import os
import re
import shutil
from contextlib import ExitStack, contextmanager
from pathlib import Path
from typing import Any, Iterator

import numpy as np
import soundfile as sf

SAMPLE_RATE = 22050
BLOCK_SIZE = 4096
NOT_INSTALLED = (
    "FluidSynth native library is not installed or could not be loaded. "
    "Install it with 'brew install fluid-synth' on macOS or "
    "'sudo apt install libfluidsynth3' on Debian/Ubuntu. "
    "On Windows, install FluidSynth and add its DLL directory to PATH. "
    "Supply your own local GM .sf2 via soundfontPath; no SoundFont is downloaded."
)


def _number(value: Any, field: str, low: float, high: float, *, integer: bool = False) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{field} must be a finite number")
    if not low <= value <= high or not math.isfinite(value):
        raise ValueError(f"{field} must be finite and between {low} and {high}")
    if integer and value != int(value):
        raise ValueError(f"{field} must be an integer")
    return value


def _validate_score(params: dict[str, Any]) -> None:
    duration = _number(params["durationSeconds"], "durationSeconds", 0, 240)
    if duration <= 0:
        raise ValueError("durationSeconds must be greater than zero")
    tracks = params["tracks"]
    if not isinstance(tracks, list) or not 1 <= len(tracks) <= 8:
        raise ValueError("tracks must contain 1 to 8 tracks")
    names: set[str] = set()
    total_notes = 0
    for track in tracks:
        if not isinstance(track, dict):
            raise ValueError("tracks must contain objects")
        name = track.get("name")
        if not isinstance(name, str) or not re.fullmatch(r"[a-z][a-z0-9_-]{0,63}", name) or name == "mix":
            raise ValueError("track name must be a lowercase filename slug, not 'mix'")
        if name in names:
            raise ValueError("track name must be unique")
        names.add(name)
        _number(track.get("channel"), "channel", 0, 15, integer=True)
        _number(track.get("program"), "program", 0, 127, integer=True)
        _number(track.get("gain"), "gain", 0, 1)
        notes = track.get("notes")
        if not isinstance(notes, list):
            raise ValueError("notes must be an array")
        total_notes += len(notes)
        if total_notes > 20000:
            raise ValueError("notes must total at most 20000 across all tracks")
        for note in notes:
            _validate_note(note, duration)


def _validate_note(note: Any, duration: float) -> None:
    if not isinstance(note, dict):
        raise ValueError("notes must contain objects")
    start = _number(note.get("time"), "time", 0, duration)
    length = _number(note.get("duration"), "duration", 0, duration)
    if start >= duration:
        raise ValueError("note time must be before durationSeconds")
    if length <= 0 or start + length > duration + 1e-9:
        raise ValueError("note duration must be positive and end within durationSeconds")
    _number(note.get("pitch"), "pitch", 0, 127, integer=True)
    _number(note.get("velocity"), "velocity", 1, 127, integer=True)


def _absolute_path(value: Any, field: str) -> Path:
    if not isinstance(value, str) or not value or "\0" in value:
        raise ValueError(f"{field} must be an absolute path without NUL bytes")
    path = Path(value)
    if not path.is_absolute() or ".." in path.parts:
        raise ValueError(f"{field} must be an absolute path without '..'")
    return path


def _validate_paths(params: dict[str, Any]) -> tuple[Path, Path]:
    font = _absolute_path(params["soundfontPath"], "soundfontPath")
    if font.suffix.lower() != ".sf2" or not font.is_file():
        raise ValueError("soundfontPath must point to an existing .sf2 file")
    out = _absolute_path(params["outDir"], "outDir")
    if os.path.lexists(out):
        raise ValueError("outDir already exists; use a new directory")
    if not out.parent.is_dir():
        raise ValueError("outDir parent directory must already exist")
    return font, out


def _native() -> Any:
    candidates = [ctypes.util.find_library("fluidsynth"), "libfluidsynth.so.3", "libfluidsynth.dylib",
                  "/opt/homebrew/lib/libfluidsynth.dylib", "/usr/local/lib/libfluidsynth.dylib",
                  "libfluidsynth-3.dll", "libfluidsynth.dll"]
    for candidate in candidates:
        if not candidate:
            continue
        try:
            lib = ctypes.CDLL(candidate)
            break
        except OSError:
            continue
    else:
        raise RuntimeError(NOT_INSTALLED)
    ptr, integer, string = ctypes.c_void_p, ctypes.c_int, ctypes.c_char_p
    signatures = {
        "new_fluid_settings": (ptr, []),
        "delete_fluid_settings": (None, [ptr]),
        "fluid_settings_setnum": (integer, [ptr, string, ctypes.c_double]),
        "fluid_settings_setint": (integer, [ptr, string, integer]),
        "new_fluid_synth": (ptr, [ptr]),
        "delete_fluid_synth": (None, [ptr]),
        "fluid_synth_sfload": (integer, [ptr, string, integer]),
        "fluid_synth_program_select": (integer, [ptr, integer, integer, integer, integer]),
        "fluid_synth_noteon": (integer, [ptr, integer, integer, integer]),
        "fluid_synth_noteoff": (integer, [ptr, integer, integer]),
        "fluid_synth_write_float": (integer, [ptr, integer, ptr, integer, integer, ptr, integer, integer]),
    }
    try:
        for name, (result, args) in signatures.items():
            function = getattr(lib, name)
            function.restype = result
            function.argtypes = args
    except AttributeError as exc:
        raise RuntimeError(f"{NOT_INSTALLED} The library lacks a required FluidSynth function.") from exc
    return lib


@contextmanager
def _synth(lib: Any, font: Path, track: dict[str, Any]) -> Iterator[Any]:
    settings = lib.new_fluid_settings()
    if not settings:
        raise RuntimeError("FluidSynth could not allocate settings")
    synth = None
    try:
        if lib.fluid_settings_setnum(settings, b"synth.sample-rate", SAMPLE_RATE) != 0:
            raise RuntimeError("FluidSynth could not set its sample rate")
        lib.fluid_settings_setnum(settings, b"synth.gain", 0.2)
        lib.fluid_settings_setint(settings, b"synth.reverb.active", 0)
        lib.fluid_settings_setint(settings, b"synth.chorus.active", 0)
        synth = lib.new_fluid_synth(settings)
        if not synth:
            raise RuntimeError("FluidSynth could not allocate an offline synthesizer")
        # The SoundFont is the caller's file: one FluidSynth cannot use is bad input (ValueError, answered -32602
        # and reported as rejected), not a sidecar fault like the allocation failures above.
        font_id = lib.fluid_synth_sfload(synth, os.fsencode(font), 1)
        if font_id < 0:
            raise ValueError("FluidSynth could not load soundfontPath as a SoundFont")
        channel, program = int(track["channel"]), int(track["program"])
        bank = 128 if channel == 9 else 0
        if lib.fluid_synth_program_select(synth, channel, font_id, bank, program) != 0:
            raise ValueError(f"SoundFont has no bank {bank} program {program} for track '{track['name']}'")
        # No audio or MIDI driver is created. Samples only leave through write_float.
        yield synth
    finally:
        if synth:
            lib.delete_fluid_synth(synth)
        lib.delete_fluid_settings(settings)


def _events(notes: list[dict[str, Any]], frames: int) -> list[tuple[int, int, int, int, int]]:
    events = []
    for index, note in enumerate(notes):
        start = min(frames - 1, round(note["time"] * SAMPLE_RATE))
        end = min(frames, max(start + 1, round((note["time"] + note["duration"]) * SAMPLE_RATE)))
        pitch = int(note["pitch"])
        # Offs sort before ons at an identical sample, including adjacent repeats.
        events.append((start, 1, index, pitch, int(note["velocity"])))
        events.append((end, 0, index, pitch, 0))
    return sorted(events)


def _write_samples(lib: Any, synth: Any, output: sf.SoundFile, frames: int, gain: float) -> None:
    while frames:
        count = min(BLOCK_SIZE, frames)
        block = np.empty((count, 2), dtype=np.float32)
        if lib.fluid_synth_write_float(synth, count, block.ctypes.data, 0, 2, block.ctypes.data, 1, 2) != 0:
            raise RuntimeError("FluidSynth failed while rendering audio samples")
        block *= gain
        if not np.isfinite(block).all():
            raise RuntimeError("FluidSynth rendered non-finite audio samples")
        output.write(block)
        frames -= count


def _write_track(lib: Any, font: Path, path: Path, track: dict[str, Any], frames: int) -> None:
    channel = int(track["channel"])
    with _synth(lib, font, track) as synth, sf.SoundFile(
        path, "w", samplerate=SAMPLE_RATE, channels=2, format="WAV", subtype="FLOAT",
    ) as output:
        position = 0
        active: dict[int, int] = {}
        for frame, on, index, pitch, velocity in _events(track["notes"], frames):
            _write_samples(lib, synth, output, frame - position, track["gain"])
            position = frame
            if on:
                if lib.fluid_synth_noteon(synth, channel, pitch, velocity) != 0:
                    raise RuntimeError(f"FluidSynth could not play pitch {pitch} on track '{track['name']}'")
                active[pitch] = index
            elif active.get(pitch) == index:
                # An older, overlapping repeat must not turn off the newer note.
                lib.fluid_synth_noteoff(synth, channel, pitch)
                del active[pitch]
        _write_samples(lib, synth, output, frames - position, track["gain"])


def _mixed_blocks(paths: list[Path]) -> Iterator[tuple[np.ndarray, float]]:
    with ExitStack() as stack:
        sources = [stack.enter_context(sf.SoundFile(path)) for path in paths]
        frames = len(sources[0])
        for start in range(0, frames, BLOCK_SIZE):
            mixed = np.zeros((min(BLOCK_SIZE, frames - start), 2), dtype=np.float32)
            stem_peak = 0.0
            for source in sources:
                block = source.read(len(mixed), dtype="float32", always_2d=True)
                stem_peak = max(stem_peak, float(np.max(np.abs(block))))
                mixed += block
            yield mixed, stem_peak


def _apply_gain(path: Path, gain: float) -> None:
    if gain == 1:
        return
    with sf.SoundFile(path, "r+") as source:
        for start in range(0, len(source), BLOCK_SIZE):
            source.seek(start)
            block = source.read(BLOCK_SIZE, dtype="float32", always_2d=True)
            block *= gain
            source.seek(start)
            source.write(block)


def _finish_mix(paths: list[Path], mix_path: Path) -> tuple[float, float]:
    peak = 0.0
    for block, stem_peak in _mixed_blocks(paths):
        peak = max(peak, stem_peak, float(np.max(np.abs(block))))
    # Cover float32 rounding across all eight stems, including cancellation.
    gain = min(1.0, 0.9 * (1 - 1e-5) / peak) if peak else 1.0
    for path in paths:
        _apply_gain(path, gain)
    mix_peak = 0.0
    with sf.SoundFile(mix_path, "w", samplerate=SAMPLE_RATE, channels=2, format="WAV", subtype="FLOAT") as output:
        for block, _ in _mixed_blocks(paths):
            output.write(block)
            mix_peak = max(mix_peak, float(np.max(np.abs(block))))
    return gain, mix_peak


def render(params: dict[str, Any]) -> dict[str, Any]:
    """Render isolated GM stems with common attenuation and a sample-exact summed mix.

    Memory is independent of duration and stem count, apart from the bounded note
    events and one native synth/SoundFont. Audio is streamed in 4096-frame blocks.
    ``durationSeconds`` includes release tails; all files have the same length,
    rounded up to the next sample. Silence has ``peakDb: None`` for JSON safety.
    """
    if not isinstance(params, dict):
        raise ValueError("render params must be an object")
    if not {"soundfontPath", "outDir", "durationSeconds", "tracks"} <= params.keys():
        raise ValueError("soundfontPath, outDir, durationSeconds and tracks are required")
    _validate_score(params)
    font, out = _validate_paths(params)
    lib = _native()
    frames = math.ceil(params["durationSeconds"] * SAMPLE_RATE)
    # mkdir is atomic. If another caller wins the race, never clean up its folder.
    try:
        out.mkdir()
    except FileExistsError as exc:
        raise ValueError("outDir already exists; use a new directory") from exc
    try:
        paths = [out / f"{track['name']}.wav" for track in params["tracks"]]
        for path, track in zip(paths, params["tracks"]):
            _write_track(lib, font, path, track, frames)
        gain, peak = _finish_mix(paths, out / "mix.wav")
        return {
            "sampleRate": SAMPLE_RATE, "durationSeconds": frames / SAMPLE_RATE,
            "gain": gain, "peakDb": 20 * math.log10(peak) if peak else None,
            "mixPath": str(out / "mix.wav"),
            "stems": [{"name": track["name"], "path": str(path)} for track, path in zip(params["tracks"], paths)],
            "engine": "FluidSynth", "soundfontPath": str(font),
        }
    except BaseException:
        shutil.rmtree(out)
        raise
