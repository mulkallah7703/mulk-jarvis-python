"""Local speech-to-text with faster-whisper."""

from __future__ import annotations

import inspect
import logging
import re

import numpy as np

from jarvis.config import Settings
from jarvis.wake import normalize

_GHOST_RAW = (
    "thanks for watching",
    "thank you for watching",
    "subtitles by the amara.org community",
    "اشتركوا في القناة",
    "ترجمة نانسي قنقر",
)
_GHOSTS = {normalize(phrase) for phrase in _GHOST_RAW}
_BRACKET = re.compile(r"^\[.*\]$")
_INITIAL_PROMPT = "Mulk Allah Alsadi. ملك الله السعدي. Jarvis."


def clean_transcript(text: str) -> str:
    """Drop empty text and the short junk Whisper emits on silence."""
    stripped = (text or "").strip()
    if not stripped or _BRACKET.match(stripped):
        return ""
    if normalize(stripped) in _GHOSTS:
        return ""
    return stripped


def resolve_device(settings: Settings) -> tuple[str, str]:
    """Pick a Whisper device and compute type. CPU uses int8 for speed."""
    device = settings.whisper_device
    compute = settings.whisper_compute_type
    if device == "auto":
        device = "cpu"
        try:
            import ctranslate2

            if ctranslate2.get_cuda_device_count() > 0:
                device = "cuda"
        except Exception:
            device = "cpu"
    if compute == "auto":
        compute = "float16" if device == "cuda" else "int8"
    return device, compute


class WhisperSTT:
    """One loaded model, reused for every utterance."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self._model = None
        self.last_language = ""

    def load(self) -> None:
        logging.getLogger("faster_whisper").setLevel(logging.WARNING)
        logging.getLogger("huggingface_hub").setLevel(logging.ERROR)
        device, compute = resolve_device(self.settings)
        print(f"Loading Whisper ({self.settings.whisper_model}, {device}, {compute})…", flush=True)
        try:
            self._model = self._open_model(device, compute)
        except Exception as exc:
            if compute != "float32" and "compute type" in str(exc).lower():
                print(f"Compute type {compute} is unavailable. Using float32.", flush=True)
                try:
                    self._model = self._open_model(device, "float32")
                except Exception as second:
                    raise self._load_error(second) from second
            else:
                raise self._load_error(exc) from exc
        # First call pays for kernel setup. Do it before the user speaks.
        silence = np.zeros(self.settings.sample_rate // 2, dtype=np.float32)
        self.transcribe(silence)
        print("Whisper ready.", flush=True)

    def _open_model(self, device: str, compute: str):
        from faster_whisper import WhisperModel

        return WhisperModel(
            self.settings.whisper_model,
            device=device,
            compute_type=compute,
        )

    def _load_error(self, exc: Exception) -> RuntimeError:
        return RuntimeError(
            f"Could not load Whisper model '{self.settings.whisper_model}': {exc}. "
            "The first run downloads the model and needs network."
        )

    def transcribe(self, audio: np.ndarray) -> str:
        if self._model is None:
            self.load()
        samples = np.ascontiguousarray(audio, dtype=np.float32).reshape(-1)
        if samples.size < self.settings.sample_rate // 10:
            return ""
        peak = float(np.max(np.abs(samples))) if samples.size else 0.0
        if 0.0 < peak < 0.2:
            samples = np.clip(samples * min(0.9 / peak, 4.0), -1.0, 1.0).astype(np.float32)
        language = self.settings.whisper_language or None
        kwargs = {
            "language": language,
            "beam_size": 1,
            "best_of": 1,
            "temperature": 0.0,
            "condition_on_previous_text": False,
            "vad_filter": False,
            "initial_prompt": _INITIAL_PROMPT,
            "without_timestamps": True,
        }
        signature = inspect.signature(self._model.transcribe)
        kwargs = {key: value for key, value in kwargs.items() if key in signature.parameters}
        segments, info = self._model.transcribe(samples, **kwargs)
        self.last_language = getattr(info, "language", "") or ""
        text = " ".join(segment.text.strip() for segment in segments).strip()
        return clean_transcript(text)
