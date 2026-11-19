# Legal pages — owner and counsel review

Status: **content complete; approval is the owner's flag.** Version `1.0`, last updated 2026-11-19.
Pages: `/ar/privacy`, `/en/privacy`, `/ar/terms`, `/en/terms`. Source of the text: `src/lib/legal.ts`.

This is engineering drafting from what the platform actually does, completed with facts the owner supplied. It is not legal advice and has not been reviewed by a lawyer. It does not claim GDPR or any other regime and carries no badges or certifications.

## How the safeguards work

- **Approval takes two keys.** `LEGAL_APPROVED=true` **and** no owner-review placeholder left in any of the four texts (`legalApproved()`, tested). With a placeholder open the pages stay marked as drafts, stay `noindex` and stay out of the sitemap even if the flag is set. No placeholder is open now.
- No checked-in configuration sets the flag to `true` (a test scans every deployable config). Production reads it from the secret store.
- Without the flag every legal page shows a draft banner, is `noindex` and is out of the sitemap. In `DAR_ENV=production` the application refuses to start unless the flag is `true`.
- To add a future review item: add it to `ownerGaps` and use `{{ID}}` in the text. It then renders visibly and holds the pages as drafts until it is replaced with confirmed text.

## Facts the owner supplied (2026-11-19)

| ID | Where | Text now published | Basis |
| --- | --- | --- | --- |
| OP-IDENTITY, OP-ADDRESS | Privacy 1, Terms 1 | Operated by WAJHATI (واجهتي), Gaza, Palestine | Owner. No registration number was given, so none is stated |
| REFUND | Terms 11 | No refund after activation unless a problem occurred that could not be resolved; contact support to request one | Owner |
| AGE-LIMIT | Privacy 12, Terms 2 | 18 years | Owner |
| RETENTION-ACCOUNT | Privacy 10, 11 | Manual deletion within 30 days of a verified request | Owner |
| RETENTION-AUDIT | Privacy 10 | Billing and audit records kept 7 years, then deleted or anonymised in periodic maintenance. **Nothing deletes them automatically today**, so this is a manual duty | Owner (7 years confirmed) |
| RETENTION-BACKUP | Privacy 10 | Off-server backups kept 35 days, enforced by the lifecycle rule `delete-backups-after-35-days` on the backup bucket (created 2026-11-19 with the owner's explicit approval) | Owner |
| RESPONSE-TIME | Privacy 11 | Within 14 days | Owner |
| PAYMENT-METHODS | Terms 10 | Bank transfer, Palestinian e-wallets, USDT, Vodafone Cash | Owner |
| TAX | Terms 8 | No tax is added to subscription prices | Owner |
| SUPPORT-HOURS | Terms 13 | 9:00 AM until 12:00 midnight, Palestine time | Owner (midnight confirmed) |
| UPTIME | Terms 13 | No availability commitment | Owner |
| EXPIRY-VISIBILITY | Terms 12 | The store page disappears from public view and stops taking orders when the period and any grace period end; data is kept; it returns on renewal | Owner; **implemented in code by migration 0028** |
| GOV-LAW | Terms 17 | Laws of the State of Palestine; unresolved disputes to the competent courts in Gaza | Owner chose this default |
| STORAGE-PROVIDER, SMTP-PROVIDER | Privacy 8 | Cloudflare (R2), Hostinger | Facts of the deployment |

### Wording drafted without an owner answer (counsel review recommended)

| ID | Where | What was written |
| --- | --- | --- |
| ROLES | Privacy 2 | Plain description: store data is processed on the merchant's behalf to run their store; merchant account data is processed to operate, bill and secure the platform. No legal labels |
| LIABILITY | Terms 16 | Standard as-is wording: no express or implied warranties; to the extent the law permits, no liability for indirect or consequential losses, lost profits or lost data. **No monetary cap was invented** |
| HOSTING-REGION | Privacy 8 | A private virtual server managed by WAJHATI at a hosting provider; the processing location is available on request. The owner chose not to name the provider |
| ACCESS-LOGS | Privacy 3 | The hosting layer may keep short-lived technical access logs for security and operations |

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

- Immediate or complete deletion, data residency in any country, an uptime figure or a refund guarantee.
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
| Owner | | 2026-11-19 | Reviewed the pages and chose to publish |
| Legal counsel | | | Not reviewed. Recommended for the four wording items above |
