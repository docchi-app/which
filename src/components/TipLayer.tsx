"use client";

import { useEffect, useRef, useState } from "react";
import { markTipSeen, TIP_EVENT, TIPS, tipAllowed, type TipId } from "@/lib/tips";

const SHOW_MS = 7000;
const WAIT_MS = 20000;
const SETTLE_MS = 2500;

type Placed = { id: TipId; top: number; left: number; arrow: number; below: boolean };

/**
 * Shows one tip bubble at a time beside its target. Waits until the page has
 * settled and no sheet is open; any tap, scroll or a few seconds hides it.
 * Never blocks: only the bubble itself takes taps.
 */
export function TipLayer() {
  const [tip, setTip] = useState<Placed | null>(null);
  const pending = useRef<{ id: TipId; until: number } | null>(null);
  const loadedAt = useRef(0);

  useEffect(() => {
    loadedAt.current = Date.now();
    const onTip = (e: Event) => {
      const id = (e as CustomEvent<TipId>).detail;
      if (!pending.current && !tip) pending.current = { id, until: Date.now() + WAIT_MS };
    };
    window.addEventListener(TIP_EVENT, onTip);

    const timer = window.setInterval(() => {
      const p = pending.current;
      if (!p) return;
      if (Date.now() > p.until) {
        pending.current = null;
        return;
      }
      const def = TIPS[p.id];
      if (def.skipOn && window.location.pathname.startsWith(def.skipOn)) {
        markTipSeen(p.id); // already where the tip would send them
        pending.current = null;
        return;
      }
      const el = document.querySelector<HTMLElement>(def.anchor);
      const busy = document.querySelector(".sheet-layer") || Date.now() - loadedAt.current < SETTLE_MS;
      if (!el || busy || !tipAllowed(p.id)) return;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.bottom < 0 || r.top > window.innerHeight) return;
      const below = r.top < window.innerHeight / 2;
      const width = Math.min(260, window.innerWidth - 24);
      const center = r.left + r.width / 2;
      const left = Math.max(12, Math.min(window.innerWidth - width - 12, center - width / 2));
      setTip({ id: p.id, below, left, arrow: center - left, top: below ? r.bottom + 12 : r.top - 12 });
      markTipSeen(p.id);
      pending.current = null;
    }, 500);

    return () => {
      window.removeEventListener(TIP_EVENT, onTip);
      window.clearInterval(timer);
    };
  }, [tip]);

  useEffect(() => {
    if (!tip) return;
    const hide = () => setTip(null);
    const t = window.setTimeout(hide, SHOW_MS);
    window.addEventListener("pointerdown", hide, { capture: true });
    window.addEventListener("scroll", hide, { capture: true, passive: true });
    window.addEventListener("resize", hide);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("pointerdown", hide, { capture: true });
      window.removeEventListener("scroll", hide, { capture: true });
      window.removeEventListener("resize", hide);
    };
  }, [tip]);

  if (!tip) return null;
  return (
    <div
      className={`tip ${tip.below ? "tip-below" : "tip-above"}`}
      role="status"
      style={{ top: tip.top, left: tip.left, width: Math.min(260, window.innerWidth - 24), ["--arrow" as string]: `${tip.arrow}px` }}
    >
      {TIPS[tip.id].text}
    </div>
  );
}
