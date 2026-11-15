# واجهتي | WAJHATI — Billing, Per-Store Activation & Central SMTP Final Acceptance Audit

**Project**: `D:\saas store ali`  
**Platform**: واجهتي | WAJHATI  
**Audit Date**: 2026-11-15  
**Referenced Documents**:
- [WAJHATI_BILLING_SMTP_HANDOFF_REPORT.md](file:///d:/saas%20store%20ali/WAJHATI_BILLING_SMTP_HANDOFF_REPORT.md)
- [docs/smtp-deliverability.md](file:///d:/saas%20store%20ali/docs/smtp-deliverability.md)

---

## Executive Verdict: **GO (Codebase & Local Verification) / CONDITIONAL GO FOR PRODUCTION (Pending Live External SMTP & DNS Blockers)**

| Scope | Verdict | Summary |
| :--- | :--- | :--- |
| **Repository Code, Database Migrations (`0025`–`0026`), Security Controls, UI/UX & Regression Suite** | **GO** | All functional, security, RBAC, MFA, RLS, per-store billing, 72-hour account trial, WhatsApp contact, and SMTP encryption/transport requirements are implemented and verified (`35/35` unit tests, `48/48` PostgreSQL integration tests, `18/18` E2E browser tests, worker jobs, load test, and backup/restore rehearsal all pass with `exit code 0`). |
| **Live Production Email Delivery & Domain Authentication** | **BLOCKED (External Dependencies)** | Requires live production `SMTP_CONFIG_KEY`, a real SMTP relay account, public DNS records (`SPF`, `DKIM`, `DMARC`), and a live Owner MFA test-email handshake (`Send test email`) in production before `mailProvider()` activates `"smtp"` sending. |

---

## 1. Review of Migrations `0025` and `0026`

### 1.1 [0025_contact_subscription_tables.sql](file:///d:/saas%20store%20ali/drizzle/0025_contact_subscription_tables.sql)
- **Additive & Non-Destructive**: Creates four new tables (`platform_account_trials`, `platform_contact`, `platform_mail`, `platform_manual_terms`) with Row-Level Security (`ENABLE ROW LEVEL SECURITY`) on each table and expands `ops_notifications_kind` to `('billing_due', 'review_pending', 'subscription_active', 'subscription_expired', 'trial_started')`.
- **No Destructive Statements**: Zero `DROP TABLE`, `TRUNCATE`, or column deletions on historical billing or storefront tables (`billing_requests`, `billing_proofs`, `billing_reviews`, `billing_periods`, `billing_trials`, `billing_audit`).
- **Strict Table Constraints**:
  - `platform_account_trials`: `user_id` PK (`ON DELETE CASCADE`), `CHECK (ends_at > starts_at)`.
  - `platform_contact`: singleton `id = 1`, `CHECK (id = 1 AND whatsapp ~ '^[1-9][0-9]{7,14}$')`.
  - `platform_mail`: singleton `id = 1`, `CHECK (id = 1 AND octet_length(cipher) BETWEEN 29 AND 4096)` (enforces 12-byte IV + >=1-byte ciphertext + 16-byte GCM tag).
  - `platform_manual_terms`: `months IN (1, 3, 6, 12)`, `amount_minor BETWEEN 1 AND 1000000000`, `length(btrim(reference)) BETWEEN 3 AND 120`, `length(note) <= 500`, `UNIQUE (reference)` (`platform_manual_reference`), and atomic state invariant requiring `(starts_at IS NULL AND ends_at IS NULL AND approved_by IS NULL)` (pending dual-approval) or `(starts_at IS NOT NULL AND ends_at > starts_at AND approved_by IS NOT NULL)` (activated).

### 1.2 [0026_contact_subscription_access.sql](file:///d:/saas%20store%20ali/drizzle/0026_contact_subscription_access.sql)
- **Default Official WhatsApp & 3-Day Trial Policy**:
  - Seeds `public.platform_contact(id, enabled, whatsapp) VALUES (1, true, '972567508786')`.
  - Updates `public.billing_config SET trial_days = 3 WHERE id = 1` without shortening any existing rows in `public.billing_trials`.
- **GiST Overlap Prevention**:
  - `platform_manual_terms_no_overlap`: `EXCLUDE USING gist (store_id WITH =, tstzrange(starts_at, ends_at, '[)') WITH &&) WHERE (starts_at IS NOT NULL AND ends_at IS NOT NULL)` guarantees two active manual terms for the same store can never overlap at the database level.
- **Immutability Trigger**:
  - `platform_manual_immutable` prevents modifying or deleting any activated manual term (`OLD.ends_at IS NOT NULL`).
- **Least-Privilege Role Grants**:
  - `REVOKE ALL` on the new tables from `PUBLIC`, `storefront_app`, `storefront_identity`, and `storefront_media_worker`.
  - `storefront_app` receives `SELECT` on `platform_manual_terms` only through RLS policy `platform_manual_owner_read` (`USING (public.billing_owner(store_id))`) and `SELECT` on `billing_plans`.
  - `platform_mail_secret()` is granted **exclusively** to `storefront_identity` (`REVOKE ALL ... FROM PUBLIC`; `GRANT EXECUTE ... TO storefront_identity`), isolating the encrypted SMTP cipher from the general storefront runtime role (`storefront_app`).

---

## 2. Verification of the 72-Hour (3-Day) Account Trial

| Requirement | Status | Evidence & Mechanism |
| :--- | :--- | :--- |
| **First store receives the eligible 72-hour trial** | **PASS** | `platform_account_trial_begin` (`0026` lines 68–77) sets `starts_at = NEW.created_at` and `ends_at = NEW.created_at + interval '72 hours'` in `platform_account_trials` upon user creation. When the user creates their first store, `platform_trial_attach` (`0026` lines 78–96) attaches that exact `[starts_at, ends_at]` window to `billing_trials`. Verified in [billing.test.ts](file:///d:/saas%20store%20ali/tests/integration/billing.test.ts#L326-L353). |
| **Second store cannot reset or duplicate the trial** | **PASS** | `platform_trial_attach` acquires `pg_advisory_xact_lock(hashtextextended(NEW.user_id::text, 12))` and checks `EXISTS (SELECT 1 FROM public.billing_trials WHERE user_id = NEW.user_id)`. Creating a second store (`Store Two`) leaves `platform_account_trials.ends_at` unchanged and sets `Store Two` status to `expired` with `trialEnd = null`. Verified in [billing.test.ts](file:///d:/saas%20store%20ali/tests/integration/billing.test.ts#L342-L353). |
| **UI explains trial eligibility clearly** | **PASS** | [billing-copy.ts](file:///d:/saas%20store%20ali/src/lib/billing-copy.ts#L60-L64) and [billing/page.tsx](file:///d:/saas%20store%20ali/src/app/%5Blocale%5D/dashboard/stores/%5Bslug%5D/billing/page.tsx#L73-L79) display the badge `"تجربة مجانية · 3 أيام (72 ساعة)"` / `"Free trial · 3 days (72 hours)"` and explain that the 72-hour trial belongs to the account's first eligible store and does not reset when creating additional stores. Verified in E2E screenshot [whatsapp-billing-merchant-ar-mobile.png](file:///d:/saas%20store%20ali/.dar-local/screenshots/whatsapp-billing-merchant-ar-mobile.png). |
| **Existing trials and paid periods are preserved** | **PASS** | Existing rows in `billing_trials` and `billing_periods` are untouched by `0025`/`0026`; `billing_state(p_store)` unions `billing_periods` and `platform_manual_terms` seamlessly. Verified across all 9 subtests in [billing.test.ts](file:///d:/saas%20store%20ali/tests/integration/billing.test.ts). |

---

## 3. Audit of Two-Store Merchant & Per-Store Activation (`1, 3, 6, 12` Months)

Tested against live PostgreSQL in [tests/integration/billing.test.ts](file:///d:/saas%20store%20ali/tests/integration/billing.test.ts#L313-L505) and [tests/integration/platform.test.ts](file:///d:/saas%20store%20ali/tests/integration/platform.test.ts#L266-L292):

1. **Activate Only Selected Store (`Store One`), Other Store (`Store Two`) Unchanged**:
   - Merchant `multiUser` creates `Store One` (`slugOne`) and `Store Two` (`slugTwo`).
   - Super Admin activates `1-month Starter` on `Store One` during its active trial (`grant1Id`).
   - `Store One` immediately transitions to `status: "active"`, `plan: "starter"`.
   - `Store Two` remains `status: "expired"`, `plan: null`.
2. **Verify `1`, `3`, `6`, and `12`-Month Terms & Renewal Date Calculations**:
   - **1-Month Starter on `Store One` (during trial)**: Starts immediately (`periodStart = begins = now()`); `periodEnd` equals `addUtcCalendarMonths(periodStart, 1)`.
   - **3-Month Starter Renewal on `Store One` (while active)**: Appends to existing `firstPeriodEnd`; new `periodEnd` equals `addUtcCalendarMonths(firstPeriodEnd, 3)`.
   - **6-Month Pro Activation on `Store Two` (while expired)**: Starts immediately (`periodStart = now()`); `periodEnd` equals `addUtcCalendarMonths(periodStart, 6)`.
   - **12-Month Pro Renewal on `Store Two` (while active)**: Appends to the 6-month `periodEnd`; new `periodEnd` equals `addUtcCalendarMonths(periodEndAfter6M, 12)` (18 total months of active coverage).
   - Leap-year and month-end clamping (`Jan 31 + 1m -> Feb 29/28`, `Aug 31 + 6m -> Feb 28`, `Feb 29 + 12m -> Feb 28`) verified in [platform-contact.test.ts](file:///d:/saas%20store%20ali/tests/unit/platform-contact.test.ts#L54-L71).
3. **Duplicate Approval & Reference Prevention**:
   - **Idempotent Retry**: Repeating `grantManualSubscription` with the same `id` (`grant1Id`) and identical parameters returns `"ok"` without creating a duplicate term or second audit entry.
   - **Tampered Retry**: Repeating `grantManualSubscription` with the same `id` (`grant1Id`) but modified `months: 3` returns `"invalid"`.
   - **Duplicate Payment Reference**: Submitting a new `id` with an already-used `reference` (`ref1`) hits the unique constraint `platform_manual_reference` and returns `"invalid"`.
   - **Concurrent Pending Lock**: `EXISTS (SELECT 1 FROM public.platform_manual_terms WHERE store_id = p_store AND ends_at IS NULL)` prevents queueing multiple unconfirmed high-value terms on the same store.
4. **MFA, Self-Approval & Dual-Approval Protections**:
   - Merchant token calling `grantManualSubscription` -> `"denied"`.
   - Admin who owns or is a member of the target store -> `"denied"` (`actor = p_user OR EXISTS (SELECT 1 FROM public.store_memberships WHERE store_id = p_store AND user_id = actor)`).
   - Admin without fresh 5-minute MFA elevation (`platform_actor(p_token, ..., true)`) -> `"denied"`.
   - High-value manual grant (`amountMinor: 50000 KWD` >= `dual_thresholds.KWD`) creates a pending term (`ends_at IS NULL`); the initiating Owner (`platformOwner`) is rejected when calling `confirmManualSubscription` (`"denied"`), and a second independent Administrator (`manager`) with fresh MFA confirms it (`"ok"`), recording `approved_by = manager.id`.

---

## 4. Audit of Central Platform SMTP System

| Audit Criterion | Status | Implementation & Verification |
| :--- | :--- | :--- |
| **Owner-Only Settings Access** | **PASS** | `platform_mail_view` requires `platform_actor(p_token, 'owner', false) IS NOT NULL`. `platform_mail_save` and `platform_mail_tested` require `platform_actor(p_token, 'owner', true)` (Owner role + fresh MFA). Tested in [platform.test.ts](file:///d:/saas%20store%20ali/tests/integration/platform.test.ts#L247-L259): `administrator` (`manager`) and `reviewer` (`first`) receive `"denied"` / `null`. |
| **Secure Password Encryption at Rest** | **PASS** | [src/server/auth/smtp.ts](file:///d:/saas%20store%20ali/src/server/auth/smtp.ts#L14-L24) encrypts passwords with **AES-256-GCM** using a 96-bit random IV, 128-bit authentication tag, `SMTP_CONFIG_KEY` (32-byte key), and AAD `"wajhati/smtp/v1"`. `platform_mail_view` never returns `cipher` or plaintext password. Updating non-password fields passes `cipher = null`, preserving the existing encrypted `cipher` via `coalesce(p_cipher, (SELECT cipher FROM public.platform_mail WHERE id = 1))`. |
| **Correct TLS Certificate Validation & SSRF Protection** | **PASS** | [src/server/auth/smtp.ts](file:///d:/saas%20store%20ali/src/server/auth/smtp.ts#L25-L43) resolves DNS once (`lookup(valid.host, { all: true, verbatim: true })`), blocks loopback/RFC1918/link-local/CGNAT/non-global IPv6 via `BlockList`, pins `host: addresses[0].address` on the Nodemailer transport to prevent DNS rebinding, and sets `tls: { servername: valid.host, minVersion: "TLSv1.2", rejectUnauthorized: true }`, `secure: valid.port === 465`, `requireTLS: true`. |
| **Retry & Duplicate Notification Prevention** | **PASS** | `ops_notifications` enforces unique `(kind, recipient, subject, window)` keys (`ON CONFLICT DO NOTHING`), atomic lease claiming (`FOR UPDATE SKIP LOCKED`, `lease = gen_random_uuid()`, 5-minute lease timeout), exponential backoff (`power(2, n.attempts)` minutes up to `attempts < 6`), and RFC 5322 `Message-ID: <wajhati-${id}@domain>` header deduplication. Verified in [operations.test.ts](file:///d:/saas%20store%20ali/tests/integration/operations.test.ts) and [platform-contact.test.ts](file:///d:/saas%20store%20ali/tests/unit/platform-contact.test.ts#L115-L153). |
| **Accurate Arabic / English Templates** | **PASS** | [src/server/auth/mail.ts](file:///d:/saas%20store%20ali/src/server/auth/mail.ts#L49-L172) provides complete Arabic and English subjects and bodies for all 5 identity purposes (`signup`, `verify`, `reset`, `change_old`, `change_new`) and all 5 operational kinds (`trial_started`, `billing_due`, `subscription_active`, `subscription_expired`, `review_pending`). Unit-tested in [platform-contact.test.ts](file:///d:/saas%20store%20ali/tests/unit/platform-contact.test.ts#L115-L153). |
| **Delivery Monitoring & Troubleshooting** | **PASS** | `platform_query(..., 'settings', ...)` returns `notificationStats` (`pending`, `sent`, `failed`, and 12 most recent `ops_notifications` rows with `kind`, `attempts`, `sentAt`, `failedAt`), rendered in `/[locale]/platform/settings` ([platform-settings-smtp-ar-desktop.png](file:///d:/saas%20store%20ali/.dar-local/screenshots/platform-settings-smtp-ar-desktop.png)). |

---

## 5. Audit of Merchant WhatsApp Subscription Flow & Storefront Checkout

| Audit Criterion | Status | Implementation & Verification |
| :--- | :--- | :--- |
| **Official Platform Number (`+972567508786`)** | **PASS** | Stored normalized as `'972567508786'` in `public.platform_contact` (`0026` line 2) and `defaultPlatformWhatsapp` in [platform-contact.ts](file:///d:/saas%20store%20ali/src/lib/platform-contact.ts#L4). Owner can update it in `/platform/settings`. |
| **Correct Account & Store Identification in WhatsApp Link** | **PASS** | `subscriptionContact()` in [platform-contact.ts](file:///d:/saas%20store%20ali/src/lib/platform-contact.ts#L38-L80) generates `https://wa.me/972567508786?text=...` including store name, merchant account email, requested plan (`Starter` or `Pro`), and public billing interval (`Monthly` or `Yearly`), with zero secrets or tokens. |
| **No Automatic Activation on Click** | **PASS** | `WhatsAppSubscriptionCard` in [billing/forms.tsx](file:///d:/saas%20store%20ali/src/components/billing/forms.tsx#L28-L115) renders external `<a href="https://wa.me/..." target="_blank" rel="noopener noreferrer">` links and performs no server mutation. |
| **No Exposed Old Payment-Proof Workflow** | **PASS** | When `platform_contact.enabled = true`, [billing/page.tsx](file:///d:/saas%20store%20ali/src/app/%5Blocale%5D/dashboard/stores/%5Bslug%5D/billing/page.tsx#L98-L110) renders `WhatsAppSubscriptionCard` instead of `PlanSelector`, hides `ProofForm` (`!contactMode && payment.status === "awaiting_payment"`), and blocks `createPaymentRequest` (`billing_request_payment` returns `{"error":"unavailable"}` when `dar.contact_enforce = 'on'`) and `/api/billing/[slug]/requests/[id]/proof` (`404`). Verified in [billing.test.mjs](file:///d:/saas%20store%20ali/tests/e2e/billing.test.mjs#L56-L64). |
| **Existing Storefront WhatsApp/Instagram Checkout Unaffected** | **PASS** | Storefront customer cart and order handoff (`src/server/orders/`, `src/components/storefront/`) were not modified. Verified by `tests/integration/orders.test.ts` (`4/4` passed) and `tests/e2e/orders.test.mjs` + `tests/e2e/storefront-themes.test.mjs` (`7/7` passed). |

---

## 6. Review of Notification Triggers

| Event | Trigger Location | Queue / Delivery Mechanism | Verification |
| :--- | :--- | :--- | :--- |
| **Trial Started (`trial_started`)** | `platform_trial_attach()` trigger (`AFTER INSERT ON public.store_memberships`) in [0026_contact_subscription_access.sql](file:///d:/saas%20store%20ali/drizzle/0026_contact_subscription_access.sql#L92) | Inserts `('trial_started', NEW.user_id, NEW.user_id, NEW.store_id::text)` into `public.ops_notifications`; claimed by `ops_claim_mail` and sent via `sendOperationsMail`. | Verified in [billing.test.ts](file:///d:/saas%20store%20ali/tests/integration/billing.test.ts#L355-L360) and [platform-contact.test.ts](file:///d:/saas%20store%20ali/tests/unit/platform-contact.test.ts#L132-L145). |
| **Trial / Subscription Approaching Expiration (`billing_due`)** | `ops_schedule_reminders()` in [0019_operations_access.sql](file:///d:/saas%20store%20ali/drizzle/0019_operations_access.sql#L19-L37) | Enqueues `'billing_due'` when `trialEnd`, `periodEnd`, or `graceUntil` is within `(now(), now() + interval '72 hours']` with `window = extract(epoch FROM deadline)::bigint::text`. | Verified in [operations.test.ts](file:///d:/saas%20store%20ali/tests/integration/operations.test.ts#L45-L70). |
| **Subscription Activation & Renewal (`subscription_active`)** | `platform_manual_activate()` in [0026_contact_subscription_access.sql](file:///d:/saas%20store%20ali/drizzle/0026_contact_subscription_access.sql#L158-L159) | Inserts `('subscription_active', user_id, term.store_id, p_id::text)` into `public.ops_notifications` upon immediate activation or second-admin confirmation. | Verified in [billing.test.ts](file:///d:/saas%20store%20ali/tests/integration/billing.test.ts#L495-L500). |
| **Trial / Subscription Expired (`subscription_expired`)** | `billing_expire()` in [0026_contact_subscription_access.sql](file:///d:/saas%20store%20ali/drizzle/0026_contact_subscription_access.sql#L344-L356) | When `observed_status` transitions to `'expired'` or `'suspended'`, inserts `('subscription_expired', m.user_id, c.store_id, YYYY-MM-DD)` into `public.ops_notifications`. | Verified in `npm run billing:expire` and [platform-contact.test.ts](file:///d:/saas%20store%20ali/tests/unit/platform-contact.test.ts#L132-L147). |
| **Email Verification & Password Reset (`signup`, `verify`, `reset`, `change_old`, `change_new`)** | `issueIdentity()` / `issueEmailChange()` -> `sendIdentityMail()` in [src/server/auth/mail.ts](file:///d:/saas%20store%20ali/src/server/auth/mail.ts#L117-L126) | Immediate delivery via `deliver()` using active `mailProvider()` (`"smtp"` when configured & verified, `"local"` in local/staging test, or `"resend"`). | Verified in [platform.test.ts](file:///d:/saas%20store%20ali/tests/integration/platform.test.ts#L71-L104), [platform-contact.test.ts](file:///d:/saas%20store%20ali/tests/unit/platform-contact.test.ts#L125-L129), and E2E `identity.test.mjs`. |

---

## 7. External Dependencies Marked **BLOCKED** Until Independently Tested in Production

In accordance with the audit policy, the following items require an external live SMTP provider, a real domain with public DNS, or production infrastructure and are marked **BLOCKED** until executed in the target production environment:

| ID | External Dependency | Status | Unblocking Action Required Before Production Cutover |
| :--- | :--- | :--- | :--- |
| **BLK-01** | **Live External SMTP Relay Handshake (`465` SSL/TLS or `587` STARTTLS)** | **BLOCKED (Requires Live SMTP Provider)** | Provision a production SMTP provider account (e.g., Amazon SES, Postmark, Mailgun, Google Workspace, or Microsoft 365), enter its credentials in `/ar/platform/settings`, and execute **إرسال بريد اختباري** (`Send test email`) so `platform_mail.verified_at` is populated against a real remote MTA. |
| **BLK-02** | **Public Domain DNS Authentication (`SPF`, `DKIM`, `DMARC`)** | **BLOCKED (Requires Real Domain DNS)** | Publish the `SPF`, 2048-bit `DKIM`, and `_dmarc` `TXT` records documented in [docs/smtp-deliverability.md](file:///d:/saas%20store%20ali/docs/smtp-deliverability.md) on the production sending domain and verify `Authentication-Results: spf=pass; dkim=pass; dmarc=pass` in an external recipient mailbox (Gmail/Outlook). |
| **BLK-03** | **Production `SMTP_CONFIG_KEY` Secret Provisioning** | **BLOCKED (Requires Production Secret Store)** | Generate a dedicated 64-character hex key (`openssl rand -hex 32`) and inject `SMTP_CONFIG_KEY` into the production runtime environment prior to saving live SMTP credentials. |
| **BLK-04** | **Live WhatsApp Support Operations Readiness (`+972567508786`)** | **BLOCKED (External Operational Readiness)** | Confirm that the official WAJHATI WhatsApp inbox (`+972567508786`) is actively monitored by platform support staff trained on the `/platform/subscriptions` per-store activation workflow. |

---

## 8. Regression Test Execution Summary

All existing and newly added regression suites were executed and passed:

1. **Static Analysis & Type Safety**:
   - `npm run lint` -> **PASS** (`0` errors, `0` warnings)
   - `npm run typecheck` -> **PASS** (`next typegen && tsc --noEmit` — `0` errors)
2. **Unit Test Suite (`npm test`)**:
   - **PASS (`35 / 35` tests in `9` files)**:
     - Includes `WhatsApp phone normalization, international formatting, and bilingual subscription links`
     - Includes `UTC calendar-month arithmetic and subscription date preview for 1, 3, 6, and 12 months`
     - Includes `SMTP validation, AES-256-GCM encryption at rest, and SSRF private-IP protection`
     - Includes `all bilingual identity and subscription operational email templates render and deduplicate by notification ID`
3. **PostgreSQL Integration Test Suite (`npm run test:db`)**:
   - **PASS (`48 / 48` subtests across `7` suites)**:
     - `tests/integration/billing.test.ts` (`9 / 9` subtests, including 72-hour account trial, two-store merchant isolation, `1/3/6/12`-month terms, UTC calendar-month renewal math, duplicate reference/approval rejection, MFA/merchant denial, and notification triggers)
     - `tests/integration/platform.test.ts` (`8 / 8` subtests, including owner-only WhatsApp/SMTP settings, AES-256-GCM encryption at rest, write-only view, and dual-admin confirmation)
     - `tests/integration/operations.test.ts`, `catalog.test.ts`, `orders.test.ts`, `postgres.test.ts`, `theme.test.ts` (all passing)
4. **Full End-to-End Verification Pipeline (`npm run local:verify`)**:
   - **PASS (`exit code 0`)**:
     - Production build (`next build --webpack`): `28 / 28` static pages & all dynamic routes compiled.
     - Playwright E2E suite (`npm run test:e2e`): **`18 / 18` passed** across desktop and mobile in Arabic RTL and English LTR.
     - Background workers (`media:cleanup`, `orders:cleanup`, `ops:notifications`, `ops:maintenance`, `billing:expire`): **all passed** (`audit_mismatch: 0`, `abandoned: 0`).
     - Concurrent load test (`scripts/ops/load.mjs`): `96` requests across `2` tenants at concurrency `8`, `errors: 0`.
     - Encrypted off-server backup & restore rehearsal (`scripts/ops/rehearse-backup.mjs`): `migrations: 27`, `tamperRejected: true`, `nonEmptyTargetRejected: true`.

