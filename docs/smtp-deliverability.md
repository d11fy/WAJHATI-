# WAJHATI — Central SMTP & Transactional Email Deliverability Guide

This document defines the DNS authentication, transport security, encryption key management, and operational troubleshooting procedures for the central WAJHATI (`واجهتي | WAJHATI`) platform SMTP system.

---

## 1. Architecture & Security Overview

- **Owner-Only Administration**: Central SMTP credentials and settings can only be viewed or modified by a `Platform Owner` (`owner` role) with an active, freshly verified MFA session (`platform_mfa`).
- **Encryption at Rest**: The SMTP password is encrypted at rest in `public.platform_mail.cipher` using **AES-256-GCM** ([src/server/auth/smtp.ts](file:///d:/saas%20store%20ali/src/server/auth/smtp.ts)) keyed by the `SMTP_CONFIG_KEY` environment variable (64-character hex / 32-byte key) with additional authenticated data (`AAD`) bound to `"wajhati/smtp/v1"`.
- **Write-Only UI & API Boundary**: `public.platform_mail_view(p_token)` returns only metadata (`config`, `enabled`, `verifiedAt`, `changedAt`, `revision`, `hasPassword`). The encrypted cipher and plaintext password are **never** returned to the browser or exposed in public APIs.
- **SSRF & DNS Rebinding Protection**: Before opening a connection, `smtpTransport()` resolves `A`/`AAAA` records via `lookup(valid.host, { all: true, verbatim: true })` and `publicSmtpAddress()` rejects loopback (`127.0.0.0/8`, `::1`), private RFC 1918 (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`), link-local (`169.254.0.0/16`, `fe80::/10`), CGNAT (`100.64.0.0/10`), benchmarking, multicast, and unique-local (`fc00::/7`) addresses. The verified IP is pinned on the Nodemailer socket while preserving `servername` for TLS SNI and certificate verification.
- **Transport Modes**:
  - **Port `465` (Implicit SSL/TLS)**: `secure: true`, `tls.minVersion: "TLSv1.2"`, `rejectUnauthorized: true`.
  - **Port `587` (Explicit STARTTLS)**: `secure: false`, `requireTLS: true`, `tls.minVersion: "TLSv1.2"`, `rejectUnauthorized: true`.

---

## 2. DNS Deliverability Records (SPF, DKIM, DMARC)

Before enabling central SMTP sending in production, configure the following DNS records on your sending domain (e.g. `wajhati.ps` or `mail.wajhati.ps`):

### 2.1 SPF (Sender Policy Framework)
Publish a single `TXT` record at the root (`@`) or custom return-path subdomain authorizing your SMTP provider:

```dns
@ IN TXT "v=spf1 include:_spf.your-smtp-provider.example -all"
```

- Replace `include:_spf.your-smtp-provider.example` with your provider's authorized SPF mechanism (for example, `include:amazonses.com`, `include:spf.protection.outlook.com`, or `include:_spf.google.com`).
- Do **not** publish multiple `v=spf1` records on the same hostname.

### 2.2 DKIM (DomainKeys Identified Mail)
Generate a 2048-bit RSA DKIM key pair in your SMTP provider console and publish the selector `TXT` or `CNAME` record:

```dns
wajhati1._domainkey IN TXT "v=DKIM1; k=rsa; p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8A..."
```

- Verify that outgoing messages contain a valid `DKIM-Signature` header whose `d=` tag matches the `From` domain.

### 2.3 DMARC (Domain-based Message Authentication, Reporting & Conformance)
Publish a `_dmarc` `TXT` record enforcing alignment between the `From` header domain and SPF/DKIM:

```dns
_dmarc IN TXT "v=DMARC1; p=quarantine; adkim=s; aspf=r; pct=100; rua=mailto:dmarc-reports@wajhati.example"
```

- Start with `p=quarantine` (or `p=none` during initial warmup) and move to `p=reject` once all legitimate sending sources pass DKIM and SPF alignment.

### 2.4 From & Reply-To Alignment
- The **From Email** (`from`) configured in `/platform/settings` **must** belong to the authenticated domain signed by DKIM and authorized by SPF.
- Set **From Display Name** (`name`) to `واجهتي | WAJHATI` (or `WAJHATI`).
- Set **Reply-To Email** (`replyTo`) to your monitored merchant support inbox if `from` is a `no-reply@` address.

---

## 3. Transactional Email Catalog & Worker Queue

WAJHATI uses two coordinated delivery paths through `src/server/auth/mail.ts`:

1. **Immediate Identity & Security Emails** (`deliverIdentityMail`):
   - `signup`: New account registration confirmation link.
   - `verify`: Account email verification link.
   - `reset`: Single-use password reset link.
   - `change_old` / `change_new`: Dual-confirmation email address change links.
2. **Queued Operational & Subscription Emails** (`public.ops_notifications` processed by `npm run ops:notifications` / `scripts/catalog-cleanup.ts --notifications`):
   - `trial_started`: Sent automatically when a merchant's 3-day (72-hour) account trial is attached to their first store.
   - `billing_due`: Sent when a trial or paid store subscription is within 72 hours of expiration.
   - `subscription_active`: Sent when a store subscription is activated or renewed (including Super Admin `1 / 3 / 6 / 12` month activations).
   - `subscription_expired`: Sent when a trial or paid subscription expires, reassuring the merchant that all products and designs are preserved and providing the official WhatsApp renewal link.
   - `review_pending`: Sent to authorized platform reviewers when a financial record requires review.

---

## 4. Key Management & Troubleshooting

- **Environment Variable**: Set `SMTP_CONFIG_KEY` to a cryptographically random 64-character lowercase hex string (`openssl rand -hex 32`).
- **Rotating `SMTP_CONFIG_KEY`**: If `SMTP_CONFIG_KEY` is rotated, the Platform Owner should sign in to `/platform/settings`, re-enter the SMTP password, save the configuration, and send a test email (`إرسال بريد اختباري` / `Send test email`) to record a new `verifiedAt` timestamp for the updated revision.
- **Inspecting Delivery Status**:
  - Open `/platform/settings` -> `سجل إرسال الإشعارات وحالة التسليم` (`Email Delivery Queue & Troubleshooting`) to inspect `Pending`, `Delivered`, and `Failed` counts and recent notification rows.
  - Failed operational emails are automatically retried with exponential backoff (`attempts < 6`) by `npm run ops:notifications`.

