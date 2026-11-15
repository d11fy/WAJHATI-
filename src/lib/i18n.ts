export const locales = ["ar", "en"] as const;
export type Locale = (typeof locales)[number];

export function isLocale(value: string): value is Locale {
  return value === "ar" || value === "en";
}

export function otherLocale(locale: Locale): Locale {
  return locale === "ar" ? "en" : "ar";
}

export function labels(locale: Locale, type: "region" | "currency", values: readonly string[]) {
  const names = new Intl.DisplayNames([locale], { type });
  return values.map((value) => ({ value, label: names.of(value) ?? value }));
}
