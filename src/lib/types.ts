export type FeedTab = "trending" | "new";

export type PollOption = {
  id: string;
  text: string;
  /** null until the viewer has voted (or the poll has closed). */
  votes: number | null;
};

export type Poll = {
  id: string;
  question: string;
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
  voteCount: number;
  options: PollOption[];
};
