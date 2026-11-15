# WAJHATI: premium presentation, complete demos and unified pricing

## Scope and review

Implemented locally. No deployment, Git push, real payment processing, Figma edits, authentication rewrite or historical subscription repricing. The latest user request explicitly expanded the visual work to storefront presentation and complete theme demos.

The screenshots are actual Chrome renders. Demo merchandise is illustrative and clearly labeled; it is not a claim about real merchants, sales or customers. The six existing theme renderers are reused, so the demo is interactive rather than an image-only mockup.

## Issue and route matrix

| Priority | Route | Finding | Resolution |
| --- | --- | --- | --- |
| P1 functional | `/ar`, `/en`, `/pricing` | Prices disappeared when no payment method existed | Public catalog exposes persisted prices separately from purchase availability; unavailable purchasing stays disabled |
| P1 functional | Theme gallery | Customers needed complete demo journeys | Six allowlisted demo stores, product details, filters, options and isolated simulated carts |
| P1 functional | `/en/dashboard/stores/:slug/products` at 320px | Header brand and actions exceeded available width | Compact narrow-screen brand; preserve 44px action targets and content access |
| P2 visual | Home | Repetitive composition and weak previews | New hero, real theme imagery, theme gallery, workspace introduction, process section, pricing, FAQ, setup-service explanation and footer |
| P2 visual | Sign in | Low-quality promotional preview | Authentic theme previews and refined desktop/mobile form composition |
| P2 visual | Merchant workspace | Flat hierarchy and decorative theme thumbnails | Refined rail, topbar, rows, panels and actual theme previews |
| P2 visual | Storefront families | Uneven grid density and spacing | Palette-aware card, grid and typography refinements; stored merchant designs remain intact |

## Main files

- Presentation: `src/app/premium-ui.css`, `src/app/premium-storefront.css`, `src/app/[locale]/layout.tsx`.
- Shared UI: `src/components/marketing.tsx`, `auth-shell.tsx`, `brand-stage.tsx`, `product-preview.tsx`, `theme-showcase.tsx`, `theme-previews.ts`, `public-pricing.tsx`, `site-header.tsx`.
- Theme integration: `src/components/store-theme/designer.tsx`, `primitives.tsx`, `family-pages.tsx`.
- Demos: `src/lib/demo-catalog.ts`, `src/components/demo-cart.tsx`, `src/app/[locale]/demo/[theme]/{layout,page}.tsx`, nested `p/[productSlug]/page.tsx` and `cart/page.tsx`.
- Assets: `src/assets/wajhati/themes/`, refreshed catalog PNG captures, `public/demo-assets/`. Photo source and license references are in `public/demo-assets/sources.json`.
- Billing: `src/server/billing/marketing.ts`, `drizzle/0024_public_plan_catalog.sql`, migration journal, `scripts/config/wajhati-unified-plan.json`.
- Tests: `tests/unit/demo.test.ts`, `tests/integration/billing.test.ts`, `tests/e2e/demo.test.mjs`, `tests/e2e/merchant.test.mjs`.

## Pricing, access and data

The approved single plan is **WAJHATI: ILS 35 monthly / ILS 245 annually**. Values are stored as 3,500 / 24,500 minor units in PostgreSQL, not hardcoded into the React price display. Annual savings are ILS 175 versus twelve monthly payments.

All current feature flags are enabled. Existing Pro resource ceilings remain 200 products and 12,288 MiB storage; this is not an unlimited-resource promise. Technical code `pro` is retained for compatibility. Plan version 2 and its two price records were added to the local preview database and the authorized temporary Neon database. Historical plan versions, subscriptions and payment snapshots were preserved.

Migration 0024 replaces only the public billing projection function. Its fixed search path and restricted execute permission are retained. The `offers` response remains limited to purchasable offers; the added `catalog` contains public prices and a `canPurchase` flag. No private payment instructions or tenant data are added. See [the migration/configuration plan](premium-pricing-change.md) for rollback and preservation details.

No active PS/ILS payment method exists in the preview configuration. Published prices are visible, but checkout is explicitly unavailable. Public registration was not enabled; development-only registration remains a local testing capability. Marketing CTAs follow the existing runtime access policy.

Demo URLs are under `/ar/demo/` and `/en/demo/`: `maison-wear`, `aura-beauty`, `electro-x`, `luma-gifts`, `digital-hub`, `learnpro`. They use no merchant database records, accept only known theme IDs and return 404 for invalid products. Carts use a dedicated per-theme localStorage namespace. Checkout simulation sends no orders or payments. Demo routes are noindex/nofollow. The storage contains only public illustrative assets; user uploads remain in S3-compatible storage.

## Visual verification and screenshots

Chrome covers Arabic RTL and English LTR at 320, 360, 375, 390, 430, 768, 1024 and 1440px. The marketing/demo test checks 144 route/locale/viewport combinations, decoded images, fonts, direction, horizontal overflow, modal keyboard dismissal and focus restoration. Merchant catalog coverage checks the same widths plus a short 320×360 viewport, filter drawer/loading/empty states, bottom navigation clearance and reachable edit actions.

Local screenshots:

- Before: `.dar-local/screenshots/premium-before/ar.png`, `ar-sign-in.png`.
- Final production preview: `.dar-local/screenshots/premium-after/home-desktop-viewport.png`, `home-mobile-viewport.png`, `neon-ar-desktop.png`, `neon-ar-mobile.png`, `neon-ar-sign-in-desktop.png`, `neon-ar-sign-in-mobile.png`.
- Theme and breakpoint captures: `.dar-local/screenshots/premium-after/`.
- Merchant states and width captures: `.dar-local/screenshots/polish-after/`.
- Final Neon smoke evidence: `.dar-local/premium-preview-verification.json`; homepage at 1440/390px and pricing at 390px returned HTTP 200, with no horizontal overflow or browser page errors. Both displayed amounts matched PostgreSQL and both unavailable-payment controls were disabled.

Intentional design choices: preserve official WAJHATI branding and Cairo/Poppins; use real local theme renders in marketing; add photographic demo merchandise; keep merchant palette tokens; label illustrative content instead of inventing social proof. This pass does not claim a new pixel-for-pixel comparison against the remote Figma file.

## Local review journey

1. Open `http://localhost:3102/ar` for the temporary Neon-backed production build preview, or `http://localhost:3100/ar` for local development.
2. Explore the six themes from the homepage. Open a complete demo, filter products, open a detail page, choose an option and add it to the demo cart.
3. Change quantity and try the simulated order action. No order is sent. Switch themes to verify carts remain independent.
4. Open `/ar/pricing`: verify ILS 35/month and ILS 245/year and the unavailable-payment explanation. Switch to English.
5. Sign in with an existing local test account to inspect the product filters and theme selection; actual merchant publishing still uses existing entitlement checks.

## Remaining operational work

- Configure a real approved payment method before enabling subscriptions; do not invent recipient details.
- Production email/signup and infrastructure readiness remain separate operational work. This task does not enable public signup or deploy the site.
- Source PNG previews are intentionally high resolution; Next Image optimizes browser delivery. A future lossless source-asset size pass can reduce repository weight.
- Validate brand/content preferences with the owner before another visual iteration.

## Execution results

| Check | Result | Local evidence |
| --- | --- | --- |
| PostgreSQL integration | 46 passed, 0 failed | `.dar-local/premium-db.log` |
| Production build | Passed, including TypeScript and route generation | `.dar-local/premium-build.log` |
| Lint | Passed, no diagnostics | `.dar-local/premium-lint.log` |
| Typecheck | Passed | `.dar-local/premium-typecheck.log` |
| Unit tests, final standalone run | 31 passed, 0 failed | `.dar-local/premium-unit-final.log` |
| Final full Chrome E2E regression | 18 passed, 0 failed, 0 skipped; 123.710 seconds | `.dar-local/premium-e2e-final.log` |
| Initial full browser regression | 17 passed, 1 failed; identified English 320px header overflow | `.dar-local/premium-e2e.log` (superseded by final run) |
| Production dependency audit | 0 reported vulnerabilities | `.dar-local/premium-audit-production.json` |
| Full dependency audit | 11 moderate, 0 high, 0 critical | `.dar-local/premium-audit.json` |

The full audit findings are development dependencies: an esbuild chain through Drizzle Kit and minimatch through TypeScript ESLint. npm's proposed Drizzle fix changes the tool to an older major version, so no forced automatic fix was applied. These findings remain open; zero production audit findings is not a claim that the application has no security vulnerabilities. Review the development-tool upgrades separately before release. The host also reported a slow-filesystem warning during local development; production build and browser results are recorded independently of that warning.

An intermediate unit run under concurrent build load passed 30/31: the local PDF child process exceeded its existing 10-second resource limit. The standalone rerun passed 31/31 without changing that security limit. After the host interruption, PostgreSQL completed its normal recovery; an early browser attempt during recovery was stopped and restarted only after the database accepted connections. These interrupted attempts are not represented as successful runs.

A later browser run exposed a race in the new demo test: it counted cart rows immediately after full navigation, while the server loading state was still being replaced by localStorage data. The test now awaits the visible cart before counting, and separately asserts that deleting from Maison does not alter Aura's stored cart. This did not require changing application behavior. The failing run is retained as `.dar-local/premium-e2e-hydration.log`.

Final full Chrome regression passed all 18 tests. The changed demo test also passed a targeted ESLint check. There are no unresolved functional failures in the executed suite. The payment-method setup, development dependency advisories and operational items above remain outstanding.
