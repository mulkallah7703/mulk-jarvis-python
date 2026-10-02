"use client";

import { useEffect, useState } from "react";

import { hudRingCount, hudStateLabel, hudTone } from "@/lib/presentation";
import { sampleSpeechLevel } from "@/lib/speech-level";

const clockFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Riyadh",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

type Props = {
  phase: string;
  mode: string;
};

export default function HologramHud({ phase, mode }: Props) {
  const [clock, setClock] = useState("--:--:--");
  const [level, setLevel] = useState(0);
  const [online, setOnline] = useState(true);
  const [rings, setRings] = useState(4);

  useEffect(() => {
    const tick = () => setClock(clockFormat.format(new Date()));
    tick();
    const clockTimer = window.setInterval(tick, 1000);
    const levelTimer = window.setInterval(() => {
      setLevel(Math.round(Math.min(1, Math.max(0, sampleSpeechLevel())) * 100));
    }, 200);
    const onLine = () => setOnline(navigator.onLine);
    onLine();
    window.addEventListener("online", onLine);
    window.addEventListener("offline", onLine);
    const media = window.matchMedia("(max-width: 720px)");
    const onWidth = () => setRings(hudRingCount(media.matches ? 390 : 1440));
    onWidth();
    media.addEventListener("change", onWidth);
    return () => {
      window.clearInterval(clockTimer);
      window.clearInterval(levelTimer);
      window.removeEventListener("online", onLine);
      window.removeEventListener("offline", onLine);
      media.removeEventListener("change", onWidth);
    };
  }, []);

  const tone = hudTone(phase, mode);
  const label = hudStateLabel(phase, mode);
  const showDetail = rings > 2;

  return (
    <div className="holo-hud" data-tone={tone} data-speaking={phase === "speaking" ? "true" : "false"} aria-hidden="true">
      <svg className="holo-rings" viewBox="0 0 200 200">
        <defs>
          <mask id="kora-face-hole">
            <rect width="200" height="200" fill="white" />
            <ellipse cx="100" cy="74" rx="36" ry="30" fill="black" />
          </mask>
        </defs>
        <g mask="url(#kora-face-hole)">
          <circle className="ring ring-a" cx="100" cy="100" r="92" />
          <circle className="ring ring-b" cx="100" cy="100" r="78" />
          {showDetail ? <circle className="ring ring-c" cx="100" cy="100" r="66" /> : null}
          {showDetail ? <circle className="ring ring-d" cx="100" cy="100" r="97" /> : null}
        </g>
      </svg>
      <div className="holo-readouts">
        <span>{clock}</span>
        <span>{label}</span>
        {showDetail ? <span>LVL {level}%</span> : null}
        {showDetail ? <span>{online ? "LINK" : "OFFLINE"}</span> : null}
      </div>
    </div>
  );
}
