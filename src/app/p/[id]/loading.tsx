import { BottomNav } from "@/components/BottomNav";
import { LogoMark, Wordmark } from "@/components/Logo";

// Shown the moment a poll link is tapped, while the page is fetched.
export default function PollLoading() {
  return (
    <div className="screen screen-feed">
      <div className="feed-top">
        <header className="app-header">
          <span className="brand">
            <LogoMark />
            <Wordmark />
          </span>
        </header>
      </div>
      <main className="feed-list" aria-busy="true" aria-label="Loading poll">
        {[0, 1].map((n) => (
          <section key={n} className="poll-card ghost-card" aria-hidden="true">
            <div className="skeleton skeleton-chip" />
            <div className="skeleton skeleton-title" />
            {[0, 1].map((m) => (
              <div key={m} className="skeleton skeleton-answer" />
            ))}
          </section>
        ))}
      </main>
      <BottomNav current="feed" />
    </div>
  );
}
