"""Text-to-speech: edge-tts by default, ElevenLabs when configured."""

from __future__ import annotations

import asyncio
import json
import re
import urllib.request
from typing import Protocol

from jarvis.config import Settings

_ARABIC = re.compile(r"[\u0600-\u06FF]")
_ABBREV = {"mr", "mrs", "ms", "dr", "st", "vs", "prof", "sr", "jr"}


class Synthesizer(Protocol):
    name: str

    def synthesize(self, text: str) -> bytes:
        """Return encoded audio bytes (MP3)."""


def sanitize_speech(text: str) -> str:
    cleaned = re.sub(r"[*_`#]+", "", text or "")
    return re.sub(r"\s+", " ", cleaned).strip()


def _abbreviation(buf: str, dot_index: int) -> bool:
    start = dot_index - 1
    while start >= 0 and buf[start].isalpha():
        start -= 1
    word = buf[start + 1 : dot_index]
    return word.lower() in _ABBREV or len(word) == 1


def _between_digits(buf: str, index: int) -> bool:
    return (
        index > 0
        and index + 1 < len(buf)
        and buf[index - 1].isdigit()
        and buf[index + 1].isdigit()
    )


def _first_sentence_cut(buf: str) -> int | None:
    for index, char in enumerate(buf):
        if char not in ".!?؟…":
            continue
        if char == "." and (_between_digits(buf, index) or _abbreviation(buf, index)):
            continue
        nxt = buf[index + 1] if index + 1 < len(buf) else ""
        if nxt == "" or nxt.isspace() or nxt.isupper():
            return index + 1
    return None


def _clause_span(buf: str) -> tuple[int, int] | None:
    """Start index of a comma and the index just after that comma+space."""
    best: tuple[int, int] | None = None
    for sep in (", ", "، "):
        found = buf.find(sep, 40)
        if found == -1:
            continue
        end = found + len(sep)
        if best is None or found < best[0]:
            best = (found, end)
    return best


def pop_sentences(buf: str) -> tuple[list[str], str]:
    """Pull finished sentences so TTS can start before the model is done."""
    sentences: list[str] = []
    while True:
        buf = buf.lstrip()
        cut = _first_sentence_cut(buf)
        if cut is not None:
            piece = buf[:cut].strip()
            buf = buf[cut:]
            if piece:
                sentences.append(piece)
            continue
        if len(buf) >= 110:
            clause = _clause_span(buf)
            if clause:
                start, end = clause
                piece = buf[:start].strip()
                buf = buf[end:]
                if piece:
                    sentences.append(piece)
                continue
        break
    return sentences, buf


def voice_for_text(text: str, english_voice: str, arabic_voice: str) -> str:
    if _ARABIC.search(text or ""):
        return arabic_voice
    return english_voice


class EdgeTTS:
    """Microsoft edge-tts. Free, no API key, good Arabic and English voices."""

    name = "edge"

    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    def synthesize(self, text: str) -> bytes:
        spoken = sanitize_speech(text)
        if not spoken:
            return b""
        voice = voice_for_text(spoken, self.settings.edge_voice_en, self.settings.edge_voice_ar)
        return _edge_mp3(spoken, voice, self.settings.edge_rate)


def _edge_mp3(text: str, voice: str, rate: str) -> bytes:
    import edge_tts

    communicate = edge_tts.Communicate(text, voice, rate=rate)
    stream_sync = getattr(communicate, "stream_sync", None)
    chunks: list[bytes] = []
    if callable(stream_sync):
        for chunk in stream_sync():
            if chunk.get("type") == "audio":
                chunks.append(chunk["data"])
        if not chunks:
            raise RuntimeError("edge-tts returned no audio")
        return b"".join(chunks)

    async def _run() -> bytes:
        data: list[bytes] = []
        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                data.append(chunk["data"])
        return b"".join(data)

    audio = asyncio.run(_run())
    if not audio:
        raise RuntimeError("edge-tts returned no audio")
    return audio


class ElevenLabsTTS:
    """Optional cloud voice. Selected with TTS_PROVIDER=elevenlabs."""

    name = "elevenlabs"

    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    def synthesize(self, text: str) -> bytes:
        spoken = sanitize_speech(text)
        if not spoken:
            return b""
        voice_id = self.settings.elevenlabs_voice_id
        if not voice_id:
            raise RuntimeError("ELEVENLABS_VOICE_ID is empty")
        url = f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}"
        body = json.dumps(
            {"text": spoken, "model_id": self.settings.elevenlabs_model},
            ensure_ascii=False,
        ).encode("utf-8")
        request = urllib.request.Request(
            url,
            data=body,
            headers={
                "xi-api-key": self.settings.elevenlabs_api_key,
                "Content-Type": "application/json",
                "Accept": "audio/mpeg",
            },
            method="POST",
        )
        with urllib.request.urlopen(request, timeout=20) as response:
            return response.read()


def build_tts(settings: Settings) -> Synthesizer:
    provider = (settings.tts_provider or "edge").lower()
    if provider == "elevenlabs":
        if settings.elevenlabs_api_key and settings.elevenlabs_voice_id:
            return ElevenLabsTTS(settings)
        print("[tts] ElevenLabs is not fully configured. Using edge-tts.", flush=True)
    elif provider != "edge":
        print(f"[tts] Unknown TTS_PROVIDER '{provider}'. Using edge-tts.", flush=True)
    return EdgeTTS(settings)
