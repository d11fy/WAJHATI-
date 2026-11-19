"use client";

import Image from "next/image";
import Link from "next/link";
import { ArrowUpRight, Monitor, Smartphone, X } from "lucide-react";
import { useRef, useState } from "react";
import type { Locale } from "@/lib/i18n";
import { themePreviews } from "./theme-previews";

const themes = [
  { id: "maison-wear", name: "Maison Wear", ar: "الأزياء", en: "Fashion" },
  { id: "aura-beauty", name: "Aura Beauty", ar: "الجمال والعناية", en: "Beauty" },
  { id: "electro-x", name: "Electro X", ar: "الإلكترونيات", en: "Electronics" },
  { id: "luma-gifts", name: "Luma Gifts", ar: "الهدايا", en: "Gifts" },
  { id: "digital-hub", name: "Digital Hub", ar: "المنتجات الرقمية", en: "Digital" },
  { id: "learnpro", name: "LearnPro", ar: "التعليم", en: "Learning" },
] as const;

export function ThemeShowcase({ locale }: { locale: Locale }) {
  const ar = locale === "ar";
  const [selected, setSelected] = useState<(typeof themes)[number]>(themes[0]);
  const dialog = useRef<HTMLDialogElement>(null);
  return <section className="theme-showcase" id="themes" aria-labelledby="theme-showcase-title">
    <div className="wajhati-market-width wajhati-market-section">
      <div className="premium-section-heading"><div><h2 id="theme-showcase-title">{ar ? "لكل تجارة، واجهة تليق بها." : "A distinct look for every ambition."}</h2></div><p>{ar ? "ستة تصاميم أساسية. اختر ما يشبه علامتك، ثم أضف منتجاتك وصورك. التخصيص المتقدم حسب باقتك." : "Six distinctive starting points. Add your products and photography. Advanced customization depends on your plan."}</p></div>
      <div className="theme-showcase-grid">{themes.map((theme) => <article className="theme-showcase-card" key={theme.id}><Link href={`/${locale}/demo/${theme.id}`} aria-label={`${ar ? "افتح المتجر التجريبي" : "Open demo store"} ${theme.name}`}>
        <div className="theme-showcase-image"><div className="theme-showcase-chrome" aria-hidden="true"><span /><span /><span /></div><Image src={themePreviews[theme.id][locale]} alt="" sizes="(max-width: 639px) 90vw, (max-width: 1023px) 45vw, 30vw" /><span className="theme-showcase-open"><Monitor size={16} aria-hidden="true" />{ar ? "افتح المتجر التجريبي" : "Open demo store"}</span></div>
        <div className="theme-showcase-caption"><div><span>{theme[locale]}</span><h3 dir="ltr">{theme.name}</h3></div><ArrowUpRight size={22} aria-hidden="true" /></div>
      </Link><button type="button" className="theme-screenshot-button" onClick={() => { setSelected(theme); dialog.current?.showModal(); }} aria-haspopup="dialog">{ar ? "لقطة سريعة للتصميم" : "Quick design preview"}</button></article>)}</div>
      <p className="theme-showcase-note"><Smartphone size={16} aria-hidden="true" />{ar ? "متجاوبة مع الهاتف والكمبيوتر. تصفّح الديمو وجرّب المنتجات والسلة بمحتوى توضيحي." : "Made for mobile and desktop. Explore products and the cart with illustrative demo content."}</p>
    </div>
    <dialog ref={dialog} className="theme-preview-dialog" aria-labelledby="theme-preview-heading" onClick={(event) => { if (event.target === event.currentTarget) dialog.current?.close(); }}>
      <header><div><h2 id="theme-preview-heading" dir="ltr">{selected.name}</h2><p>{ar ? "معاينة توضيحية للتصميم، وليست متجرًا للبيع" : "Illustrative design preview, not a live store"}</p></div><button type="button" autoFocus aria-label={ar ? "إغلاق المعاينة" : "Close preview"} onClick={() => dialog.current?.close()}><X size={22} /></button></header>
      <Image src={themePreviews[selected.id][locale]} alt={`${ar ? "التصميم الكامل" : "Full design"} · ${selected.name}`} sizes="(max-width: 1000px) 95vw, 1100px" />
    </dialog>
  </section>;
}
