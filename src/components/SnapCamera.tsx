"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { drawFromVideo } from "@/lib/snap-photo";

type Props = {
  /** A photo taken here: an exact 3:4 frame. */
  onShot: (frame: HTMLCanvasElement) => void;
  /** A photo from the gallery (or the phone's own camera, when ours isn't available). */
  onPick: (file: File, fromCamera: boolean) => void;
};

type CamState = "starting" | "ready" | "unavailable";

/**
 * The camera, inside Eithr. The frame on screen is exactly the snap card
 * (3:4), so what you see is what friends see. Nothing else on it: the
 * question comes after the photo.
 */
export function SnapCamera({ onShot, onPick }: Props) {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const [facing, setFacing] = useState<"environment" | "user">("environment");
  const [state, setState] = useState<CamState>("starting");
  const galleryRef = useRef<HTMLInputElement>(null);
  const phoneCamRef = useRef<HTMLInputElement>(null);

  const stop = useCallback(() => {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) return setState("unavailable");
      try {
        const s = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: facing, width: { ideal: 1920 }, height: { ideal: 1440 } },
          audio: false,
        });
        if (cancelled) return s.getTracks().forEach((t) => t.stop());
        stream.current = s;
        if (video.current) {
          video.current.srcObject = s;
          await video.current.play().catch(() => {});
        }
        setState("ready");
      } catch (e) {
        console.warn("camera:", e);
        if (!cancelled) setState("unavailable");
      }
    })();
    return () => {
      cancelled = true;
      stop();
    };
  }, [facing, stop]);

  function shoot() {
    const v = video.current;
    if (state !== "ready" || !v || !v.videoWidth) return;
    const frame = drawFromVideo(v, facing === "user");
    stop();
    onShot(frame);
  }

  return (
    <div className="cam-screen">
      <div className="cam-top">
        <Link href="/" className="cam-icon" aria-label="Close">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </Link>
        <h1 className="cam-title">Snap</h1>
        <span className="cam-icon cam-spacer" aria-hidden="true" />
      </div>

      <div className="cam-frame">
        <video ref={video} className={`cam-video${facing === "user" ? " cam-mirror" : ""}`} playsInline muted autoPlay />
        {state === "unavailable" && (
          <div className="cam-off">
            <p>
              <strong>The camera isn&apos;t available here.</strong> Allow camera access for Eithr, or use one of these:
            </p>
            <button type="button" className="mini-btn mini-btn-coral" onClick={() => phoneCamRef.current?.click()}>
              📸 Phone camera
            </button>
            <button type="button" className="mini-btn" onClick={() => galleryRef.current?.click()}>
              🖼️ Gallery
            </button>
          </div>
        )}
        <span className="cam-corner cam-tl" aria-hidden="true" />
        <span className="cam-corner cam-tr" aria-hidden="true" />
        <span className="cam-corner cam-bl" aria-hidden="true" />
        <span className="cam-corner cam-br" aria-hidden="true" />
      </div>
      <p className="cam-note">Snap first. You&apos;ll add the question next.</p>

      <div className="cam-bar">
        <button type="button" className="cam-round" aria-label="Choose from gallery" onClick={() => galleryRef.current?.click()}>
          🖼️
        </button>
        <button type="button" className="cam-shutter press" aria-label="Take the photo" onClick={shoot} disabled={state !== "ready"} />
        <button
          type="button"
          className="cam-round"
          aria-label="Switch camera"
          onClick={() => setFacing((f) => (f === "environment" ? "user" : "environment"))}
          disabled={state === "unavailable"}
        >
          🔄
        </button>
      </div>

      <input ref={galleryRef} type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && onPick(e.target.files[0], false)} />
      <input ref={phoneCamRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => e.target.files?.[0] && onPick(e.target.files[0], true)} />
    </div>
  );
}
