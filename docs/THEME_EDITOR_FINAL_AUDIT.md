# Theme editor final audit

Date: 2026-11-18 · Branch `audit/final-readiness` (local only; nothing pushed or deployed).

## How this was audited

Evidence comes from three sources, and each cell below says which:

- **Code**: reading `src/lib/theme-config.ts`, `src/server/themes/*`, `src/components/store-theme/*`.
- **E2E**: Playwright suites in `tests/e2e` run against the production build with an isolated PostgreSQL and S3 emulator (`npm run local:verify`, final run recorded in `docs/FINAL_LAUNCH_READINESS_AUDIT.md`).
- **Integration/unit**: `tests/integration/theme.test.ts` (PostgreSQL, RLS) and `tests/unit/theme.test.ts`.

I did not visually inspect every cell for every theme in a browser by hand. Where a cell says "E2E", an automated test exercised it; where it says "Code", I traced the code path but no test asserts that exact cell.

## Architecture in one paragraph

A store has one JSON draft (`store_designs.draft`) and a published snapshot, both validated by the same Zod schema (`themeConfig`). The designer posts the whole config; the server re-validates it, checks entitlement and that referenced assets, products and categories belong to the store, and saves with an optimistic revision number (stale writes return `conflict`). Publishing runs in the database (`theme_publish`) so the public projection changes atomically and the previous snapshot is kept for "restore previous". The public site reads only the published projection, so drafts cannot leak (E2E asserts the private banner is 404 to visitors before publishing and 200 after).

## Customization matrix

Legend: **Works** = supported and working · **Defect** = supported but defective · **By design** = intentionally not supported · **Missing** = expected by the brief but not implemented.
Themes: MC Minimal Commerce · LB Luxury Boutique · EX Electro X · MW Maison Wear · AB Aura Beauty · LG Luma Gifts · DH Digital Hub · LP LearnPro.

| Setting | MC | LB | EX | MW | AB | LG | DH | LP | Evidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Theme selection and switching, merchant data preserved | Works | Works | Works | Works | Works | Works | Works | Works | Unit `registry defaults ... a theme switch retains merchant content`; E2E switches Minimal → Luxury and the six families keep catalog and orders |
| Hero title and description (AR and EN) | Works | Works | Works | Works | Works | Works | Works | Works | Code `storefront.tsx` Hero, `family-pages.tsx:42`; E2E asserts the h1 text on public pages |
| Hero call-to-action label or link | By design | By design | By design | By design | By design | By design | By design | By design | No schema field. The label is a fixed localized string per theme (`familyLabels.*.browse`) pointing at the product list |
| Logo | Works | Works | Works | Works | Works | Works | Works | Works | Code: one shared `Header`/`Brand` in `primitives.tsx:49`; E2E asserts the public logo asset is 200 after publishing |
| Favicon (store icon) | Works | Works | Works | Works | Works | Works | Works | Works | Code `s/[slug]/layout.tsx:9`; E2E asserts `link[rel=icon]` ends with the uploaded icon id |
| Hero banner image | Works | Works | Works | Works | Works | Works | Works | Works | E2E uploads a banner, previews privately, publishes. Family heroes fall back to a published product photo when no banner is set (`family-pages.tsx:178`) |
| Multiple promotional banners | By design | By design | By design | By design | By design | By design | By design | By design | Schema holds one banner. Electro X side promotions are derived from real compare-at discounts, not merchant-authored banners (`docs/wajhati-storefront-families.md`) |
| Colors (4 tokens, contrast ≥ 4.5:1) | Works | Works | Works | Works | Works | Works | Works | Works | Unit rejects bad colors and low contrast; server `allowsStyle` enforces Premium; UI controls disabled without Premium |
| Typography | Works (2 options) | Works (2 options) | Works | Works | Works | Works | Works | Works | Fixed choice of `sans` or `editorial`; no free font input by design (prevents arbitrary CSS) |
| Section visibility | Works | Works | Works | Works | Works | Works | Works | Works | Unit: products section cannot be hidden; E2E hides Categories on Luxury |
| Section order | Works | Works | Works | Works | Works | Works | Works | Works | E2E reorders; order is remembered per theme when switching (`sectionPreferences`) |
| Featured products (max 8) | Works | Works | Works | Works | Works | Works | Works | Works | E2E picks a product; server verifies it belongs to the store |
| Featured categories (max 8) | Works | Works | Works | Works | Works | Works | Works | Works | Same as above |
| Editorial text (eyebrow, heading, body, AR and EN) | By design | By design | Works | Works | Works | Works | Works | Works | E2E `storefront-families` fills all six fields per family and asserts the public text |
| Product comparison section | By design | By design | By design | By design | By design | By design | Works | By design | Only Digital Hub lists `comparison` in the registry; it compares real price and availability |
| Contact channels (WhatsApp, Instagram) in footer | Works | Works | Works | Works | Works | Works | Works | Works | Edited on the store contact page, rendered by the shared `Footer`; checkout E2E |
| Footer free text | By design | By design | By design | By design | By design | By design | By design | By design | Footer shows brand, market, contact links and a fixed "Powered by WAJHATI". Removing the attribution is a product decision for the owner |
| Store name and identity | Works | Works | Works | Works | Works | Works | Works | Works | Edited in the store profile, not the designer |
| Draft, publish, restore published, restore previous | Works | Works | Works | Works | Works | Works | Works | Works | Integration (atomic publish, RLS, owner-only) and E2E |
| Draft isolation from the public store | Works | Works | Works | Works | Works | Works | Works | Works | E2E: visitor gets 404 for the private banner and sees the old design until publish |
| Plan permissions on server and UI | Works | Works | Works | Works | Works | Works | Works | Works | Server `allowsStyle`/`entitledThemes`; Luxury theme needs its entitlement, the six families are included |
| Live preview of unsaved edits | By design | By design | By design | By design | By design | By design | By design | By design | The preview iframe renders the last **saved** draft and says so (`previewHint`). Not defective, but a real limitation (see recommendations) |

No cell was found **Defect** or **Missing** against the current schema. The settings in the "Missing" sense that a merchant might expect (custom CTA text, multiple banners, editable footer text, live unsaved preview) are listed as proposals, because each needs a schema or product decision.

## Defects found and fixed in this pass

| # | Severity | Problem | Root cause | Fix | Test |
| --- | --- | --- | --- | --- | --- |
| T1 | P2 | Closing or reloading the designer silently lost unsaved edits. | The component computed `dirty` but only used it to disable Publish. | `beforeunload` guard while dirty (`designer.tsx`). | E2E asserts the guard is raised after an edit and lifted after save or discard. |
| T2 | P2 | No way to abandon unsaved edits short of reloading. | No reset control. | "Discard unsaved changes" button next to the unsaved notice; restores the saved draft. Copy in AR and EN. | Same E2E. |
| T3 | P2 | Logo, icon and banner were chosen from a text list ("Logo 1", "Logo 2") with no thumbnails, so a merchant with several uploads could not tell them apart. | Plain `<select>`. | Pressed-state thumbnail grid with a "no image" option; the larger selected preview and upload/delete flow are unchanged. | Existing upload, select, delete and publish E2E; screenshot `store-designer-banner-picker.png`. |
| T4 | P2 | In the family themes a store with one or two categories got one category tile stretched across the full row (Electro X desktop). | `premium-storefront.css` overrode the grid with `auto-fit`, which collapses empty tracks. | `auto-fill` keeps tiles at a consistent width. | Visual (see report); no pixel golden exists. |
| T5 | P2 | The "available only" filter checkbox (and every checkbox/radio app-wide) was 13 px on phones. | Browser default size. | 18 px, and 24 px at ≤ 640 px or coarse pointers (`globals.css`). | New responsive sweep (`tests/e2e/responsive.test.mjs`) flagged it in all six themes at 320 and 390 px, then passed with 0 issues. |

## Comparison with the Figma source

Frame `29:2` (Electro X, Arabic desktop home) was fetched from the official Figma file and compared with the rendered storefront (`storefront-families-after/electro-x-home-ar-1440.png`).

- Matches: section sequence (hero with two side promotions, orange offers band, product row, category row, editorial banner with CTA, picks, footer), RTL alignment, palette, CTA styling.
- Intentional differences already documented in `docs/wajhati-storefront-families.md`: no countdown timer, no stock photography, no invented ratings, real store currency and media.
- Real difference found: Figma shows five compact category chips in a row; the app renders media-led category tiles. T4 stops a single category from spanning the row, but the tile treatment is not a chip row. Left as is; it is a deliberate shared-component choice.
- Not compared: the other 35 Figma frames. I only fetched one frame, so I make **no claim of visual parity** for the other families, product pages or carts. The previous team's visual review is described in the families doc and its screenshots are in `.dar-local/screenshots/storefront-families-after`.

## Responsive and accessibility results for the six family themes

`tests/e2e/responsive.test.mjs` loads each family demo home, product and cart in Arabic and English at 320, 390, 768 and 1440 px (144 loads) and checks: no horizontal overflow, exactly one visible `h1`, every image has an `alt` attribute, every link and button has an accessible name, every form control has a label, `lang` and `dir` match the locale, and touch targets are at least 24 px at phone widths. Final result: 0 issues (after T5). This is a structural smoke test, not a screen-reader session or a full axe audit; contrast was validated for the default palettes by the existing unit test and the previous team's 4.5:1 check.

## Recommendations (not implemented, need a decision)

1. **Live preview of unsaved edits.** Post the in-memory config to the preview iframe instead of requiring Save. Medium effort, high merchant value. Must keep the preview route owner-only and uncached.
2. **Editable hero CTA label.** One more optional pair of localized strings in the schema (migration-free because the config is JSON, but the SQL projection `theme_public_design` must emit it).
3. **Unsaved warning on in-app navigation.** `beforeunload` covers closing and reloading. Clicking a sidebar link inside the app does not go through it; Next.js App Router has no stable hook for that, so it would need a confirm wrapper around the dashboard links.
4. **Removing the "Powered by WAJHATI" attribution** is a pricing/product decision for the owner, not an engineering one.
