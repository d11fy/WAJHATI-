"use client";

/*
 * FAQ list with live search and a link per question, following 21st.dev's "FAQ Accordion Section" (search across questions and answers,
 * deep links). Uses native <details> so it works without JavaScript; search only hides non-matching rows.
 */
import { Link2, Plus, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

type Props = { items: readonly (readonly [string, string])[]; searchable: boolean; labels: { search: string; none: string; link: string } };

export function FaqList({ items, searchable, labels }: Props) {
  const [query, setQuery] = useState("");
  const list = useRef<HTMLDivElement>(null);
  const rows = useMemo(() => items.map(([question, answer], index) => ({ question, answer, id: `faq-${index + 1}` })), [items]);
  const needle = query.trim().toLowerCase();
  const visible = needle ? rows.filter((row) => `${row.question} ${row.answer}`.toLowerCase().includes(needle)) : rows;

  useEffect(() => {
    const open = () => {
      const target = list.current?.querySelector<HTMLDetailsElement>(`details[id="${decodeURIComponent(window.location.hash.slice(1))}"]`);
      if (target) { target.open = true; target.scrollIntoView({ block: "center" }); }
    };
    open();
    window.addEventListener("hashchange", open);
    return () => window.removeEventListener("hashchange", open);
  }, []);

  return <div className="faq" ref={list}>
    {searchable && <label className="faq-search"><Search size={18} aria-hidden="true" /><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={labels.search} aria-label={labels.search} /></label>}
    {visible.map((row, index) => <details key={row.id} id={row.id} className="panel" open={!needle && index === 0 ? true : undefined}>
      <summary>{row.question}<Plus size={20} aria-hidden="true" /></summary>
      <p>{row.answer}</p>
      <a className="faq-link" href={`#${row.id}`}><Link2 size={14} aria-hidden="true" />{labels.link}</a>
    </details>)}
    {searchable && needle && visible.length === 0 && <p className="faq-none" role="status">{labels.none}</p>}
  </div>;
}
