import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { getSharedPoll } from "@/lib/server-poll";

// The card WhatsApp, X and others show for a shared poll: the question, the
// answers and the vote count. Never the result: you vote to see that.

export const alt = "A poll on Docchi. Tap to pick a side.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
// Counts in the card can be up to 5 minutes old (apps cache previews anyway).
export const revalidate = 300;

const INK = "#1B1530";
const CREAM = "#FFF7EC";
const COLORS = ["#FF7A59", "#6CB4FF", "#FFD23F", "#52D6A8"];
const BUBBLE = "M12 4H38A8 8 0 0 1 46 12V28A8 8 0 0 1 38 36H21L12 44V36A8 8 0 0 1 4 28V12A8 8 0 0 1 12 4Z";

const font = (file: string) => readFile(join(process.cwd(), "assets/fonts", file));

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [poll, display, body] = await Promise.all([
    getSharedPoll(id),
    font("BricolageGrotesque-ExtraBold.ttf"),
    font("DMSans-Bold.ttf"),
  ]);

  const question = poll?.question ?? "Which one? Tap a side, then see where everyone landed.";
  // Long questions and 4-answer polls get a tighter layout so nothing overlaps.
  const long = question.length > 80;
  const compact = long || (question.length > 45 && (poll?.options.length ?? 0) > 2);
  const questionSize = question.length <= 45 ? 76 : long ? 46 : 60;
  const votes = poll ? `${poll.voteCount.toLocaleString("en-US")} ${poll.voteCount === 1 ? "vote" : "votes"}` : null;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          padding: "48px 64px",
          background: CREAM,
          color: INK,
          fontFamily: "DM Sans",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <svg width="64" height="64" viewBox="0 0 52 52">
            <path d={BUBBLE} transform="translate(3 3)" fill={INK} />
            <path d={BUBBLE} fill="#FFD23F" stroke={INK} strokeWidth="3" strokeLinejoin="round" />
            <circle cx="17" cy="18" r="7" fill="#FFFFFF" stroke={INK} strokeWidth="2.4" />
            <circle cx="33" cy="18" r="7" fill="#FFFFFF" stroke={INK} strokeWidth="2.4" />
            <circle cx="14.5" cy="18" r="3.2" fill={INK} />
            <circle cx="30.5" cy="18" r="3.2" fill={INK} />
            <path d="M21 29Q25 32 29 29" fill="none" stroke={INK} strokeWidth="2.4" strokeLinecap="round" />
          </svg>
          <div style={{ display: "flex", fontFamily: "Bricolage Grotesque", fontSize: 52, letterSpacing: -2 }}>
            docchi<span style={{ color: "#FF7A59" }}>?</span>
          </div>
          {poll && (
            <div style={{ display: "flex", marginLeft: "auto", fontSize: 26, color: "#5A5370" }}>
              by @{poll.creator}
            </div>
          )}
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            flex: 1,
            gap: compact ? 20 : 26,
            marginTop: 30,
            padding: "36px 44px",
            border: `5px solid ${INK}`,
            borderRadius: 40,
            background: "#FFFFFF",
            boxShadow: `12px 12px 0 ${INK}`,
          }}
        >
          <div
            style={{
              display: "flex",
              fontFamily: "Bricolage Grotesque",
              flexShrink: 0,
              fontSize: questionSize,
              lineHeight: 1.08,
              letterSpacing: -1.5,
            }}
          >
            {question}
          </div>
          {poll && (
            <div style={{ display: "flex", flexWrap: "wrap", flexShrink: 0, gap: compact ? 10 : 14 }}>
              {poll.options.map((text, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: compact ? 10 : 12,
                    padding: compact ? "6px 18px 6px 8px" : "10px 22px 10px 12px",
                    border: `4px solid ${INK}`,
                    borderRadius: compact ? 18 : 22,
                    background: COLORS[i],
                    fontSize: compact ? 26 : 30,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      width: compact ? 36 : 44,
                      height: compact ? 36 : 44,
                      alignItems: "center",
                      justifyContent: "center",
                      border: `3px solid ${INK}`,
                      borderRadius: 14,
                      background: "#FFFFFF",
                      fontSize: 24,
                    }}
                  >
                    {"ABCD"[i]}
                  </div>
                  {text}
                </div>
              ))}
            </div>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: 18, marginTop: "auto" }}>
            <div
              style={{
                display: "flex",
                padding: "12px 26px",
                borderRadius: 999,
                background: INK,
                color: CREAM,
                fontSize: 30,
              }}
            >
              {poll?.closed ? "See the final result" : "Tap to vote"}
            </div>
            {votes && <div style={{ display: "flex", fontSize: 30, color: "#5A5370" }}>{votes} · results after you vote</div>}
          </div>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: "Bricolage Grotesque", data: display, weight: 800, style: "normal" },
        { name: "DM Sans", data: body, weight: 700, style: "normal" },
      ],
    },
  );
}
