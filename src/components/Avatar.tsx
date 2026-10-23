/** A person's Google photo, or the first letter of their name on a colour tile. */
const TILE_COLORS = ["var(--coral)", "var(--sky)", "var(--sun)", "var(--mint)", "var(--lilac)"];

export function Avatar({ name, url, size = 40 }: { name: string; url?: string | null; size?: number }) {
  const style = { width: size, height: size, borderRadius: Math.round(size * 0.32), fontSize: Math.round(size * 0.45) };
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img className="person-avatar" src={url} alt="" referrerPolicy="no-referrer" style={style} />;
  }
  const color = TILE_COLORS[[...name].reduce((n, c) => n + c.charCodeAt(0), 0) % TILE_COLORS.length];
  return (
    <span className="person-avatar person-avatar-initial" aria-hidden="true" style={{ ...style, background: color }}>
      {name.charAt(0).toUpperCase()}
    </span>
  );
}
