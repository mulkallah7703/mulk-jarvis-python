"""Decode speech audio and play it on the output device."""

from __future__ import annotations

import io
import time
import wave
from collections.abc import Callable

import numpy as np

from jarvis.capture import parse_device


def decode_wav(data: bytes) -> tuple[np.ndarray, int]:
    with wave.open(io.BytesIO(data), "rb") as handle:
        rate = handle.getframerate()
        channels = handle.getnchannels()
        width = handle.getsampwidth()
        raw = handle.readframes(handle.getnframes())
    if width == 2:
        audio = np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32768.0
    elif width == 4:
        audio = np.frombuffer(raw, dtype="<i4").astype(np.float32) / 2147483648.0
    else:
        raise ValueError(f"unsupported wav sample width: {width}")
    if channels > 1:
        audio = audio.reshape(-1, channels).mean(axis=1)
    return np.ascontiguousarray(audio, dtype=np.float32), rate


def decode_compressed(data: bytes) -> tuple[np.ndarray, int]:
    """Decode MP3 (edge-tts / ElevenLabs) with PyAV, which Whisper already needs."""
    import av

    container = av.open(io.BytesIO(data))
    try:
        stream = container.streams.audio[0]
        rate = int(stream.codec_context.sample_rate or stream.rate or 24000)
        resampler = av.audio.resampler.AudioResampler(format="fltp", layout="mono", rate=rate)
        pieces: list[np.ndarray] = []

        def consume(frames) -> None:
            if frames is None:
                return
            if not isinstance(frames, list):
                frames = [frames]
            for frame in frames:
                if frame is None:
                    continue
                arr = np.asarray(frame.to_ndarray(), dtype=np.float32).reshape(-1)
                if arr.size:
                    pieces.append(arr)

        for frame in container.decode(audio=0):
            consume(resampler.resample(frame))
        consume(resampler.resample(None))
    finally:
        container.close()
    if not pieces:
        raise RuntimeError("decoded audio was empty")
    audio = np.concatenate(pieces).astype(np.float32)
    peak = float(np.max(np.abs(audio))) if audio.size else 1.0
    if peak > 1.5:
        audio = audio / peak
    return np.clip(audio, -1.0, 1.0), rate


def decode_audio(data: bytes) -> tuple[np.ndarray, int]:
    if not data:
        raise RuntimeError("no audio bytes")
    if data[:4] == b"RIFF":
        return decode_wav(data)
    return decode_compressed(data)


class AudioPlayer:
    def __init__(self, output_device: str = "") -> None:
        self.output_device = parse_device(output_device)

    def stop(self) -> None:
        try:
            import sounddevice as sd

            sd.stop()
        except Exception:
            return

    def play(
        self,
        pcm: np.ndarray,
        rate: int,
        still_ok: Callable[[], bool],
    ) -> None:
        import sounddevice as sd

        samples = np.ascontiguousarray(np.clip(pcm, -1.0, 1.0), dtype=np.float32)
        if samples.size == 0 or not still_ok():
            return
        sd.play(samples, samplerate=rate, device=self.output_device)
        while still_ok():
            try:
                active = sd.get_stream().active
            except Exception:
                return
            if not active:
                return
            time.sleep(0.04)
        sd.stop()
