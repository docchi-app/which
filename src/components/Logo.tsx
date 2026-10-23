/** The Docchi mark: a speech bubble whose eyes glance between answers. */
export function LogoMark({ size = 38, shadow = true }: { size?: number; shadow?: boolean }) {
  const bubble =
    "M12 4H38A8 8 0 0 1 46 12V28A8 8 0 0 1 38 36H21L12 44V36A8 8 0 0 1 4 28V12A8 8 0 0 1 12 4Z";
  return (
    <svg width={size} height={size} viewBox="0 0 52 52" aria-hidden="true">
      {shadow && <path d={bubble} transform="translate(3 3)" fill="var(--ink)" />}
      <path d={bubble} fill="var(--sun)" stroke="var(--ink)" strokeWidth="3" strokeLinejoin="round" />
      <circle cx="17" cy="18" r="7" fill="#fff" stroke="var(--ink)" strokeWidth="2.4" />
      <circle cx="33" cy="18" r="7" fill="#fff" stroke="var(--ink)" strokeWidth="2.4" />
      <g className="logo-pupils">
        <circle cx="17" cy="18" r="3.2" fill="var(--ink)" />
        <circle cx="33" cy="18" r="3.2" fill="var(--ink)" />
      </g>
      <path d="M21 29Q25 32 29 29" fill="none" stroke="var(--ink)" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}

export function Wordmark() {
  return (
    <span className="wordmark">
      docchi<span className="wordmark-q">?</span>
    </span>
  );
}
