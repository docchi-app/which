"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { finishMove, takeHandoff, type Handoff } from "@/lib/move";
import { LogoMark } from "./Logo";

/**
 * Arriving from the old address with a sign-in. It asks "Continue as …?" before using it, so a
 * link someone else made can't quietly sign you into their account.
 */
export function MoveArrival() {
  const router = useRouter();
  const [hand, setHand] = useState<Handoff | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const h = takeHandoff();
    // The handoff is in the URL fragment, only readable after mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHand(h);
    if (!h) router.replace("/");
  }, [router]);

  async function go() {
    if (!hand) return;
    setBusy(true);
    if (await finishMove(hand)) router.replace(hand.to);
    else {
      setBusy(false);
      setFailed(true);
    }
  }

  if (!hand) return <div className="screen move-arrival" />;
  return (
    <div className="screen move-arrival">
      <div className="move-mark" aria-hidden="true">
        <LogoMark size={88} />
      </div>
      <h1 className="move-title">Welcome to Eithr</h1>
      {failed ? (
        <>
          <p className="move-text">That link has expired. Sign in once and everything&apos;s here.</p>
          <button type="button" className="btn btn-coral press move-go" onClick={() => router.replace("/")}>
            Go to Eithr →
          </button>
        </>
      ) : (
        <>
          <p className="move-text">
            Continue as <strong>{hand.name}</strong>?
          </p>
          <button type="button" className="btn btn-coral press move-go" onClick={go} disabled={busy}>
            {busy ? "Signing you in…" : "Continue →"}
          </button>
          <button type="button" className="sheet-later" onClick={() => router.replace("/")} disabled={busy}>
            Not me
          </button>
        </>
      )}
    </div>
  );
}
