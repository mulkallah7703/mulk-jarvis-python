"""TTS provider selection and ElevenLabs request shape."""

from __future__ import annotations

import json
import unittest
from unittest import mock

from jarvis.config import default_settings
from jarvis.tts import EdgeTTS, ElevenLabsTTS, build_tts


class TTSTests(unittest.TestCase):
    def test_edge_is_default(self) -> None:
        tts = build_tts(default_settings())
        self.assertIsInstance(tts, EdgeTTS)
        self.assertEqual(tts.name, "edge")

    def test_elevenlabs_falls_back_without_a_key(self) -> None:
        tts = build_tts(default_settings(tts_provider="elevenlabs"))
        self.assertIsInstance(tts, EdgeTTS)

    def test_elevenlabs_when_configured(self) -> None:
        tts = build_tts(
            default_settings(
                tts_provider="elevenlabs",
                elevenlabs_api_key="key",
                elevenlabs_voice_id="voice",
            )
        )
        self.assertIsInstance(tts, ElevenLabsTTS)

    def test_elevenlabs_request(self) -> None:
        tts = ElevenLabsTTS(
            default_settings(
                elevenlabs_api_key="secret",
                elevenlabs_voice_id="voice123",
                elevenlabs_model="eleven_flash_v2_5",
            )
        )

        class _Response:
            def read(self) -> bytes:
                return b"mp3-bytes"

            def __enter__(self):
                return self

            def __exit__(self, *args) -> bool:
                return False

        seen: dict = {}

        def fake_urlopen(request, timeout=0):
            seen["url"] = request.full_url
            seen["timeout"] = timeout
            seen["headers"] = dict(request.header_items())
            seen["body"] = json.loads(request.data.decode("utf-8"))
            return _Response()

        with mock.patch("urllib.request.urlopen", fake_urlopen):
            audio = tts.synthesize("مرحبا")
        self.assertEqual(audio, b"mp3-bytes")
        self.assertEqual(
            seen["url"],
            "https://api.elevenlabs.io/v1/text-to-speech/voice123",
        )
        self.assertEqual(seen["body"]["model_id"], "eleven_flash_v2_5")
        self.assertEqual(seen["body"]["text"], "مرحبا")
        header_key = {name.lower(): value for name, value in seen["headers"].items()}
        self.assertEqual(header_key.get("xi-api-key"), "secret")


if __name__ == "__main__":
    unittest.main()
