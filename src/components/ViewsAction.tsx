"use client";

import { useEffect, useLayoutEffect, useState, type DependencyList, type RefObject } from "react";
import { compactCount, formatCount } from "@/lib/format";
import { ViewsIcon } from "./icons";

// Below this many views, the card says "New" / "Noticed" instead of a tiny number
// (the creator always sees the exact count on their own poll).
const FEW_VIEWS = 10;

/** Views in the card's action row, X-style: ✨ New · 👀 Noticed · 📊 3.4K. Tap for the full line. */
export function ViewsAction({ count, mine }: { count: number; mine: boolean }) {
  const [tip, setTip] = useState(false);
  useEffect(() => {
    if (!tip) return;
    const t = window.setTimeout(() => setTip(false), 2200);
    return () => window.clearTimeout(t);
  }, [tip]);
  const early = !mine && count < FEW_VIEWS;
  const fresh = count < 5;
  const text = early
    ? fresh
      ? "Just posted"
      : "People are noticing"
    : `${formatCount(count)} ${count === 1 ? "person" : "people"} saw this`;
  return (
    <button type="button" className={`views-action${early ? " early" : ""}`} aria-label={text} onClick={() => setTip((v) => !v)}>
      {early ? <span aria-hidden="true">{fresh ? "✨" : "👀"}</span> : <ViewsIcon size={18} />}
      {early ? <span className="views-word">{fresh ? "New" : "Noticed"}</span> : compactCount(count)}
      {tip && (
        <span className="views-tip" role="status">
          {text}
        </span>
      )}
    </button>
  );
}

// Ways the action row makes room, in order, used only while it would otherwise overflow:
// Share shows just its icon, Next just its arrow, "Noticed" just 👀, then the icons sit closer.
const STEPS = ["share-icon", "tight", "tighter", "tightest"];

function overflows(row: HTMLElement) {
  const end = row.clientWidth - parseFloat(getComputedStyle(row).paddingRight);
  // Layout boxes (offset*), not getBoundingClientRect: Next pops in with a scale animation.
  const base = row.offsetLeft;
  for (const c of row.children) {
    const el = c as HTMLElement;
    if (!el.offsetWidth) continue;
    const left = el.offsetParent === row ? el.offsetLeft : el.offsetLeft - base;
    if (left + el.offsetWidth > end + 0.5) return true;
  }
  return false;
}

/**
 * Keeps the card's action row on one line at its normal height: before the row is
 * drawn (and when its width changes), it takes the fewest STEPS that make it fit.
 */
export function useFitActions(ref: RefObject<HTMLElement | null>, deps: DependencyList) {
  useLayoutEffect(() => {
    const row = ref.current;
    if (!row) return;
    const fit = () => {
      row.classList.remove(...STEPS);
      for (const step of STEPS) {
        if (!overflows(row)) break;
        row.classList.add(step);
      }
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(row);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
