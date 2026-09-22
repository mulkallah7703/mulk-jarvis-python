"""Wake-word session loop."""

from __future__ import annotations

import re
import signal

from jarvis.config import Settings
from jarvis.control import Control
from jarvis.gemini import MISSING_KEY
from jarvis.wake import is_stop_phrase, match_wake
from jarvis.whisper import clean_transcript

GREETING = "Hi Mulk Allah!"
_ARABIC = re.compile(r"[\u0600-\u06FF]")


def ack_phrase(text: str) -> str:
    if _ARABIC.search(text or ""):
        return "نعم؟"
    return "Yes?"


def goodbye_phrase(text: str) -> str:
    if _ARABIC.search(text or ""):
        return "حاضر."
    return "Okay."


class VoiceJarvis:
    """Idle until the wake word, then answer every utterance until stop."""

    def __init__(self, settings: Settings, capture, stt, chat, speaker, control: Control | None = None) -> None:
        self.settings = settings
        self.capture = capture
        self.stt = stt
        self.chat = chat
        self.speaker = speaker
        self.control = control or Control()
        self.in_session = False

    def run(self, handle_signals: bool = True) -> None:
        if handle_signals:
            self._install_signals()
        self._banner()
        print('Waiting for "mulk"…  (Ctrl+C quits)', flush=True)
        while not self.control.quit.is_set():
            try:
                if self.in_session:
                    self._session_turn()
                else:
                    self._wake_turn()
            except KeyboardInterrupt:
                if self.control.quit.is_set() or not self.in_session:
                    self.control.quit.set()
                    break
                self._end_session(polite=False)
        print("\nBye.", flush=True)

    def _banner(self) -> None:
        tts_name = getattr(self.speaker, "tts", None)
        provider = getattr(tts_name, "name", self.settings.tts_provider)
        print("Mulk Jarvis", flush=True)
        print(
            f"Whisper {self.settings.whisper_model} · "
            f"Gemini {self.settings.gemini_model} · TTS {provider}",
            flush=True,
        )
        if not self.settings.gemini_api_key:
            print(MISSING_KEY, flush=True)

    def _install_signals(self) -> None:
        def handler(signum, frame) -> None:  # noqa: ARG001
            if self.control.quit.is_set() or not self.in_session or self.control.end_session.is_set():
                self.control.quit.set()
                self.speaker.interrupt()
                raise KeyboardInterrupt
            self.control.end_session.set()
            self.speaker.interrupt()
            raise KeyboardInterrupt

        signal.signal(signal.SIGINT, handler)

    def _wake_turn(self) -> None:
        if self.control.quit.is_set():
            return
        audio = self.capture.listen(self.control)
        if self.control.quit.is_set() or audio is None:
            return
        text = clean_transcript(self.stt.transcribe(audio))
        if not text:
            return
        self._show_user("heard", text)
        wake = match_wake(text)
        if wake is None:
            return
        if wake.remainder and is_stop_phrase(wake.remainder):
            return
        self.in_session = True
        print('Session on. Say "stop jarvis" or press Ctrl+C to wait.', flush=True)
        self.speaker.say(GREETING)
        if self.control.quit.is_set():
            return
        if self.control.end_session.is_set() or not self.in_session:
            self._end_session(polite=False)
            return
        if wake.remainder:
            self._answer(wake.remainder)

    def _session_turn(self) -> None:
        if self.control.quit.is_set():
            return
        if self.control.end_session.is_set():
            self._end_session(polite=False)
            return
        audio = self.capture.listen(self.control)
        if self.control.quit.is_set():
            return
        if self.control.end_session.is_set():
            self._end_session(polite=False)
            return
        if audio is None:
            return
        text = clean_transcript(self.stt.transcribe(audio))
        if not text:
            return
        self._show_user("you", text)
        if is_stop_phrase(text):
            self._end_session(polite=True, heard=text)
            return
        wake = match_wake(text)
        if wake and wake.remainder and is_stop_phrase(wake.remainder):
            self._end_session(polite=True, heard=text)
            return
        if wake and not wake.remainder:
            self.speaker.say(ack_phrase(text))
            return
        command = wake.remainder if wake else text
        self._answer(command)

    def _show_user(self, label: str, text: str) -> None:
        if getattr(self.capture, "shows_transcript", False):
            return
        print(f"{label}> {text}", flush=True)

    def _answer(self, command: str) -> None:
        if not command or self.control.quit.is_set() or self.control.end_session.is_set():
            return
        self.speaker.say_stream(self.chat.stream(command))

    def _end_session(self, polite: bool, heard: str = "") -> None:
        if not self.in_session:
            self.control.end_session.clear()
            return
        self.in_session = False
        self.speaker.interrupt()
        self.chat.reset()
        self.control.end_session.clear()
        if polite and not self.control.quit.is_set():
            self.speaker.say(goodbye_phrase(heard))
        if not self.control.quit.is_set():
            print('Waiting for "mulk"…  (Ctrl+C quits)', flush=True)
