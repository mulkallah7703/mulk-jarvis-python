"""Environment configuration."""

from __future__ import annotations

import os
from dataclasses import dataclass


def _env(name: str, default: str = "") -> str:
    return os.environ.get(name, default).strip()


def _env_int(name: str, default: int) -> int:
    raw = _env(name)
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError:
        return default


def _env_float(name: str, default: float) -> float:
    raw = _env(name)
    if not raw:
        return default
    try:
        return float(raw)
    except ValueError:
        return default


@dataclass(frozen=True)
class Settings:
    gemini_api_key: str
    gemini_model: str
    whisper_model: str
    whisper_device: str
    whisper_compute_type: str
    whisper_language: str
    tts_provider: str
    edge_voice_en: str
    edge_voice_ar: str
    edge_rate: str
    elevenlabs_api_key: str
    elevenlabs_voice_id: str
    elevenlabs_model: str
    sample_rate: int
    input_device: str
    output_device: str
    vad_silence_ms: int
    vad_min_speech_ms: int
    vad_min_rms: float
    vad_multiplier: float
    max_utterance_s: float
    history_turns: int
    verbose: bool = False


def default_settings(**overrides: object) -> Settings:
    """Build settings, using overrides on top of the documented defaults."""
    values: dict[str, object] = {
        "gemini_api_key": "",
        "gemini_model": "gemini-2.5-flash",
        "whisper_model": "base",
        "whisper_device": "auto",
        "whisper_compute_type": "auto",
        "whisper_language": "",
        "tts_provider": "edge",
        "edge_voice_en": "en-US-GuyNeural",
        "edge_voice_ar": "ar-SA-HamedNeural",
        "edge_rate": "+12%",
        "elevenlabs_api_key": "",
        "elevenlabs_voice_id": "",
        "elevenlabs_model": "eleven_flash_v2_5",
        "sample_rate": 16000,
        "input_device": "",
        "output_device": "",
        "vad_silence_ms": 650,
        "vad_min_speech_ms": 250,
        "vad_min_rms": 0.008,
        "vad_multiplier": 2.8,
        "max_utterance_s": 18.0,
        "history_turns": 6,
        "verbose": False,
    }
    values.update(overrides)
    return Settings(**values)  # type: ignore[arg-type]


def load_settings() -> Settings:
    """Read process environment. A local `.env` fills any missing keys."""
    try:
        from dotenv import load_dotenv
    except ImportError:
        pass
    else:
        load_dotenv(override=False)

    provider = _env("TTS_PROVIDER", "edge").lower() or "edge"
    return default_settings(
        gemini_api_key=_env("GEMINI_API_KEY") or _env("GOOGLE_API_KEY"),
        gemini_model=_env("GEMINI_MODEL", "gemini-2.5-flash"),
        whisper_model=_env("WHISPER_MODEL", "base"),
        whisper_device=_env("WHISPER_DEVICE", "auto").lower() or "auto",
        whisper_compute_type=_env("WHISPER_COMPUTE_TYPE", "auto").lower() or "auto",
        whisper_language=_env("WHISPER_LANGUAGE").lower(),
        tts_provider=provider,
        edge_voice_en=_env("EDGE_VOICE_EN", "en-US-GuyNeural"),
        edge_voice_ar=_env("EDGE_VOICE_AR", "ar-SA-HamedNeural"),
        edge_rate=_env("EDGE_TTS_RATE", "+12%"),
        elevenlabs_api_key=_env("ELEVENLABS_API_KEY"),
        elevenlabs_voice_id=_env("ELEVENLABS_VOICE_ID"),
        elevenlabs_model=_env("ELEVENLABS_MODEL_ID", "eleven_flash_v2_5"),
        sample_rate=_env_int("SAMPLE_RATE", 16000),
        input_device=_env("INPUT_DEVICE"),
        output_device=_env("OUTPUT_DEVICE"),
        vad_silence_ms=_env_int("VAD_SILENCE_MS", 650),
        vad_min_speech_ms=_env_int("VAD_MIN_SPEECH_MS", 250),
        vad_min_rms=_env_float("VAD_MIN_RMS", 0.008),
        vad_multiplier=_env_float("VAD_MULTIPLIER", 2.8),
        max_utterance_s=_env_float("MAX_UTTERANCE_S", 18.0),
        history_turns=_env_int("HISTORY_TURNS", 6),
    )
