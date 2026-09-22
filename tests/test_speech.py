"""Sentence splitting for early TTS."""

from __future__ import annotations

import unittest

from jarvis.tts import pop_sentences, sanitize_speech, voice_for_text


class SpeechTests(unittest.TestCase):
    def test_two_sentences_and_decimal(self) -> None:
        parts, rest = pop_sentences("Pi is 3.14 today. Next one is here.")
        self.assertEqual(parts, ["Pi is 3.14 today.", "Next one is here."])
        self.assertEqual(rest, "")

    def test_keeps_unfinished_tail(self) -> None:
        parts, rest = pop_sentences("Hello. Not done yet")
        self.assertEqual(parts, ["Hello."])
        self.assertEqual(rest, "Not done yet")

    def test_arabic(self) -> None:
        parts, rest = pop_sentences("مرحبا. كيف حالك؟")
        self.assertEqual(parts, ["مرحبا.", "كيف حالك؟"])
        self.assertEqual(rest, "")

    def test_abbreviation(self) -> None:
        parts, rest = pop_sentences("Mr. Smith is here. Thanks.")
        self.assertEqual(parts, ["Mr. Smith is here.", "Thanks."])
        self.assertEqual(rest, "")

    def test_long_clause_starts_early(self) -> None:
        text = (
            "This clause is intentionally long so the splitter can speak "
            "before the period, and then the rest stays for later"
        )
        self.assertGreaterEqual(len(text), 110)
        parts, rest = pop_sentences(text)
        self.assertTrue(parts)
        self.assertIn("later", rest)

    def test_sanitize_and_voice(self) -> None:
        self.assertEqual(sanitize_speech("**Hello**  there"), "Hello there")
        self.assertEqual(
            voice_for_text("Hello Mulk", "en", "ar"),
            "en",
        )
        self.assertEqual(voice_for_text("مرحبا ملك", "en", "ar"), "ar")


if __name__ == "__main__":
    unittest.main()
