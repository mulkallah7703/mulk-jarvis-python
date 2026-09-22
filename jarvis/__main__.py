"""Entry point for `python -m jarvis`."""

from __future__ import annotations

import argparse
import sys
import threading

from jarvis import __version__
from jarvis.config import load_settings
from jarvis.control import Control
from jarvis.gemini import GeminiChat
from jarvis.loop import GREETING, VoiceJarvis
from jarvis.speaker import Speaker
from jarvis.tts import build_tts


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="jarvis",
        description="Mulk Jarvis — local wake word, Whisper, Gemini, and speech.",
    )
    parser.add_argument("--text", action="store_true", help="Type instead of using the microphone")
    parser.add_argument("--list-devices", action="store_true", help="Print audio input and output devices")
    parser.add_argument("--no-audio", action="store_true", help="Print replies without speaking them")
    parser.add_argument("-v", "--verbose", action="store_true", help="Print extra audio diagnostics")
    parser.add_argument("--version", action="store_true", help="Print the version and exit")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    if args.version:
        print(__version__)
        return 0
    if args.list_devices:
        from jarvis.capture import list_devices

        try:
            list_devices()
        except Exception as exc:
            print(exc, file=sys.stderr)
            from jarvis.capture import MIC_HELP

            print(MIC_HELP, file=sys.stderr)
            return 1
        return 0

    if sys.version_info < (3, 10):
        print("Python 3.10 or newer is required.", file=sys.stderr)
        return 1

    settings = load_settings()
    if args.verbose:
        settings = type(settings)(**{**settings.__dict__, "verbose": True})

    control = Control()
    tts = build_tts(settings)
    speaker = Speaker(
        tts,
        control,
        output_device=settings.output_device,
        enabled=not args.no_audio,
    )
    chat = GeminiChat(settings)

    if args.text:
        from jarvis.textmode import IdentitySTT, TextCapture

        capture = TextCapture()
        stt = IdentitySTT()
        print("Text mode. Type the way you would speak. Blank line is ignored.", flush=True)
    else:
        from jarvis.capture import MIC_HELP, MicError, MicrophoneCapture, probe_input
        from jarvis.whisper import WhisperSTT

        try:
            probe_input(settings)
        except MicError as exc:
            print(exc, file=sys.stderr)
            print(MIC_HELP, file=sys.stderr)
            return 1
        capture = MicrophoneCapture(settings)
        stt = WhisperSTT(settings)
        warmer = threading.Thread(
            target=lambda: speaker.warm([GREETING, "Okay.", "حاضر.", "Yes?", "نعم؟"]),
            name="jarvis-warm-tts",
            daemon=True,
        )
        gemini_warm = threading.Thread(target=chat.warmup, name="jarvis-warm-gemini", daemon=True)
        warmer.start()
        gemini_warm.start()
        try:
            stt.load()
        except Exception as exc:
            print(exc, file=sys.stderr)
            return 1
        warmer.join()

    app = VoiceJarvis(settings, capture, stt, chat, speaker, control)
    from jarvis.capture import MicError

    try:
        app.run(handle_signals=True)
    except MicError as exc:
        from jarvis.capture import MIC_HELP

        print(exc, file=sys.stderr)
        print(MIC_HELP, file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print("\nBye.", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
