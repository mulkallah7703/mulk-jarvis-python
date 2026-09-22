"""Speak fixed lines and stream model sentences with a small synth pipeline."""

from __future__ import annotations

import queue
import sys
import threading
from collections.abc import Iterator

from jarvis.control import Control
from jarvis.playback import AudioPlayer, decode_audio
from jarvis.tts import Synthesizer, pop_sentences, sanitize_speech

_DONE = object()


class Speaker:
    def __init__(
        self,
        tts: Synthesizer,
        control: Control,
        output_device: str = "",
        enabled: bool = True,
    ) -> None:
        self.tts = tts
        self.control = control
        self.enabled = enabled
        self.player = AudioPlayer(output_device)
        self._cache: dict[str, tuple] = {}
        self._epoch = 0
        self._playback_broken = False
        self._lock = threading.Lock()

    def interrupt(self) -> None:
        with self._lock:
            self._epoch += 1
        self.player.stop()

    def _epoch_now(self) -> int:
        with self._lock:
            return self._epoch

    def warm(self, phrases: list[str]) -> None:
        if not self.enabled:
            return
        for phrase in phrases:
            try:
                self._cache[phrase] = self._synthesize(phrase)
            except Exception as exc:
                print(f"[tts] warmup skipped ({exc})", flush=True)
                return

    def say(self, text: str) -> None:
        text = sanitize_speech(text)
        if not text:
            return
        epoch = self._epoch_now()
        print(f"jarvis> {text}", flush=True)
        if not self.enabled or self._playback_broken or epoch != self._epoch_now():
            return
        try:
            pcm, rate = self._cached(text)
        except Exception as exc:
            print(f"[tts] {exc}", flush=True)
            return
        if epoch != self._epoch_now() or self.control.quit.is_set():
            return
        self._play(pcm, rate, epoch)

    def say_stream(self, tokens: Iterator[str]) -> None:
        """Print tokens as they arrive and speak each finished sentence."""
        if not self.enabled or self._playback_broken:
            text = sanitize_speech("".join(tokens))
            if text:
                print(f"jarvis> {text}", flush=True)
            return

        epoch = self._epoch_now()
        sentences: queue.Queue = queue.Queue()
        audio_q: queue.Queue = queue.Queue()

        def produce() -> None:
            buf = ""
            started = False
            try:
                for token in tokens:
                    if epoch != self._epoch_now() or self.control.quit.is_set():
                        break
                    if not token:
                        continue
                    if not started:
                        sys.stdout.write("jarvis> ")
                        sys.stdout.flush()
                        started = True
                    sys.stdout.write(token)
                    sys.stdout.flush()
                    buf += token
                    ready, buf = pop_sentences(buf)
                    for sentence in ready:
                        sentences.put(sentence)
                tail = buf.strip()
                if tail and epoch == self._epoch_now():
                    sentences.put(tail)
            finally:
                closer = getattr(tokens, "close", None)
                if closer is not None:
                    try:
                        closer()
                    except Exception:
                        pass
                if started:
                    sys.stdout.write("\n")
                    sys.stdout.flush()
                sentences.put(_DONE)

        def synth() -> None:
            try:
                while True:
                    item = sentences.get()
                    if item is _DONE or epoch != self._epoch_now():
                        break
                    try:
                        audio_q.put(self._cached(sanitize_speech(str(item))))
                    except Exception as exc:
                        print(f"\n[tts] {exc}", flush=True)
            finally:
                audio_q.put(_DONE)

        threading.Thread(target=produce, name="jarvis-tokens", daemon=True).start()
        threading.Thread(target=synth, name="jarvis-tts", daemon=True).start()

        while True:
            item = audio_q.get()
            if item is _DONE or item is None:
                if item is _DONE:
                    break
                continue
            if epoch != self._epoch_now() or self.control.quit.is_set() or self.control.end_session.is_set():
                break
            pcm, rate = item
            self._play(pcm, rate, epoch)

    def _cached(self, text: str) -> tuple:
        cached = self._cache.get(text)
        if cached is not None:
            return cached
        return self._synthesize(text)

    def _synthesize(self, text: str) -> tuple:
        encoded = self.tts.synthesize(text)
        if not encoded:
            raise RuntimeError("synthesizer returned empty audio")
        return decode_audio(encoded)

    def _play(self, pcm, rate: int, epoch: int) -> None:
        if self._playback_broken:
            return

        def still_ok() -> bool:
            return (
                epoch == self._epoch_now()
                and not self.control.quit.is_set()
                and not self.control.end_session.is_set()
            )

        try:
            self.player.play(pcm, rate, still_ok)
        except Exception as exc:
            self._playback_broken = True
            print(f"[audio] playback unavailable ({exc}). Replies will be printed.", flush=True)
