import { z } from "zod";

export const familyThemeIds = ["electro-x", "maison-wear", "aura-beauty", "luma-gifts", "digital-hub", "learnpro"] as const;
export const themeIds = ["minimal-commerce", "luxury-boutique", ...familyThemeIds] as const;
export const themeSections = ["hero", "categories", "featured", "products", "editorial", "comparison"] as const;
export const designAssetKinds = ["logo", "icon", "banner"] as const;
export const themeFonts = ["sans", "editorial"] as const;
export type ThemeId = (typeof themeIds)[number];
export type FamilyThemeId = (typeof familyThemeIds)[number];
export type ThemeSection = (typeof themeSections)[number];
export type AssetKind = (typeof designAssetKinds)[number];

export const themeRegistry = {
  "minimal-commerce": {
    version: 1, title: "Minimal Commerce", font: "sans", sections: ["hero", "categories", "featured", "products"],
    colors: { background: "#F7F8F2", text: "#192D26", accent: "#215742", onAccent: "#FFFFFF" },
  },
  "luxury-boutique": {
    version: 1, title: "Luxury Boutique", font: "editorial", sections: ["hero", "featured", "categories", "products"],
    colors: { background: "#FAF3E8", text: "#302119", accent: "#643B30", onAccent: "#FFF7EC" },
  },
  "electro-x": {
    version: 1, title: "Electro X", font: "sans", sections: ["hero", "featured", "categories", "editorial", "products"],
    colors: { background: "#080F1D", text: "#F9FCFF", accent: "#4BE7C5", onAccent: "#08101E" },
  },
  "maison-wear": {
    version: 1, title: "Maison Wear", font: "sans", sections: ["hero", "editorial", "featured", "categories", "products"],
    colors: { background: "#F5F0E8", text: "#2D2822", accent: "#25231F", onAccent: "#FFFFFF" },
  },
  "aura-beauty": {
    version: 1, title: "Aura Beauty", font: "sans", sections: ["hero", "categories", "featured", "editorial", "products"],
    colors: { background: "#FBF4F1", text: "#382F35", accent: "#A45476", onAccent: "#FFFFFF" },
  },
  "luma-gifts": {
    version: 1, title: "Luma Gifts", font: "sans", sections: ["hero", "categories", "editorial", "featured", "products"],
    colors: { background: "#F9F5FF", text: "#31263E", accent: "#7452B5", onAccent: "#FFFFFF" },
  },
  "digital-hub": {
    version: 1, title: "Digital Hub", font: "sans", sections: ["hero", "featured", "comparison", "editorial", "categories", "products"],
    colors: { background: "#080E20", text: "#F5F8FF", accent: "#5EE9D3", onAccent: "#071324" },
  },
  learnpro: {
    version: 1, title: "LearnPro", font: "sans", sections: ["hero", "categories", "products", "editorial", "featured"],
    colors: { background: "#F5F7FE", text: "#162440", accent: "#315DE7", onAccent: "#FFFFFF" },
  },
} as const satisfies Record<ThemeId, { version: number; title: string; font: (typeof themeFonts)[number]; sections: readonly ThemeSection[]; colors: Record<string, string> }>;

export function isFamilyTheme(id: ThemeId): id is FamilyThemeId {
  return (familyThemeIds as readonly ThemeId[]).includes(id);
}

function luminance(hex: string) {
  const channels = [1, 3, 5].map((position) => {
    const value = Number.parseInt(hex.slice(position, position + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

export function contrast(first: string, second: string) {
  const a = luminance(first);
  const b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/).transform((value) => value.toUpperCase());
const text = (max: number) => z.string().trim().max(max).refine((value) => !/[<>\p{Cs}\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/u.test(value));
const selected = z.array(z.uuid()).max(8).refine((values) => new Set(values).size === values.length);
const familyContent = z.strictObject({
  kickerAr: text(80), kickerEn: text(80), headingAr: text(120), headingEn: text(120), bodyAr: text(520), bodyEn: text(520),
});
export type FamilyContent = z.output<typeof familyContent>;
export const emptyFamilyContent: FamilyContent = { kickerAr: "", kickerEn: "", headingAr: "", headingEn: "", bodyAr: "", bodyEn: "" };
const sectionsSchema = z.array(z.strictObject({ id: z.enum(themeSections), visible: z.boolean() })).max(themeSections.length);

function validSectionOrder(theme: ThemeId, sections: z.output<typeof sectionsSchema>) {
  const expected = new Set<ThemeSection>(themeRegistry[theme].sections);
  return sections.length === expected.size && new Set(sections.map(({ id }) => id)).size === expected.size &&
    sections.every(({ id }) => expected.has(id)) && sections.some((section) => section.id === "products" && section.visible);
}

export const themeConfig = z.strictObject({
  theme: z.enum(themeIds),
  version: z.literal(1),
  font: z.enum(themeFonts),
  colors: z.strictObject({ background: hex, text: hex, accent: hex, onAccent: hex }),
  hero: z.strictObject({ titleAr: text(120), titleEn: text(120), descriptionAr: text(320), descriptionEn: text(320) }),
  assets: z.strictObject({ logo: z.uuid().nullable(), icon: z.uuid().nullable(), banner: z.uuid().nullable() }),
  sections: sectionsSchema,
  products: selected,
  categories: selected,
  familyContent: z.partialRecord(z.enum(familyThemeIds), familyContent).optional(),
  sectionPreferences: z.partialRecord(z.enum(themeIds), sectionsSchema).optional(),
}).superRefine((config, context) => {
  const { colors, sections } = config;
  if (Math.min(contrast(colors.text, colors.background), contrast(colors.accent, colors.background), contrast(colors.accent, colors.onAccent)) < 4.5) {
    context.addIssue({ code: "custom", message: "contrast", path: ["colors"] });
  }
  if (!validSectionOrder(config.theme, sections)) {
    context.addIssue({ code: "custom", message: "sections", path: ["sections"] });
  }
  for (const [theme, saved] of Object.entries(config.sectionPreferences ?? {})) {
    if (!validSectionOrder(theme as ThemeId, saved)) context.addIssue({ code: "custom", message: "sections", path: ["sectionPreferences", theme] });
  }
});

export type ThemeConfig = z.output<typeof themeConfig>;

export function defaultDesign(theme: ThemeId = "minimal-commerce"): ThemeConfig {
  const entry = themeRegistry[theme];
  return {
    theme, version: entry.version, font: entry.font, colors: { ...entry.colors },
    hero: { titleAr: "", titleEn: "", descriptionAr: "", descriptionEn: "" }, assets: { logo: null, icon: null, banner: null },
    sections: entry.sections.map((id) => ({ id, visible: true })), products: [], categories: [],
  };
}

export function switchTheme(config: ThemeConfig, id: ThemeId): ThemeConfig {
  if (config.theme === id) return config;
  const entry = themeRegistry[id];
  const changingFamily = isFamilyTheme(id) || isFamilyTheme(config.theme);
  const sections = config.sectionPreferences?.[id] ?? (changingFamily
    ? entry.sections.map((section) => ({ id: section, visible: config.sections.find((item) => item.id === section)?.visible ?? true }))
    : config.sections);
  const sectionPreferences = changingFamily || config.sectionPreferences
    ? { ...config.sectionPreferences, [config.theme]: config.sections } : undefined;
  return {
    ...config, theme: id, version: entry.version, font: entry.font, colors: { ...entry.colors }, sections,
    ...(sectionPreferences ? { sectionPreferences } : {}),
  };
}

export function designAssetPath(store: string, id: string, preview = false) {
  return `/api/${preview ? "theme-assets" : "store-design-media"}/${store}/${id}`;
}
