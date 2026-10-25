import type { CSSProperties } from "react";
import { CARD, cardModel, type CardInput } from "@/lib/preview";

const u = (n: number) => `calc(${n} * var(--u))`;
const BUBBLE = "M12 4H38A8 8 0 0 1 46 12V28A8 8 0 0 1 38 36H21L12 44V36A8 8 0 0 1 4 28V12A8 8 0 0 1 12 4Z";

/**
 * The link-preview card, drawn right here from data already on the phone, so
 * it shows the instant the share sheet opens (no image to fetch). Laid out on
 * the same 1200×630 grid as the server image and scaled with container units.
 */
export function SharePreview({ card }: { card: CardInput }) {
  const m = cardModel(card);
  const { ink, cream, muted, colors } = CARD;
  return (
    <div className="share-preview" role="img" aria-label={`Link preview: ${m.question}`}>
      <div className="share-preview-inner" style={{ padding: `${u(48)} ${u(64)}`, color: ink }}>
        <div style={{ display: "flex", alignItems: "center", gap: u(14) }}>
          <svg style={{ width: u(64), height: u(64) }} viewBox="0 0 52 52" aria-hidden="true">
            <path d={BUBBLE} transform="translate(3 3)" fill={ink} />
            <path d={BUBBLE} fill="#FFD23F" stroke={ink} strokeWidth="3" strokeLinejoin="round" />
            <circle cx="17" cy="18" r="7" fill="#FFFFFF" stroke={ink} strokeWidth="2.4" />
            <circle cx="33" cy="18" r="7" fill="#FFFFFF" stroke={ink} strokeWidth="2.4" />
            <circle cx="14.5" cy="18" r="3.2" fill={ink} />
            <circle cx="30.5" cy="18" r="3.2" fill={ink} />
            <path d="M21 29Q25 32 29 29" fill="none" stroke={ink} strokeWidth="2.4" strokeLinecap="round" />
          </svg>
          <span className="sp-display" style={{ fontSize: u(52), letterSpacing: u(-2) }}>
            docchi<span style={{ color: colors[0] }}>?</span>
          </span>
          <span className="sp-by" style={{ fontSize: u(26), color: muted, gap: u(8) }}>
            by <span style={{ color: ink }}>@{card.creator}</span>
            {card.verified && (
              <span className="sp-tick" style={{ width: u(30), height: u(30), borderWidth: u(3) }}>
                <svg style={{ width: u(16), height: u(16) }} viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke={ink} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
            )}
          </span>
        </div>

        <div
          className="sp-card"
          style={{
            gap: u(m.compact ? 20 : 26),
            marginTop: u(30),
            padding: `${u(36)} ${u(44)}`,
            borderWidth: u(5),
            borderRadius: u(40),
            background: m.cardBg,
            boxShadow: `${u(12)} ${u(12)} 0 ${ink}`,
          }}
        >
          {m.badge && (
            <div style={{ display: "flex", alignItems: "flex-start", gap: u(14), flexShrink: 0 }}>
              <span className="sp-badge" style={{ padding: `${u(6)} ${u(18)}`, borderWidth: u(3), fontSize: u(22), letterSpacing: u(1) }}>
                {m.badge}
              </span>
              {m.kind === "mystery" && (
                <span style={{ display: "flex", flexDirection: "column", gap: u(8), flex: 1, paddingTop: u(4) }}>
                  <span className="sp-blur" style={{ height: u(16), borderRadius: u(8) }} />
                  <span className="sp-blur" style={{ height: u(16), width: "60%", borderRadius: u(8) }} />
                </span>
              )}
            </div>
          )}
          <div className="sp-display sp-question" style={{ fontSize: u(m.questionSize), letterSpacing: u(-1.5) }}>
            {m.question}
          </div>
          {!card.circle && (
            <div style={{ display: "flex", flexWrap: "wrap", flexShrink: 0, gap: u(m.compact ? 10 : 14) }}>
              {m.options.map((text, i) =>
                m.kind === "hot_take" ? (
                  <span
                    key={i}
                    className="sp-pill"
                    style={{
                      padding: `${u(10)} ${u(34)}`,
                      borderWidth: u(4),
                      borderRadius: u(22),
                      background: i === 0 ? "#FFFFFF" : ink,
                      color: i === 0 ? ink : cream,
                      fontSize: u(30),
                    }}
                  >
                    {text}
                  </span>
                ) : (
                  <span
                    key={i}
                    className="sp-pill"
                    style={
                      {
                        gap: u(m.compact ? 10 : 12),
                        padding: m.compact ? `${u(6)} ${u(18)} ${u(6)} ${u(8)}` : `${u(10)} ${u(22)} ${u(10)} ${u(12)}`,
                        borderWidth: u(4),
                        borderRadius: u(m.compact ? 18 : 22),
                        background: colors[i],
                        fontSize: u(m.compact ? 26 : 30),
                      } as CSSProperties
                    }
                  >
                    <span
                      className="sp-letter"
                      style={{ width: u(m.compact ? 36 : 44), height: u(m.compact ? 36 : 44), borderWidth: u(3), borderRadius: u(14), fontSize: u(24) }}
                    >
                      {"ABCD"[i]}
                    </span>
                    {text}
                  </span>
                ),
              )}
            </div>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: u(18), marginTop: "auto" }}>
            <span className="sp-cta" style={{ padding: `${u(12)} ${u(26)}`, fontSize: u(30), background: ink, color: cream }}>
              {m.cta}
            </span>
            {m.votes && !card.circle && (
              <span style={{ fontSize: u(30), color: m.kind === "classic" ? muted : ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {m.votes} · {m.votesNote}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
