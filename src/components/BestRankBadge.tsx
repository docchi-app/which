"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getBestRank, type BestRank } from "@/lib/profile";

/** "🏆 Best rank #3" (the week in its tooltip), for anyone who's made the creators' top 100. name: whose; mine if left out. */
export function BestRankBadge({ name }: { name?: string }) {
  const [best, setBest] = useState<BestRank | null>(null);

  useEffect(() => {
    let stale = false;
    getBestRank(name)
      .then((b) => !stale && setBest(b))
      .catch(() => {});
    return () => {
      stale = true;
    };
  }, [name]);

  if (!best) return null;
  const week = new Date(`${best.week}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  return (
    <Link href="/leaders" className="best-rank" title={`Best weekly rank on the Leaders board: #${best.rank}, week of ${week}`}>
      🏆 Best rank <strong>#{best.rank}</strong>
    </Link>
  );
}
