"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";

import {
  EMPTY_ANSWER,
  GREETING,
  REACH_ERROR,
  ackPhrase,
  cleanTranscript,
  goodbyePhrase,
  hasArabic,
  popSentences,
  sanitizeSpeech,
} from "@/lib/text";
import { isStopPhrase, matchWake, normalize } from "@/lib/wake";

type Mode = "wake" | "session";
type Phase = "starting" | "listening" | "thinking" | "speaking" | "muted";
type Lang = "ar-SA" | "en-US";
type TtsProvider = "browser" | "gemini" | "elevenlabs";
type Line = { id: number; who: "you" | "jarvis" | "heard"; text: string };

type SpeechAlt = { transcript: string };
type SpeechResult = SpeechAlt[] & { isFinal: boolean; length: number };
type SpeechResultEvent = Event & {
  resultIndex: number;
  results: { length: number; [index: number]: SpeechResult };
};
type SpeechErrorEvent = Event & { error: string };
type SpeechRec = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  start: () => void;
  abort: () => void;
  onresult: ((event: SpeechResultEvent) => void) | null;
  onerror: ((event: SpeechErrorEvent) => void) | null;
  onend: (() => void) | null;
};

type Engine = {
  mode: Mode;
  phase: Phase;
  muted: boolean;
  busy: boolean;
  closed: boolean;
  needsTap: boolean;
  unsupported: boolean;
  lang: Lang;
  interim: string;
  notice: string;
  hasKey: boolean | null;
  tts: TtsProvider;
  ttsFailed: boolean;
  lines: Line[];
  nextId: number;
  history: { role: "user" | "assistant"; content: string }[];
  generation: number;
  spokenGuard: string[];
  spokeAt: number;
  lastFinal: string;
  lastFinalAt: number;
  rec: SpeechRec | null;
  recOn: boolean;
  restartTimer: number | null;
  audio: HTMLAudioElement | null;
  chatAbort: AbortController | null;
  ttsAbort: AbortController | null;
};

type View = {
  mode: Mode;
  phase: Phase;
  muted: boolean;
  busy: boolean;
  interim: string;
  notice: string;
  hasKey: boolean | null;
  needsTap: boolean;
  unsupported: boolean;
  lang: Lang;
  lines: Line[];
};

type Api = {
  arm: () => void;
  stop: () => void;
  toggleMute: () => void;
  setLang: (lang: Lang) => void;
  submit: (text: string) => void;
};

const LANG_KEY = "mulk-jarvis-stt-lang";

function initialLang(): Lang {
  try {
    const saved = localStorage.getItem(LANG_KEY);
    if (saved === "ar-SA" || saved === "en-US") return saved;
  } catch {
    /* private mode */
  }
  return navigator.language.toLowerCase().startsWith("ar") ? "ar-SA" : "en-US";
}

function createEngine(): Engine {
  return {
    mode: "wake",
    phase: "starting",
    muted: false,
    busy: false,
    closed: false,
    needsTap: false,
    unsupported: false,
    lang: "en-US",
    interim: "",
    notice: "",
    hasKey: null,
    tts: "browser",
    ttsFailed: false,
    lines: [],
    nextId: 1,
    history: [],
    generation: 0,
    spokenGuard: [],
    spokeAt: 0,
    lastFinal: "",
    lastFinalAt: 0,
    rec: null,
    recOn: false,
    restartTimer: null,
    audio: null,
    chatAbort: null,
    ttsAbort: null,
  };
}

function snapshot(engine: Engine): View {
  return {
    mode: engine.mode,
    phase: engine.phase,
    muted: engine.muted,
    busy: engine.busy,
    interim: engine.interim,
    notice: engine.notice,
    hasKey: engine.hasKey,
    needsTap: engine.needsTap,
    unsupported: engine.unsupported,
    lang: engine.lang,
    lines: engine.lines.map((line) => ({ ...line })),
  };
}

function recognitionCtor(): (new () => SpeechRec) | null {
  const host = window as unknown as {
    SpeechRecognition?: new () => SpeechRec;
    webkitSpeechRecognition?: new () => SpeechRec;
  };
  return host.SpeechRecognition || host.webkitSpeechRecognition || null;
}

function shouldListen(engine: Engine): boolean {
  return !engine.closed && !engine.muted && !engine.busy && !engine.needsTap && !engine.unsupported;
}

function pauseRec(engine: Engine): void {
  if (engine.restartTimer !== null) {
    window.clearTimeout(engine.restartTimer);
    engine.restartTimer = null;
  }
  if (!engine.rec || !engine.recOn) return;
  try {
    engine.rec.abort();
  } catch {
    engine.recOn = false;
  }
}

function scheduleRestart(engine: Engine): void {
  if (!shouldListen(engine) || engine.restartTimer !== null) return;
  engine.restartTimer = window.setTimeout(() => {
    engine.restartTimer = null;
    startRec(engine);
  }, 200);
}

function startRec(engine: Engine): void {
  if (!shouldListen(engine) || !engine.rec || engine.recOn) return;
  try {
    engine.rec.lang = engine.lang;
    engine.rec.start();
    engine.recOn = true;
    engine.phase = "listening";
  } catch {
    engine.recOn = false;
    scheduleRestart(engine);
  }
}

function stopAudio(engine: Engine): void {
  engine.chatAbort?.abort();
  engine.ttsAbort?.abort();
  if (engine.audio) {
    engine.audio.pause();
    engine.audio = null;
  }
  window.speechSynthesis?.cancel();
}

function pushLine(engine: Engine, who: Line["who"], text: string): number {
  const id = engine.nextId;
  engine.nextId += 1;
  engine.lines.push({ id, who, text });
  if (engine.lines.length > 8) engine.lines.splice(0, engine.lines.length - 8);
  return id;
}

function updateLine(engine: Engine, id: number, text: string): void {
  const line = engine.lines.find((item) => item.id === id);
  if (line) line.text = text;
}

function isEcho(engine: Engine, text: string): boolean {
  if (Date.now() - engine.spokeAt > 2500) return false;
  const heard = normalize(text);
  if (!heard) return true;
  return engine.spokenGuard.some((spoken) => spoken === heard || (heard.length >= 8 && spoken.includes(heard)));
}

function rememberSpoken(engine: Engine, text: string): void {
  const spoken = normalize(text);
  if (!spoken) return;
  engine.spokenGuard.push(spoken);
  engine.spokenGuard = engine.spokenGuard.slice(-4);
  engine.spokeAt = Date.now();
}

function pickVoice(lang: string): SpeechSynthesisVoice | undefined {
  const voices = window.speechSynthesis?.getVoices() ?? [];
  const prefix = lang.toLowerCase().startsWith("ar") ? "ar" : "en";
  const ranked = voices.filter((voice) => voice.lang.toLowerCase().startsWith(prefix));
  return ranked.find((voice) => /google/i.test(voice.name)) || ranked[0];
}

function speakBrowser(engine: Engine, text: string, generation: number): Promise<void> {
  const synth = window.speechSynthesis;
  if (!synth) return Promise.resolve();
  return new Promise((resolve) => {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = hasArabic(text) ? "ar-SA" : "en-US";
    utterance.rate = 1.05;
    utterance.pitch = 0.95;
    const voice = pickVoice(utterance.lang);
    if (voice) utterance.voice = voice;
    let settled = false;
    let timer = 0;
    const finish = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      resolve();
    };
    timer = window.setTimeout(() => {
      synth.cancel();
      finish();
    }, Math.min(12000, 900 + text.length * 70));
    utterance.onend = finish;
    utterance.onerror = finish;
    if (engine.generation !== generation) {
      finish();
      return;
    }
    synth.resume();
    synth.speak(utterance);
  });
}

function playBlob(engine: Engine, blob: Blob, generation: number): Promise<boolean> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    engine.audio = audio;
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      URL.revokeObjectURL(url);
      if (engine.audio === audio) engine.audio = null;
      resolve(ok);
    };
    audio.onended = () => finish(true);
    audio.onerror = () => finish(false);
    audio.onpause = () => {
      if (engine.generation !== generation) finish(false);
    };
    audio.play().catch(() => finish(false));
  });
}

async function speakServer(engine: Engine, text: string, generation: number): Promise<boolean> {
  const abort = new AbortController();
  engine.ttsAbort = abort;
  try {
    const response = await fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
      signal: abort.signal,
    });
    if (engine.generation !== generation) return true;
    const type = response.headers.get("content-type") || "";
    if (!response.ok || !type.startsWith("audio/")) return false;
    const blob = await response.blob();
    if (engine.generation !== generation) return true;
    return playBlob(engine, blob, generation);
  } catch {
    return engine.generation !== generation || abort.signal.aborted;
  }
}

async function speakText(engine: Engine, text: string, generation: number, publish: () => void): Promise<void> {
  const spoken = sanitizeSpeech(text);
  if (!spoken || engine.generation !== generation) return;
  rememberSpoken(engine, spoken);
  engine.phase = "speaking";
  publish();
  const useServer = engine.tts !== "browser" && !engine.ttsFailed;
  if (useServer) {
    const ok = await speakServer(engine, spoken, generation);
    if (engine.generation !== generation) return;
    if (ok) return;
    engine.ttsFailed = true;
  }
  if (engine.generation !== generation) return;
  await speakBrowser(engine, spoken, generation);
}

function bestTranscript(result: SpeechResult, mode: Mode): string {
  const alternatives: string[] = [];
  for (let index = 0; index < result.length; index += 1) {
    const transcript = result[index]?.transcript?.trim();
    if (transcript) alternatives.push(transcript);
  }
  if (mode === "wake") {
    const woken = alternatives.find((alternative) => matchWake(alternative));
    if (woken) return woken;
  }
  return alternatives[0] || "";
}

export function JarvisApp() {
  const [view, setView] = useState<View>(() => snapshot(createEngine()));
  const [draft, setDraft] = useState("");
  const api = useRef<Api | null>(null);

  useEffect(() => {
    const engine = createEngine();
    engine.lang = initialLang();
    const publish = () => setView(snapshot(engine));

    const releaseMic = () => {
      engine.busy = false;
      engine.interim = "";
      if (engine.closed || engine.generation < 0) return;
      if (engine.muted) {
        engine.phase = "muted";
        publish();
        return;
      }
      if (engine.mode === "session" || engine.mode === "wake") {
        engine.phase = "listening";
        publish();
        startRec(engine);
      }
    };

    const answer = async (command: string, generation: number) => {
      const cleaned = sanitizeSpeech(command);
      if (!cleaned || engine.generation !== generation) {
        releaseMic();
        return;
      }
      engine.history.push({ role: "user", content: cleaned });
      engine.history = engine.history.slice(-12);
      engine.phase = "thinking";
      publish();
      let jarvisId = 0;
      let full = "";
      try {
        full = await readAnswer(engine, generation, publish, (partial) => {
          const visible = partial.replace(/[*_`#]+/g, "");
          if (!jarvisId) jarvisId = pushLine(engine, "jarvis", visible);
          else updateLine(engine, jarvisId, visible);
          publish();
        });
      } catch (error) {
        if (engine.generation !== generation) return;
        const aborted = error instanceof DOMException && error.name === "AbortError";
        if (aborted) return;
        full = REACH_ERROR;
      }
      if (engine.generation !== generation) return;
      const answerText = sanitizeSpeech(full) || EMPTY_ANSWER;
      if (!jarvisId) pushLine(engine, "jarvis", answerText);
      else updateLine(engine, jarvisId, answerText);
      engine.history.push({ role: "assistant", content: answerText });
      engine.history = engine.history.slice(-12);
      publish();
      releaseMic();
    };

    const sayFixed = async (text: string, generation: number) => {
      pushLine(engine, "jarvis", text);
      publish();
      await speakText(engine, text, generation, publish);
    };

    const openSession = async (remainder: string) => {
      const generation = engine.generation;
      engine.mode = "session";
      engine.busy = true;
      pauseRec(engine);
      await sayFixed(GREETING, generation);
      if (engine.generation !== generation || engine.mode !== "session") return;
      if (remainder.trim()) {
        await answer(remainder, generation);
        return;
      }
      releaseMic();
    };

    const endSession = async (heard: string) => {
      engine.generation += 1;
      const generation = engine.generation;
      stopAudio(engine);
      engine.mode = "wake";
      engine.history = [];
      engine.busy = true;
      pauseRec(engine);
      await sayFixed(goodbyePhrase(heard), generation);
      if (engine.generation !== generation) return;
      releaseMic();
    };

    const accept = async (raw: string) => {
      if (engine.closed || engine.muted || engine.busy) return;
      const text = cleanTranscript(raw);
      if (!text || isEcho(engine, text)) return;
      const key = normalize(text);
      const now = Date.now();
      if (key && key === engine.lastFinal && now - engine.lastFinalAt < 1500) return;
      engine.lastFinal = key;
      engine.lastFinalAt = now;
      engine.interim = "";

      if (engine.mode === "wake") {
        const wake = matchWake(text);
        if (!wake || (wake.remainder && isStopPhrase(wake.remainder))) {
          if (!wake) pushLine(engine, "heard", text);
          publish();
          return;
        }
        engine.busy = true;
        pauseRec(engine);
        pushLine(engine, "you", text);
        publish();
        await openSession(wake.remainder);
        return;
      }

      engine.busy = true;
      pauseRec(engine);
      pushLine(engine, "you", text);
      publish();
      if (isStopPhrase(text)) {
        await endSession(text);
        return;
      }
      const wake = matchWake(text);
      if (wake && wake.remainder && isStopPhrase(wake.remainder)) {
        await endSession(text);
        return;
      }
      if (wake && !wake.remainder) {
        const generation = engine.generation;
        await sayFixed(ackPhrase(text), generation);
        if (engine.generation === generation) releaseMic();
        return;
      }
      await answer(wake?.remainder || text, engine.generation);
    };

    const ensureRec = (Ctor: new () => SpeechRec) => {
      if (engine.rec) return;
      const rec = new Ctor();
      rec.continuous = true;
      rec.interimResults = true;
      rec.maxAlternatives = 3;
      rec.onresult = (event) => {
        let interim = "";
        for (let index = event.resultIndex; index < event.results.length; index += 1) {
          const result = event.results[index];
          if (!result) continue;
          if (result.isFinal) void accept(bestTranscript(result, engine.mode));
          else interim = result[0]?.transcript || interim;
        }
        engine.interim = interim;
        publish();
      };
      rec.onerror = (event) => {
        if (event.error === "not-allowed" || event.error === "service-not-allowed") {
          engine.needsTap = true;
          engine.notice = "Allow the microphone to listen for mulk.";
          engine.recOn = false;
          publish();
          return;
        }
        if (event.error === "network") {
          engine.notice = "Speech recognition needs Chrome or Edge with a network connection.";
          publish();
        }
      };
      rec.onend = () => {
        engine.recOn = false;
        if (shouldListen(engine)) scheduleRestart(engine);
      };
      engine.rec = rec;
    };

    const arm = async () => {
      engine.needsTap = false;
      engine.notice = "";
      engine.unsupported = false;
      publish();
      if (!navigator.mediaDevices?.getUserMedia) {
        engine.needsTap = true;
        engine.phase = "listening";
        engine.notice = "This browser cannot open a microphone.";
        publish();
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((track) => track.stop());
      } catch {
        if (engine.closed) return;
        engine.needsTap = true;
        engine.phase = "listening";
        engine.notice = "Allow the microphone to listen for mulk.";
        publish();
        return;
      }
      if (engine.closed) return;
      const Ctor = recognitionCtor();
      if (!Ctor) {
        engine.unsupported = true;
        engine.notice = "Speech recognition needs Chrome or Edge. You can still type.";
        engine.phase = "listening";
        publish();
        return;
      }
      ensureRec(Ctor);
      engine.phase = "listening";
      publish();
      startRec(engine);
    };

    api.current = {
      arm: () => void arm(),
      stop: () => {
        engine.generation += 1;
        stopAudio(engine);
        engine.mode = "wake";
        engine.history = [];
        engine.busy = false;
        engine.muted = false;
        engine.interim = "";
        engine.phase = "listening";
        publish();
        startRec(engine);
      },
      toggleMute: () => {
        if (engine.needsTap) {
          void arm();
          return;
        }
        if (engine.muted) {
          engine.muted = false;
          engine.mode = "wake";
          engine.phase = "listening";
          publish();
          startRec(engine);
          return;
        }
        engine.generation += 1;
        stopAudio(engine);
        engine.mode = "wake";
        engine.history = [];
        engine.busy = false;
        engine.muted = true;
        engine.interim = "";
        engine.phase = "muted";
        pauseRec(engine);
        publish();
      },
      setLang: (lang) => {
        engine.lang = lang;
        try {
          localStorage.setItem(LANG_KEY, lang);
        } catch {
          /* ignore */
        }
        publish();
        if (!engine.rec) return;
        pauseRec(engine);
        if (!engine.recOn) startRec(engine);
      },
      submit: (text) => void accept(text),
    };

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") api.current?.stop();
    };
    const unlock = () => {
      window.speechSynthesis?.resume();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", unlock);
    publish();
    void arm();
    void fetch("/api/config")
      .then((response) => response.json())
      .then((data: { hasGeminiKey?: boolean; tts?: TtsProvider }) => {
        if (engine.closed) return;
        engine.hasKey = Boolean(data.hasGeminiKey);
        if (data.tts === "gemini" || data.tts === "elevenlabs" || data.tts === "browser") engine.tts = data.tts;
        publish();
      })
      .catch(() => undefined);

    return () => {
      engine.closed = true;
      engine.generation += 1;
      stopAudio(engine);
      pauseRec(engine);
      try {
        engine.rec?.abort();
      } catch {
        /* already stopped */
      }
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", unlock);
      api.current = null;
    };
  }, []);

  const status = statusLabel(view);
  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text || view.busy) return;
    setDraft("");
    api.current?.submit(text);
  };

  return (
    <main className="shell">
      <header>
        <p className="eyebrow">Mulk Allah</p>
        <h1>Jarvis</h1>
      </header>
      <section
        className="stage"
        data-phase={view.phase}
        data-mode={view.mode}
        data-needs-tap={view.needsTap ? "true" : "false"}
      >
        <button
          type="button"
          className="orb"
          aria-label={view.needsTap || view.muted ? "Enable microphone" : "Microphone is listening"}
          aria-pressed={view.muted}
          onClick={() => {
            if (view.needsTap) api.current?.arm();
            else if (view.muted) api.current?.toggleMute();
          }}
        >
          <span className="orb-core" />
        </button>
        <p className="status" role="status">
          {status}
        </p>
        <p className="interim" aria-hidden={view.interim ? undefined : true}>
          {view.interim}
        </p>
        {view.hasKey === false ? (
          <p className="banner">Add a Gemini API key to answer questions. Wake word still works.</p>
        ) : null}
        {view.notice ? <p className="notice">{view.notice}</p> : null}
        {view.needsTap ? (
          <button type="button" className="tap" onClick={() => api.current?.arm()}>
            Enable microphone
          </button>
        ) : null}
      </section>
      <section className="log" aria-live="polite">
        {view.lines.length === 0 ? (
          <p className="empty">Say mulk, ملك, or Mulk Allah.</p>
        ) : (
          view.lines.map((line) => (
            <p key={line.id} className={`line line-${line.who}`}>
              <span className="who">{line.who === "jarvis" ? "Jarvis" : line.who === "you" ? "You" : "Heard"}</span>
              <span>{line.text}</span>
            </p>
          ))
        )}
      </section>
      <form className="composer" onSubmit={onSubmit}>
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={view.mode === "session" ? "Ask in Arabic or English" : "Type mulk, then a question"}
          aria-label="Type instead of speaking"
          autoComplete="off"
          enterKeyHint="send"
          disabled={view.phase === "starting"}
        />
        <button type="submit" disabled={view.busy || view.phase === "starting" || !draft.trim()}>
          Send
        </button>
      </form>
      <div className="controls">
        <button type="button" aria-pressed={view.lang === "ar-SA"} onClick={() => api.current?.setLang("ar-SA")}>
          العربية
        </button>
        <button type="button" aria-pressed={view.lang === "en-US"} onClick={() => api.current?.setLang("en-US")}>
          English
        </button>
        <button type="button" onClick={() => api.current?.toggleMute()}>
          {view.muted ? "Unmute" : "Mute"}
        </button>
        <button type="button" onClick={() => api.current?.stop()}>
          Stop
        </button>
      </div>
      <p className="hint">After mulk, keep talking. Say stop jarvis, goodbye, or توقف to wait again. Esc does the same.</p>
    </main>
  );
}

function statusLabel(view: View): string {
  if (view.needsTap) return "Microphone off · الميكروفون مغلق";
  if (view.phase === "starting") return "Starting…";
  if (view.muted || view.phase === "muted") return "Muted · صامت";
  if (view.phase === "speaking") return "Speaking · يتكلم";
  if (view.phase === "thinking") return "Thinking · يفكر";
  if (view.mode === "session") return "Listening · يستمع";
  return "Listening for mulk · قل ملك";
}

async function readAnswer(
  engine: Engine,
  generation: number,
  publish: () => void,
  onPartial: (text: string) => void,
): Promise<string> {
  const abort = new AbortController();
  engine.chatAbort = abort;
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: engine.history }),
    signal: abort.signal,
  });
  if (!response.ok || !response.body) throw new Error(`chat ${response.status}`);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let full = "";
  let pending = "";
  let chain = Promise.resolve();
  let queued = false;
  const queue = (sentence: string) => {
    queued = true;
    chain = chain.then(() => speakText(engine, sentence, generation, publish));
  };
  while (true) {
    const { done, value } = await reader.read();
    if (engine.generation !== generation) {
      await reader.cancel().catch(() => undefined);
      break;
    }
    if (done) break;
    const chunk = decoder.decode(value, { stream: true });
    full += chunk;
    pending += chunk;
    onPartial(full);
    const popped = popSentences(pending);
    pending = popped.rest;
    for (const sentence of popped.sentences) queue(sentence);
  }
  const tail = pending.trim();
  if (tail && engine.generation === generation) queue(tail);
  await chain;
  if (!queued && engine.generation === generation) {
    await speakText(engine, sanitizeSpeech(full) || EMPTY_ANSWER, generation, publish);
  }
  return full;
}
