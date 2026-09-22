"""Session loop with scripted audio and a fake model."""

from __future__ import annotations

import unittest

from jarvis.config import default_settings
from jarvis.control import Control
from jarvis.loop import GREETING, VoiceJarvis


class ScriptedCapture:
    def __init__(self, items: list[str]) -> None:
        self.items = list(items)

    def listen(self, control: Control) -> str | None:
        if control.quit.is_set():
            return None
        if not self.items:
            control.quit.set()
            return None
        item = self.items.pop(0)
        if item == "__BREAK__":
            control.end_session.set()
            return None
        return item


class FakeSTT:
    def transcribe(self, audio: str) -> str:
        return audio


class FakeChat:
    def __init__(self) -> None:
        self.queries: list[str] = []
        self.reset_count = 0

    def stream(self, text: str):
        self.queries.append(text)
        yield f"echo {text}"

    def reset(self) -> None:
        self.reset_count += 1


class FakeSpeaker:
    def __init__(self) -> None:
        self.lines: list[str] = []

    def say(self, text: str) -> None:
        self.lines.append(text)

    def say_stream(self, tokens) -> None:
        self.lines.append("".join(tokens))

    def interrupt(self) -> None:
        return None


class LoopTests(unittest.TestCase):
    def _run(self, lines: list[str]) -> tuple[FakeSpeaker, FakeChat]:
        control = Control()
        speaker = FakeSpeaker()
        chat = FakeChat()
        app = VoiceJarvis(
            default_settings(),
            ScriptedCapture(lines),
            FakeSTT(),
            chat,
            speaker,
            control,
        )
        app.run(handle_signals=False)
        return speaker, chat

    def test_wake_session_and_stop(self) -> None:
        speaker, chat = self._run(
            [
                "just noise",
                "mulk",
                "how are you",
                "mulk",
                "stop jarvis",
                "what time is it",
                "mulk what is two plus two",
            ]
        )
        self.assertEqual(
            speaker.lines,
            [
                GREETING,
                "echo how are you",
                "Yes?",
                "Okay.",
                GREETING,
                "echo what is two plus two",
            ],
        )
        self.assertEqual(chat.queries, ["how are you", "what is two plus two"])
        self.assertEqual(chat.reset_count, 1)

    def test_ctrl_c_returns_to_wake_without_goodbye(self) -> None:
        speaker, chat = self._run(
            ["mulk", "how are you", "__BREAK__", "what time is it"]
        )
        self.assertEqual(speaker.lines, [GREETING, "echo how are you"])
        self.assertEqual(chat.queries, ["how are you"])
        self.assertEqual(chat.reset_count, 1)

    def test_arabic_session(self) -> None:
        speaker, chat = self._run(["ملك", "كم الساعة", "توقف"])
        self.assertEqual(
            speaker.lines,
            [GREETING, "echo كم الساعة", "حاضر."],
        )
        self.assertEqual(chat.queries, ["كم الساعة"])


if __name__ == "__main__":
    unittest.main()
