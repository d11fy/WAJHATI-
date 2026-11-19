"use client";

/*
 * Header menu that lists the six family themes with their real demo screenshots. Pattern: 21st.dev "Mega Menu Navbar" (animated panel
 * under a nav item), rebuilt without a library. It closes on Escape, on outside click and when the focus leaves it.
 */
import Image from "next/image";
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { HeroTheme } from "./hero-themes";

export function ThemesMenu({ label, all, themes }: { label: string; all: { href: string; label: string }; themes: HeroTheme[] }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent) { if (event.key === "Escape") setOpen(false); return; }
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", close); };
  }, [open]);

  return <div className="tm" ref={root} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false); }}>
    <button type="button" className="tm-trigger" aria-expanded={open} aria-controls={open ? "tm-panel" : undefined} onClick={() => setOpen((value) => !value)}>
      {label}<ChevronDown size={16} aria-hidden="true" className="tm-chevron" />
    </button>
    {open && <div id="tm-panel" className="tm-panel" data-open="true">
      <ul className="tm-grid">
        {themes.map((theme) => <li key={theme.id}><Link href={theme.demo} onClick={() => setOpen(false)}>
          <span className="tm-thumb"><Image src={theme.src} alt="" sizes="180px" loading="lazy" /></span>
          <span className="tm-name">{theme.label}</span>
        </Link></li>)}
      </ul>
      <Link className="tm-all" href={all.href} onClick={() => setOpen(false)}>{all.label}</Link>
    </div>}
  </div>;
}
