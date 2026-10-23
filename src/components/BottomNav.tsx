import Link from "next/link";
import { HomeIcon, PlusIcon, TrophyIcon, UserIcon } from "./icons";

type Section = "feed" | "leaders" | "profile" | "create";

const ITEMS = [
  { id: "feed", href: "/", label: "Feed", Icon: HomeIcon },
  { id: "leaders", href: "/leaders", label: "Leaders", Icon: TrophyIcon },
  { id: "profile", href: "/profile", label: "Profile", Icon: UserIcon },
] as const;

/** Floating dark pill (Feed / Leaders / Profile) plus the coral create button. */
export function BottomNav({ current }: { current: Section }) {
  return (
    <div className="bottom-bar">
      <nav aria-label="Main" className="nav-pill">
        {ITEMS.map(({ id, href, label, Icon }) =>
          id === current ? (
            <Link key={id} href={href} aria-current="page" className="nav-item nav-item-active">
              <Icon />
              {label}
            </Link>
          ) : (
            <Link key={id} href={href} aria-label={label} className="nav-item">
              <Icon size={22} />
            </Link>
          ),
        )}
      </nav>
      <Link href="/create" aria-label="Create a poll" className="create-btn press">
        <PlusIcon size={28} />
      </Link>
    </div>
  );
}
