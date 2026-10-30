"""
Source separation (stems from a mix) for the reaper-mcp sidecar, with Demucs
(Meta, MIT licence): htdemucs gives drums, bass, other and vocals; htdemucs_6s
adds guitar and piano.

Opt-in: installed by `reaper-mcp setup-sidecar --with-separation` (demucs and
the model weights, ~80 MB per model, cached by torch hub). Audio goes in and
out through soundfile; demucs's own torchaudio-based I/O is never used
(torchaudio 2.9+ moved load/save to torchcodec).
"""

from __future__ import annotations

import math
import os
import sys
import time
from typing import Any

import numpy as np

import analysis

MODELS = {
    "htdemucs": ["drums", "bass", "other", "vocals"],
    "htdemucs_6s": ["drums", "bass", "other", "vocals", "guitar", "piano"],
}
NOT_INSTALLED = ("Stem separation is not installed. Run: reaper-mcp setup-sidecar --with-separation "
                 "(installs Demucs and its model, ~80 MB)")

_models: dict[str, Any] = {}


def is_installed() -> bool:
    try:
        import demucs.apply  # noqa: F401  type: ignore
        import demucs.pretrained  # noqa: F401  type: ignore
    except Exception:  # noqa: BLE001
        return False
    return True


def _device() -> str:
    import torch  # type: ignore

    if os.environ.get("REAPER_MCP_SEPARATION_DEVICE"):
        return os.environ["REAPER_MCP_SEPARATION_DEVICE"]
    if torch.cuda.is_available():
        return "cuda"
    if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
        return "mps"
    return "cpu"


def _model(name: str) -> Any:
    if name not in _models:
        from demucs.pretrained import get_model  # type: ignore

        model = get_model(name)
        model.eval()
        _models[name] = model
    return _models[name]


def separate(path: str, out_dir: str, model_name: str = "htdemucs", stems: list[str] | None = None,
             start: float = 0.0, end: float | None = None, max_seconds: float | None = None) -> dict[str, Any]:
    """
    Split [start, end) of `path` into stems written to `out_dir/<stem>.wav` (32-bit float, never clipped;
    the model's sample rate, stereo). `stems` keeps only those (the others are not
    written). Returns each written stem with its path, peak and loudness.
    """
    if model_name not in MODELS:
        raise ValueError(f"Unknown model {model_name}. Use {', '.join(MODELS)}")
    wanted = stems or MODELS[model_name]
    unknown = [s for s in wanted if s not in MODELS[model_name]]
    if unknown:
        raise ValueError(f"{model_name} has no stem {', '.join(unknown)}: it gives {', '.join(MODELS[model_name])}")
    if not is_installed():
        raise RuntimeError(NOT_INSTALLED)

    import soundfile as sf  # type: ignore
    import torch  # type: ignore
    import torchaudio.functional as F  # type: ignore
    from demucs.apply import apply_model  # type: ignore

    audio, sr = analysis.load_audio(path, start, end)
    if audio.shape[1] < sr:
        raise ValueError("Audio too short: need at least 1 s")
    if max_seconds and audio.shape[1] / sr > max_seconds + 0.5:
        raise ValueError(f"Audio is {audio.shape[1] / sr:.0f} s: max {max_seconds:.0f} s per call (pass startTime/endTime)")
    model = _model(model_name)
    started = time.time()  # after the model load: the speed is the separation's own
    wav = torch.from_numpy(audio)
    if wav.shape[0] == 1:
        wav = wav.repeat(2, 1)
    wav = wav[:2]
    if sr != model.samplerate:
        wav = F.resample(wav, sr, model.samplerate)
    # Demucs's own normalisation (as its CLI): zero mean, unit deviation of the mono mix
    ref = wav.mean(0)
    mean, std = ref.mean(), ref.std()
    if float(std) < 1e-8:
        raise ValueError("The audio is silent: nothing to separate")
    wav = (wav - mean) / std

    device = _device()
    fallback: dict[str, str] = {}
    try:
        with torch.no_grad():
            sources = apply_model(model, wav[None], device=device, split=True, overlap=0.25, progress=False)[0]
    except Exception as exc:  # noqa: BLE001
        if device == "cpu":
            raise
        # An op the accelerator lacks: CPU always works. Labelled apart from a plain CPU run,
        # so the fallback shows in the speed metric and the answer.
        fallback = {"fallbackFrom": device, "fallbackError": str(exc)[:300]}
        print(f"separate: {device} failed, falling back to CPU: {exc}", file=sys.stderr, flush=True)
        device = "cpu_fallback"
        with torch.no_grad():
            sources = apply_model(model, wav[None], device="cpu", split=True, overlap=0.25, progress=False)[0]
    sources = sources * std + mean

    os.makedirs(out_dir, exist_ok=True)
    written = []
    for name, src in zip(model.sources, sources):
        if name not in wanted:
            continue
        data = src.cpu().numpy().astype(np.float32)
        out = os.path.join(out_dir, f"{name}.wav")
        sf.write(out, data.T, model.samplerate, subtype="FLOAT")  # a stem can peak above 0 dBFS
        peak = float(np.abs(data).max(initial=0.0))
        lufs = analysis.integrated_loudness(data, model.samplerate)
        written.append({
            "stem": name, "path": out,
            "peakDbfs": analysis._round(analysis._db(peak), 1),
            "lufs": analysis._round(lufs, 1) if math.isfinite(lufs) else None,
        })
    return {
        "model": model_name, "sampleRate": int(model.samplerate), "device": device,
        "seconds": round(audio.shape[1] / sr, 2), "processingSeconds": round(time.time() - started, 1),
        "stems": written, "outDir": out_dir, **fallback,
    }
