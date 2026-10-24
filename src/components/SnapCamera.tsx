"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { SNAP_TEMPLATES, type SnapAudience, type SnapTemplate } from "@/lib/snap";
import { drawFromVideo } from "@/lib/snap-photo";

type Props = {
  template: SnapTemplate;
  audience: SnapAudience;
  onTemplate: (t: SnapTemplate) => void;
  onAudience: (a: SnapAudience) => void;
  /** A photo taken here: an exact 3:4 frame. */
  onShot: (frame: HTMLCanvasElement) => void;
  /** A photo from the gallery (or the phone's own camera, when ours isn't available). */
  onPick: (file: File, fromCamera: boolean) => void;
};

type CamState = "starting" | "ready" | "unavailable";

/**
 * The camera, inside Docchi. The frame on screen is exactly the snap card
 * (3:4), so what you see is what friends see. The question and Friends /
 * Everyone are picked right here.
 */
export function SnapCamera({ template, audience, onTemplate, onAudience, onShot, onPick }: Props) {
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

  const tpl = SNAP_TEMPLATES.find((t) => t.id === template)!;

  return (
    <div className="cam-screen">
      <div className="cam-top">
        <Link href="/" className="cam-icon" aria-label="Close">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </Link>
        <div className="cam-aud" role="radiogroup" aria-label="Who sees it">
          <button type="button" role="radio" aria-checked={audience === "circle"} onClick={() => onAudience("circle")}>
            👥 Friends
          </button>
          <button type="button" role="radio" aria-checked={audience === "public"} onClick={() => onAudience("public")}>
            🌍 Everyone
          </button>
        </div>
        <span className="cam-icon cam-spacer" aria-hidden="true" />
      </div>

      <div className="cam-frame">
        <video ref={video} className={`cam-video${facing === "user" ? " cam-mirror" : ""}`} playsInline muted autoPlay />
        {state === "unavailable" && (
          <div className="cam-off">
            <p>
              <strong>The camera isn&apos;t available here.</strong> Allow camera access for Docchi, or use one of these:
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
        <p className="cam-question">{template === "own" ? "Your own question (type it next)" : tpl.question}</p>
        <div className="cam-chips" role="radiogroup" aria-label="Question">
          {SNAP_TEMPLATES.map((t) => (
            <button key={t.id} type="button" role="radio" aria-checked={template === t.id} onClick={() => onTemplate(t.id)}>
              {t.id === "own" ? "✏️ Own" : t.label}
            </button>
          ))}
        </div>
      </div>
      <p className="cam-note">The frame is exactly the card. What you see is what friends see.</p>

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
