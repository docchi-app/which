// Finds text that spills out of, or is clipped by, its box. Returns [{text, box, how}].
window.__overflow = (root) => {
  const out = [];
  const clipAncestor = (el) => {
    for (let a = el.parentElement; a; a = a.parentElement) {
      const s = getComputedStyle(a);
      if (s.overflowX !== 'visible' || s.overflowY !== 'visible') return a;
      if (a === root) return a;
    }
    return document.documentElement;
  };
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const seen = new Set();
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!n.textContent.trim()) continue;
    const el = n.parentElement;
    if (!el || el.closest('[aria-hidden="true"]') || getComputedStyle(el).visibility === 'hidden') continue;
    const r = document.createRange(); r.selectNodeContents(n);
    // Screen-reader-only text lives in a 1px, clipped box on purpose (sometimes a parent's).
    if (el.getBoundingClientRect().width <= 1 || getComputedStyle(el).clip !== 'auto') continue;
    let hidden = false;
    for (let a = el; a && !hidden; a = a.parentElement) hidden = getComputedStyle(a).clipPath !== 'none';
    if (hidden) continue;
    const a = clipAncestor(el);
    const top = a === document.body || a === document.documentElement;
    // The page itself scrolls up and down; only its sides are a hard edge.
    const ar = top ? { left: 0, top: -Infinity, right: window.innerWidth, bottom: Infinity } : a.getBoundingClientRect();
    const as = getComputedStyle(a);
    // A scrolling container (the card on a short screen) may scroll vertically; that isn't clipping.
    const vScroll = as.overflowY === 'auto' || as.overflowY === 'scroll';
    for (const rect of r.getClientRects()) {
      if (rect.width < 1) continue;
      const over = [];
      if (rect.right > ar.right + 1) over.push(`right +${Math.round(rect.right - ar.right)}`);
      if (rect.left < ar.left - 1) over.push(`left +${Math.round(ar.left - rect.left)}`);
      if (!vScroll && rect.bottom > ar.bottom + 1) over.push(`bottom +${Math.round(rect.bottom - ar.bottom)}`);
      if (!vScroll && rect.top < ar.top - 1) over.push(`top +${Math.round(ar.top - rect.top)}`);
      if (rect.right > window.innerWidth + 1) over.push('past screen');
      if (over.length) {
        const key = n.textContent.slice(0, 30) + over.join();
        if (!seen.has(key)) { seen.add(key); out.push({ text: n.textContent.trim().slice(0, 40), in: el.className || el.tagName, box: a.className || a.tagName, how: over.join(', ') }); }
        break;
      }
    }
  }
  // Text that's cut with an ellipsis is fine; text cut silently by nowrap is not.
  for (const el of root.querySelectorAll('*')) {
    const s = getComputedStyle(el);
    // Visually hidden (screen-reader-only) boxes are clipped on purpose.
    if (s.clipPath !== 'none' || el.closest('[aria-hidden="true"]')) continue;
    if (el.scrollWidth > el.clientWidth + 1 && s.overflowX === 'hidden' && s.textOverflow !== 'ellipsis' && el.clientWidth > 1 && el !== document.body) {
      const t = el.textContent.trim().slice(0, 40);
      if (t) out.push({ text: t, in: el.className, box: el.className, how: `content ${el.scrollWidth}px in ${el.clientWidth}px box` });
    }
  }
  return out;
};
