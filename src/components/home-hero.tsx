"use client";

/*
 * Home hero. Layout and behavior follow the "Preview Switch Hero" pattern from 21st.dev (split hero: copy with CTAs on one side,
 * a text-tab rail that switches the product preview on the other, and a divided strip of facts underneath). Rebuilt here in plain
 * CSS with logical properties so it works right-to-left; the preview shows WAJHATI's real theme screenshots (demo data only).
 */
import Image from "next/image";
import Link from "next/link";
import { ArrowUpLeft, ExternalLink } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { Locale } from "@/lib/i18n";
import type { HeroTheme } from "./hero-themes";

type Props = {
  locale: Locale; startHref: string; startLabel: string; note: string | null; themes: HeroTheme[]; factIcons: ReactNode[];
  copy: { badge: string; title: [string, string]; intro: string; explore: string; themesLabel: string; facts: readonly string[] };
};

export function HomeHero({ locale, startHref, startLabel, note, themes, factIcons, copy }: Props) {
  const ar = locale === "ar";
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    if (paused || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = window.setInterval(() => setActive((index) => (index + 1) % themes.length), 4800);
    return () => window.clearInterval(timer);
  }, [paused, themes.length]);

  function onKey(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const step = { ArrowDown: 1, ArrowRight: ar ? -1 : 1, ArrowUp: -1, ArrowLeft: ar ? 1 : -1 }[event.key];
    if (!step) return;
    event.preventDefault();
    const next = (index + step + themes.length) % themes.length;
    setActive(next);
    setPaused(true);
    tabs.current[next]?.focus();
  }

  const current = themes[active];
  return <section className="mh" aria-labelledby="mh-title">
    <div className="mh-glow" aria-hidden="true" />
    <div className="wajhati-market-width mh-split">
      <div className="mh-copy">
        <p className="mh-badge"><span>{ar ? "جديد" : "New"}</span>{ar ? "ثيمات جاهزة بالعربية والإنجليزية" : "Ready-made themes in Arabic and English"}</p>
        <h1 id="mh-title">{copy.title[0]} <em>{copy.title[1]}</em></h1>
        <p className="mh-intro">{copy.intro}</p>
        <div className="mh-actions">
          <Link href={startHref} className="mh-primary">{startLabel}<ArrowUpLeft size={18} className="mh-arrow" aria-hidden="true" /></Link>
          <a href="#themes" className="mh-secondary">{copy.explore}</a>
        </div>
        {note && <p className="mh-note">{note}</p>}
      </div>
      <div className="mh-demo" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
        <div className="mh-rail" role="tablist" aria-label={copy.themesLabel} aria-orientation="vertical">
          {themes.map((theme, index) => <button key={theme.id} ref={(node) => { tabs.current[index] = node; }} type="button" role="tab" id={`mh-tab-${theme.id}`}
            aria-selected={index === active} aria-controls="mh-panel" tabIndex={index === active ? 0 : -1} className="mh-tab"
            onClick={() => { setActive(index); setPaused(true); }} onKeyDown={(event) => onKey(event, index)}>{theme.label}</button>)}
        </div>
        <div className="mh-frame" id="mh-panel" role="tabpanel" aria-labelledby={`mh-tab-${current.id}`}>
          <div className="mh-chrome">
            <span className="mh-dots" aria-hidden="true"><i /><i /><i /></span>
            <span className="mh-url" dir="ltr">wajhati.store/s/<b>{ar ? "متجرك" : "your-store"}</b></span>
            <Link href={current.demo} className="mh-open" aria-label={ar ? `افتح متجر ${current.label} التجريبي` : `Open the ${current.label} demo store`}><ExternalLink size={14} aria-hidden="true" /><span>{ar ? "افتح" : "Open"}</span></Link>
          </div>
          <div className="mh-screen">
            {themes.map((theme, index) => <Image key={theme.id} src={theme.src} alt={index === active ? theme.alt : ""} aria-hidden={index === active ? undefined : true}
              sizes="(max-width: 767px) 94vw, 640px" priority={index === 0} className={index === active ? "mh-shot is-active" : "mh-shot"} />)}
          </div>
        </div>
        <p className="mh-caption">{ar ? "ثيمات فعلية من واجهتي · محتوى توضيحي" : "Actual WAJHATI themes · illustrative content"}</p>
      </div>
    </div>
    <ul className="mh-facts wajhati-market-width" aria-label={ar ? "لماذا واجهتي" : "Why WAJHATI"}>
      {copy.facts.map((fact, index) => <li key={fact}>{factIcons[index]}<span>{fact}</span></li>)}
    </ul>
  </section>;
}
