// The app's name and taglines in one place. Said "ee-ther".

export const APP_NAME = "Eithr";
/** How the system account appears ("by @eithr"). */
export const SYSTEM_NAME = "eithr";

/** Short lines that rotate on the share card and the install screen. */
export const TAGLINES = [
  "Pick a side.",
  "Settle it.",
  "This or that?",
  "No fence-sitting.",
  "Your take counts.",
  "Pick one. See everyone.",
];

/** A tagline that stays the same for the same seed (a poll id), so the share image and its preview match. */
export function taglineFor(seed: string | null | undefined): string {
  let h = 0;
  for (const c of seed ?? "") h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return TAGLINES[h % TAGLINES.length];
}

/** A different tagline each time. */
export const randomTagline = () => TAGLINES[Math.floor(Math.random() * TAGLINES.length)];
