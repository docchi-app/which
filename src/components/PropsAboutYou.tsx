"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { myProps, propsShareImage, type MyProps } from "@/lib/props";
import { recall, remember } from "@/lib/screen-cache";

/** Profile: "What friends say about you". Counts only, never who; only you see it. */
export function PropsAboutYou() {
  const [props, setProps] = useState<MyProps | null>(() => recall<MyProps>("profile:props") ?? null);
  const [all, setAll] = useState(false);
  const [sharing, setSharing] = useState<string | null>(null);

  useEffect(() => {
    myProps()
      .then((p) => {
        setProps(p);
        remember("profile:props", p);
      })
      .catch(() => {});
  }, []);

  if (!props) return null;

  async function share(item: MyProps["items"][number]) {
    setSharing(item.label);
    try {
      const blob = await propsShareImage(item);
      const file = new File([blob], "docchi-props.png", { type: "image/png" });
      const text = `My friends say I have the ${item.label.toLowerCase()} 💜 Give your friends props on Docchi.`;
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], text });
      } else {
        // No file sharing here (most desktops): save the picture instead.
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "docchi-props.png";
        a.click();
        window.setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      }
    } catch {
      // Dismissed.
    } finally {
      setSharing(null);
    }
  }

  const top = props.items[0]?.count ?? 1;
  const shown = all ? props.items : props.items.slice(0, 3);

  return (
    <section className="props-about" aria-labelledby="props-about-title">
      <div className="props-about-head">
        <h2 id="props-about-title">💜 What friends say about you</h2>
        <span className="props-only">🔒 Only you see this</span>
      </div>
      {props.items.length === 0 ? (
        <p className="props-about-empty">
          Nothing yet. <Link href="/props">Give your friends props</Link> and they&apos;ll start giving them back.
        </p>
      ) : (
        <>
          <ul className="props-about-list">
            {shown.map((i) => (
              <li key={i.label}>
                <span className="props-about-emoji" aria-hidden="true">
                  {i.emoji}
                </span>
                <span className="props-about-label">
                  {i.label}
                  <span className="props-about-bar" style={{ width: `${Math.max(8, (i.count / top) * 100)}%` }} aria-hidden="true" />
                </span>
                <strong className="props-about-n">×{i.count}</strong>
                <button
                  type="button"
                  className="profile-poll-icon press"
                  aria-label={`Share "${i.label}"`}
                  disabled={sharing === i.label}
                  onClick={() => share(i)}
                >
                  ↥
                </button>
              </li>
            ))}
          </ul>
          {props.items.length > 3 && (
            <button type="button" className="props-about-more" onClick={() => setAll((v) => !v)}>
              {all ? "Show less" : `Show all ${props.items.length}`}
            </button>
          )}
        </>
      )}
    </section>
  );
}
