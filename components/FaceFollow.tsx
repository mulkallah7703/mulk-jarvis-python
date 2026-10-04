"use client";

import { useEffect, useRef, useState } from "react";

import { startFaceTracker, type FaceTracker } from "@/lib/face-tracker";
import {
  clearFaceLook,
  faceFollowFailureMessage,
  writeFaceFollowEnabled,
} from "@/lib/face-follow";

export default function FaceFollow() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const trackerRef = useRef<FaceTracker | null>(null);
  const generation = useRef(0);
  const noticeTimer = useRef(0);
  const [live, setLive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  function showNotice(text: string) {
    setNotice(text);
    window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(""), 4200);
  }

  useEffect(() => {
    return () => {
      generation.current += 1;
      window.clearTimeout(noticeTimer.current);
      trackerRef.current?.stop();
      trackerRef.current = null;
      clearFaceLook();
    };
  }, []);

  async function enable() {
    const video = videoRef.current;
    if (!video || busy) return;
    const token = ++generation.current;
    setBusy(true);
    try {
      const tracker = await startFaceTracker(video, {
        onFail: (message) => {
          if (generation.current !== token) return;
          trackerRef.current = null;
          writeFaceFollowEnabled(false);
          clearFaceLook();
          setLive(false);
          showNotice(message);
        },
      });
      if (generation.current !== token) {
        tracker.stop();
        return;
      }
      trackerRef.current = tracker;
      writeFaceFollowEnabled(true);
      setLive(true);
    } catch (error) {
      if (generation.current === token) {
        writeFaceFollowEnabled(false);
        clearFaceLook();
        setLive(false);
        showNotice(faceFollowFailureMessage(error));
      }
    } finally {
      if (generation.current === token) setBusy(false);
    }
  }

  function disable() {
    generation.current += 1;
    trackerRef.current?.stop();
    trackerRef.current = null;
    writeFaceFollowEnabled(false);
    clearFaceLook();
    setLive(false);
    setBusy(false);
  }

  return (
    <>
      <button
        type="button"
        className="cam"
        data-face-follow={live ? "on" : "off"}
        aria-pressed={live}
        aria-busy={busy}
        disabled={busy}
        aria-label={live ? "Camera follow is on" : "Follow with camera"}
        onClick={() => {
          if (live) disable();
          else void enable();
        }}
      >
        <CameraIcon />
      </button>
      <video ref={videoRef} className="face-video" muted playsInline aria-hidden="true" />
      {notice ? (
        <p className="face-toast" role="status">
          {notice}
        </p>
      ) : null}
    </>
  );
}

function CameraIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
        strokeLinecap="round"
        d="M4.5 8.2h2.2l1.3-2h8l1.3 2h2.2v9.2h-15V8.2z"
      />
      <circle cx="12" cy="12.4" r="2.7" fill="none" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  );
}
