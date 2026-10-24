"use client";

import { useEffect, useState } from "react";
import { snapInfo, snapPhotoUrl } from "@/lib/snap";
import type { Poll } from "@/lib/types";

/** A snap's photo with its question on top. Gone (or not loaded) → a placeholder. */
export function SnapPhoto({ poll, closed }: { poll: Poll; closed: boolean }) {
  // undefined: loading · null: no photo (it has disappeared)
  const [src, setSrc] = useState<string | null | undefined>(undefined);
  const [live, setLive] = useState(false);

  useEffect(() => {
    let stale = false;
    (async () => {
      const info = await snapInfo(poll.id).catch(() => null);
      const url = info?.path ? await snapPhotoUrl(info.path).catch(() => null) : null;
      if (stale) return;
      setLive(!!info?.live);
      setSrc(url);
    })();
    return () => {
      stale = true;
    };
  }, [poll.id]);

  return (
    <div className={`snap-photo${src ? "" : " snap-photo-empty"}`}>
      {src ? (
        // A signed link to a private photo; next/image can't optimise it.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" />
      ) : src === null ? (
        <span className="snap-gone">{closed ? "👻 This snap has disappeared" : "📷 Photo unavailable"}</span>
      ) : null}
      {live && src && <span className="snap-live">📸 Live</span>}
      <h1 id={`q-${poll.id}`} className="snap-question">
        {poll.question}
      </h1>
    </div>
  );
}
