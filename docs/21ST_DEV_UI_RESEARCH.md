# 21st.dev UI research — WAJHATI

Date: 2026-11-18 · Scope: research and licence review for the final launch pass.

## 1. What was inspected

| Source | Method | Result |
| --- | --- | --- |
| https://21st.dev/ (home) | Built-in browser, page text | Marketplace of components, templates, themes, shaders and icons. Entry point is "Get 21st free". |
| https://21st.dev/terms (Terms of Service, last updated 20 July 2026) | Built-in browser, DOM text | Read in full for Marketplace sections 2–3.1 (see section 2). |
| 21st MCP (`mcp__21st__search`, free, metadata only) | Official MCP server already connected to this session | Worked on the third attempt; the first two attempts returned "temporary backend issue" (retry succeeded). Queries sent were generic UI terms only. No project or personal data was sent. |
| 21st MCP `get_component` (paid daily quota) | **Not used** | Retrieval spends the account's daily quota and the cost model is not ours to decide. Not needed, because no candidate cleared the licence gate (section 3). |
| 21st CLI / Claude Code plugin install | **Not installed** | The MCP server is already connected. Installing the CLI adds nothing for a research pass. |

No component source was downloaded, no `npx shadcn add …?api_key=` command was run, no WAJHATI source or private component was submitted to 21st.dev.

## 2. Licence findings that drive the decision

From the 21st Terms of Service (sections 2 and 3):

1. Component code stays owned by **each individual author**; 21st does not grant a blanket licence. The licence is whatever that author attached, and the marketplace search results expose **no licence field** (only name, author, preview, install command).
2. Demos, previews, screenshots, descriptions and metadata are owned by 21st Labs Inc. and may not be republished.
3. Copying components elsewhere requires a clear visible link back to the original 21st page.
4. Redistribution, scraping and automated collection of Marketplace content are prohibited without written consent.
5. 21st itself warns that commercial UI kits whose licences forbid "products that let other people build interfaces" (it names Tailwind Plus) must not be republished. WAJHATI is exactly such a product: merchants build storefronts on it.

Install commands returned by the catalog embed a personal `api_key` query parameter, so install requires a 21st account/key. That is a cost and credential decision for the owner, not something to introduce silently.

**Consequence.** For any candidate we would need (a) an explicit permissive licence from the author, (b) confirmation that it is not derived from a kit with a "no site-builder" clause, (c) a visible attribution link, and (d) the owner's agreement to a 21st account. None of the candidates below exposes (a) or (b) in the metadata we can see, so under the brief ("if use inside merchant-generated storefronts is restricted or unclear, do not integrate it") **none was integrated**.

## 3. Shortlist (metadata only, none integrated)

Search used the free `search` tool. "Intended placement" is where the pattern would help WAJHATI. "Verdict" explains why it was not adopted.

| Pattern | Candidate (author) · URL | Intended placement | Deps implied | Licence visible | Verdict |
| --- | --- | --- | --- | --- | --- |
| Pricing section | Pricing Section 1 (shadcnstore) · https://21st.dev/@shadcnstore/components/pricing-section-1 | Public pricing (Monthly/Yearly toggle) | shadcn/Radix, utility libs | No | Not adopted. WAJHATI already ships a bilingual pricing component tied to `billing_plans`; a generic template would add dependencies and no new data behaviour. |
| Pricing section | Pricing Section (brijr) · https://21st.dev/@brijr/components/pricing-section | Same | shadcn | No | Not adopted, same reasons. |
| Product card | Product Card (deltacomponents) · https://21st.dev/@deltacomponents/components/product-card | Storefront tiles | shadcn | No | **Rejected for storefronts.** Storefront themes are merchant-generated output; unclear licence there is disallowed by the brief. Also adds wishlist/rating UI we must not fake. |
| Product card | ProductCard (beratberkayg) · https://21st.dev/@beratberkayg/components/product-card-1 | Storefront tiles | shadcn + Framer Motion | No | Rejected: Framer Motion is heavy for mid-range phones, ratings/"best seller" badges would be invented data. |
| Toast | Toast Notification (ghaerdi) · https://21st.dev/@ghaerdi/components/toast | Dashboard feedback | `sonner` | No | Not adopted. The dashboard already uses server-redirect `role="status"` notices; the new dependency is not justified. |
| Skeleton | Skeleton Swap (ddoemonn) · https://21st.dev/@ddoemonn/components/skeleton-swap | Storefront section loading | none claimed | No | Not adopted. `store-skeleton` already exists; the pattern (reserve the box, no layout shift) is already how it works. |
| Dashboard stats | Stats Card (kavikatiyar) · https://21st.dev/@kavikatiyar/components/stats-card-1 | Merchant overview | animation lib | No | Not adopted. A chart or trend card needs real time-series data; WAJHATI has none and the brief forbids fake statistics. |
| Image upload | Image Preview Dropzone (uilayout.contact) · https://21st.dev/@uilayout.contact/components/imgpreview-dropzone | Theme designer media picker | none claimed | No | Pattern adopted **by re-implementation only** (thumbnail previews in the designer). No code copied. |
| Navigation | Mega Menu Navbar (anelkabag) · https://21st.dev/@anelkabag/components/navbar2 | Marketing header with language switch | Radix/animation | No | Not adopted; the existing header already has a mobile menu and locale switch. |

## 4. What was actually taken from the research

Ideas, not code. Each was implemented from scratch in the existing CSS system, with no third-party package added:

- Image pickers show an actual thumbnail grid with the selected state, not a text select ("Logo 1", "Logo 2"). Source of the idea: dropzone-with-thumbnails pattern above. Implemented in `src/components/store-theme/designer.tsx`.
- Designer shows an unsaved-changes warning (`beforeunload`) and a "discard changes" action. Not a 21st component, noted here because the research surveyed form-state patterns.
- Reserved-box skeletons were already present; confirmed, not changed.

## 5. Licence of what ships today

The repo already uses only these third-party UI assets: `lucide-react` (ISC), `@fontsource/*` (OFL/Apache fonts; Cairo, Manrope, Poppins, Noto Sans Arabic, Amiri). The Manrope licence is referenced in `docs/wajhati-storefront-families.md`. No change in this pass.

## 6. Recommendation

1. Keep the existing in-house design system. It is lighter than any shadcn + Framer Motion import and already aligned with the brand tokens.
2. If the owner wants 21st components for **platform marketing/admin pages only** (never inside merchant storefronts), do it per component: read the author's licence on the component page, add a visible attribution link, and pay for retrieval only after the licence is confirmed. Record each in this file.
3. Do not use 21st components inside storefront themes. That output is redistributed to every merchant's customers and the licence position is unverifiable from the catalog.
4. Costs the owner must decide on: a 21st account/API key and, possibly, paid retrieval quota. Neither was used.
