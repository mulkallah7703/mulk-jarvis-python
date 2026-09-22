"""Sentence pipeline speaks each finished sentence in order."""

from __future__ import annotations

import io
import unittest
import wave

import numpy as np

from jarvis.control import Control
from jarvis.speaker import Speaker


def _wav(text: str) -> bytes:
    # A short tone so decode has real samples. Text only affects the caller.
    del text
    samples = (np.sin(np.linspace(0, 8, 800)) * 4000).astype(np.int16)
    buf = io.BytesIO()
    with wave.open(buf, "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(16000)
        handle.writeframes(samples.tobytes())
    return buf.getvalue()


class _TTS:
    name = "edge"

    def __init__(self) -> None:
        self.spoken: list[str] = []

    def synthesize(self, text: str) -> bytes:
        self.spoken.append(text)
        return _wav(text)


class _Player:
    def __init__(self) -> None:
        self.rates: list[int] = []

    def stop(self) -> None:
        return None

    def play(self, pcm, rate: int, still_ok) -> None:
        self.rates.append(rate)
        if not still_ok():
            return


class SpeakerTests(unittest.TestCase):
    def test_streams_sentences_in_order(self) -> None:
        tts = _TTS()
        speaker = Speaker(tts, Control(), enabled=True)
        speaker.player = _Player()

        def tokens():
            yield "Hello. "
            yield "This is the next sentence."

        speaker.say_stream(tokens())
        self.assertEqual(tts.spoken, ["Hello.", "This is the next sentence."])
        self.assertEqual(speaker.player.rates, [16000, 16000])


if __name__ == "__main__":
    unittest.main()
