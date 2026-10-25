import { BottomNav } from "@/components/BottomNav";
import { LogoMark, Wordmark } from "@/components/Logo";

// Shown the moment a poll link is tapped, while the page is fetched.
export default function PollLoading() {
  return (
    <div className="screen screen-feed">
      <header className="app-header">
        <span className="brand">
          <LogoMark />
          <Wordmark />
        </span>
      </header>
      <main className="stack">
        <div className="stack-deck">
          <div className="swipe-card">
            <section className="poll-card empty-card" aria-busy="true" aria-label="Loading poll">
              <div className="skeleton skeleton-chip" />
              <div className="skeleton skeleton-title" />
              {[0, 1, 2].map((n) => (
                <div key={n} className="skeleton skeleton-answer" />
              ))}
            </section>
          </div>
        </div>
      </main>
      <BottomNav current="feed" />
    </div>
  );
}
