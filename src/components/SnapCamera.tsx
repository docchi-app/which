"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { drawFromVideo } from "@/lib/snap-photo";
import { leaveScreen } from "@/lib/back";

type Props = {
  /** A photo taken here: an exact 3:4 frame. */
  onShot: (frame: HTMLCanvasElement) => void;
  /** A photo from the gallery (or the phone's own camera, when ours isn't available). */
  onPick: (file: File, fromCamera: boolean) => void;
};

type CamState = "starting" | "ready" | "unavailable";

/** What this camera lets a website control (browsers differ: iPhones allow almost none of it). */
type Caps = {
  /** Real camera zoom, when the phone has it. Otherwise zoom crops the photo. */
  zoom: { min: number; max: number } | null;
  torch: boolean;
  focus: boolean;
  /** Real exposure (EV), when the phone has it. Otherwise brightness is applied to the photo. */
  exposure: { min: number; max: number } | null;
};
const NO_CAPS: Caps = { zoom: null, torch: false, focus: false, exposure: null };

// The browser's camera controls aren't in TypeScript's types yet.
type TrackCaps = MediaTrackCapabilities & {
  zoom?: { min: number; max: number };
  torch?: boolean;
  focusMode?: string[];
  pointsOfInterest?: unknown;
  exposureCompensation?: { min: number; max: number };
};
type Advanced = Record<string, unknown>;

const DIGITAL_MAX = 3;
const TIMERS = [0, 3, 10] as const;
type Timer = (typeof TIMERS)[number];

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/**
 * The camera, inside Eithr. The frame on screen is exactly the snap card (3:4),
 * so what you see is what friends see. Tap to focus there (and drag up or down
 * for brightness), pinch or tap .5 / 1× / 2× to zoom, and flash, timer and grid
 * up top. Controls the phone doesn't allow are done on the photo, or left out.
 */
export function SnapCamera({ onShot, onPick }: Props) {
  const router = useRouter();
  const video = useRef<HTMLVideoElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const [facing, setFacing] = useState<"environment" | "user">("environment");
  const [state, setState] = useState<CamState>("starting");
  const [caps, setCaps] = useState<Caps>(NO_CAPS);
  const [zoom, setZoom] = useState(1);
  // -1 (darker) … 0 … +1 (brighter).
  const [bright, setBright] = useState(0);
  const [focusAt, setFocusAt] = useState<{ x: number; y: number; n: number } | null>(null);
  const [flash, setFlash] = useState(false);
  const [timer, setTimer] = useState<Timer>(0);
  const [grid, setGrid] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [screenFlash, setScreenFlash] = useState(false);
  const galleryRef = useRef<HTMLInputElement>(null);
  const phoneCamRef = useRef<HTMLInputElement>(null);
  const countRef = useRef(0);
  // Touches on the frame: one finger taps (focus) or drags (brightness); two pinch (zoom).
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ kind: "tap" | "drag" | "pinch"; x: number; y: number; bright: number; dist: number; zoom: number } | null>(null);

  const mirror = facing === "user";
  const track = () => stream.current?.getVideoTracks()[0] ?? null;

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
        const c = (s.getVideoTracks()[0]?.getCapabilities?.() ?? {}) as TrackCaps;
        setCaps({
          zoom: c.zoom && c.zoom.max > c.zoom.min ? { min: c.zoom.min, max: c.zoom.max } : null,
          torch: c.torch === true,
          focus: !!c.pointsOfInterest || !!c.focusMode?.some((m) => m === "single-shot" || m === "continuous"),
          exposure: c.exposureCompensation && c.exposureCompensation.max > c.exposureCompensation.min ? c.exposureCompensation : null,
        });
        setZoom(1);
        setBright(0);
        setFocusAt(null);
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

  // Stop a running timer when the camera goes away.
  useEffect(() => () => void (countRef.current = 0), []);

  const apply = useCallback((advanced: Advanced) => {
    track()
      ?.applyConstraints({ advanced: [advanced as MediaTrackConstraintSet] })
      .catch(() => {});
  }, []);

  // Real zoom and exposure follow the controls; otherwise they're drawn (see below).
  useEffect(() => {
    if (caps.zoom) apply({ zoom: clamp(zoom, caps.zoom.min, caps.zoom.max) });
  }, [zoom, caps.zoom, apply]);
  useEffect(() => {
    // Up to 2 stops either way.
    if (caps.exposure) apply({ exposureCompensation: bright * Math.min(2, bright < 0 ? -caps.exposure.min : caps.exposure.max) });
  }, [bright, caps.exposure, apply]);

  const zoomMin = caps.zoom ? Math.max(caps.zoom.min, 0.5) : 1;
  const zoomMax = caps.zoom ? Math.min(caps.zoom.max, 10) : DIGITAL_MAX;
  const zoomStops = [0.5, 1, 2].filter((z) => z >= zoomMin - 0.01 && z <= zoomMax + 0.01);
  // Drawn on the photo when the camera can't do it itself.
  const cropZoom = caps.zoom ? 1 : zoom;
  const drawnBright = caps.exposure ? 1 : 1 + bright * 0.6;
  // Flash: the torch on the back camera, the screen on the front one.
  const canFlash = mirror || caps.torch;

  function focusTap(px: number, py: number) {
    const f = frameRef.current;
    const v = video.current;
    if (!f || !v) return;
    const r = f.getBoundingClientRect();
    setFocusAt({ x: px - r.left, y: py - r.top, n: Date.now() });
    if (!caps.focus || !v.videoWidth) return;
    // Where that is in the camera's own picture (it's cropped to 3:4, zoomed and maybe mirrored on screen).
    const scale = Math.max(r.width / v.videoWidth, r.height / v.videoHeight) * cropZoom;
    let x = (px - r.left - r.width / 2) / (v.videoWidth * scale) + 0.5;
    const y = (py - r.top - r.height / 2) / (v.videoHeight * scale) + 0.5;
    if (mirror) x = 1 - x;
    const point = { x: clamp(x, 0, 1), y: clamp(y, 0, 1) };
    const modes = ((track()?.getCapabilities?.() ?? {}) as TrackCaps).focusMode ?? [];
    apply({ pointsOfInterest: [point], ...(modes.includes("single-shot") ? { focusMode: "single-shot" } : {}) });
    // Back to following the scene after a moment, still weighted to that spot.
    if (modes.includes("single-shot") && modes.includes("continuous")) window.setTimeout(() => apply({ focusMode: "continuous" }), 3000);
  }

  function onDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (state !== "ready") return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = [...pointers.current.values()];
    if (pts.length === 2) {
      gesture.current = { kind: "pinch", x: 0, y: 0, bright, dist: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y), zoom };
    } else if (pts.length === 1) {
      gesture.current = { kind: "tap", x: e.clientX, y: e.clientY, bright, dist: 0, zoom };
    }
  }

  function onMove(e: ReactPointerEvent<HTMLDivElement>) {
    const g = gesture.current;
    if (!g || !pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = [...pointers.current.values()];
    if (g.kind === "pinch" && pts.length >= 2) {
      const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      if (g.dist > 0) setZoom(Math.round(clamp((g.zoom * d) / g.dist, zoomMin, zoomMax) * 10) / 10);
      return;
    }
    const dy = e.clientY - g.y;
    if (g.kind === "tap" && Math.abs(dy) > 8) {
      g.kind = "drag";
      // Dragging shows the brightness bar where you started, if nothing was tapped yet.
      if (!focusAt) {
        const r = frameRef.current?.getBoundingClientRect();
        if (r) setFocusAt({ x: g.x - r.left, y: g.y - r.top, n: Date.now() });
      }
    }
    if (g.kind === "drag") setBright(Math.round(clamp(g.bright - dy / 160, -1, 1) * 20) / 20);
  }

  function onUp(e: ReactPointerEvent<HTMLDivElement>) {
    const g = gesture.current;
    pointers.current.delete(e.pointerId);
    if (g?.kind === "tap" && pointers.current.size === 0) focusTap(e.clientX, e.clientY);
    if (pointers.current.size === 0) gesture.current = null;
  }

  async function capture() {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    if (flash && mirror) {
      // Front camera: the screen lights the face.
      setScreenFlash(true);
      await new Promise((r) => setTimeout(r, 260));
    } else if (flash && caps.torch) {
      apply({ torch: true });
      await new Promise((r) => setTimeout(r, 400));
    }
    const frame = drawFromVideo(v, mirror, cropZoom, drawnBright);
    setScreenFlash(false);
    stop();
    onShot(frame);
  }

  async function shoot() {
    if (state !== "ready") return;
    if (countdown) {
      // Tapping again during the timer cancels it.
      countRef.current = 0;
      setCountdown(0);
      return;
    }
    if (timer) {
      const run = Date.now();
      countRef.current = run;
      for (let s = timer; s > 0; s--) {
        if (countRef.current !== run) return;
        setCountdown(s);
        await new Promise((r) => setTimeout(r, 1000));
      }
      if (countRef.current !== run) return;
      setCountdown(0);
    }
    capture();
  }

  const zoomLabel = (z: number) => (z === 0.5 ? ".5" : `${z}×`);
  const videoStyle = {
    transform: `scale(${mirror ? -cropZoom : cropZoom}, ${cropZoom})`,
    filter: drawnBright !== 1 ? `brightness(${drawnBright})` : undefined,
  };

  return (
    <div className="cam-screen">
      <div className="cam-top">
        <button type="button" className="cam-icon" aria-label="Close" onClick={() => leaveScreen(router, "/")}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
        <div className="cam-tools">
          {canFlash && (
            <button type="button" className="cam-tool" aria-pressed={flash} onClick={() => setFlash((f) => !f)} disabled={state !== "ready"}>
              ⚡ {flash ? "On" : "Off"}
            </button>
          )}
          <button
            type="button"
            className="cam-tool"
            aria-pressed={timer > 0}
            aria-label={timer ? `Timer: ${timer} seconds` : "Timer: off"}
            onClick={() => setTimer((t) => TIMERS[(TIMERS.indexOf(t) + 1) % TIMERS.length])}
            disabled={state !== "ready"}
          >
            ⏱ {timer ? `${timer}s` : "Off"}
          </button>
          <button type="button" className="cam-tool" aria-pressed={grid} aria-label="Grid" onClick={() => setGrid((g) => !g)} disabled={state !== "ready"}>
            #
          </button>
        </div>
      </div>

      <div
        ref={frameRef}
        className="cam-frame"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      >
        <video ref={video} className="cam-video" style={videoStyle} playsInline muted autoPlay />
        {grid && <span className="cam-grid" aria-hidden="true" />}
        {focusAt && state === "ready" && (
          <span key={focusAt.n} className="cam-focus" style={{ left: focusAt.x, top: focusAt.y }} aria-hidden="true">
            <span className="cam-sun" style={{ "--b": bright } as CSSProperties}>
              ☀
            </span>
          </span>
        )}
        {countdown > 0 && (
          <span className="cam-count" aria-live="assertive">
            {countdown}
          </span>
        )}
        {state === "ready" && zoomStops.length > 1 && (
          <div className="cam-zoom" role="group" aria-label="Zoom">
            {zoomStops.map((z) => {
              // The lit stop is the nearest one at or below the zoom; pinched in between, it shows the exact zoom.
              const on = z === (zoomStops.filter((x) => x <= zoom + 0.01).at(-1) ?? zoomStops[0]);
              return (
                <button key={z} type="button" aria-pressed={on} onPointerDown={(e) => e.stopPropagation()} onClick={() => setZoom(z)}>
                  {on && Math.abs(zoom - z) >= 0.05 ? `${zoom.toFixed(1)}×` : zoomLabel(z)}
                </button>
              );
            })}
          </div>
        )}
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
      </div>
      {/* Brightness for keyboards and screen readers (fingers drag on the frame). */}
      <label className="sr-only">
        Brightness
        <input type="range" min={-1} max={1} step={0.05} value={bright} onChange={(e) => setBright(Number(e.target.value))} />
      </label>
      <p className="cam-note">Tap to focus · drag up or down for brightness · pinch to zoom</p>

      <div className="cam-bar">
        <button type="button" className="cam-round" aria-label="Choose from gallery" onClick={() => galleryRef.current?.click()}>
          🖼️
        </button>
        <button
          type="button"
          className={`cam-shutter press${countdown ? " cam-shutter-counting" : ""}`}
          aria-label={countdown ? "Cancel the timer" : "Take the photo"}
          onClick={shoot}
          disabled={state !== "ready"}
        />
        <button
          type="button"
          className="cam-round"
          aria-label="Switch camera"
          onClick={() => {
            countRef.current = 0;
            setCountdown(0);
            setFacing((f) => (f === "environment" ? "user" : "environment"));
          }}
          disabled={state === "unavailable"}
        >
          🔄
        </button>
      </div>

      {screenFlash && <div className="cam-screen-flash" aria-hidden="true" />}
      <input ref={galleryRef} type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && onPick(e.target.files[0], false)} />
      <input ref={phoneCamRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => e.target.files?.[0] && onPick(e.target.files[0], true)} />
    </div>
  );
}
