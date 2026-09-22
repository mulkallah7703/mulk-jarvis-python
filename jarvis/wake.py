"""Wake-word and stop-phrase matching for Arabic and English."""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass

_ARABIC_MAP = str.maketrans(
    {
        "أ": "ا",
        "إ": "ا",
        "آ": "ا",
        "ٱ": "ا",
        "ى": "ي",
        "ة": "ه",
        "ؤ": "و",
        "ئ": "ي",
        "ـ": "",
    }
)

# Longer phrases are listed first only for readability. Matching picks the
# earliest token, then the longest phrase at that position.
_WAKE_RAW = (
    "mulk allah alsadi",
    "ملك الله السعدي",
    "mulk allah",
    "ملك الله",
    "mulkallah",
    "mulk",
    "malk",
    "molk",
    "ملك",
    "مولك",
)

_STOP_RAW = (
    "stop jarvis",
    "goodbye jarvis",
    "exit jarvis",
    "quit jarvis",
    "jarvis stop",
    "jarvis goodbye",
    "stop",
    "goodbye",
    "exit",
    "quit",
    "go to sleep",
    "shutdown",
    "shut down",
    "توقف",
    "اوقف",
    "أوقف",
    "وقف",
    "خلاص",
    "مع السلامة",
    "اوقف جارفس",
    "أوقف جارفس",
    "اوقف جارفيز",
    "وقف يا جارفس",
    "توقف يا جارفس",
    "يا جارفس توقف",
)

_POLITE = re.compile(
    r"\b(please|now)\b|لو سمحت|من فضلك",
    re.IGNORECASE,
)


def normalize(text: str) -> str:
    """Lowercase, strip Arabic diacritics and punctuation, collapse space."""
    text = text.strip().lower().translate(_ARABIC_MAP)
    text = unicodedata.normalize("NFKD", text)
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    # Arabic comma and question mark live inside the Arabic block, so a
    # generic "keep Arabic letters" range would also keep that punctuation.
    text = "".join(ch if (ch.isalnum() or ch.isspace()) else " " for ch in text)
    return re.sub(r"\s+", " ", text).strip()


def _phrase_tokens(phrases: tuple[str, ...]) -> list[list[str]]:
    tokenized: list[list[str]] = []
    seen: set[tuple[str, ...]] = set()
    for phrase in phrases:
        tokens = tuple(normalize(phrase).split())
        if tokens and tokens not in seen:
            seen.add(tokens)
            tokenized.append(list(tokens))
    return tokenized


_WAKE_PHRASES = _phrase_tokens(_WAKE_RAW)
_STOP_PHRASES = {" ".join(tokens) for tokens in _phrase_tokens(_STOP_RAW)}


@dataclass(frozen=True)
class WakeMatch:
    """A wake hit. `remainder` is the command spoken in the same breath."""

    remainder: str


def _aligned_tokens(text: str) -> tuple[list[str], list[tuple[int, str]]]:
    """Whitespace words, plus normalized pieces pointing back at each word."""
    raw = text.strip().split()
    pieces: list[tuple[int, str]] = []
    for index, word in enumerate(raw):
        for piece in normalize(word).split():
            pieces.append((index, piece))
    return raw, pieces


def match_wake(text: str) -> WakeMatch | None:
    """Return a match when a wake phrase appears as whole words.

    The remainder keeps the speaker's original wording after the wake phrase.
    """
    raw, pieces = _aligned_tokens(text)
    if not pieces:
        return None
    tokens = [piece for _, piece in pieces]
    best_index: int | None = None
    best_length = 0
    for phrase in _WAKE_PHRASES:
        size = len(phrase)
        limit = len(tokens) - size + 1
        for index in range(limit):
            if tokens[index : index + size] != phrase:
                continue
            if best_index is None or index < best_index or (
                index == best_index and size > best_length
            ):
                best_index = index
                best_length = size
    if best_index is None:
        return None
    end = best_index + best_length
    if end >= len(pieces):
        return WakeMatch("")
    raw_start = pieces[end][0]
    if any(index == raw_start for index, _ in pieces[:end]):
        raw_start += 1
    remainder = " ".join(raw[raw_start:]).strip(" ،,")
    return WakeMatch(remainder)


def is_stop_phrase(text: str) -> bool:
    """True when the whole utterance asks Jarvis to leave the session."""
    cleaned = normalize(text)
    cleaned = _POLITE.sub(" ", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned in _STOP_PHRASES
