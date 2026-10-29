"use client";

import { useEffect, useState } from "react";
import { askFor, onAsk, type Ask } from "@/lib/asks";
import { isSignedIn, onUserChange } from "@/lib/auth";
import { InstallSheet } from "./InstallSheet";
import { NotifyAsk } from "./NotifyAsk";

/** Shows the ask that fits the moment (see lib/asks): Home Screen first on iPhone, then notifications. */
export function MomentAsk() {
  const [ask, setAsk] = useState<Ask | null>(null);
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => onUserChange((u) => setSignedIn(!!u && isSignedIn(u))), []);

  useEffect(() => {
    if (!signedIn) return;
    return onAsk((moment) => {
      // A moment's own screen (the share sheet, the props list) comes first.
      window.setTimeout(() => {
        askFor(moment)
          .then((a) => a && setAsk((cur) => cur ?? a))
          .catch(() => {});
      }, 900);
    });
  }, [signedIn]);

  if (!ask) return null;
  return ask.kind === "install" ? (
    <InstallSheet reason={ask.moment} onClose={() => setAsk(null)} />
  ) : (
    <NotifyAsk moment={ask.moment} onClose={() => setAsk(null)} />
  );
}
