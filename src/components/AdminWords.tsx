"use client";

import { useEffect, useMemo, useState } from "react";
import { addWord, fetchWords, removeWord, testWords, type BlockedWord, type WordKind } from "@/lib/admin";

const KINDS: { id: WordKind; label: string; hint: string }[] = [
  { id: "word", label: "Whole word", hint: "Only the word or phrase itself (bc, teri maa ki)" },
  { id: "root", label: "Start of a word", hint: "Every word that starts with it (chutiy → chutiya, chutiyapa)" },
  { id: "part", label: "Anywhere", hint: "Inside any word; only for long ones (behenchod)" },
  { id: "allow", label: "Always allow", hint: "An ordinary word a rule above catches by mistake (shiitake)" },
];
const LANGS: [string, string][] = [
  ["", "Any"],
  ["en", "English"],
  ["hi", "Hindi"],
  ["mr", "Marathi"],
];

/**
 * Admin → Words: the word filter's list. Test any text, add or remove words. Text is
 * cleaned before matching (sh1t, f*ck, f u c k, fuuuck, Devanagari nukta), so add
 * plain spellings only.
 */
export function AdminWords() {
  const [words, setWords] = useState<BlockedWord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [probe, setProbe] = useState("");
  const [hits, setHits] = useState<string[] | null>(null);
  const [term, setTerm] = useState("");
  const [kind, setKind] = useState<WordKind>("word");
  const [lang, setLang] = useState("");
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState(false);

  const load = () =>
    fetchWords()
      .then(setWords)
      .catch(() => setError("Couldn't load the words."));
  useEffect(() => void load(), []);

  // Test as you type (a moment after the last key).
  useEffect(() => {
    if (!probe.trim()) return;
    const t = window.setTimeout(() => {
      testWords(probe)
        .then(setHits)
        .catch(() => setHits(null));
    }, 300);
    return () => window.clearTimeout(t);
  }, [probe]);

  async function add() {
    if (term.trim().length < 2 || busy) return;
    setBusy(true);
    setError(null);
    try {
      await addWord(term, kind, lang || null);
      setTerm("");
      await load();
      if (probe.trim()) setHits(await testWords(probe));
    } catch (e) {
      setError(e instanceof Error && e.message === "word_length" ? "2 to 40 letters." : "Couldn't add it.");
    }
    setBusy(false);
  }

  async function remove(w: string) {
    setError(null);
    try {
      await removeWord(w);
      setWords((list) => list?.filter((x) => x.term !== w) ?? null);
      if (probe.trim()) setHits(await testWords(probe));
    } catch {
      setError("Couldn't remove it.");
    }
  }

  const shown = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return (words ?? []).filter((w) => !f || w.term.includes(f));
  }, [words, filter]);

  return (
    <section className="admin-words" aria-label="Blocked words">
      <div className="field">
        <label htmlFor="word-test" className="field-label">
          Test any text
        </label>
        <input
          id="word-test"
          className="field-input"
          placeholder="e.g. Who's the bigg3st ch*tiya?"
          value={probe}
          onChange={(e) => {
            setProbe(e.target.value);
            if (!e.target.value.trim()) setHits(null);
          }}
        />
        {probe.trim() && hits && (
          <p className={`word-verdict${hits.length ? " word-verdict-blocked" : ""}`} role="status">
            {hits.length ? `🚫 Blocked by: ${hits.join(", ")}` : "✅ Goes through"}
          </p>
        )}
      </div>

      <div className="field">
        <label htmlFor="word-add" className="field-label">
          Add a word
        </label>
        <div className="word-add">
          <input
            id="word-add"
            className="field-input"
            placeholder="word or phrase"
            maxLength={40}
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add()}
          />
          <select className="field-input" aria-label="How it matches" value={kind} onChange={(e) => setKind(e.target.value as WordKind)}>
            {KINDS.map((k) => (
              <option key={k.id} value={k.id}>
                {k.label}
              </option>
            ))}
          </select>
          <select className="field-input" aria-label="Language" value={lang} onChange={(e) => setLang(e.target.value)}>
            {LANGS.map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
          <button type="button" className="mini-btn mini-btn-coral" onClick={add} disabled={busy || term.trim().length < 2}>
            Add
          </button>
        </div>
        <p className="field-hint">{KINDS.find((k) => k.id === kind)?.hint}</p>
        {error && (
          <p className="poll-error" role="alert">
            {error}
          </p>
        )}
      </div>

      <div className="field">
        <div className="word-list-head">
          <span className="field-label">{words ? `${words.length} words` : "Words"}</span>
          <input className="field-input word-filter" aria-label="Find a word" placeholder="Find…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        </div>
        {!words ? (
          <p className="admin-empty">Loading…</p>
        ) : (
          <ul className="word-list">
            {shown.map((w) => (
              <li key={w.term} className={`word-row word-${w.kind}`}>
                <span className="word-term">{w.term}</span>
                <span className="word-kind">
                  {KINDS.find((k) => k.id === w.kind)?.label}
                  {w.lang ? ` · ${w.lang}` : ""}
                </span>
                <button type="button" className="word-x" aria-label={`Remove ${w.term}`} onClick={() => remove(w.term)}>
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
