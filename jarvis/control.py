"""Shared stop flags for the listen / speak loop."""

from __future__ import annotations

import threading


class Control:
    """Process-wide flags. The mic loop and the speaker both watch these."""

    def __init__(self) -> None:
        self.quit = threading.Event()
        self.end_session = threading.Event()
