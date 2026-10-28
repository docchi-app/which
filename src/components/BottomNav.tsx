"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { FriendsIcon, HomeIcon, PlusIcon, TrophyIcon, UserIcon } from "./icons";
import { NavBadge } from "./NavBadge";

type Section = "feed" | "friends" | "leaders" | "profile" | "create";

/** Feed tapped while on the feed: it goes back to the top (and loads new polls). */
export const FEED_TOP = "eithr:feed-top";

const ITEMS = [
  { id: "feed", href: "/", label: "Feed", Icon: HomeIcon },
  { id: "friends", href: "/friends", label: "Friends", Icon: FriendsIcon },
  { id: "leaders", href: "/leaders", label: "Leaders", Icon: TrophyIcon },
  { id: "profile", href: "/profile", label: "Profile", Icon: UserIcon },
] as const;

/** Floating dark pill (Feed / Friends / Leaders / Profile) plus the coral create button. */
export function BottomNav({ current }: { current?: Section }) {
  const path = usePathname();
  const onFeed = path === "/";
  // The + menu: Snap it or Type it, one tap from any screen.
  const [menu, setMenu] = useState(false);

  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenu(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menu]);
  // Going to another screen (the back button too) closes it.
  const [menuPath, setMenuPath] = useState(path);
  if (menuPath !== path) {
    setMenuPath(path);
    setMenu(false);
  }

  return (
    <>
      {menu && <div className="create-scrim" aria-hidden="true" onClick={() => setMenu(false)} />}
      <div className="bottom-bar">
        <nav aria-label="Main" className="nav-pill">
          {ITEMS.map(({ id, href, label, Icon }) =>
            id === current ? (
              <Link
                key={id}
                href={href}
                aria-current="page"
                className="nav-item nav-item-active"
                data-tip={id === "feed" ? undefined : id}
                onClick={(e) => {
                  if (id !== "feed" || !onFeed) return;
                  e.preventDefault();
                  window.dispatchEvent(new Event(FEED_TOP));
                }}
              >
                <Icon />
                <span className="nav-label">{label}</span>
                {id === "friends" && <NavBadge />}
              </Link>
            ) : (
              <Link key={id} href={href} aria-label={label} className="nav-item" data-tip={id === "feed" ? undefined : id}>
                <Icon size={22} />
                {id === "friends" && <NavBadge />}
              </Link>
            ),
          )}
        </nav>
        {menu && (
          <div id="create-menu" className="create-menu" role="menu" aria-label="Make a poll">
            <Link href="/snap" role="menuitem" className="create-choice create-choice-snap press" onClick={() => setMenu(false)}>
              <span className="create-choice-icon" aria-hidden="true">
                📸
              </span>
              <strong>Snap it</strong>
              <small>Photo poll, gone in 24 hours</small>
            </Link>
            <Link href="/create" role="menuitem" className="create-choice create-choice-type press" onClick={() => setMenu(false)}>
              <span className="create-choice-icon" aria-hidden="true">
                ✍️
              </span>
              <strong>Type it</strong>
              <small>A question with 2 to 4 answers</small>
            </Link>
          </div>
        )}
        <button
          type="button"
          aria-label={menu ? "Close" : "Make a poll"}
          aria-expanded={menu}
          aria-haspopup="menu"
          aria-controls={menu ? "create-menu" : undefined}
          className={`create-btn press${menu ? " create-btn-open" : ""}`}
          data-tip="create"
          onClick={() => setMenu((m) => !m)}
        >
          <PlusIcon size={28} />
        </button>
      </div>
    </>
  );
}
