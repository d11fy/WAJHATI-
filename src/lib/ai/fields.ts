import type { ThemeConfig, ThemeId } from "../theme-config";
import { emptyFamilyContent, isFamilyTheme } from "../theme-config";

/**
 * Every operation has one price in the admin-editable cost table. A price belongs to the kind of text, not to the command:
 * shortening, translating or improving a headline all cost the same as writing it.
 */
export const aiOperations = ["headline", "product_description", "section_description", "about_store", "theme_fill", "store_from_idea"] as const;
export type AiOperation = (typeof aiOperations)[number];

/** Launch prices, also seeded by migration 0030. The database table is the source of truth at run time. */
export const defaultCredits: Record<AiOperation, number> = {
  headline: 1, product_description: 2, section_description: 2, about_store: 3, theme_fill: 15, store_from_idea: 20,
};

export const aiCommands = ["write", "improve", "shorten", "expand", "tone", "alternatives", "translate"] as const;
export type AiCommand = (typeof aiCommands)[number];
export const aiTones = ["professional", "friendly", "luxury", "simple", "persuasive"] as const;
export type AiTone = (typeof aiTones)[number];
export type AiLanguage = "ar" | "en";

export type AiField = { id: string; operation: AiOperation; max: number; language: AiLanguage; sibling: string };

function pair(base: string, operation: AiOperation, max: number): AiField[] {
  return [
    { id: `${base}Ar`, operation, max, language: "ar", sibling: `${base}En` },
    { id: `${base}En`, operation, max, language: "en", sibling: `${base}Ar` },
  ];
}

/**
 * The only fields the writing assistant can touch. This is an allow-list on purpose: passwords, prices, SKUs, e-mail, addresses, phone numbers and
 * legal text are not here, so no request can name them. Limits match the product form and the theme configuration schema.
 */
export const aiFields: readonly AiField[] = [
  ...pair("product.name", "headline", 100),
  ...pair("product.description", "product_description", 2000),
  ...pair("hero.title", "headline", 120),
  ...pair("hero.description", "about_store", 320),
  ...pair("family.kicker", "headline", 80),
  ...pair("family.heading", "headline", 120),
  ...pair("family.body", "section_description", 520),
];

export function aiField(id: string) {
  return aiFields.find((field) => field.id === id) ?? null;
}

/** The text fields a theme really has. Colors, fonts, images and section structure are never listed. */
export type ThemeTextField = { path: string; group: "hero" | "family"; key: string; language: AiLanguage; max: number; label: { ar: string; en: string } };

const heroFields: ThemeTextField[] = [
  { path: "hero.titleAr", group: "hero", key: "titleAr", language: "ar", max: 120, label: { ar: "عنوان الواجهة (عربي)", en: "Hero title (Arabic)" } },
  { path: "hero.titleEn", group: "hero", key: "titleEn", language: "en", max: 120, label: { ar: "عنوان الواجهة (إنجليزي)", en: "Hero title (English)" } },
  { path: "hero.descriptionAr", group: "hero", key: "descriptionAr", language: "ar", max: 320, label: { ar: "وصف الواجهة (عربي)", en: "Hero description (Arabic)" } },
  { path: "hero.descriptionEn", group: "hero", key: "descriptionEn", language: "en", max: 320, label: { ar: "وصف الواجهة (إنجليزي)", en: "Hero description (English)" } },
];
const familyFields: ThemeTextField[] = [
  ["kicker", 80, "عبارة فوق العنوان", "Hero eyebrow"], ["heading", 120, "عنوان القسم", "Section heading"], ["body", 520, "نص القسم", "Section text"],
].flatMap(([base, max, ar, en]) => (["Ar", "En"] as const).map((suffix) => ({
  path: `familyContent.${base}${suffix}`, group: "family" as const, key: `${base}${suffix}`, language: suffix === "Ar" ? "ar" as const : "en" as const, max: max as number,
  label: { ar: `${ar} (${suffix === "Ar" ? "عربي" : "إنجليزي"})`, en: `${en} (${suffix === "Ar" ? "Arabic" : "English"})` },
})));

export function themeTextFields(theme: ThemeId, languages: readonly AiLanguage[] = ["ar", "en"]): ThemeTextField[] {
  return [...heroFields, ...(isFamilyTheme(theme) ? familyFields : [])].filter((field) => languages.includes(field.language));
}

export function readThemeText(config: ThemeConfig, field: ThemeTextField): string {
  if (field.group === "hero") return config.hero[field.key as keyof ThemeConfig["hero"]];
  if (!isFamilyTheme(config.theme)) return "";
  return (config.familyContent?.[config.theme] ?? emptyFamilyContent)[field.key as keyof typeof emptyFamilyContent];
}

/** Returns a copy of the design with exactly these text values replaced. Nothing else in the configuration is touched. */
export function writeThemeText(config: ThemeConfig, values: ReadonlyMap<ThemeTextField, string>): ThemeConfig {
  let next = config;
  for (const [field, value] of values) {
    if (field.group === "hero") next = { ...next, hero: { ...next.hero, [field.key]: value } };
    else if (isFamilyTheme(next.theme)) {
      const family = next.theme;
      next = { ...next, familyContent: { ...next.familyContent, [family]: { ...emptyFamilyContent, ...next.familyContent?.[family], [field.key]: value } } };
    }
  }
  return next;
}
