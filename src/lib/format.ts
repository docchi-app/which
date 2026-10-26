/** "18h left", "2d left", "Closed". */
export function timeLeft(closesAt: string, now = Date.now()): string {
  const ms = new Date(closesAt).getTime() - now;
  if (ms <= 0) return "Closed";
  const hours = Math.floor(ms / 3_600_000);
  if (hours >= 48) return `${Math.floor(hours / 24)}d left`;
  if (hours >= 1) return `${hours}h left`;
  return `${Math.max(1, Math.floor(ms / 60_000))}m left`;
}

/** Whole-number percentages that always add up to 100 (largest remainder). */
export function percentages(counts: number[]): number[] {
  const total = counts.reduce((a, b) => a + b, 0);
  if (total === 0) return counts.map(() => 0);
  const exact = counts.map((c) => (c / total) * 100);
  const floored = exact.map(Math.floor);
  let left = 100 - floored.reduce((a, b) => a + b, 0);
  const order = exact
    .map((v, i) => [v - Math.floor(v), i] as const)
    .sort((a, b) => b[0] - a[0]);
  for (const [, i] of order) {
    if (left-- <= 0) break;
    floored[i] += 1;
  }
  return floored;
}

export const formatCount = (n: number) => n.toLocaleString("en-US");

/** Short counts for tight spots, never more than 4 characters: 950, 3.4K, 12K, 999K, 1.2M. Rounds down. */
export function compactCount(n: number): string {
  const down = (x: number) => Math.floor(x * 10) / 10;
  if (n < 1000) return String(Math.max(0, Math.floor(n)));
  if (n < 10_000) return `${down(n / 1000)}K`;
  if (n < 1_000_000) return `${Math.floor(n / 1000)}K`;
  if (n < 10_000_000) return `${down(n / 1_000_000)}M`;
  return `${Math.min(Math.floor(n / 1_000_000), 999)}M`;
}
