# WAJHATI implementation map

[Approved Figma file](https://www.figma.com/design/z7zz8KzrJ5KjOOmkHJ1p0o)

Use the Arabic frames at their reference widths (1440 px desktop and 390 px mobile). Mirror the shell and logical alignment for English. Preserve localized text, visible focus, reading order and existing server actions. Use the approved components to adapt screen sizes and states without a dedicated frame.

| Milestone | Figma nodes | Application routes |
| --- | --- | --- |
| M1 Design system | `18:2`, `2:20`, `2:22`, `2:24`, `18:49`, `18:52` | Shared platform typography, color, controls, surfaces and navigation. Tenant storefront and draft preview rendering stay outside this styling scope. |
| M2 Marketing | Home (`7:2`, `7:159`), pricing (`22:6`, `22:196`), features (`22:76`), FAQ (`22:152`) | `/[locale]` and localized features, pricing and FAQ routes. Render features and prices from available platform data. Preserve the registration gate. |
| M3 Identity and onboarding | Sign-in (`8:2`, `8:293`), sign-up (`8:44`), recovery (`8:89`), verification (`8:131`), onboarding (`8:173`, `8:214`, `8:255`, `8:318`) | `/sign-in`, `/sign-up`, `/forgot-password`, `/identity/[purpose]`, `/account`, `/dashboard/new`, `/platform/mfa` under the locale. Use the identity design for reset and both email-change confirmations. The onboarding completion state follows successful store creation. |
| M4 Merchant workspaces | Overview (`10:2`, `10:615`), products (`10:131`, `10:662`), editor (`10:242`), orders (`10:332`, `10:726`), categories (`10:443`), contact (`10:536`), store settings (`11:296`) | `/dashboard` and `/dashboard/stores/[slug]`, including products, categories, order lists and details, contact settings and store controls. Use persisted data and preserve existing authorization. |
| M5 Designer and billing | Theme library (`11:2`), editor (`11:76`, `11:381`), billing (`11:155`, `11:357`), payment (`11:231`) | `/dashboard/stores/[slug]/design` and `/billing`. Keep the preview route and Theme Registry. The billing presentation retains real plans, amounts and statuses. |
| M6 Admin | Overview (`14:2`, `14:687`), merchants (`14:123`), stores (`14:222`), payment (`14:316`, `14:717`), plans (`14:424`), setup (`14:512`), audit (`14:592`) | `/platform`, `/platform/[section]`, `/payment-review` and `/payment-review/[payment]`. Extend the shared admin presentation to subscription, jobs and settings routes with their current role gates. |
| M7–M8 Review | Desktop and mobile pairs above | Compare reference screenshots and browser captures, check keyboard navigation and RTL/LTR, then run the full isolated regression suite. |

## Brand artwork

The Figma logo layer (`20:6`) contains a 68×68 PNG and the editable emblem (`18:7`) has different artwork. The supplied square JPEG is 1254×1254. The shared header displays a tight viewport over its official emblem and retains a localized, readable wordmark alongside it. The larger brand board informed the selection. The JPEG is bundled as a Next.js static asset.

## Integration boundaries

- Keep migrations, database and service identifiers, storage keys, server actions, session policies and payment workflows compatible.
- Restrict platform design tokens to platform screens. Storefront routes and isolated previews keep their current styling and renderers.
- Use the Figma charts and sample rows as layout references. Use available persisted activity and avoid inserting invented metrics. Use the marketing dashboard illustration only as an explicitly illustrative product visual.
- Record routes without dedicated mobile or state frames during each milestone. Adapt them with the shared navigation, layout and form primitives.

Public pricing needs a narrow read path. The existing `billing_options` function requires store ownership and returns payment instructions together with prices. The marketing pages need only active offers, country, currency, billing interval and public plan features. Keep the owner-scoped function in place and test the public projection with the restricted runtime role before using it in marketing.

## M1 review

The platform uses scoped Figma color tokens, Cairo and Poppins, shared control styles and the localized WAJHATI wordmark. The first M1 captures predate the supplied artwork. The Arabic desktop and mobile sign-in captures use the reference viewports of 1440×920 and 390×856. Comparing with `8:2` and `8:293` confirms the typography and control direction. The editorial panel and mobile form layout belong to M3.

Local captures appear in `.dar-local/screenshots/wajhati-m1`. Existing before captures for administration, billing and the store designer were preserved in `.dar-local/wajhati-before`. The new Playwright checks verify actual font loading, RTL and LTR, and viewport overflow. Another check runs the same production build with registration disabled at runtime and checks that the homepage and sign-in page omit registration links. The storefront test verifies that the scope wrapper stays outside the published storefront and preview iframe.

The final isolated verification passed lint, typecheck, the production build, 27 unit tests, 42 PostgreSQL tests and 9 end-to-end tests. The first run found old synthetic notifications during maintenance and marked them as abandoned. The final maintenance run reported zero abandoned items and zero audit-chain mismatches. The isolated backup restore and the 96-request load run also passed. The before and after screenshots contain synthetic account and store data from the local verification database.

## M2 implementation

The localized marketing pages use Figma's home, features, pricing and FAQ layouts. The dashboard artwork on the homepage is labeled as an illustration. The FAQ uses native disclosure controls. The footer links lead to current platform pages. The reference's privacy, terms and contact links need approved destinations and content.

Migration `0020_marketing_offers` introduces a narrowly scoped PostgreSQL function for active public offers in markets with a configured payment option. The function reads the latest active offer per plan, market and billing interval and returns public feature limits. It grants execution to the restricted storefront application role and projects no payment instructions, identifiers or tenant data. The existing merchant pricing and payment paths remain separate.

## Workspace and identity implementation

| Area | Implementation files | Existing behavior |
| --- | --- | --- |
| Marketing and identity | `src/components/{marketing,site-header,auth-shell,auth-form,identity-forms,store-wizard}.tsx`, `src/app/{platform-ui,marketing,identity-ui}.css`, localized pages and identity routes | Runtime registration gate, login and logout, verification, password reset, email change and store validation remain in their existing handlers. |
| Merchant workspace | `src/components/{workspace-frame,catalog/catalog-ui}.tsx`, `src/app/workspace-ui.css`, `src/app/[locale]/{account,dashboard}`, `src/server/stores/overview.ts` | Uses existing membership checks and tenant-scoped reads for published product, category and active order counts and recent orders. Retains store publication controls, catalog search and filters, and order workflows. |
| Designer and billing | `src/components/{store-theme/designer,billing/forms}.tsx`, store `design` and `billing` pages | Draft preview uses the existing iframe and Theme Registry. Plan cards choose an existing price record. Proof upload, protected downloads and approval keep their existing handlers. |
| Platform administration | `src/components/admin-workspace.tsx`, `src/app/[locale]/{platform,payment-review}` | Role and MFA gates run before rendering. The overview reads actual payment counts, audit events and jobs through the existing restricted functions. |
| Public offer projection | `drizzle/0020_marketing_offers.sql`, `drizzle/meta/_journal.json`, `src/server/billing/marketing.ts` | Additive read-only migration. No stored prices, subscriptions or payment history are rewritten. |
| Test coverage | `tests/e2e/{merchant,catalog,platform}.test.mjs`, `tests/integration/billing.test.ts` | Adds visual captures and locale/viewport assertions to the real test journeys, and checks the public billing projection and its permissions on PostgreSQL. |

## Visual review notes

- The marketing illustration and logo crop follow the supplied references. A standalone vector or transparent official emblem would allow a direct logo export for small sizes and other backgrounds.
- The onboarding form collects the same four fields in the existing two steps. The completed store opens its management screen. Product image upload continues to require a saved product.
- The administrative overview presents recent job results and audit events where the Figma sample shows an illustrative chart. Merchant and store listings retain the fields actually returned by the backend. Prices, accounts and activity in the screenshots are isolated local fixtures.
- The shared responsive components cover translated and unframed states. Selected tables, advanced forms, and empty or error states are adaptations of the existing controls and retain differences from the reference frames.
- Compare the baseline in `.dar-local/wajhati-before` with the new public and catalog captures in `.dar-local/screenshots/wajhati-current`. The billing, designer and administration journeys also write their captures directly under `.dar-local/screenshots`.

## Final regression

The final local run used the restricted PostgreSQL application role and the isolated S3 fixture. Lint, TypeScript and the production build passed. The results were 27 of 27 unit tests, 43 of 43 PostgreSQL integration tests and 9 of 9 Playwright tests. The browser run covered the configured pricing interval, signup gating, catalog publication, both storefront themes, contact checkout, protected payment evidence, MFA and tenant isolation. Maintenance reported zero abandoned notifications and zero audit-chain mismatches. The local load test completed 96 requests with zero errors at 347 ms p95. The encrypted backup rehearsal restored the fixture and rejected a tampered artifact and a nonempty target.

An earlier run encountered two PDF timeouts under slow local I/O. A diagnostic receipt with three pages rendered just after the worker's nine-second deadline. Both cases passed on retry and in the final suite with the existing processing limits. See `.dar-local/wajhati-complete-verify.log` for the full final output.
