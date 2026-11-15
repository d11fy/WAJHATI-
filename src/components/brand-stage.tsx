"use client";

import Image from "next/image";
import { Palette, PanelsTopLeft, Smartphone } from "lucide-react";
import { useState } from "react";
import type { Locale } from "@/lib/i18n";
import { themePreviews } from "./theme-previews";
import phoneAr from "@/assets/wajhati/themes/aura-beauty-phone-ar.png";
import phoneEn from "@/assets/wajhati/themes/aura-beauty-phone-en.png";

const stageThemes = [
  { id: "maison-wear", ar: "الأزياء", en: "Fashion" },
  { id: "aura-beauty", ar: "الجمال", en: "Beauty" },
  { id: "electro-x", ar: "الإلكترونيات", en: "Electronics" },
  { id: "luma-gifts", ar: "الهدايا", en: "Gifts" },
  { id: "digital-hub", ar: "الرقمية", en: "Digital" },
  { id: "learnpro", ar: "التعليم", en: "Learning" },
] as const;

export function BrandStage({ locale, interactive = false }: { locale: Locale; interactive?: boolean }) {
  const ar = locale === "ar";
  const [active, setActive] = useState<(typeof stageThemes)[number]["id"]>("maison-wear");
  return <figure className="brand-stage">
    <div className="brand-stage-orbit" aria-hidden="true" />
    <div className="brand-stage-browser">
      <div className="brand-stage-bar"><span className="wajhati-preview-dots" aria-hidden="true"><i /><i /><i /></span><span>WAJHATI / STUDIO</span><PanelsTopLeft size={14} aria-hidden="true" /></div>
      <div className="brand-stage-screen"><Image src={themePreviews[active][locale]} alt={ar ? "معاينة ثيم الأزياء من واجهتي بمنتجات توضيحية" : "WAJHATI fashion theme with illustrative products"} sizes="(max-width: 767px) 90vw, 600px" preload /></div>
    </div>
    <div className="brand-stage-phone" aria-hidden="true"><span /><div><Image src={ar ? phoneAr : phoneEn} alt="" sizes="200px" /></div></div>
    <div className="brand-stage-chip"><Palette size={19} aria-hidden="true" /><div><strong>{ar ? "هويتك، بكل تفاصيلها" : "Every detail, yours"}</strong><span>{ar ? "ألوان · خطوط · تصميم" : "Colors · Type · Design"}</span></div><div className="brand-stage-colors" aria-hidden="true"><i /><i /><i /></div></div>
    {interactive && (
      <div className="brand-stage-switcher" role="group" aria-label={ar ? "تبديل معاينة الثيم" : "Switch theme preview"}>
        {stageThemes.map((item) => (
          <button
            key={item.id}
            type="button"
            className="brand-stage-pill"
            aria-pressed={active === item.id}
            onClick={() => setActive(item.id)}
          >
            {item[locale]}
          </button>
        ))}
      </div>
    )}
    <figcaption><Smartphone size={14} aria-hidden="true" />{ar ? "ثيمات فعلية من واجهتي · محتوى توضيحي" : "Actual WAJHATI themes · Illustrative content"}</figcaption>
  </figure>;
}
