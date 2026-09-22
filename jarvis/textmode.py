"""Keyboard input for machines without a microphone."""

from __future__ import annotations

from jarvis.control import Control


class TextCapture:
    """Typed lines. The terminal already shows what the user entered."""

    shows_transcript = True

    def listen(self, control: Control) -> str | None:
        if control.quit.is_set() or control.end_session.is_set():
            return None
        try:
            line = input("> ").strip()
        except EOFError:
            control.quit.set()
            return None
        if control.quit.is_set() or control.end_session.is_set():
            return None
        return line or None


class IdentitySTT:
    """Typed text is already a transcript."""

    def load(self) -> None:
        return None

    def transcribe(self, audio: str) -> str:
        return (audio or "").strip()
