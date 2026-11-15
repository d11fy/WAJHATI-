# WAJHATI storefront family integration

[Official storefront design](https://www.figma.com/design/6S2HAy6atpNLe35hcBpf1l). The blueprint is frame `27:13`, and the editor registry is frame `35:2`. All 36 frame contexts include Figma renders. The Arabic reference widths are 1440 and 390 pixels.

| Family | Home desktop | Home mobile | Product desktop | Product mobile | Cart desktop | Cart mobile |
| --- | --- | --- | --- | --- | --- | --- |
| Electro X | `29:2` | `29:103` | `30:2` | `30:60` | `30:101` | `30:154` |
| Maison Wear | `29:165` | `29:217` | `31:2` | `31:36` | `31:64` | `31:100` |
| Aura Beauty | `29:259` | `29:332` | `31:128` | `31:167` | `31:195` | `31:233` |
| Luma Gifts | `29:388` | `29:463` | `31:263` | `31:315` | `31:344` | `31:383` |
| Digital Hub | `29:521` | `29:640` | `31:413` | `31:464` | `31:492` | `31:531` |
| LearnPro | `29:703` | `29:778` | `31:561` | `31:607` | `31:635` | `31:675` |

## Architecture and entitlement

Storefront routes retain the existing public catalog, store publication checks, protected media, cart and contact checkout APIs. The six renderers share image, price, option and navigation primitives. Each family owns its hero, default section order, featured presentation, detail arrangement and cart presentation. The existing two renderers retain their route contracts and layouts.

All six new templates are included at their default style. The existing premium entitlement governs custom colors and type. The existing Luxury Boutique entitlement remains separate. The server and database check the same defaults. Published JSON stays intact if an entitlement changes, while the public renderer receives the permitted presentation. Existing RLS, owner-only publishing and draft restoration remain in effect.

Figma photography has no verified redistribution provenance in the provided file. The renderers use merchant banner, category and product media. Missing media or editorial content produces an intentional empty treatment or hides the optional section. [Manrope license](https://fontsource.org/fonts/manrope/about).

The forward migration `0022_storefront_family_styles.sql` replaces the design entitlement trigger function and public design projection. It adds a private palette resolver and performs no merchant-row backfill. The public projection emits the active family's editorial fields and omits the editor's saved section preferences for other families.

Migration `0023_storefront_previous_design.sql` adds a nullable previous-publication snapshot and protects its referenced media from deletion. The existing owner-authorized publication function updates the current and previous snapshots in the same transaction. An owner can load the previous snapshot into the draft, preview it, and republish it under the current entitlement and reference checks. Existing publications acquire a previous snapshot after the first distinct publication following migration.

| Area | Files |
| --- | --- |
| Registry, labels and content validation | `src/lib/theme-config.ts`, `src/lib/theme-families.ts`, `src/lib/theme-copy.ts` |
| Storefront presentation | `src/components/store-theme/storefront.tsx`, `src/components/store-theme/family-pages.tsx`, `src/components/store-theme/primitives.tsx`, `src/app/storefront-families.css`, `src/app/[locale]/layout.tsx` |
| Designer, media and entitlement checks | `src/components/store-theme/designer.tsx`, `src/app/[locale]/dashboard/stores/[slug]/design/page.tsx`, `src/server/themes/actions.ts`, `src/server/themes/design.ts`, `src/server/themes/media.ts`, `src/server/billing/entitlements.ts` |
| Database migrations | `drizzle/0022_storefront_family_styles.sql`, `drizzle/0023_storefront_previous_design.sql`, `drizzle/meta/_journal.json`, `src/server/db/theme-schema.ts` |
| Font dependency | `package.json`, `package-lock.json` |
| Verification | `tests/unit/theme.test.ts`, `tests/integration/theme.test.ts`, `tests/e2e/storefront-families.test.mjs` |

## Model gaps

| Family | Safe presentation | Gap for a later data-model decision |
| --- | --- | --- |
| Electro X | Real compare-at discounts, descriptions and options | A flash countdown needs a scheduled promotion with an authoritative end time. Structured specifications need localized product attributes. |
| Maison Wear | Published product imagery, a lookbook, and configured editorial text | Dedicated seasonal media and a fit guide need merchant-owned editorial assets or structured sizing data. |
| Aura Beauty | Configured categories, descriptions and ritual copy | Ingredients and per-product routines need localized attributes. Reviews need a verified review model. |
| Luma Gifts | Published categories and existing product option groups | Gift message and recipient fields need validation and persistence in cart snapshots and order intents. |
| Digital Hub | Comparison of actual merchant product prices and availability, with duration as an existing option | Recurring charges, access delivery and activation require a separate merchant fulfillment model. |
| LearnPro | Course-shaped catalog and authored descriptions, followed by contact checkout | Curriculum, mentors, streaming, enrollment and certification need separately modeled course records and access rights. |

Shipping calculators, coupons, payment processing and fulfillment claims in the frames require server-backed capabilities before their controls can be shown.

## Visual decisions

- The Figma price amounts, stock images, and brand wordmarks are replaced by the current store's currency, media, and brand. The shared language switch and catalog navigation provide the Arabic and English entry points.
- Electro X uses current compare-at discounts for the orange offers section and actual catalog items for the side promotions. No timer appears.
- Maison Wear uses a wide cover at desktop widths and an in-flow title on phones. The lookbook derives its imagery from published products.
- Aura Beauty darkens the reference's rose accent to `#A45476` to meet the 4.5:1 default-theme contrast check. The ritual panel draws from the store editor.
- Luma Gifts uses real photos for the mosaic and existing catalog options in place of unpersisted gift personalization fields.
- Digital Hub compares real price and availability. LearnPro uses a course-shaped detail page with the merchant's description. Their cart actions prepare a contact request using the same order service as the other themes.
- Product selections and cart actions remain in document flow, with native controls and accessible labels. The reference's sticky payment bars and static delivery claims give way to the current contact-order controls.
- Chrome review revealed that an intrinsic image aspect ratio could expand a gallery cell in Maison Wear and spill across the desktop hero in Luma Gifts. The grid tracks now constrain those images. An additional browser probe checked both home layouts at 390, 768 and 1440 pixels in Arabic and English. All 12 checks passed.

## Local review

Run `npm.cmd run local:verify` to apply migrations to the local verification database and run lint, typecheck, unit tests, production build, PostgreSQL integration tests and Chrome E2E. The Chrome test creates six isolated fixture stores, uploads original test artwork and captures home, product and populated cart screens at 1440 and 390 pixels in both locales. Screenshots go to `.dar-local/screenshots/storefront-families-after`. The matching pre-publication catalog is captured in `.dar-local/screenshots/storefront-families-before`.

In the merchant dashboard, open **Store design**, choose a family, add localized hero and editorial copy, and save the draft. Check the phone and desktop preview, then publish as the store owner. Visit the public store, choose a published product option and quantity, and use the cart to prepare the contact request.

## Chrome captures

[Before publication, with the same Electro X fixture catalog](../.dar-local/screenshots/storefront-families-before/same-catalog-before-publishing.png).

| Family | Arabic desktop, 1440 px | Arabic phone, 390 px |
| --- | --- | --- |
| Electro X | [Home](../.dar-local/screenshots/storefront-families-after/electro-x-home-ar-1440.png) · [Product](../.dar-local/screenshots/storefront-families-after/electro-x-product-ar-1440.png) · [Cart](../.dar-local/screenshots/storefront-families-after/electro-x-cart-ar-1440.png) | [Home](../.dar-local/screenshots/storefront-families-after/electro-x-home-ar-390.png) · [Product](../.dar-local/screenshots/storefront-families-after/electro-x-product-ar-390.png) · [Cart](../.dar-local/screenshots/storefront-families-after/electro-x-cart-ar-390.png) |
| Maison Wear | [Home](../.dar-local/screenshots/storefront-families-after/maison-wear-home-ar-1440.png) · [Product](../.dar-local/screenshots/storefront-families-after/maison-wear-product-ar-1440.png) · [Cart](../.dar-local/screenshots/storefront-families-after/maison-wear-cart-ar-1440.png) | [Home](../.dar-local/screenshots/storefront-families-after/maison-wear-home-ar-390.png) · [Product](../.dar-local/screenshots/storefront-families-after/maison-wear-product-ar-390.png) · [Cart](../.dar-local/screenshots/storefront-families-after/maison-wear-cart-ar-390.png) |
| Aura Beauty | [Home](../.dar-local/screenshots/storefront-families-after/aura-beauty-home-ar-1440.png) · [Product](../.dar-local/screenshots/storefront-families-after/aura-beauty-product-ar-1440.png) · [Cart](../.dar-local/screenshots/storefront-families-after/aura-beauty-cart-ar-1440.png) | [Home](../.dar-local/screenshots/storefront-families-after/aura-beauty-home-ar-390.png) · [Product](../.dar-local/screenshots/storefront-families-after/aura-beauty-product-ar-390.png) · [Cart](../.dar-local/screenshots/storefront-families-after/aura-beauty-cart-ar-390.png) |
| Luma Gifts | [Home](../.dar-local/screenshots/storefront-families-after/luma-gifts-home-ar-1440.png) · [Product](../.dar-local/screenshots/storefront-families-after/luma-gifts-product-ar-1440.png) · [Cart](../.dar-local/screenshots/storefront-families-after/luma-gifts-cart-ar-1440.png) | [Home](../.dar-local/screenshots/storefront-families-after/luma-gifts-home-ar-390.png) · [Product](../.dar-local/screenshots/storefront-families-after/luma-gifts-product-ar-390.png) · [Cart](../.dar-local/screenshots/storefront-families-after/luma-gifts-cart-ar-390.png) |
| Digital Hub | [Home](../.dar-local/screenshots/storefront-families-after/digital-hub-home-ar-1440.png) · [Product](../.dar-local/screenshots/storefront-families-after/digital-hub-product-ar-1440.png) · [Cart](../.dar-local/screenshots/storefront-families-after/digital-hub-cart-ar-1440.png) | [Home](../.dar-local/screenshots/storefront-families-after/digital-hub-home-ar-390.png) · [Product](../.dar-local/screenshots/storefront-families-after/digital-hub-product-ar-390.png) · [Cart](../.dar-local/screenshots/storefront-families-after/digital-hub-cart-ar-390.png) |
| LearnPro | [Home](../.dar-local/screenshots/storefront-families-after/learnpro-home-ar-1440.png) · [Product](../.dar-local/screenshots/storefront-families-after/learnpro-product-ar-1440.png) · [Cart](../.dar-local/screenshots/storefront-families-after/learnpro-cart-ar-1440.png) | [Home](../.dar-local/screenshots/storefront-families-after/learnpro-home-ar-390.png) · [Product](../.dar-local/screenshots/storefront-families-after/learnpro-product-ar-390.png) · [Cart](../.dar-local/screenshots/storefront-families-after/learnpro-cart-ar-390.png) |

The folder also includes the same 36 views in English. The artwork was generated for these fixtures and uploaded through the merchant UI. The catalog, money amounts, product options, and carts in the screenshots come from the local application. The visual review compared hierarchy, placement, responsive behavior and supported controls against the Figma frames. The differences in imagery, content and controls are recorded above.

## Verification

The pre-change baseline passed lint, typecheck, production build, 27 unit tests, 43 PostgreSQL integration tests and 9 Chrome tests. With the storefront changes, lint, typecheck, production build, 28 unit tests, 45 PostgreSQL integration tests and 16 Chrome tests passed. The Chrome count includes the suite for all six families and its six individual cases.

The first complete browser run reached the maintenance job with 375 stale notification fixtures in the verification database. The job recorded their failed status and reported zero audit-chain mismatches. A repeat with the restricted worker returned `abandoned: 0`, `audit_mismatch: 0`, and exit code 0.

The final harness run also passed media cleanup, maintenance and billing expiry. The load check recorded 96 requests across two test tenants with zero errors. The backup rehearsal restored an isolated fixture through all 24 migrations and rejected both a tampered backup and a second restore into the populated destination. See the [local verification log](../.dar-local/theme-expansion-final.log).
