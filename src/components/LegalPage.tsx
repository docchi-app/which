import Link from "next/link";
import type { ReactNode } from "react";
import { CONTACT_EMAIL, POLICIES_UPDATED } from "@/lib/site";
import { BottomNav } from "./BottomNav";
import { LogoMark, Wordmark } from "./Logo";

const PAGES = [
  { href: "/guidelines", label: "Guidelines" },
  { href: "/terms", label: "Terms" },
  { href: "/privacy", label: "Privacy" },
] as const;

/** Terms, Privacy and Community guidelines share this frame. */
export function LegalPage({ path, title, intro, children }: { path: string; title: string; intro: string; children: ReactNode }) {
  const updated = new Date(POLICIES_UPDATED).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
  return (
    <div className="screen">
      <header className="app-header">
        <Link href="/" className="brand" aria-label="Docchi home">
          <LogoMark />
          <Wordmark />
        </Link>
      </header>
      <nav className="legal-tabs" aria-label="Policies">
        {PAGES.map((p) => (
          <Link key={p.href} href={p.href} className="legal-tab" aria-current={p.href === path ? "page" : undefined}>
            {p.label}
          </Link>
        ))}
      </nav>
      <article className="legal">
        <h1 className="legal-title">{title}</h1>
        <p className="legal-updated">Last updated {updated}</p>
        <p className="legal-intro">{intro}</p>
        {children}
        <h2>Contact</h2>
        <p>
          <ContactLine />
        </p>
      </article>
      <BottomNav />
    </div>
  );
}

/** "Email x@y" when an address is configured, otherwise the in-app route. */
export function ContactLine() {
  return CONTACT_EMAIL ? (
    <>
      Questions, privacy requests or complaints (including grievances under India&apos;s IT Rules): email{" "}
      <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>. We reply within 7 days and act on valid complaints within
      the time the law sets.
    </>
  ) : (
    <>
      Questions, privacy requests or complaints: use <strong>Report</strong> on any poll or profile, and we&apos;ll
      review it. We act on valid complaints within the time the law sets.
    </>
  );
}
