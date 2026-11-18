# WAJHATI — final launch readiness audit

Date: 2026-11-18 · Branch `audit/final-readiness` (local; snapshot tag `pre-final-audit-snapshot` marks the starting commit `cebd7e1`).
Nothing was pushed, merged, deployed or changed in any production system. Public signup was not enabled.

## 1. Executive summary

The codebase is in better shape than a typical pre-launch SaaS. Security controls are layered (RLS, security-definer SQL functions, MFA, dual approval, encrypted SMTP secrets with SSRF pinning, rate limits, hashed session tokens) and the existing automated suites are meaningful. This pass found **no P0 or P1 code defect**, and fixed a set of P2 issues: a non-repeatable verification gate, missing SEO plumbing (robots, sitemap, canonical/hreflang, staging protection), designer data-loss and usability gaps, and a phone-size tap target problem.

**Production is not ready to launch**, for reasons that are not code defects: no Terms of Service or Privacy Policy pages exist, and the four known external blockers (BLK-01…04: live SMTP, SPF/DKIM/DMARC, production `SMTP_CONFIG_KEY`, WhatsApp support readiness) cannot be verified from a local machine and are still open.

Final gate result (run 4, release-candidate): `npm run local:verify` exit 0 — lint, typecheck, 40/40 unit, 48/48 PostgreSQL integration, production build, 19/19 browser E2E (including a 234-page responsive sweep with 0 issues), five background workers, concurrent load test, encrypted backup/restore rehearsal.

**Verdict** (details in section 24): Local codebase **GO** · Staging **CONDITIONAL GO** · Production **NO-GO until the blockers in section 22 are closed**.

## 2. Current architecture

- Next.js 16.4.5 App Router (webpack build), React 19, Tailwind 4, TypeScript 5.9. Locales `ar` (RTL) and `en` (LTR) under `/[locale]`.
- PostgreSQL 18 with Drizzle migrations `0000`–`0026`. Authorization lives mostly in SQL: RLS on every tenant table, `SECURITY DEFINER` functions with fixed `search_path`, three runtime roles (`storefront_app`, `storefront_identity`, `storefront_media_worker`), no `BYPASSRLS`.
- Tenancy: stores with memberships; every merchant query runs through `withMerchantStore`. Media in S3-compatible storage, re-encoded to WebP, served through authorization-aware routes.
- Billing: per-store subscriptions activated manually by platform admins (1/3/6/12 months, GiST non-overlap constraint, dual approval above a threshold, immutable activated terms), account-level 72-hour trial attached to the first store by trigger. No online payment for storefront customers; checkout hands off to WhatsApp/Instagram and records an order intent only.
- Operations: Docker/compose (Caddy, app, PDF worker, DB, worker, operator), systemd backup timer, encrypted backup/restore tooling, scheduler, health/readiness/metrics endpoints, Dokploy bootstrap.

## 3. Existing features verified (by running them, not by reading reports)

All of the following ran green in the final pipeline: registration policy, sign-in, MFA, email verification and recovery flows (identity E2E and integration); two-store merchant with per-store activation and the 3-day trial; 1/3/6/12-month renewal math; duplicate-reference and tampered-retry rejection; owner-only SMTP settings with encrypted storage; notification queue leasing and retry; catalog, variants, cart, server-side price validation, WhatsApp/Instagram order handoff; tenant isolation (cross-merchant 404s, private design assets); theme draft → preview → publish → restore; all eight themes render with catalog fixtures; platform admin and merchant dashboards; workers; load; backup and restore.

The two handoff reports claimed these were passing. I re-ran them rather than trusting the reports. The acceptance report states 35/35 unit, 48/48 DB and 18/18 E2E; on the untouched baseline I observed 36 unit, 48 DB and 18 E2E, all passing (the unit count had drifted by one since the report). With my additions the counts are 40, 48 and 19.

## 4–6. Issues discovered, severity, root cause, fix

| ID | Sev | Issue | Root cause | Fix |
| --- | --- | --- | --- | --- |
| I1 | P2 | `npm run local:verify` exited 1 on the baseline run and never reached billing expiry, load or backup rehearsal. | The disposable verify database persists between runs. Fixture accounts never receive mail, so unsent notifications age past the 20-hour window and `ops_maintain()` (correctly) reports them as abandoned (975 in the baseline), failing the job. A second run passes, so the gate was flaky by calendar. | `scripts/local-env.mjs` retires pre-existing unsent notifications at the start of `verify`, only for the verify database (asserted). The end-of-run maintenance check now judges this run's own notifications. Production behaviour is unchanged. Evidence: baseline exit 1 → exit 0 on three later runs (150–163 stale rows retired each time). |
| I2 | P2 | No `robots.txt` or `sitemap.xml`; nothing stopped a staging copy being indexed. | Never implemented. | `src/app/robots.ts`, `sitemap.ts`, `src/lib/seo.ts`. Only `DAR_ENV=production` over HTTPS is crawlable; development and staging return `Disallow: /`. Private areas are disallowed in both locales. The sitemap lists marketing pages with hreflang alternates. Both routes are `force-dynamic`, so the runtime environment decides, not the build's. Unit tests added. |
| I3 | P2 | Marketing pages had no canonical URL, hreflang, per-page description or social tags. | Only storefronts had them. | `marketingMetadata()` on home, features, pricing, FAQ. Descriptions reuse the existing on-page copy, so metadata claims nothing the page does not. Verified in a browser (`/ar/pricing` emits canonical, ar/en/x-default alternates, `og:*`). |
| I4 | P2 | `/account` lacked `noindex`. | Omitted. | Added (it also sits behind login). |
| I5 | P2 | HSTS and `Permissions-Policy` were only set by the bundled Caddy; the Dokploy/Traefik path (recent commits) would serve neither. | Headers lived only in `infra/Caddyfile`. | `next.config.ts` now sends both. HSTS is inert over plain HTTP, so local work is unaffected. |
| T1–T5 | P2 | Theme designer and tap-target issues. | See `THEME_EDITOR_FINAL_AUDIT.md`. | Leave-page guard, discard button, thumbnail asset picker, category grid `auto-fill`, 24 px checkboxes. |
| I6 | P1 (blocker, not code) | No Terms of Service or Privacy Policy anywhere in the app, and no footer links to them, although the platform collects emails and merchant data. | Content not written. | **Not fixed on purpose**: legal text must come from the owner/counsel. See section 22. |

A regression I introduced and fixed within this pass: my first thumbnail picker removed the large selected-image preview, and six existing E2E cases (which assert that preview) failed. I restored the preview and kept the test as it was.

## 7. Modified files

`next.config.ts` · `scripts/local-env.mjs` · `src/lib/seo.ts` (new) · `src/app/robots.ts` (new) · `src/app/sitemap.ts` (new) · `src/app/[locale]/{page,features,pricing,faq}/page.tsx` · `src/app/[locale]/account/page.tsx` · `src/components/marketing.tsx` · `src/components/store-theme/designer.tsx` · `src/lib/theme-copy.ts` · `src/app/globals.css` · `src/app/premium-storefront.css` · `tests/unit/seo.test.ts` (new) · `tests/e2e/responsive.test.mjs` (new) · `tests/e2e/theme.test.mjs` · `docs/*` (4 reports). `tsconfig.json` is rewritten by `next typegen` during every run with local `.dar-local` include paths; I reverted it so it is not part of the change.

## 8. Database migration changes

None. No migration was added, no schema or data was touched outside the disposable `.dar-local` verification database.

## 9. Security audit findings

Reviewed by reading and by running the existing suites: sessions, auth actions, rate limiting, checkout API, SMTP module, security headers, Docker/compose, dependency advisories.

- **Sessions/cookies**: random tokens stored only as digests; `__Host-` prefixed `HttpOnly`, `SameSite=Lax`, `Secure` in production over HTTPS; session rotation on sign-in/up; revocation on sign-out.
- **Enumeration/brute force**: password check against a dummy hash for unknown users; sign-up reports a generic result for existing accounts; per-email and per-IP limits stored in PostgreSQL. The IP limit applies only when `TRUSTED_CLIENT_IP_HEADER` is set behind a trusted proxy (already documented; compose sets `x-real-ip`).
- **Checkout**: origin check, bounded JSON body (64 KiB), strict Zod schema, per-visitor/IP/store limits, prices recomputed server-side, idempotency keys. Nothing marks an order paid.
- **SMTP**: AES-256-GCM with AAD, key from env, write-only view, DNS resolved once and pinned (no rebinding), private/reserved ranges blocked including IPv6, TLS verification on with TLS ≥ 1.2, file/URL access disabled in the mail library.
- **Dependencies**: `npm audit --omit=dev` reported 0 vulnerabilities at the start. No dependency was added or upgraded in this pass. Dev dependencies were not audited.
- **Headers**: `nosniff`, `X-Frame-Options: DENY`, referrer policy, `frame-ancestors 'none'` CSP; added HSTS and Permissions-Policy. **There is still no `script-src` CSP.** A nonce-based CSP is a worthwhile hardening step but needs Next.js nonce plumbing and a full E2E pass; I did not attempt it.
- **Not tested**: a penetration test, fuzzing, race-condition stress on activation beyond the existing concurrency tests, and RLS beyond what the 48 integration tests cover. "No new vulnerability found" means none was found in what I read, not that none exists.

## 10. Performance (measured, before and after)

I made no performance change, so there is no before/after delta to claim. What was measured, on a developer laptop with the app limited to the verify harness:

- Local load test (96 requests, 2 tenants, concurrency 8): 0 errors. Baseline-era run p50 703 ms / p95 1319 ms; final run p50 329 ms / p95 529 ms. The spread between runs is machine noise, not an improvement from my changes.
- Static client chunks total about 1.17 MB across the app (all routes combined, uncompressed).
- Nearly every route is dynamic (`ƒ` in the build output), including storefronts and marketing pages. That is consistent with real-time price accuracy, but it means no CDN caching of HTML. A short `s-maxage` for anonymous marketing pages is a candidate optimization.
- **Core Web Vitals (LCP/INP/CLS) were not measured** (no Lighthouse or field data available). I do not report numbers I did not collect.

## 11. Accessibility results

Automated structural sweep (`tests/e2e/responsive.test.mjs`), 234 page loads: marketing pages (home, features, pricing, FAQ, sign-in) at 320, 360, 375, 390, 430, 768, 1024, 1440 and 1920 px, and six theme demos (home, product, cart) at 320, 390, 768 and 1440 px, in Arabic and English. Checks: no horizontal overflow, one `h1`, image `alt`, named links/buttons, labelled controls, `lang`/`dir`, 24 px touch targets on phones. First run: 12 findings (one root cause, T5). Final run: 0.

Existing reduced-motion handling is present in the platform, storefront and premium stylesheets. **Not done**: manual keyboard walkthrough, dialog focus-trap testing, screen-reader testing, 200% zoom/large text, and sweeps of authenticated dashboard/platform pages at all nine widths (those are covered only by the previous team's mobile/desktop E2E screenshots).

## 12–13. SEO findings

Fixed: robots, sitemap, canonical/hreflang/OG on marketing pages, `noindex` on `/account`, staging protection via runtime robots. Already good: storefront pages have canonical, hreflang and Open Graph; unknown/unpublished stores return `noindex`; dashboard, platform, demos, sign-in, identity and payment pages are `noindex`.
Open: no `og:image` for marketing pages (needs an approved brand image); storefronts are not in the sitemap (merchant-controlled, and a listing of all stores would be a product decision); no structured data (adding Organization data is safe, product/review markup should wait for real data); **legal pages are missing (blocker)**. The staging protection is `robots.txt` only; a staging host should also sit behind authentication or an IP allow-list, because robots.txt is advisory.

## 14–15. Results for all eight themes and the editor matrix

See `THEME_EDITOR_FINAL_AUDIT.md`. Summary: all eight themes render in both locales, switching themes preserves merchant data, draft isolation and atomic publish are tested, and every editable setting maps to its supported themes with no defect found. Only one Figma frame was compared against a render (Electro X desktop home); I make no parity claim for the other 35 frames.

## 16–17. 21st.dev

See `21ST_DEV_UI_RESEARCH.md`. Reviewed: terms and licensing model, and catalog metadata for pricing, product-card, toast, skeleton, stats, upload and navigation components. **Integrated: none.** The catalog exposes no per-component licence, each component stays under its author's own terms, and WAJHATI is a site-builder product, which several licences prohibit. Ideas, not code, informed T3. The 21st MCP backend returned temporary errors on the first two attempts and then worked. No paid retrieval, account key or CLI was used.

## 18. Third-party licences and dependencies

No dependency added or changed. Existing UI assets: `lucide-react` (ISC) and Fontsource fonts (Cairo, Manrope, Poppins, Noto Sans Arabic, Amiri). No third-party image or component was added.

## 19. Screenshots and visual comparisons

Generated by the run under `.dar-local/screenshots` (git-ignored): `responsive-sweep/` (marketing and theme demos at 390 and 1440 px in both locales, plus `report.json`), `storefront-families-after/` (36 views in each locale), `store-designer-banner-picker.png` (new picker), plus billing, platform and storefront shots. The sweep screenshots are taken after my changes. I did not capture matching "before" shots for the five fixes, so before/after is described in words, not images. The Figma comparison is limited as stated above.

## 20. Actual test results (final run)

| Gate | Result |
| --- | --- |
| `npm run lint` | pass, 0 problems |
| `npm run typecheck` | pass |
| `npm test` | 40/40 (36 existing + 4 new SEO tests) |
| `npm run test:db` | 48/48 on isolated PostgreSQL |
| `npm run build` | pass (webpack) |
| `npm run test:e2e` | 19/19 (18 existing, one new sweep; theme E2E extended) |
| Workers (media, orders, notifications, maintenance, billing expiry) | all `success: true`, `abandoned: 0`, `audit_mismatch: 0` |
| Load | 96 requests, 0 errors |
| Backup/restore rehearsal | passed, 27 migrations, tampered backup and non-empty target both rejected (the two `backup_failed` log lines are those deliberate negative tests) |
| `npm run local:verify` | exit 0 |

History: baseline before changes exit 1 at the maintenance worker (I1; lint, typecheck, 36 unit, 48 DB and 18 E2E had all passed); run 2 had 8 failing entries from two causes (the new sweep correctly flagging T5, and the six-family test failing because of my own picker regression, fixed); run 3 and run 4 exit 0. `test:db` and `test:e2e` were run sequentially by the harness against one database, never in parallel.

## 21. Unresolved issues

1. Terms of Service and Privacy Policy pages (blocker).
2. No `script-src` CSP.
3. No Core Web Vitals measurement.
4. Manual keyboard, focus-trap, screen-reader and zoom testing not done.
5. 35 of 36 Figma frames not compared.
6. Authenticated pages not swept at all nine widths.
7. Marketing pages have no `og:image`.
8. Designer preview shows the saved draft, not unsaved edits.
9. No in-app-navigation unsaved warning (only close/reload).

## 22. External infrastructure blockers (status checked)

| ID | Item | Status | Why |
| --- | --- | --- | --- |
| BLK-01 | Live SMTP send verified by the owner | **Open** | Local runs use `MAIL_PROVIDER=local`. Tests with mocks do not count. |
| BLK-02 | SPF/DKIM/DMARC published and verified in a real inbox | **Open** | Needs the production domain's DNS. Steps in `docs/smtp-deliverability.md`. |
| BLK-03 | Production `SMTP_CONFIG_KEY` provisioned | **Open** | Secret store access needed; the local key is a fixture. |
| BLK-04 | Official WhatsApp (+972567508786) staffed and trained | **Open** | Operational, not verifiable from code. The number is seeded in migration `0026`. |
| BLK-05 (new) | Legal pages | **Open** | Owner/counsel must supply text. |
| BLK-06 (new) | Production backup restore proven against the real database and object store | **Open** | The rehearsal ran against an isolated fixture. |

## 23. Recommended future features

Live unsaved preview in the designer; editable hero CTA label; short HTML caching for anonymous marketing pages; nonce-based CSP; Organization structured data and a brand `og:image`; an owner-visible notification backlog indicator (the 20-hour abandonment rule is invisible until the worker fails); admin filtering on large merchant lists. Each needs a decision before building; none was implemented. Major systems (payment gateways, coupons, LMS, automatic fulfilment) were deliberately not proposed for implementation.

## 24. Final release recommendation

- **A. Local codebase readiness: GO.** Every automated gate passes on the final code, business rules are untouched, no migration risk, and no open code defect higher than P2.
- **B. Staging readiness: CONDITIONAL GO.** Deploy a staging environment with `DAR_ENV=staging`, a staging SMTP account and a test send, and confirm `/robots.txt` returns `Disallow: /`. I could not exercise a real staging host.
- **C. Production readiness: NO-GO** until BLK-01…06 are closed. Legal pages are the only item that needs new product content; the rest are operations steps in `FINAL_RELEASE_CHECKLIST.md`. A passing local suite does not substitute for them.

## Tools and skills used

Used: Bash/PowerShell, the repo's own npm scripts and Playwright (via the existing harness), the built-in browser, the 21st MCP (free search only), the Figma MCP (one read-only frame), `npm audit`. **Installed skills were not invoked**: I did not run the Skill tool for the Next.js, accessibility, design or code-review skills, so none of this work can be attributed to them. Figma auth for the design plugin and the other connectors listed as needing authorization were not used.
