"use client";

import { useCallback, useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

// The phone's back button (and the back swipe) closes the sheet or menu on top
// instead of leaving the screen: each open layer adds a history entry for the
// same address, and going back from it closes the layer.
//
// Closing a layer with its own buttons goes back too, so no empty entry is left
// behind. A layer that goes away because the app moved to another screen (a link
// inside it) leaves its entry under the new screen; arriving back on such an
// entry steps over it, so it never costs an extra press.

const KEY = "eithrLayer";
const openLayers = new Set<string>();
// Layers whose entry is being removed without closing them (see dropLayer).
const quiet = new Set<string>();
let seq = 0;
// A back step we started (closing with a button), and what's waiting for it.
let stepping: Promise<void> | null = null;
let stepped: (() => void) | null = null;
let installed = false;

const layerOf = (state: unknown) => {
  const id = (state as Record<string, unknown> | null)?.[KEY];
  return typeof id === "string" ? id : null;
};

function install() {
  if (installed) return;
  installed = true;
  window.addEventListener("popstate", (e) => {
    const done = stepped;
    stepping = null;
    stepped = null;
    done?.();
    // Landed on the entry of a layer that's already closed: one more step back.
    const id = layerOf(e.state);
    if (id && !openLayers.has(id)) history.back();
  });
}

/**
 * While `open`, back closes this layer (calling `onClose`). Returns the function
 * the layer's own close buttons should call instead of `onClose`.
 */
export function useBackClose(open: boolean, onClose: () => void): () => void {
  const closeRef = useRef(onClose);
  const idRef = useRef<string | null>(null);
  useEffect(() => {
    closeRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return;
    install();
    const id = `l${++seq}`;
    idRef.current = id;
    openLayers.add(id);
    let live = true;
    // Back from this layer's entry (or past it): close.
    const onPop = (e: PopStateEvent) => {
      if (layerOf(e.state) === id) return;
      if (!quiet.delete(id)) closeRef.current();
    };
    const add = () => {
      if (!live) return;
      history.pushState({ ...history.state, [KEY]: id }, "");
      window.addEventListener("popstate", onPop);
    };
    // Another layer just closed with a button: add ours once its step back has landed.
    if (stepping) stepping.then(add);
    else add();
    return () => {
      live = false;
      openLayers.delete(id);
      quiet.delete(id);
      window.removeEventListener("popstate", onPop);
      if (idRef.current === id) idRef.current = null;
    };
  }, [open]);

  return useCallback(() => {
    if (idRef.current && layerOf(history.state) === idRef.current && !stepping) stepBack();
    else closeRef.current();
  }, []);
}

function stepBack() {
  stepping = new Promise((resolve) => (stepped = resolve));
  history.back();
}

/**
 * Removes the top layer's history entry without closing it, for a layer that's
 * moving on by itself (a snap being sent stops being the "ask" step).
 */
export function dropLayer() {
  const id = layerOf(history.state);
  if (!id || !openLayers.has(id) || stepping) return;
  quiet.add(id);
  stepBack();
}

// How many screens into the app this history entry is (0: the first one opened).
const DEPTH = "eithrDepth";
let depth = -1;

/** Keeps `depth` up to date. Used once, in the root layout. */
export function useTrackDepth() {
  const path = usePathname();
  useEffect(() => {
    const known = (history.state as Record<string, unknown> | null)?.[DEPTH];
    if (typeof known === "number") {
      depth = known;
    } else {
      depth += 1;
      history.replaceState({ ...history.state, [DEPTH]: depth }, "");
    }
  }, [path]);
}

/**
 * A screen's own ✕ or ← : back to where you came from in the app (past this
 * screen's open layers), or to `fallback` when this is the first screen opened.
 */
export function leaveScreen(router: { replace: (href: string) => void }, fallback: string) {
  const layer = layerOf(history.state);
  const steps = layer && openLayers.has(layer) ? 2 : 1;
  const nav = (window as { navigation?: { currentEntry?: { index: number } | null } }).navigation;
  const index = nav?.currentEntry?.index;
  const canGoBack = typeof index === "number" ? index >= steps : depth > 0;
  if (canGoBack) history.go(-steps);
  else router.replace(fallback);
}
