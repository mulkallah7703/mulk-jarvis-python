"""Wake word and stop phrase tests."""

from __future__ import annotations

import unittest

from jarvis.wake import is_stop_phrase, match_wake
from jarvis.whisper import clean_transcript


class WakeTests(unittest.TestCase):
    def test_english_wake_and_command(self) -> None:
        hit = match_wake("Hey Mulk, what time is it?")
        self.assertIsNotNone(hit)
        assert hit is not None
        self.assertEqual(hit.remainder, "what time is it?")

    def test_full_name_is_only_a_wake(self) -> None:
        hit = match_wake("Mulk Allah Alsadi")
        self.assertIsNotNone(hit)
        assert hit is not None
        self.assertEqual(hit.remainder, "")

    def test_arabic_wake(self) -> None:
        for phrase in ("ملك", "مُلْك", "ملك الله", "مولك"):
            hit = match_wake(phrase)
            self.assertIsNotNone(hit, phrase)
            assert hit is not None
            self.assertEqual(hit.remainder, "", phrase)

    def test_arabic_command_after_wake(self) -> None:
        hit = match_wake("ملك كم الساعة")
        self.assertIsNotNone(hit)
        assert hit is not None
        self.assertEqual(hit.remainder, "كم الساعة")
        hit = match_wake("ملك الله، كم الساعة؟")
        self.assertIsNotNone(hit)
        assert hit is not None
        self.assertEqual(hit.remainder, "كم الساعة؟")

    def test_ignores_lookalikes(self) -> None:
        self.assertIsNone(match_wake("the milk is cold"))
        self.assertIsNone(match_wake("المملكة العربية"))
        self.assertIsNone(match_wake("hello there"))

    def test_mishear_malk(self) -> None:
        hit = match_wake("malk tell me a joke")
        self.assertIsNotNone(hit)
        assert hit is not None
        self.assertEqual(hit.remainder, "tell me a joke")

    def test_stop_phrases(self) -> None:
        self.assertTrue(is_stop_phrase("Stop Jarvis!"))
        self.assertTrue(is_stop_phrase("please stop jarvis"))
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
