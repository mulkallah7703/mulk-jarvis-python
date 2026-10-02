"use client";

import { useEffect, useState } from "react";

import { isIntroSkipped, onIntroSkip } from "@/lib/presentation";

const WORD = "KORA";

export default function IntroTitle() {
  const [count, setCount] = useState(0);
  const [tagline, setTagline] = useState(false);
  const [glitch, setGlitch] = useState(false);
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setReduced(motion);
    if (motion || isIntroSkipped()) {
      setCount(WORD.length);
      setTagline(true);
      return;
    }
    setCount(0);
    setTagline(false);
    const timers: number[] = [];
    for (let index = 0; index < WORD.length; index += 1) {
      timers.push(
        window.setTimeout(() => {
          setCount(index + 1);
          setGlitch(true);
          timers.push(window.setTimeout(() => setGlitch(false), 120));
        }, 360 + index * 170),
      );
    }
    timers.push(window.setTimeout(() => setTagline(true), 360 + WORD.length * 170 + 160));
    const stop = onIntroSkip(() => {
      setCount(WORD.length);
      setTagline(true);
      setGlitch(false);
    });
    return () => {
      stop();
      for (const timer of timers) window.clearTimeout(timer);
    };
  }, []);

  return (
    <>
      <h1 className={glitch && !reduced ? "title-glitch" : undefined} aria-label="KORA">
        {WORD.slice(0, count)}
        <span className="title-rest" aria-hidden="true">
          {WORD.slice(count)}
        </span>
        {count < WORD.length ? <span className="title-caret" aria-hidden="true" /> : null}
      </h1>
      <p className={tagline ? "eyebrow tagline tagline-in" : "eyebrow tagline"}>The AI That Has Attitude.</p>
    </>
  );
}
