export type FeedTab = "trending" | "new";

export type PollOption = {
  id: string;
  text: string;
  /** null until the viewer has voted (or the poll has closed). */
  votes: number | null;
};

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
