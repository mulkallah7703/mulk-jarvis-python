"""Settings and Gemini history, no network."""

from __future__ import annotations

import os
import unittest
from types import SimpleNamespace

from jarvis.config import default_settings, load_settings
from jarvis.gemini import MISSING_KEY, GeminiChat, speakable_error, visible_text


class ConfigTests(unittest.TestCase):
    def test_defaults(self) -> None:
        settings = default_settings()
        self.assertEqual(settings.whisper_model, "base")
        self.assertEqual(settings.tts_provider, "edge")
        self.assertEqual(settings.gemini_model, "gemini-2.5-flash")
        self.assertEqual(settings.edge_voice_ar, "ar-SA-HamedNeural")

    def test_env_keys(self) -> None:
        previous = {name: os.environ.get(name) for name in ("GEMINI_API_KEY", "GOOGLE_API_KEY", "WHISPER_MODEL", "TTS_PROVIDER")}
        try:
            os.environ.pop("GEMINI_API_KEY", None)
            os.environ["GOOGLE_API_KEY"] = "from-google"
            os.environ["WHISPER_MODEL"] = "small"
            os.environ["TTS_PROVIDER"] = "elevenlabs"
            settings = load_settings()
            self.assertEqual(settings.gemini_api_key, "from-google")
            self.assertEqual(settings.whisper_model, "small")
            self.assertEqual(settings.tts_provider, "elevenlabs")
            os.environ["GEMINI_API_KEY"] = "from-gemini"
            settings = load_settings()
            self.assertEqual(settings.gemini_api_key, "from-gemini")
        finally:
            for name, value in previous.items():
                if value is None:
                    os.environ.pop(name, None)
                else:
                    os.environ[name] = value


class GeminiTests(unittest.TestCase):
    def test_missing_key_does_not_call_the_model(self) -> None:
        def boom(_history):
            raise AssertionError("model should not be called")
            yield  # pragma: no cover

        chat = GeminiChat(default_settings(gemini_api_key=""), complete=None)
        # complete=None and empty key must speak the setup hint.
        self.assertIsNone(chat._complete)
        spoken = list(chat.stream("hello"))
        self.assertEqual(spoken, [MISSING_KEY])
        self.assertEqual(chat.history[-1]["role"], "model")
        # The injected complete is not used above. Guard the helper anyway.
        del boom

    def test_history_and_trim(self) -> None:
        seen: list[list[dict[str, str]]] = []

        def complete(history):
            seen.append(list(history))
            yield "ok"

        chat = GeminiChat(default_settings(history_turns=2), complete=complete)
        for index in range(5):
            self.assertEqual(list(chat.stream(f"q{index}")), ["ok"])
        self.assertLessEqual(len(chat.history), 4)
        self.assertEqual(seen[0][-1]["text"], "q0")
        self.assertEqual(chat.history[-1]["text"], "ok")
        chat.reset()
        self.assertEqual(chat.history, [])

    def test_visible_text_skips_thoughts(self) -> None:
        chunk = SimpleNamespace(
            text="hidden plus visible",
            candidates=[
                SimpleNamespace(
                    content=SimpleNamespace(
                        parts=[
                            SimpleNamespace(text="secret", thought=True),
                            SimpleNamespace(text="Hello.", thought=False),
                        ]
                    )
                )
            ],
        )
        self.assertEqual(visible_text(chunk), "Hello.")
        plain = SimpleNamespace(text="Just text", candidates=None)
        self.assertEqual(visible_text(plain), "Just text")

    def test_errors_stay_generic(self) -> None:
        self.assertIn("API key", speakable_error(RuntimeError("401 invalid api key abc")))
        self.assertNotIn("abc", speakable_error(RuntimeError("401 invalid api key abc")))
        self.assertIn("Gemini", speakable_error(RuntimeError("timed out")))


if __name__ == "__main__":
    unittest.main()
