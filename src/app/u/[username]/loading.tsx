import { BottomNav } from "@/components/BottomNav";

// Shown the moment someone's @name is tapped, while their profile is fetched.
export default function ProfileLoading() {
  return (
    <div className="screen profile-screen" aria-busy="true" aria-label="Loading profile">
      <div className="profile-banner" aria-hidden="true">
        <span className="banner-sun" />
        <span className="banner-tile" />
      </div>
      <section className="profile-head">
        <span className="avatar avatar-initial skeleton" aria-hidden="true" />
        <div className="profile-name">
          <span className="skeleton skeleton-line" />
        </div>
      </section>
      <div className="skeleton skeleton-strip" />
      <ul className="profile-list">
        {[0, 1].map((n) => (
          <li key={n} className="skeleton profile-skeleton" />
        ))}
      </ul>
      <BottomNav />
    </div>
  );
}
