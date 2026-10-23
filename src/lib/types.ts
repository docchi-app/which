export type FeedTab = "trending" | "new" | "circle";

export type PollOption = {
  id: string;
  text: string;
  /** null until the viewer has voted (or the poll has closed). */
  votes: number | null;
};

export type Visibility = "public" | "link" | "circle";

/** classic: question + 2–4 answers · hot_take: a statement, Agree / Disagree ·
 *  mystery: a teaser and answers; the question shows after you vote. */
export type PollKind = "classic" | "hot_take" | "mystery";

export type Poll = {
  id: string;
  kind: PollKind;
  /** null for a mystery poll you haven't voted on yet. */
  question: string | null;
  /** What a mystery poll shows before you vote ("Pick a colour"). */
  teaser: string | null;
  /** public: in the feed · link: only people with the link (plus its creator and voters) ·
   *  circle: only the creator's circle (or some of its groups). */
  visibility: Visibility;
  /** A circle poll you're not in: no question, no answers, no voting. */
  locked: boolean;
  /** Who a circle poll is for ("Family, Office" / "Whole circle"); only for its creator. */
  audience: string | null;
  /** The viewer made this poll. */
  isMine: boolean;
  shareCount: number;
  creator: string;
  isSystem: boolean;
  featuredToday: boolean;
  voteCount: number;
  commentCount: number;
  createdAt: string;
  closesAt: string;
  myOptionId: string | null;
  options: PollOption[];
};

export type VoteResult = {
  myOptionId: string;
  /** The question, revealed (matters for mystery polls). */
  question: string;
  voteCount: number;
  options: PollOption[];
};
