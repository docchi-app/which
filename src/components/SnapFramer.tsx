"use client";

import { useEffect, useRef, useState, type PointerEvent } from "react";
import { drawFill, drawWhole, encode } from "@/lib/snap-photo";

type Props = {
  /** The photo, read the right way up. */
  bitmap: ImageBitmap;
  /** The same photo as a URL, for showing it. */
  url: string;
  onDone: (photo: Blob) => void;
  onCancel: () => void;
};

/**
 * "Frame your photo": for gallery photos that aren't upright. Drag to move and
 * pinch (or scroll) to zoom inside the 3:4 frame, or show the whole photo on a
 * blurred copy of itself. Nothing is cut unless the person chooses it.
 */
export function SnapFramer({ bitmap, url, onDone, onCancel }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [mode, setMode] = useState<"fill" | "whole">("fill");
  const [view, setView] = useState({ zoom: 1, cx: 0.5, cy: 0.5 });
  const [busy, setBusy] = useState(false);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<number | null>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Where the photo sits in the frame (same maths as drawFill, in screen pixels).
  const base = size.w ? Math.max(size.w / bitmap.width, size.h / bitmap.height) : 0;
  const w = bitmap.width * base * view.zoom;
  const h = bitmap.height * base * view.zoom;
  const clampC = (c: number, frame: number, img: number) => (img <= frame ? 0.5 : Math.min(1 - frame / 2 / img, Math.max(frame / 2 / img, c)));
  const cx = clampC(view.cx, size.w, w);
  const cy = clampC(view.cy, size.h, h);
  const left = size.w / 2 - cx * w;
  const top = size.h / 2 - cy * h;

  function down(e: PointerEvent) {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
  }

  function move(e: PointerEvent) {
    const prev = pointers.current.get(e.pointerId);
    if (!prev || mode !== "fill") return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = [...pointers.current.values()];
    if (pts.length >= 2) {
      const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      if (pinch.current) setView((v) => ({ ...v, zoom: Math.min(4, Math.max(1, v.zoom * (d / pinch.current!))) }));
      pinch.current = d;
      return;
    }
    const dx = e.clientX - prev.x;
    const dy = e.clientY - prev.y;
    setView((v) => ({ ...v, cx: clampC(v.cx - dx / w, size.w, w), cy: clampC(v.cy - dy / h, size.h, h) }));
  }

  function up(e: PointerEvent) {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
  }

  async function done() {
    setBusy(true);
    try {
      onDone(await encode(mode === "whole" ? drawWhole(bitmap) : drawFill(bitmap, view.zoom, cx, cy)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="framer">
      <div
        ref={box}
        className={`framer-box${mode === "whole" ? " framer-whole" : ""}`}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onWheel={(e) => mode === "fill" && setView((v) => ({ ...v, zoom: Math.min(4, Math.max(1, v.zoom * (e.deltaY < 0 ? 1.08 : 0.93))) }))}
      >
        {/* The photo being framed (a local file). */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {mode === "whole" && <img className="framer-blur" src={url} alt="" />}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          className="framer-img"
          src={url}
          alt="Your photo"
          draggable={false}
          style={mode === "fill" && size.w ? { left, top, width: w, height: h } : undefined}
        />
        {mode === "fill" && <div className="framer-grid" aria-hidden="true" />}
        {mode === "fill" && <span className="framer-hint">✋ Drag to move · pinch to zoom</span>}
      </div>
      <div className="snap-seg" role="radiogroup" aria-label="How to fit the photo">
        <button type="button" role="radio" aria-checked={mode === "fill"} onClick={() => setMode("fill")}>
          Fill the card
        </button>
        <button type="button" role="radio" aria-checked={mode === "whole"} onClick={() => setMode("whole")}>
          Show whole photo
        </button>
      </div>
      <div className="framer-actions">
        <button type="button" className="mini-btn" onClick={onCancel}>
          Back
        </button>
        <button type="button" className="post-btn press" onClick={done} disabled={busy}>
          {busy ? "…" : "Use this photo →"}
        </button>
      </div>
    </div>
  );
}
