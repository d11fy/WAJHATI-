import type { StaticImageData } from "next/image";
import type { Locale } from "@/lib/i18n";
import { themePreviews } from "./theme-previews";

export type HeroTheme = { id: string; label: string; alt: string; src: StaticImageData; demo: string };

const labels = [
  ["maison-wear", "الأزياء", "Fashion"],
  ["aura-beauty", "الجمال", "Beauty"],
  ["electro-x", "الإلكترونيات", "Electronics"],
  ["luma-gifts", "الهدايا", "Gifts"],
  ["digital-hub", "المنتجات الرقمية", "Digital"],
  ["learnpro", "التعليم", "Learning"],
] as const;

/** The six family themes with their real demo screenshots, for the home hero's theme switcher. */
export function heroThemes(locale: Locale): HeroTheme[] {
  const ar = locale === "ar";
  return labels.map(([id, labelAr, labelEn]) => {
    const label = ar ? labelAr : labelEn;
    return {
      id, label, demo: `/${locale}/demo/${id}`, src: themePreviews[id][locale],
      alt: ar ? `معاينة ثيم ${label} من واجهتي بمنتجات توضيحية` : `WAJHATI ${label} theme with illustrative products`,
    };
  });
}
