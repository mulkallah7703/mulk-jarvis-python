"use client";

import { useEffect, useRef, useState } from "react";

import {
  cameraAlreadyGranted,
  startFaceTracker,
  type FaceTracker,
} from "@/lib/face-tracker";
import {
  clearFaceLook,
  faceFollowTooSlow,
  readFaceFollowEnabled,
  writeFaceFollowEnabled,
} from "@/lib/face-follow";

export default function FaceFollow() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const trackerRef = useRef<FaceTracker | null>(null);
  const generation = useRef(0);
  const [live, setLive] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancel = false;
    if (!readFaceFollowEnabled() || faceFollowTooSlow()) return undefined;
    void cameraAlreadyGranted().then((granted) => {
      if (cancel || !granted) return;
      void enable();
    });
    return () => {
      cancel = true;
      generation.current += 1;
      trackerRef.current?.stop();
      trackerRef.current = null;
      clearFaceLook();
    };
    // enable is stable for this mount; the generation guard covers a second start.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function enable() {
    const video = videoRef.current;
    if (!video || busy) return;
    const token = ++generation.current;
    setBusy(true);
    try {
      const tracker = await startFaceTracker(video, {
        onSlow: () => {
          if (generation.current !== token) return;
          trackerRef.current = null;
          setLive(false);
        },
      });
      if (generation.current !== token) {
        tracker.stop();
        return;
      }
      trackerRef.current = tracker;
      writeFaceFollowEnabled(true);
      setLive(true);
    } catch {
      if (generation.current === token) {
        writeFaceFollowEnabled(false);
        clearFaceLook();
        setLive(false);
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
      <video ref={videoRef} className="face-video" muted playsInline autoPlay aria-hidden="true" />
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
