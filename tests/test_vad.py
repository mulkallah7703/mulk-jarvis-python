"""Energy VAD and resampling, no microphone required."""

from __future__ import annotations

import unittest

import numpy as np

from jarvis.capture import Framer, UtteranceDetector, VadConfig, resample_linear


def _tone(level: float, count: int, frame: int = 480) -> list[np.ndarray]:
    return [np.full(frame, level, dtype=np.float32) for _ in range(count)]


class VadTests(unittest.TestCase):
    def _pull(self, frames: list[np.ndarray]) -> np.ndarray | None:
        cursor = iter(frames)

        def next_frame() -> np.ndarray:
            return next(cursor)

        detector = UtteranceDetector(
            VadConfig(
                silence_ms=300,
                min_speech_ms=200,
                preroll_ms=90,
                start_frames=3,
                min_rms=0.01,
                multiplier=2.5,
            )
        )
        return detector.pull(next_frame)

    def test_silence_is_ignored(self) -> None:
        self.assertIsNone(self._pull(_tone(0.001, 40)))

    def test_short_blip_is_ignored(self) -> None:
        frames = _tone(0.001, 8) + _tone(0.2, 3) + _tone(0.001, 30)
        self.assertIsNone(self._pull(frames))

    def test_phrase_is_returned(self) -> None:
        frames = _tone(0.001, 6) + _tone(0.2, 20) + _tone(0.001, 20)
        audio = self._pull(frames)
        self.assertIsNotNone(audio)
        assert audio is not None
        self.assertGreater(audio.size, 480 * 8)

    def test_resample_length(self) -> None:
        audio = np.linspace(-0.2, 0.2, 4800, dtype=np.float32)
        out = resample_linear(audio, 48000, 16000)
        self.assertEqual(out.size, 1600)

    def test_framer(self) -> None:
        framer = Framer(4)
        self.assertEqual(len(framer.push(np.ones(3, dtype=np.float32))), 0)
        frames = framer.push(np.ones(5, dtype=np.float32))
        self.assertEqual(len(frames), 2)
        self.assertTrue(np.all(frames[0] == 1))


if __name__ == "__main__":
    unittest.main()
