# WAJHATI visual polish audit

Baseline captures are in `.dar-local/screenshots/polish-before`. Frame IDs below refer to the [WAJHATI design file](https://www.figma.com/design/z7zz8KzrJ5KjOOmkHJ1p0o).

| Priority | Type | Route and baseline | Observation and reference |
| --- | --- | --- | --- |
| P0 | Functional | All reviewed routes | No blocking access or data-integrity defect reproduced during the initial review. |
| P1 | Functional | Merchant products, `products-ar-mobile.png` | A viewport-fixed bottom bar paints over cards. The open filter form fills most of the first screen. Figma `10:662` places a compact search above the list. |
| P1 | Functional | Platform payments, first QA capture | Chrome rendered the error boundary. PostgreSQL reported an ambiguous `reviewer` reference. Migration `0021_fix_platform_payment_listing` disambiguates the local variable in the existing function and preserves its signature, grants, role predicates and data. |
| P1 | Functional and content | Pricing, `pricing-ar-desktop.png` | An unavailable card exposes the same action as an active offer. Figma `22:196` gives the card an action before a market is selected. The implemented action must reflect actual availability. |
| P1 | Content | Home and signup | The review profile enables loopback test signup while public signup is disabled. The public experience needs distinct copy for existing-account access. No invite intake exists in the inspected routes. |
| P2 | Visual and content | Home and sign-in | The placeholder dashboard and promotional bars communicate little about the actual workflow. Figma `7:159` and `8:2` use an illustrative panel. Use a labeled, sanitized capture of the working catalog. |
| P2 | Visual and functional | Store overview and admin | Long fixture URLs dominate the details panel. The admin mobile layout needs clearer action hierarchy and table scrolling. Figma `10:615` and `14:123`. |

## Pricing audit

The local development database returned zero public offers through `public.billing_marketing()` as `dar_runtime`. Its Palestinian market has no price or payment-method rows. The isolated verification database has one active Palestinian fixture offer, Pro annual at 19,999 USD minor units, and one active method for PS/USD. The public projection filters on active prices and active methods for the same country and currency. It excludes payment instructions. Store currency support includes ILS, USD and JOD, while checkout availability depends on configured offers and methods. This review does not insert offers or change either database's price configuration.

Public pricing uses the existing integer minor-unit formatter. A market with annual-only offers opens on annual pricing. An explicit cycle with no offers keeps the requested cycle and shows unavailable cards without checkout actions. A valid market in the URL without an offer is preserved instead of switching visitors to another market. Available cards explain that billing is managed after sign-in. The homepage shows the test-account CTA only when the existing loopback flag permits it. When public registration is closed, account holders see a sign-in action and an explanation.

## Deliberate differences from the Figma frames

| Reference | Implementation decision |
| --- | --- |
| Home `7:159` | A labeled Chrome capture of the product interface replaces the illustrated dashboard. Feature rows, an onboarding sequence and a pricing callout use different layouts to reduce repetitive cards. |
| Products `10:662` | Compact search stays above the product list. A native dialog presents the existing filters as a sheet on phones and a centered dialog on desktop. The mobile tab bar occupies its own viewport row. |
| Pricing `22:196` | The market selector lists active offers by country and currency. Plans without offers appear as compact status cards without actions. The all-empty state explains availability once. |
| Sign-in `8:2` | The desktop split remains. A labeled Chrome capture replaces the placeholder promotional panel. |
| Store overview `10:615` | Long storefront paths are visually truncated. Published paths have copy and share controls that use the original URL. Devices without the share API copy the link. |
| Admin `14:123` | Payment and setup tables use their actual columns. Scroll is contained in a labeled, keyboard-focusable region on narrow screens. Existing authorization and confirmation controls remain in the same workflows. |

The marketing footer still needs approved privacy, terms and contact destinations. The operating system controls the appearance of the native share sheet.

## Chrome captures

| Screen | Before | After |
| --- | --- | --- |
| Arabic homepage at 390 px | [Baseline](../.dar-local/screenshots/polish-before/home-ar-mobile.png) | [Polished](../.dar-local/screenshots/polish-after/home-ar-390.png) |
| Merchant products | [Baseline at 390 px](../.dar-local/screenshots/polish-before/products-ar-mobile.png) | [Populated at 320 px](../.dar-local/screenshots/polish-after/products-ar-320.png), [filter sheet](../.dar-local/screenshots/polish-after/products-ar-filter-drawer.png), [loading](../.dar-local/screenshots/polish-after/products-ar-loading.png), [filtered empty](../.dar-local/screenshots/polish-after/products-ar-empty-filter.png) |
| Public pricing | [Baseline](../.dar-local/screenshots/polish-before/pricing-ar-desktop.png) | [PS/USD annual fixture](../.dar-local/screenshots/polish-after/pricing-ar-desktop.png) |
| Desktop sign-in | [Baseline](../.dar-local/screenshots/polish-before/sign-in-ar-desktop.png) | [Polished](../.dar-local/screenshots/polish-after/sign-in-ar-desktop.png) |
| Administration | [Payments error during initial QA](../.dar-local/screenshots/polish-before/admin-payments-error.png) | [Mobile payments table](../.dar-local/screenshots/polish-after/admin-payments-ar-mobile.png) |

Viewport captures of home, sign-in, pricing and merchant products are saved at 320, 360, 375, 390, 430, 768, 1024 and 1440 CSS pixels in both locales. The catalog test also checks the last edit action after scrolling at 320 × 360. The marketing and sign-in previews reuse cropped Chrome captures from the same catalog route in Arabic and English, with test product data and the merchant's shell excluded.

The payment regression checks the SQL listing for both an administrator and a reviewer and denies access to an ordinary merchant. The browser test requires a populated payments table and verifies that its scroll region can be focused. A separate existing notification test now prioritizes its own temporary notice so previously queued local test mail cannot preempt the assertion.

## Shared implementation

- [MerchantFilters](../src/components/catalog/merchant-filters.tsx) owns search, the native filter sheet and pending status. The same URL parameters reach the existing catalog repository.
- [WorkspaceFrame](../src/components/workspace-frame.tsx) and [workspace styles](../src/app/workspace-ui.css) provide the reserved tab row, scrollable content, compact cards and contained administrative tables.
- [ProductPreview](../src/components/product-preview.tsx) shares the localized Chrome captures between marketing and authentication.
- [StorefrontLink](../src/components/storefront-link.tsx) shortens the display, copies the canonical path for the current origin and offers native sharing where supported.
- [Marketing](../src/components/marketing.tsx) reads the existing public billing projection and signup gates. [Migration 0021](../drizzle/0021_fix_platform_payment_listing.sql) corrects the administrative list query.

## Verification results

Lint, TypeScript, the production build and all 27 unit tests passed on the final application code. After the notification fixture correction, the targeted lint and TypeScript checks, all 43 PostgreSQL tests and all 9 Playwright tests passed on that production build. Earlier local I/O caused a PDF timeout. The retry and final unit suite passed with the original renderer limits. The first database run exposed a fixture-ordering conflict with a previous verification notice. The regression run passed after the fixture-only correction.

Logs are in [the final code and build run](../.dar-local/wajhati-polish-final.log) and [the completed database and browser run](../.dar-local/wajhati-polish-regression.log).
