"""Microphone capture and energy-based end-of-speech detection."""

from __future__ import annotations

import queue
import sys
from collections import deque
from collections.abc import Callable
from dataclasses import dataclass

import numpy as np

from jarvis.config import Settings
from jarvis.control import Control

MIC_HELP = """
No working microphone.
  Linux:   sudo apt install libportaudio2
           then: python -m jarvis --list-devices
           set INPUT_DEVICE in .env if the default mic is wrong.
  macOS:   System Settings → Privacy → Microphone, allow your terminal.
           brew install portaudio   (only if the pip install failed)
  Windows: Settings → Privacy → Microphone, allow desktop apps.
           python -m jarvis --list-devices
Keyboard fallback (no mic): python -m jarvis --text
""".strip()


class MicError(RuntimeError):
    """The input device could not be opened."""


def _friendly_mic_error(exc: Exception) -> str:
    message = str(exc)
    if "device -1" in message or "no default" in message.lower():
        return "No microphone was found."
    return message


def probe_input(settings: Settings) -> None:
    """Fail fast when this machine has no usable input device."""
    import sounddevice as sd

    device = parse_device(settings.input_device)
    try:
        info = sd.query_devices(device, "input")
    except Exception as exc:
        raise MicError(_friendly_mic_error(exc)) from exc
    if int(info.get("max_input_channels") or 0) < 1:
        raise MicError("No microphone was found.")


@dataclass
class VadConfig:
    sample_rate: int = 16000
    frame_ms: int = 30
    silence_ms: int = 650
    min_speech_ms: int = 250
    max_utterance_s: float = 18.0
    min_rms: float = 0.008
    multiplier: float = 2.8
    preroll_ms: int = 300
    start_frames: int = 3


def parse_device(value: str) -> int | str | None:
    """PortAudio device index, a name fragment, or the host default."""
    text = value.strip()
    if not text:
        return None
    if text.lstrip("-").isdigit():
        return int(text)
    return text


def resample_linear(audio: np.ndarray, src_rate: int, dst_rate: int) -> np.ndarray:
    """Resample mono audio. Speech does not need a high-quality resampler."""
    samples = np.asarray(audio, dtype=np.float32).reshape(-1)
    if src_rate == dst_rate or samples.size == 0:
        return samples
    dst_len = int(samples.size * dst_rate / src_rate)
    if dst_len <= 0:
        return np.zeros(0, dtype=np.float32)
    old_x = np.linspace(0.0, 1.0, num=samples.size, endpoint=False)
    new_x = np.linspace(0.0, 1.0, num=dst_len, endpoint=False)
    return np.interp(new_x, old_x, samples).astype(np.float32)


def rms(frame: np.ndarray) -> float:
    audio = np.asarray(frame, dtype=np.float32).reshape(-1)
    if audio.size == 0:
        return 0.0
    return float(np.sqrt(np.mean(np.square(audio, dtype=np.float64))))


class UtteranceDetector:
    """Keep a noise estimate across phrases and cut one utterance at a time."""

    def __init__(self, config: VadConfig | None = None) -> None:
        self.config = config or VadConfig()
        self.noise = 0.005

    def pull(
        self,
        next_frame: Callable[[], np.ndarray],
        should_stop: Callable[[], bool] | None = None,
    ) -> np.ndarray | None:
        """Block through `next_frame` until one phrase ends.

        `next_frame` raises StopIteration when the source is finished.
        Returns None on cancel, on a too-short blip with no real phrase,
        or when the source ends before enough speech.
        """
        stop = should_stop or (lambda: False)
        cfg = self.config
        frame_ms = max(1, cfg.frame_ms)
        preroll_len = max(1, cfg.preroll_ms // frame_ms)
        silence_needed = max(1, cfg.silence_ms // frame_ms)
        min_speech_frames = max(1, cfg.min_speech_ms // frame_ms)
        max_frames = max(1, int(cfg.max_utterance_s * 1000 / frame_ms))
        preroll: deque[np.ndarray] = deque(maxlen=preroll_len)
        voiced: list[np.ndarray] = []
        hot = 0
        silence_frames = 0
        speech_frames = 0
        in_speech = False

        while not stop():
            try:
                frame = np.asarray(next_frame(), dtype=np.float32).reshape(-1)
            except StopIteration:
                break
            level = rms(frame)
            if not in_speech:
                if level < self.noise:
                    self.noise = 0.9 * self.noise + 0.1 * level
                else:
                    self.noise = 0.98 * self.noise + 0.02 * level
                preroll.append(frame)
                start_th = max(cfg.min_rms, self.noise * cfg.multiplier)
                if level >= start_th:
                    hot += 1
                    if hot >= cfg.start_frames:
                        in_speech = True
                        voiced = list(preroll)
                        speech_frames = hot
                        silence_frames = 0
                else:
                    hot = 0
                continue

            voiced.append(frame)
            end_th = max(cfg.min_rms * 0.55, self.noise * cfg.multiplier * 0.55)
            if level >= end_th:
                speech_frames += 1
                silence_frames = 0
            else:
                silence_frames += 1
                if silence_frames >= silence_needed:
                    if speech_frames >= min_speech_frames:
                        break
                    in_speech = False
                    voiced = []
                    speech_frames = 0
                    silence_frames = 0
                    hot = 0
                    preroll.clear()
            if len(voiced) >= max_frames and speech_frames >= min_speech_frames:
                break

        if not in_speech or speech_frames < min_speech_frames or not voiced:
            return None
        return np.concatenate(voiced).astype(np.float32, copy=False)


def vad_config_from(settings: Settings) -> VadConfig:
    return VadConfig(
        sample_rate=settings.sample_rate,
        silence_ms=settings.vad_silence_ms,
        min_speech_ms=settings.vad_min_speech_ms,
        max_utterance_s=settings.max_utterance_s,
        min_rms=settings.vad_min_rms,
        multiplier=settings.vad_multiplier,
    )


class Framer:
    """Slice a stream of samples into fixed frames."""

    def __init__(self, size: int) -> None:
        self.size = size
        self._buf = np.zeros(0, dtype=np.float32)

    def push(self, audio: np.ndarray) -> list[np.ndarray]:
        self._buf = np.concatenate([self._buf, np.asarray(audio, dtype=np.float32).reshape(-1)])
        frames: list[np.ndarray] = []
        while self._buf.size >= self.size:
            frames.append(self._buf[: self.size].copy())
            self._buf = self._buf[self.size :]
        return frames


class MicrophoneCapture:
    """Always-on mic. `listen` returns one utterance of float32 audio at 16 kHz."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.detector = UtteranceDetector(vad_config_from(settings))

    def listen(self, control: Control) -> np.ndarray | None:
        import sounddevice as sd

        target_rate = self.settings.sample_rate
        device = parse_device(self.settings.input_device)
        try:
            probe_input(self.settings)
            info = sd.query_devices(device, "input")
        except MicError:
            raise
        except Exception as exc:
            raise MicError(_friendly_mic_error(exc)) from exc
        native_rate = int(info.get("default_samplerate") or target_rate)
        frame_size = int(target_rate * self.detector.config.frame_ms / 1000)
        native_block = max(1, int(native_rate * self.detector.config.frame_ms / 1000))
        audio_q: queue.Queue[np.ndarray] = queue.Queue()

        def callback(indata, frames, time_info, status) -> None:  # noqa: ARG001
            if status and self.settings.verbose:
                print(status, file=sys.stderr)
            audio_q.put(np.asarray(indata[:, 0], dtype=np.float32).copy())

        framer = Framer(frame_size)
        pending: deque[np.ndarray] = deque()

        def next_frame() -> np.ndarray:
            while not pending:
                if control.quit.is_set() or control.end_session.is_set():
                    raise StopIteration
                try:
                    block = audio_q.get(timeout=0.2)
                except queue.Empty:
                    continue
                if native_rate != target_rate:
                    block = resample_linear(block, native_rate, target_rate)
                pending.extend(framer.push(block))
            return pending.popleft()

        try:
            stream = sd.InputStream(
                samplerate=native_rate,
                channels=1,
                dtype="float32",
                blocksize=native_block,
                device=device,
                latency="low",
                callback=callback,
            )
        except Exception as exc:
            raise MicError(str(exc)) from exc
        try:
            with stream:
                return self.detector.pull(
                    next_frame,
                    should_stop=lambda: control.quit.is_set() or control.end_session.is_set(),
                )
        except KeyboardInterrupt:
            raise
        except MicError:
            raise
        except Exception as exc:
            raise MicError(str(exc)) from exc


def list_devices() -> None:
    import sounddevice as sd

    print(sd.query_devices())
