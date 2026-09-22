"""WAV decode used before playback."""

from __future__ import annotations

import io
import unittest
import wave

import numpy as np

from jarvis.playback import decode_wav


class PlaybackTests(unittest.TestCase):
    def test_wav_roundtrip(self) -> None:
        samples = (np.sin(np.linspace(0, 20, 1600)) * 8000).astype(np.int16)
        buf = io.BytesIO()
        with wave.open(buf, "wb") as handle:
            handle.setnchannels(1)
            handle.setsampwidth(2)
            handle.setframerate(16000)
            handle.writeframes(samples.tobytes())
        audio, rate = decode_wav(buf.getvalue())
        self.assertEqual(rate, 16000)
        self.assertEqual(audio.size, samples.size)
        self.assertLess(abs(float(audio[10]) - samples[10] / 32768.0), 0.001)


if __name__ == "__main__":
    unittest.main()
