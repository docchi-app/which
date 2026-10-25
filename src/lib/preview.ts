/**
 * The share card's content and layout decisions, shared by the server image
 * (src/app/p/[id]/opengraph-image.tsx) and the instant in-app preview
 * (SharePreview), so both always show the same card.
 */
export type CardInput = {
  kind: "classic" | "hot_take" | "mystery";
  question: string | null;
  teaser: string | null;
  circle: boolean;
  creator: string;
  verified: boolean;
  voteCount: number;
  options: string[];
  closed: boolean;
};

export const CARD = {
  ink: "#1B1530",
  cream: "#FFF7EC",
  muted: "#5A5370",
  colors: ["#FF7A59", "#6CB4FF", "#FFD23F", "#52D6A8"],
};

export function cardModel(poll: CardInput | null) {
  const kind = poll?.kind ?? "classic";
  // A mystery poll shows its teaser; the question is the surprise.
  const question = poll?.circle
    ? `A poll for @${poll.creator}'s circle`
    : ((kind === "mystery" ? poll?.teaser : poll?.question) ?? "Which one? Tap a side, then see where everyone landed.");
  const cardBg = poll?.circle ? "#52D6A8" : kind === "hot_take" ? "#FF7A59" : kind === "mystery" ? "#B79CFF" : "#FFFFFF";
  const badge = poll?.circle ? "Circle only" : kind === "hot_take" ? "Hot take" : kind === "mystery" ? "Mystery poll" : null;
  const cta = poll?.circle
    ? "Ask to join"
    : poll?.closed
      ? "See the final result"
      : kind === "hot_take"
        ? "Agree or disagree?"
        : kind === "mystery"
          ? "Tap to find out"
          : "Tap to vote";
  // Long questions and 4-answer polls get a tighter layout so nothing overlaps.
  // The format badge row takes space too.
  const answersCount = poll?.options.length ?? 0;
  const long = question.length > 80;
  const compact = long || (answersCount > 2 && (question.length > 45 || kind !== "classic"));
  let questionSize = Math.min(question.length <= 45 ? 76 : long ? 46 : 60, kind === "classic" ? 76 : 62);
  // A long question plus 3–4 answers wraps to two answer rows: shrink the
  // question so the footer still fits inside the card.
  if (answersCount > 2 && question.length > 45) questionSize = Math.min(questionSize, question.length > 70 ? 44 : 52);
  // Very long questions get smaller still, and long answers are shortened (…), so 4 answers of up to
  // 60 characters never push the footer out of the card.
  if (question.length > 110) questionSize = Math.min(questionSize, 40);
  const maxAnswer = answersCount > 2 ? (long ? 22 : 30) : 44;
  const options = (poll?.options ?? []).map((t) => ([...t].length > maxAnswer ? `${[...t].slice(0, maxAnswer - 1).join("").trimEnd()}…` : t));
  // A tiny count looks like nobody's there; invite them to be early instead (as on the feed).
  const votes = !poll
    ? null
    : poll.voteCount === 0 && !poll.closed
      ? "Be the first to vote"
      : poll.voteCount < 10 && !poll.closed
        ? "Be one of the first"
        : `${poll.voteCount.toLocaleString("en-US")} ${poll.voteCount === 1 ? "vote" : "votes"}`;
  const votesNote = kind === "mystery" ? "the question shows after you vote" : "results after you vote";
  return { kind, question, cardBg, badge, cta, compact, questionSize, votes, votesNote, options };
}
