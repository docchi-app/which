"use client";

import Link from "next/link";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { isEmojiAnswers, snapInfo, snapPhotoUrl } from "@/lib/snap";
import type { Poll } from "@/lib/types";

/**
 * The snap card: a 3:4 photo filling the card, who posted it on top, and the
 * question with its answers (or results) on the bottom of the photo. Used in
 * the feed and while asking, so both look the same.
 */
export function SnapCardShell({
  src,
  live,
  who,
  href,
  sub,
  gone,
  more,
  menu,
  children,
}: {
  src: string | null | undefined;
  live: boolean;
  who: string;
  /** Their profile, when the name should link there. */
  href?: string;
  sub: ReactNode;
  /** The photo has disappeared (24 hours are up). */
  gone?: boolean;
  /** Opens the owner's menu (Share, Delete). */
  more?: () => void;
  /** The owner's menu, when open (it hangs under •••). */
  menu?: ReactNode;
  children: ReactNode;
}) {
  const name = (
    <>
      <span className="snapc-av" aria-hidden="true">
        {who.replace(/^@/, "").charAt(0).toUpperCase() || "?"}
      </span>
      <span className="snapc-name">
        {who}
        <small>{sub}</small>
      </span>
    </>
  );
  return (
    <div className="snapc">
      {src ? (
        // A signed link (or local preview) of a private photo; next/image can't optimise it.
        // eslint-disable-next-line @next/next/no-img-element
        <img className="snapc-img" src={src} alt="" />
      ) : (
        <div className="snapc-empty">{src === null ? (gone ? "👻 This snap has disappeared" : "📷 Photo unavailable") : null}</div>
      )}
      <div className="snapc-shade-top" aria-hidden="true" />
      <div className="snapc-shade-bottom" aria-hidden="true" />
      <div className="snapc-top">
        {href ? (
          <Link href={href} className="snapc-who">
            {name}
          </Link>
        ) : (
          <span className="snapc-who">{name}</span>
        )}
        <span className="snapc-badges">
          {live && <span className="snapc-live">📸 Live</span>}
          {more && (
            <button type="button" className="snapc-more" aria-label="Snap options" aria-haspopup="menu" onClick={more}>
              •••
            </button>
          )}
        </span>
      </div>
      {menu}
      <div className="snapc-bottom">{children}</div>
    </div>
  );
}

/** A snap in the feed: the photo loads from its signed link; you vote right on it. */
export function SnapPoll({
  poll,
  sub,
  closed,
  showResults,
  pcts,
  mineId,
  onVote,
  onMore,
  menu,
}: {
  poll: Poll;
  sub: ReactNode;
  closed: boolean;
  /** Voted (or closed): the answers fill with their share. */
  showResults: boolean;
  pcts: number[];
  /** The viewer's pick (or the one being saved). */
  mineId: string | null;
  onVote: (optionId: string) => void;
  /** My own snap: the ••• menu. */
  onMore?: () => void;
  menu?: ReactNode;
}) {
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

  // "Rate it": four emoji, shown as big tap targets. Three or four words: two by two.
  const emoji = isEmojiAnswers(poll.options.map((o) => o.text));
  const grid = !emoji && poll.options.length > 2;
  const busy = !!mineId && !showResults;

  return (
    <SnapCardShell
      src={src}
      live={live && !!src}
      who={`@${poll.creator}`}
      href={poll.isSystem ? undefined : `/u/${poll.creator}`}
      sub={sub}
      gone={closed}
      more={onMore}
      menu={menu}
    >
      <h1 id={`q-${poll.id}`} className="snapc-q">
        {poll.question}
      </h1>
      <div
        className={`snapc-answers${grid ? " snapc-grid" : ""}${showResults ? " snapc-results" : ""}`}
        role={showResults ? "list" : undefined}
        aria-label={showResults ? "Results" : undefined}
      >
        {poll.options.map((o, i) => {
          const mine = o.id === mineId;
          const cls = `snapc-answer${emoji ? " snapc-emoji" : ""}${mine ? " snapc-mine" : ""}`;
          return showResults || busy ? (
            <span key={o.id} role={showResults ? "listitem" : undefined} className={cls} style={{ "--pct": `${showResults ? pcts[i] : 0}%` } as CSSProperties}>
              <span className="snapc-label">{o.text}</span>
              {showResults && <strong className="snapc-pct">{pcts[i]}%</strong>}
            </span>
          ) : (
            <button key={o.id} type="button" className={`${cls} press`} aria-label={`Vote ${o.text}`} onClick={() => onVote(o.id)}>
              <span className="snapc-label">{o.text}</span>
            </button>
          );
        })}
      </div>
    </SnapCardShell>
  );
}
