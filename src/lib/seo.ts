import type { Metadata } from "next";
import { locales, type Locale } from "./i18n";
import { legalApproved, legalPaths } from "./legal";

/** Marketing routes that may be indexed, relative to `/{locale}`. */
export const marketingPaths = ["", "/features", "/pricing", "/faq"] as const;

/** Routes that must never be crawled: private, transactional or per-user. */
export const privateSections = ["dashboard", "platform", "account", "payment-review", "identity", "demo", "sign-in", "sign-up", "forgot-password"] as const;

/** Public origin from APP_ORIGIN, read at request time. Falls back to localhost for local work. */
export function siteOrigin(env: Record<string, string | undefined> = process.env) {
  try {
    return new URL(env.APP_ORIGIN ?? "");
  } catch {
    return new URL("http://localhost:3000");
  }
}

/**
 * Only the production environment is crawlable. Development and staging (DAR_ENV) are
 * disallowed in robots.txt so a staging copy is never indexed.
 */
export function crawlable(env: Record<string, string | undefined> = process.env) {
  return env.DAR_ENV === "production" && siteOrigin(env).protocol === "https:";
}

export function robotsRules(env: Record<string, string | undefined> = process.env) {
  if (!crawlable(env)) return { rules: [{ userAgent: "*", disallow: ["/"] }] };
  return {
    rules: [{
      userAgent: "*",
      allow: ["/"],
      disallow: ["/api/", ...locales.flatMap((locale) => privateSections.map((section) => `/${locale}/${section}`))],
    }],
    sitemap: `${siteOrigin(env).origin}/sitemap.xml`,
  };
}

export function sitemapEntries(env: Record<string, string | undefined> = process.env, now = new Date(), unresolvedLegal?: number) {
  if (!crawlable(env)) return [];
  const origin = siteOrigin(env).origin;
  // Draft legal pages stay out of the sitemap until LEGAL_APPROVED=true.
  const paths = [...marketingPaths, ...(legalApproved(env, unresolvedLegal) ? legalPaths : [])];
  return locales.flatMap((locale) => paths.map((path) => ({
    url: `${origin}/${locale}${path}`,
    lastModified: now,
    changeFrequency: path === "/pricing" ? "weekly" as const : "monthly" as const,
    priority: path === "" ? 1 : 0.7,
    alternates: { languages: Object.fromEntries(locales.map((language) => [language, `${origin}/${language}${path}`])) },
  })));
}

/** Canonical, hreflang and social metadata for a marketing page. */
export function marketingMetadata(locale: Locale, path: string, title: string | undefined, description: string, index = true): Metadata {
  const brand = locale === "ar" ? "واجهتي | WAJHATI" : "WAJHATI | واجهتي";
  const url = `/${locale}${path}`;
  return {
    ...(title ? { title } : {}),
    description,
    ...(index ? {} : { robots: { index: false, follow: true } }),
    metadataBase: siteOrigin(),
    alternates: { canonical: url, languages: Object.fromEntries([...locales.map((language) => [language, `/${language}${path}`]), ["x-default", `/ar${path}`]]) },
    openGraph: { type: "website", siteName: brand, title: title ? `${title} · ${brand}` : brand, description, url, locale: locale === "ar" ? "ar_AR" : "en_US" },
    twitter: { card: "summary", title: title ? `${title} · ${brand}` : brand, description },
  };
}
