"""Gemini streaming replies, kept short for speech."""

from __future__ import annotations

from collections.abc import Iterator
from typing import Any

from jarvis.config import Settings

SYSTEM_PROMPT = """You are Jarvis for Mulk Allah Alsadi: an insanely capable voice AI with attitude. Arabic: مساعدك الذكي، بس عنده شخصية. Sharp, fast, confident, dry, sarcastic, playfully arrogant, witty, loyal. Never corporate, generic, motivational, or an encyclopedia.

Voice first. Simple requests: 1 to 3 short spoken sentences. Longer only if he asks for detail, steps, a list, or an explanation. No markdown, bullets, asterisks, or emojis. No intro. Do not repeat the question.

Match his language. Arabic is natural Saudi/Gulf talk, native humor, light slang, not a translated joke and not a joke every line. Mixed speech stays mixed.

He is the operator. Rarely say sir, boss, chief, or طال عمرك / يا ريس. Use his name only when natural. A leading mulk, ملك, or Mulk Allah is the wake word, not part of the question.

Humor is situational. Facts stay mostly direct. Casual talk can have personality. An obvious question gets one dry line, then the answer. Play along if he jokes. Serious, angry, technical, medical, or emergency: no jokes, help first. Tease lightly, never insult or joke about his body or a crisis. Chest pain, injury, or danger: tell him to get urgent care now.

Correct him when he is wrong, then give the fact. Thanks is one short smug or warm line, never "at your service" or "happy to help". Goodbye stays short and varied. Signature lines, rare and never repeated back to back: On it. Already handled. That's easy. I've got it. Seriously, sir? That was almost too easy.

Never open with Certainly, Of course, I'd be happy to help, Absolutely, Great question, or As an AI.

Never invent facts, times, or actions. If you lack data, say you don't have it yet or it is outside your access, then the next step. You cannot open apps, browse for him, or control lights or devices. Say so.

Order: correct, useful, fast, natural, then personality. Drop the joke if it slows or confuses the answer.
A clock line follows. If he asks the time or date, use that clock only.
"""


def system_prompt() -> str:
    from datetime import datetime
    from zoneinfo import ZoneInfo

    clock = datetime.now(ZoneInfo("Asia/Riyadh")).strftime("%a %d %b %H:%M")
    return f"{SYSTEM_PROMPT}Clock: {clock} Asia/Riyadh."

MISSING_KEY = "Add a Gemini API key to answer questions. Wake word still works."


def speakable_error(exc: Exception) -> str:
    raw = str(exc).lower()
    if any(word in raw for word in ("api key", "api_key", "permission", "unauthenticated", "401", "403")):
        return "Check the Gemini API key and try again."
    return "I couldn't reach Gemini. Try again."


def visible_text(chunk: Any) -> str:
    """Text the user should hear. Skip hidden thinking parts."""
    candidates = getattr(chunk, "candidates", None)
    if candidates:
        collected: list[str] = []
        saw_part = False
        for candidate in candidates:
            content = getattr(candidate, "content", None)
            parts = getattr(content, "parts", None) if content is not None else None
            if not parts:
                continue
            for part in parts:
                saw_part = True
                if getattr(part, "thought", False):
                    continue
                value = getattr(part, "text", None)
                if value:
                    collected.append(value)
        if saw_part:
            return "".join(collected)
    text = getattr(chunk, "text", None)
    return text or ""


def _thinking_config(model: str) -> Any:
    """Low-latency thinking settings. 2.5 Flash can disable thinking entirely."""
    from google.genai import types

    name = model.lower()
    if "gemini-3" in name:
        return types.ThinkingConfig(thinking_level="low")
    if "2.5" in name or "flash-lite" in name:
        return types.ThinkingConfig(thinking_budget=0)
    return None


class GeminiChat:
    """Short multi-turn chat. History clears when the wake session ends."""

    def __init__(self, settings: Settings, complete: Any = None) -> None:
        self.settings = settings
        self._complete = complete
        self._client: Any = None
        self.history: list[dict[str, str]] = []

    def reset(self) -> None:
        self.history.clear()

    def warmup(self) -> None:
        """Open the TLS connection so the first real question starts sooner."""
        if not self.settings.gemini_api_key or self._complete is not None:
            return
        try:
            list(self._api_stream([{"role": "user", "text": "ping"}], warmup=True))
        except Exception:
            return

    def stream(self, user_text: str) -> Iterator[str]:
        user_text = user_text.strip()
        if not user_text:
            return
        self.history.append({"role": "user", "text": user_text})
        pieces: list[str] = []
        try:
            if self._complete is None and not self.settings.gemini_api_key:
                pieces.append(MISSING_KEY)
                yield MISSING_KEY
                return
            source = self._invoke()
            for text in source:
                if not text:
                    continue
                pieces.append(text)
                yield text
            if not pieces:
                pieces.append("I don't have an answer for that.")
                yield pieces[-1]
        except Exception as exc:
            if not pieces:
                pieces.append(speakable_error(exc))
                yield pieces[-1]
        finally:
            answer = "".join(pieces).strip()
            if answer:
                self.history.append({"role": "model", "text": answer})
            elif self.history and self.history[-1].get("text") == user_text:
                self.history.pop()
            self._trim()

    def _trim(self) -> None:
        limit = max(2, self.settings.history_turns * 2)
        if len(self.history) > limit:
            self.history = self.history[-limit:]

    def _invoke(self) -> Iterator[str]:
        if self._complete is not None:
            yield from self._complete(list(self.history))
            return
        yield from self._api_stream(list(self.history), warmup=False)

    def _api_stream(self, messages: list[dict[str, str]], warmup: bool) -> Iterator[str]:
        client = self._sdk_client()
        from google.genai import types

        contents = [
            types.Content(role=item["role"], parts=[types.Part(text=item["text"])])
            for item in messages
        ]
        config_kwargs: dict[str, Any] = {
            "system_instruction": "Reply with one word." if warmup else system_prompt(),
            "max_output_tokens": 8 if warmup else 400,
        }
        if "gemini-3" not in self.settings.gemini_model.lower() and not warmup:
            config_kwargs["temperature"] = 0.4
        thinking = _thinking_config(self.settings.gemini_model)
        variants = [dict(config_kwargs)]
        if thinking is not None:
            with_thinking = dict(config_kwargs)
            with_thinking["thinking_config"] = thinking
            variants.insert(0, with_thinking)
        last_error: Exception | None = None
        yielded = False
        for variant in variants:
            try:
                config = types.GenerateContentConfig(**variant)
                response = client.models.generate_content_stream(
                    model=self.settings.gemini_model,
                    contents=contents,
                    config=config,
                )
                for chunk in response:
                    text = visible_text(chunk)
                    if text:
                        yielded = True
                        yield text
                return
            except Exception as exc:
                last_error = exc
                if yielded:
                    raise
                continue
        if last_error is not None:
            raise last_error

    def _sdk_client(self) -> Any:
        if self._client is None:
            from google import genai

            self._client = genai.Client(api_key=self.settings.gemini_api_key)
        return self._client
