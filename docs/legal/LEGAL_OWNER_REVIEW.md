# Legal pages — owner and counsel review

Status: **DRAFT, not approved.** Version `draft-1`, last updated 2026-11-18.
Pages: `/ar/privacy`, `/en/privacy`, `/ar/terms`, `/en/terms`. Source of the text: `src/lib/legal.ts`.

This is engineering drafting from what the platform actually does. It is not legal advice and has not been reviewed by a lawyer. I did not copy third-party legal text, did not claim GDPR or any other regime, and did not add badges or certifications.

## How the safeguards work

- **Approval takes two keys.** `LEGAL_APPROVED=true` **and** no owner-review placeholder left in any of the four texts. If the flag is set while placeholders remain, the pages stay marked as drafts, stay `noindex` and stay out of the sitemap, so setting the flag by mistake cannot present draft text as approved (`legalApproved()` in `src/lib/legal.ts`, tested).
- No checked-in configuration sets the flag to `true` (a test scans every deployable config). The production template and the staging compose file both say `false`.
- While `LEGAL_APPROVED` is not exactly `true`, every legal page shows a visible banner ("Draft pending owner approval and legal review"), highlights each open item inline, sets `noindex`, and stays out of the sitemap.
- In `DAR_ENV=production`, `scripts/ops/validate-env.mjs` fails with `LEGAL_APPROVED` and the Dokploy bootstrap refuses to start the app. Staging and development are not blocked. This makes it impossible to ship the draft to production by accident.
- To approve: resolve every item below in `src/lib/legal.ts` (replace the `{{ID}}` token with the confirmed text, or delete the sentence), bump `legalVersion` and `legalUpdated`, have counsel sign off, then set `LEGAL_APPROVED=true` in the production secret store.

## Open items the owner must supply

Each ID is rendered on the pages as a highlighted placeholder. "Today's code" says what the platform currently does so the answer can be consistent with it.

| ID | Where | Question | Today's code |
| --- | --- | --- | --- |
| `OP-IDENTITY` | Privacy 1; Terms 1 | Registered legal name of the operator | Unknown. Not in the repository. |
| `OP-ADDRESS` | Privacy 1; Terms 1 | Registered address and registration number | Unknown. |
| `GOV-LAW` | Terms 17 | Governing law and competent courts | None chosen. I did not guess a jurisdiction. |
| `REFUND` | Terms 11 | Refund and paid-period cancellation policy | **No refund function exists.** Renewal is manual, so a merchant can simply not renew. Whether money is returned for an activated period is a business decision. |
| `LIABILITY` | Terms 16 | Warranty disclaimer and liability limits | Needs counsel; wording and caps are jurisdiction-specific. |
| `AGE-LIMIT` | Privacy 12; Terms 2 | Minimum age and eligibility | Not enforced in code (the sign-up form asks only name, email, password). |
| `ROLES` | Privacy 2 | How WAJHATI and merchants are characterised under data-protection law | Not decided. The page describes responsibilities factually and does not use legal labels. |
| `HOSTING-REGION` | Privacy 8 | Hosting provider and data location | **Not decided.** `wajhati.store` is currently a Hostinger parked domain and no application host exists yet. |
| `STORAGE-PROVIDER` | Privacy 8 | Object storage and backup storage providers | Code speaks to any S3-compatible store; none chosen. |
| `SMTP-PROVIDER` | Privacy 8 | Outbound email relay provider | Mailbox DNS is Hostinger Email. The relay actually used is configured in the platform settings and is not yet set. |
| `RETENTION-ACCOUNT` | Privacy 10; Privacy 11 | How and how fast an account or store is deleted on request | **No self-service deletion or export exists.** `store_memberships.user_id` is `ON DELETE RESTRICT`, so deleting a user needs a deliberate manual procedure. Decide the procedure, then write it. |
| `RETENTION-AUDIT` | Privacy 10 | Retention period for billing and audit records | Nothing deletes `platform_events`, `billing_audit` or manual subscription terms (activated terms are immutable). Tax and accounting rules in your jurisdiction may require a minimum. |
| `RETENTION-BACKUP` | Privacy 10 | Backup retention | Local spool 7 days. Off-server lifecycle (recommended 35 days in `docs/phase6b-operations.md`) is a bucket setting that does not exist yet. |
| `RESPONSE-TIME` | Privacy 11 | Response time for privacy requests | None. |
| `EXPIRY-VISIBILITY` | Terms 12 | What happens to a store's public page when the trial or subscription ends | Entitlements change (for example `publish`). Whether the published storefront stays visible after expiry should be confirmed against the `billing_state` logic before it is promised in writing. |
| `PAYMENT-METHODS` | Terms 10 | Accepted payment methods and currencies for subscriptions | Arranged over WhatsApp; the platform has no gateway. |
| `SUPPORT-HOURS` | Terms 13 | Support hours and response targets | None. |
| `UPTIME` | Terms 13 | Any availability commitment | None; a single-VPS design (`docs/phase6b-operations.md`) argues against promising one. |
| `TAX` | Terms 8 | VAT and tax treatment of subscription prices | Unknown. |
| `ACCESS-LOGS` | Privacy 3 | Access logs kept by the proxy or hosting stack and for how long | Depends on the chosen hosting. The app logs structured event codes only. |

## Facts the draft states, with where they come from

Confirm each still holds before approval. If the code changes, the text must change with it.

| Statement | Source |
| --- | --- |
| Order intents hold no customer name, phone, address or payment data | `src/server/db/order-schema.ts` (columns), `src/lib/checkout.ts` |
| Unconfirmed order intents deleted after 90 days, confirmed after 365 | `drizzle/0008_order_access.sql` (a unit test checks the policy text against these numbers) |
| Legacy payment proofs deleted 180 days after review | `README.md` billing section, `billing:expire` worker |
| Operational email records deleted 90 days after send or failure | `drizzle/0019_operations_access.sql` (`ops_maintain`) |
| Sessions last 7 days; attempt counters 15 minutes | `src/server/auth/repository.ts` |
| Verification links 24 h; reset, sign-up and email-change links 20 min | `README.md` operational decisions |
| Cookies `dar_session` and `dar_visitor`, 7 days, `__Host-` prefix in production | `src/server/auth/session.ts`, `src/app/api/checkout/[store]/route.ts` |
| Cart in browser `localStorage`, order identifier in `sessionStorage` | `src/components/orders/cart-store.ts`, `cart.tsx` |
| No analytics, advertising or third-party tracking code | grep of `src` found none; fonts are bundled by Fontsource |
| Expiry does not delete store data | `README.md` ("the expiry job does not delete store data") |
| No automatic renewal | `README.md` ("no automatic renewal is created") |
| Subscription terms of 1, 3, 6, 12 months, one store per subscription, dates in UTC | `drizzle/0025`–`0026`, `src/lib/platform-contact.ts` |
| 72-hour trial per account, attached to the first store, not reset by extra stores | `drizzle/0026`, `tests/integration/billing.test.ts` |

## Things the text avoids promising

- Immediate or complete deletion, data residency in any country, a response deadline, an uptime figure, a refund guarantee or a no-refund rule.
- GDPR, UAE, KSA, Egyptian or any other legal compliance.
- That WAJHATI collects payments from store customers (it does not).

## Decisions that need a product call, not just text

1. **Acceptance record.** Sign-up currently shows an acknowledgement line with links; it is not a checkbox and no acceptance record (version, timestamp) is stored. A click-through with a stored record would need a form change and a small additive migration. Counsel should say whether the acknowledgement is enough in your market.
2. **Account deletion and export.** The privacy text says requests are handled manually. If counsel requires a faster or self-service process, that is new feature work.
3. **Storefront footers.** The eight merchant themes were not changed, so storefronts carry no link to this platform's policy. Merchants remain responsible for their own customer-facing notices; counsel may want WAJHATI to provide a template.
4. **Support mailbox.** The pages publish `support@wajhati.store` as given by the owner. Receiving mail at that address has **not** been verified; see `docs/operations/EMAIL_DNS_VERIFICATION.md`.

## Sign-off

| Role | Name | Date | Decision |
| --- | --- | --- | --- |
| Owner | | | |
| Legal counsel | | | |

## Placeholder audit (second pass, 2026-11-18)

What a visitor can see, counted from the live text:

| Page | Visible placeholders | Distinct items |
| --- | --- | --- |
| `/ar/privacy` | 12 | 12 |
| `/en/privacy` | 12 | 12 |
| `/ar/terms` | 11 | 11 |
| `/en/terms` | 11 | 11 |
| All four pages | | **20 of 20** |

- Every placeholder renders inside a highlighted `OWNER REVIEW` or `LEGAL REVIEW` marker (a test and a browser check fail if a raw `{{TOKEN}}` ever shows).
- A search of all tracked source for stray placeholder text (`lorem`, `TBD`, `TODO`, `coming soon`, `REPLACE_ME`, template braces) found **none outside `src/lib/legal.ts`**. The only other placeholders in the product are input hint attributes (for example the e-mail field) and are not content.
- Nothing was invented to fill a gap. The facts the pages do state come from the code or from the owner (domain, support e-mail, WhatsApp number), listed in the table above with their sources.
- The Arabic and English texts carry identical sets of placeholders (a test enforces it), so a gap cannot be closed in one language and forgotten in the other.
