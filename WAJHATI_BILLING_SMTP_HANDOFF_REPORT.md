# واجهتي | WAJHATI — Billing, Per-Store Activation & Central SMTP Handoff Report

**Project**: `D:\saas store ali`  
**Platform**: واجهتي | WAJHATI  
**Date**: 2026-11-15  

---

## 1. Codex Recovery Summary

Before modifying any files, the workspace and local PostgreSQL state left by the interrupted Codex session were inspected and snapshotted:

- **Pre-Modification Snapshots**:
  - Uncommitted working tree and untracked files backed up to `C:\Users\Alosh2\.gemini\antigravity\brain\664d13e1-172f-4412-9f3e-d5408ac8d668\scratch\codex-snapshot`.
  - Local PostgreSQL cluster data directory (`.dar-local\postgres`) and fixture credentials (`.dar-local\postgres-fixture.json`) backed up to `C:\Users\Alosh2\.gemini\antigravity\brain\664d13e1-172f-4412-9f3e-d5408ac8d668\scratch\pre-0025-db-backup`.
- **Work Completed by Codex Before Interruption**:
  - Drafted migrations [0025_contact_subscription_tables.sql](file:///d:/saas%20store%20ali/drizzle/0025_contact_subscription_tables.sql) and [0026_contact_subscription_access.sql](file:///d:/saas%20store%20ali/drizzle/0026_contact_subscription_access.sql) (not yet applied to the local database).
  - Created initial versions of [platform-contact.ts](file:///d:/saas%20store%20ali/src/lib/platform-contact.ts), [smtp.ts](file:///d:/saas%20store%20ali/src/server/auth/smtp.ts), and [contact.ts](file:///d:/saas%20store%20ali/src/server/platform/contact.ts).
  - Started partial updates to [platform-schema.ts](file:///d:/saas%20store%20ali/src/server/db/platform-schema.ts), [mail.ts](file:///d:/saas%20store%20ali/src/server/auth/mail.ts), [actions.ts](file:///d:/saas%20store%20ali/src/server/platform/actions.ts), [marketing.tsx](file:///d:/saas%20store%20ali/src/components/marketing.tsx), [public-pricing.tsx](file:///d:/saas%20store%20ali/src/components/public-pricing.tsx), [billing.ts](file:///d:/saas%20store%20ali/src/lib/billing.ts), [billing-copy.ts](file:///d:/saas%20store%20ali/src/lib/billing-copy.ts), and [copy.ts](file:///d:/saas%20store%20ali/src/lib/copy.ts).
- **Work Completed in This Resumed Session**:
  - Enhanced `platform_manual_terms` and `platform_manual_grant` in `0025` and `0026` to support both `Starter` and `Pro` plans, store `currency` and administrative `note`, enforce GiST non-overlapping period constraints (`platform_manual_terms_no_overlap`), use exact UTC calendar-month arithmetic (`make_interval(months => term.months)`), enqueue `trial_started` / `subscription_active` / `subscription_expired` notifications, and expose store-level manual activation history and notification queue health.
  - Completed server actions (`contactAction`, `smtpSaveAction`, `smtpTestAction`, `manualSubscriptionAction`, `confirmManualSubscriptionAction`) and bilingual email delivery (`sendOperationsMail`, `sendTestSmtpMail`, `scripts/catalog-cleanup.ts`).
  - Completed the Merchant Billing UI ([billing/page.tsx](file:///d:/saas%20store%20ali/src/app/%5Blocale%5D/dashboard/stores/%5Bslug%5D/billing/page.tsx), [billing/forms.tsx](file:///d:/saas%20store%20ali/src/components/billing/forms.tsx)) and Public Pricing UI ([public-pricing.tsx](file:///d:/saas%20store%20ali/src/components/public-pricing.tsx), [marketing.tsx](file:///d:/saas%20store%20ali/src/components/marketing.tsx)).
  - Completed the Super Admin Activation & Communication/SMTP UI ([platform/[section]/page.tsx](file:///d:/saas%20store%20ali/src/app/%5Blocale%5D/platform/%5Bsection%5D/page.tsx), [platform-forms.tsx](file:///d:/saas%20store%20ali/src/components/platform-forms.tsx), [platform-copy.ts](file:///d:/saas%20store%20ali/src/lib/platform-copy.ts)).
  - Authored SPF/DKIM/DMARC deliverability documentation ([docs/smtp-deliverability.md](file:///d:/saas%20store%20ali/docs/smtp-deliverability.md)) and comprehensive unit, integration, and E2E tests.

---

## 2. Completed Changes by Area

| Area | Key Files | Summary of Changes |
| :--- | :--- | :--- |
| **Database & Migrations** | [0025_contact_subscription_tables.sql](file:///d:/saas%20store%20ali/drizzle/0025_contact_subscription_tables.sql), [0026_contact_subscription_access.sql](file:///d:/saas%20store%20ali/drizzle/0026_contact_subscription_access.sql), [platform-schema.ts](file:///d:/saas%20store%20ali/src/server/db/platform-schema.ts) | Added `platform_account_trials`, `platform_contact`, `platform_mail`, and `platform_manual_terms` (with `currency`, `note`, GiST overlap exclusion, immutability trigger, RLS, and SECURITY DEFINER RPCs). |
| **Contact, Dates & SMTP Library** | [platform-contact.ts](file:///d:/saas%20store%20ali/src/lib/platform-contact.ts), [smtp.ts](file:///d:/saas%20store%20ali/src/server/auth/smtp.ts), [contact.ts](file:///d:/saas%20store%20ali/src/server/platform/contact.ts) | Implemented `+972567508786` normalization/formatting, WhatsApp prefilled links, UTC calendar-month date preview (`1, 3, 6, 12` months), AES-256-GCM SMTP password encryption, and SSRF/private-IP blocking with DNS pinning. |
| **Transactional Email System** | [mail.ts](file:///d:/saas%20store%20ali/src/server/auth/mail.ts), [catalog-cleanup.ts](file:///d:/saas%20store%20ali/scripts/catalog-cleanup.ts) | Unified bilingual (AR/EN) identity and operational email delivery across `signup`, `verify`, `reset`, `change_old`, `change_new`, `trial_started`, `billing_due`, `subscription_active`, `subscription_expired`, and `review_pending`, plus owner SMTP test email delivery. |
| **Merchant Billing & Public Pricing** | [billing/page.tsx](file:///d:/saas%20store%20ali/src/app/%5Blocale%5D/dashboard/stores/%5Bslug%5D/billing/page.tsx), [billing/forms.tsx](file:///d:/saas%20store%20ali/src/components/billing/forms.tsx), [public-pricing.tsx](file:///d:/saas%20store%20ali/src/components/public-pricing.tsx), [marketing.tsx](file:///d:/saas%20store%20ali/src/components/marketing.tsx) | Replaced customer-facing payment request/proof upload form in contact mode with `WhatsAppSubscriptionCard` (`"تواصل معنا لتفعيل الاشتراك"`, `"تجديد الاشتراك عبر واتساب"`), displayed 3-day trial status and manual activation history, and kept public pricing strictly limited to `Monthly` and `Yearly`. |
| **Super Admin Activation & SMTP UI** | [platform/[section]/page.tsx](file:///d:/saas%20store%20ali/src/app/%5Blocale%5D/platform/%5Bsection%5D/page.tsx), [platform-forms.tsx](file:///d:/saas%20store%20ali/src/components/platform-forms.tsx), [platform-copy.ts](file:///d:/saas%20store%20ali/src/lib/platform-copy.ts) | Added `"الاشتراكات والتفعيل"` (`ManualSubscriptionForm`) for email search, exact account match, single-store selection, `Starter`/`Pro` & `1/3/6/12`-month activation, date preview, and dual-admin confirmation; added `"إعدادات التواصل والإشعارات"` (`SmtpSettingsForm`, WhatsApp settings, template catalog, and queue health). |
| **Documentation & Tests** | [docs/smtp-deliverability.md](file:///d:/saas%20store%20ali/docs/smtp-deliverability.md), [platform-contact.test.ts](file:///d:/saas%20store%20ali/tests/unit/platform-contact.test.ts), [billing.test.ts](file:///d:/saas%20store%20ali/tests/integration/billing.test.ts), [platform.test.ts](file:///d:/saas%20store%20ali/tests/integration/platform.test.ts), [billing.test.mjs](file:///d:/saas%20store%20ali/tests/e2e/billing.test.mjs) | Added SPF/DKIM/DMARC deliverability guide and unit, PostgreSQL integration, and Playwright E2E coverage. |

---

## 3. Database Migrations (`0025` & `0026`) & Non-Destructive Guarantees

- **[0025_contact_subscription_tables.sql](file:///d:/saas%20store%20ali/drizzle/0025_contact_subscription_tables.sql)**:
  - Creates `public.platform_account_trials` (`user_id` PK, `starts_at`, `ends_at`).
  - Creates `public.platform_contact` singleton (`id = 1`, `enabled = true`, `whatsapp = '972567508786'`).
  - Creates `public.platform_mail` singleton (`id = 1`, `config` JSONB, `cipher` bytea, `revision`, `enabled`, `verified_at`, `changed_at`).
  - Creates `public.platform_manual_terms` (`id` PK, `store_id`, `plan_id`, `months` in `(1, 3, 6, 12)`, `amount_minor`, `currency`, `reference` unique, `note`, `actor`, `approved_by`, `created_at`, `starts_at`, `ends_at`).
  - Expands `ops_notifications_kind` check constraint to include `'trial_started'`, `'subscription_active'`, and `'subscription_expired'`.
- **[0026_contact_subscription_access.sql](file:///d:/saas%20store%20ali/drizzle/0026_contact_subscription_access.sql)**:
  - Adds GiST exclusion constraint `platform_manual_terms_no_overlap` preventing overlapping active manual terms on the same store.
  - Updates `billing_config.trial_days` to `3` while preserving all existing rows in `billing_trials`, `billing_periods`, `billing_requests`, `billing_proofs`, `billing_reviews`, and `billing_audit`.
  - No destructive `DROP TABLE`, `TRUNCATE`, or data deletion is performed.

---

## 4. Three-Day Free Trial (72 Hours) Architecture & Transition Policy

- **Server-Authoritative 72-Hour Window**:
  - Trigger `platform_account_trial_begin` fires `AFTER INSERT ON public.users` and records `starts_at = NEW.created_at, ends_at = NEW.created_at + interval '72 hours'` in `public.platform_account_trials`.
- **Account-Level Eligibility & First-Store Attachment**:
  - Trigger `platform_trial_attach` fires `AFTER INSERT ON public.store_memberships` for `role = 'owner'`.
  - It attaches the trial to the merchant's **first** owned store only (`NOT EXISTS (SELECT 1 FROM public.billing_trials WHERE user_id = NEW.user_id)` and no other owned store).
  - Creating a second store or signing in again never resets or extends `platform_account_trials.ends_at` and never grants a second trial.
- **Transition Policy**:
  - Existing accounts and historical `billing_trials` rows are backfilled into `platform_account_trials` with `ON CONFLICT DO NOTHING` so already-granted trials are never retroactively shortened and paid subscriptions remain untouched.
- **Expiration Behavior**:
  - When the 72-hour trial expires, `billing_state(p_store)` transitions to `'expired'` immediately (even before the background worker runs). All products, categories, media, and published theme designs are preserved, while unpaid storefront order handoffs are blocked by `billing_entitlements`.

---

## 5. WhatsApp External Subscription Flow (`+972567508786`)

- **Separation of Flows**:
  - **Customer Storefront Orders**: Customers shopping at merchant stores continue to add products to their cart and send their order via the merchant's WhatsApp or Instagram channel without any platform payment gateway or commission.
  - **Merchant WAJHATI Subscriptions**: Merchants subscribe to WAJHATI externally by contacting official WAJHATI support on WhatsApp (`+972567508786`, stored normalized as `'972567508786'` in `public.platform_contact` and configurable by the Platform Owner in `/platform/settings`).
- **Merchant Billing UI**:
  - Displays clear bilingual CTAs: `"تواصل معنا لتفعيل الاشتراك"` (`Contact us to activate subscription`) and `"تجديد الاشتراك عبر واتساب"` (`Renew subscription via WhatsApp`).
  - The prefilled WhatsApp message includes the merchant's account email, store name, selected `Starter` or `Pro` plan, and selected `Monthly` or `Yearly` billing option — never passwords, tokens, or secrets.
  - Opening WhatsApp never activates a subscription; only an authorized platform administrator with fresh MFA can activate a store subscription.

---

## 6. Per-Store Subscriptions & Super Admin Activation (`1, 3, 6, 12` Months)

- **Strict Per-Store Scoping**:
  - Each subscription activation in `public.platform_manual_grant` requires both the merchant `user_id` (`p_user`) and target `store_id` (`p_store`), verifies ownership, and activates **only** the selected store. Other stores under the same merchant email are never activated.
- **Supported Durations**:
  - Super Admin supports `1`, `3`, `6`, and `12` UTC calendar months for both `Starter` and `Pro`.
  - Public marketing pages (`/pricing` and home page `#pricing`) continue to display **only** `Monthly` and `Yearly` billing options.
- **Activation & Renewal Date Rules**:
  - **During Free Trial or After Expiry**: Paid period starts immediately (`now()`).
  - **Active Paid Subscription**: Renewal appends to the end of the store's current active paid expiration (`greatest(now(), max(ends_at))`), preserving every second of remaining paid time.
  - **Calendar-Month Calculation**: Uses UTC calendar months (`((begins AT TIME ZONE 'UTC') + make_interval(months => term.months)) AT TIME ZONE 'UTC'`) with month-end clamping (e.g., Jan 31 + 1 month -> Feb 28/29).
- **Financial Audit & Dual Control**:
  - Every activation records the merchant account, target store, plan (`starter`/`pro`), duration (`1/3/6/12`), effective `starts_at`/`ends_at`, received `amount_minor`, `currency`, transfer `reference`, administrative `note`, and admin `actor` in `platform_manual_terms`, `billing_audit`, and tamper-evident hash-chained `platform_events`.
  - If `amount_minor` meets or exceeds `platform_policy.dual_thresholds` for the selected currency, the record is saved in pending state (`ends_at IS NULL`) until a second independent administrator confirms it via `platform_manual_confirm`.

---

## 7. Central Platform SMTP & Security Architecture

- **Owner-Only Access**:
  - Viewing or saving SMTP settings (`platform_mail_view`, `platform_mail_save`, `platform_mail_tested`) requires the `owner` role with a verified MFA session (`platform_actor(p_token, 'owner', true)` for mutations).
- **Encryption at Rest & Write-Only Password**:
  - `sealSmtpPassword` encrypts the SMTP password using **AES-256-GCM** with `SMTP_CONFIG_KEY` (32-byte hex key) and AAD `"wajhati/smtp/v1"`.
  - `platform_mail_view` returns only `{ config, enabled, verifiedAt, changedAt, revision, hasPassword }` — the encrypted cipher and plaintext password are never returned to the browser.
- **SSRF & Transport Hardening**:
  - `publicSmtpAddress` blocks loopback, RFC 1918 private networks, link-local (`169.254.0.0/16`, `fe80::/10`), CGNAT, multicast, and non-global IPv6 addresses.
  - `smtpTransport` resolves DNS once, validates every returned IP, pins the resolved IP on the Nodemailer connection, enforces TLS 1.2+ with `servername` certificate verification (`465` implicit SSL/TLS or `587` STARTTLS), and disables file/URL access.

---

## 8. Platform-Wide Transactional Email System & Notification Worker

- **Immediate Identity & Security Emails** (`deliverIdentityMail` in [mail.ts](file:///d:/saas%20store%20ali/src/server/auth/mail.ts)):
  - `signup`, `verify`, `reset`, `change_old`, `change_new`.
- **Queued Operational & Subscription Emails** (`sendOperationsMail` in [mail.ts](file:///d:/saas%20store%20ali/src/server/auth/mail.ts) + `npm run ops:notifications` in [catalog-cleanup.ts](file:///d:/saas%20store%20ali/scripts/catalog-cleanup.ts)):
  - `trial_started`: Sent when the 3-day account trial attaches to the merchant's first store.
  - `billing_due`: Sent when a trial or paid subscription is within 72 hours of expiration.
  - `subscription_active`: Sent when a store subscription is activated or renewed.
  - `subscription_expired`: Sent when a trial or paid subscription expires, confirming all products and designs are preserved and providing the official WhatsApp renewal link.
  - `review_pending`: Sent to authorized platform reviewers when a financial record awaits review.

---

## 9. Communication & Notification Settings (`إعدادات التواصل والإشعارات`)

In `/[locale]/platform/settings`, the Super Admin console now includes:
- **Section A — Official WAJHATI Subscription WhatsApp**: Configure the international WhatsApp phone number (`+972567508786`) and toggle WhatsApp contact mode.
- **Section B — Central Platform SMTP Settings (Owner Only)**: Configure SMTP host, port & encryption mode (`587 — STARTTLS` or `465 — SSL/TLS`), username, write-only encrypted password, From email, From display name, Reply-To email, enable/disable toggle, and **Send SMTP Test Email** with verification status badge.
- **Section C & D — Platform Transactional Email Catalog & Notification Rules**: Displays all 9 bilingual transactional email templates, triggers, and subjects.
- **Section E — Email Delivery Queue & Troubleshooting**: Displays live counters (`Pending`, `Delivered`, `Failed`) and recent `ops_notifications` delivery records.

---

## 10. Deliverability Guide (SPF, DKIM, DMARC)

Full operational documentation has been written to [docs/smtp-deliverability.md](file:///d:/saas%20store%20ali/docs/smtp-deliverability.md), covering:
- SPF `TXT` record configuration (`v=spf1 include:... -all`)
- 2048-bit RSA DKIM selector setup and `From` domain alignment
- DMARC policy progression (`p=quarantine` -> `p=reject`)
- `SMTP_CONFIG_KEY` generation and rotation procedures

---

## 11. Verification & Automated Test Results

- **`npm run local:check`**: Passed (`PostgreSQL 55432 (dar_local, restricted role), S3 4569 (dar-market-local)`).
- **`npm run lint`**: Passed (`0` errors, `0` warnings).
- **`npm run typecheck`**: Passed (`next typegen && tsc --noEmit` — `0` errors).
- **`npm test` (Unit Tests)**: Passed (`34 / 34` unit tests passing, including [platform-contact.test.ts](file:///d:/saas%20store%20ali/tests/unit/platform-contact.test.ts)).
- **`npm run build` (Production Build)**: Passed (`28 / 28` static pages generated, all dynamic routes compiled cleanly).
- **`npm run test:db` (PostgreSQL Integration Tests)**: Passed (`48 / 48` subtests passing across `billing.test.ts`, `platform.test.ts`, `catalog.test.ts`, `operations.test.ts`, `orders.test.ts`, `postgres.test.ts`, and `theme.test.ts`).
- **`npm run test:e2e` (Playwright Browser Suite)**: Passed (`18 / 18` E2E tests passing across mobile and desktop in Arabic RTL and English LTR, including [billing.test.mjs](file:///d:/saas%20store%20ali/tests/e2e/billing.test.mjs)).
- **`npm run local:verify` (Full End-to-End Verification Pipeline)**: Passed with `exit code 0`:
  - `media:cleanup`: `{"completed":2,"retry":0}`
  - `orders:cleanup`: `{"removed":0}`
  - `ops:notifications`: `{"enqueued":0,"sent":0,"retry":0,"terminal":0,"skipped":12}`
  - `ops:maintenance`: `{"removed":0,"abandoned":0,"audit_mismatch":0}`
  - `billing:expire`: `{"proofs":0,"requests":0,"subscriptions":2}`
  - `scripts/ops/load.mjs`: `{"event":"local_load","tenants":2,"concurrency":8,"requests":96,"errors":0,"p50Ms":368,"p95Ms":803,"p99Ms":895}`
  - `scripts/ops/rehearse-backup.mjs`: `{"event":"restore_complete","migrations":27,"stores":1}` & `{"event":"restore_rehearsal_passed","tamperRejected":true,"nonEmptyTargetRejected":true}`
- **Captured Verification Screenshots**:
  - [whatsapp-billing-merchant-ar-mobile.png](file:///d:/saas%20store%20ali/.dar-local/screenshots/whatsapp-billing-merchant-ar-mobile.png)
  - [platform-activation-ar-desktop.png](file:///d:/saas%20store%20ali/.dar-local/screenshots/platform-activation-ar-desktop.png)
  - [platform-settings-smtp-ar-desktop.png](file:///d:/saas%20store%20ali/.dar-local/screenshots/platform-settings-smtp-ar-desktop.png)
  - [billing-merchant-rtl-mobile.png](file:///d:/saas%20store%20ali/.dar-local/screenshots/billing-merchant-rtl-mobile.png)
  - [billing-review-ltr-desktop.png](file:///d:/saas%20store%20ali/.dar-local/screenshots/billing-review-ltr-desktop.png)
  - [billing-merchant-ltr-mobile.png](file:///d:/saas%20store%20ali/.dar-local/screenshots/billing-merchant-ltr-mobile.png)

---

## 12. Remaining Manual Steps for Production Launch

1. **Generate Production `SMTP_CONFIG_KEY`**:
   - Generate a 64-character hex key (`openssl rand -hex 32`) and set `SMTP_CONFIG_KEY` in the production environment secrets.
2. **Publish DNS Records (SPF, DKIM, DMARC)**:
   - Follow [docs/smtp-deliverability.md](file:///d:/saas%20store%20ali/docs/smtp-deliverability.md) to publish SPF, DKIM, and DMARC records for your production sending domain.
3. **Configure Live SMTP Credentials in Super Admin**:
   - Sign in as Platform Owner, complete MFA verification at `/ar/platform/mfa`, open `/ar/platform/settings`, enter your production SMTP host, port (`587` STARTTLS or `465` SSL/TLS), username, password, From email, and From display name (`واجهتي | WAJHATI`), save, and click **إرسال بريد اختباري** (`Send test email`) to verify end-to-end delivery.
4. **Verify Official WhatsApp Number**:
   - Confirm `+972567508786` is active in `/ar/platform/settings` under **رقم واتساب الرسمي لاشتراكات واجهتي**.

