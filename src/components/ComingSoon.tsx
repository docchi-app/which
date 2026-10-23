import Link from "next/link";
import type { ReactNode } from "react";
import { BottomNav } from "./BottomNav";
import { LogoMark, Wordmark } from "./Logo";

type Section = "leaders" | "profile" | "create";

/** Placeholder for screens later in the build order (docs/HANDOFF-docchi.md §4). */
export function ComingSoon({
  section,
  title,
  blurb,
  children,
}: {
  section: Section;
  title: string;
  blurb: string;
  children?: ReactNode;
}) {
  return (
    <div className="screen">
      <header className="app-header">
        <Link href="/" className="brand" aria-label="Docchi home">
          <LogoMark />
          <Wordmark />
        </Link>
      </header>
      <section className="poll-card soon">
        <span className="chip chip-sun">Coming soon</span>
        <h1 className="poll-question">{title}</h1>
        <p className="poll-foot-note">{blurb}</p>
        {children}
        <Link href="/" className="btn btn-coral press">
          Back to the feed
        </Link>
      </section>
      <BottomNav current={section} />
    </div>
  );
}
