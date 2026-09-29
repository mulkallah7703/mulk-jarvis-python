"""Wake word and stop phrase tests."""

from __future__ import annotations

import unittest

from jarvis.wake import is_stop_phrase, match_wake
from jarvis.whisper import clean_transcript


class WakeTests(unittest.TestCase):
    def test_english_wake_and_command(self) -> None:
        hit = match_wake("kora what time is it")
        self.assertIsNotNone(hit)
        assert hit is not None
        self.assertEqual(hit.remainder, "what time is it")
        hit = match_wake("Hey Kora, what time is it?")
        self.assertIsNotNone(hit)
        assert hit is not None
        self.assertEqual(hit.remainder, "what time is it?")

    def test_transcription_variants(self) -> None:
        for phrase in (
            "hey cora",
            "hi kora",
            "korra",
            "corra",
            "qora",
            "kura",
            "كورا",
            "قورا",
            "كُورا",
            "يا كورا",
            "هاي كورا",
        ):
            hit = match_wake(phrase)
            self.assertIsNotNone(hit, phrase)
            assert hit is not None
            self.assertEqual(hit.remainder, "", phrase)

    def test_arabic_command_after_wake(self) -> None:
        hit = match_wake("كورا وش الوقت")
        self.assertIsNotNone(hit)
        assert hit is not None
        self.assertEqual(hit.remainder, "وش الوقت")
        hit = match_wake("يا كورا، وش الوقت؟")
        self.assertIsNotNone(hit)
        assert hit is not None
        self.assertEqual(hit.remainder, "وش الوقت؟")

    def test_ignores_old_wake_and_lookalikes(self) -> None:
        self.assertIsNone(match_wake("mulk"))
        self.assertIsNone(match_wake("ملك"))
        self.assertIsNone(match_wake("Mulk Allah"))
        self.assertIsNone(match_wake("core"))
        self.assertIsNone(match_wake("corner office"))
        self.assertIsNone(match_wake("chorus"))
        self.assertIsNone(match_wake("كورة"))
        self.assertIsNone(match_wake("hello there"))

    def test_stop_phrases(self) -> None:
        self.assertTrue(is_stop_phrase("Stop Jarvis!"))
        self.assertTrue(is_stop_phrase("please stop jarvis"))
        self.assertTrue(is_stop_phrase("stop kora"))
        self.assertTrue(is_stop_phrase("توقف كورا"))
        self.assertTrue(is_stop_phrase("goodbye"))
        self.assertTrue(is_stop_phrase("توقف"))
        self.assertTrue(is_stop_phrase("توقف؟"))
        self.assertTrue(is_stop_phrase("مع السلامة"))
        self.assertFalse(is_stop_phrase("stop the music"))
        self.assertFalse(is_stop_phrase("mulk what is the stop jarvis about"))

    def test_ghost_transcripts(self) -> None:
        self.assertEqual(clean_transcript("Thanks for watching."), "")
        self.assertEqual(clean_transcript("[music]"), "")
        self.assertEqual(clean_transcript("اشتركوا في القناة"), "")
        self.assertEqual(clean_transcript("What time is it?"), "What time is it?")


if __name__ == "__main__":
    unittest.main()
