# WAJHATI — final release checklist

Everything here needs production or staging access, a secret, a domain or owner content, so none of it was done in the local audit. Tick each box with evidence (a log line, a screenshot, a header dump), not a belief. Never paste secret values into tickets or chat.

## 0. Before anything else

- [ ] Review the diff on branch `audit/final-readiness` (`git log --oneline pre-final-audit-snapshot..HEAD` once committed) and merge by your own process. Nothing was pushed or merged by the audit.
- [ ] Re-run the gate on the exact commit you will deploy: `npm run local:verify` (needs PostgreSQL 18 binaries locally or `DAR_PG_BIN`). It must exit 0.
- [ ] Keep `PUBLIC_SIGNUP_ENABLED=false` unless you decide to open registration. Opening it is a business decision; it was left off.

## 1. Legal and content (blocker BLK-06)

Status after the infrastructure pass: **draft pages exist** at `/ar|en/privacy` and `/ar|en/terms`, linked from the marketing footer, sign-in and sign-up, store onboarding, the merchant workspace footer and the billing card. They are marked as drafts and are not approved.

- [ ] Fill every open item in `docs/legal/LEGAL_OWNER_REVIEW.md` (20 items: operator identity, address, governing law, refund policy, retention periods, hosting region, providers and so on) by editing `src/lib/legal.ts`.
- [ ] Counsel reviews both languages and signs the table at the end of that document.
- [ ] Bump `legalVersion` and `legalUpdated` in `src/lib/legal.ts`.
- [ ] Set `LEGAL_APPROVED=true` in the **production** secret store. Until then production refuses to start (`validate-env`), the pages show the draft banner, are `noindex` and are left out of the sitemap. Staging may leave it unset.
- [ ] Decide whether sign-up needs a stored, versioned acceptance (a checkbox plus a small migration). Today it is an acknowledgement line with links and nothing is recorded.
- [ ] Optional: a brand `og:image` for marketing pages.

## 2. Secrets and environment (BLK-03)

- [ ] `DAR_ENV=production`, `APP_ORIGIN=https://<your-domain>` (HTTPS, not loopback). `scripts/ops/validate-env.mjs` rejects bad combinations; run it against the real environment file.
- [ ] Generate dedicated keys in your secret store, one per secret, never reused across environments:

```bash
openssl rand -hex 32   # SMTP_CONFIG_KEY (64 hex chars)
openssl rand -hex 32   # PLATFORM_MFA_KEY
openssl rand -hex 32   # PAYMENT_PROOF_KEY (or the keyring variables)
```

- [ ] Database roles use the three restricted logins; `MIGRATION_DATABASE_URL` is given only to the migration step, never to the running app.
- [ ] `TRUSTED_CLIENT_IP_HEADER` is set only if your proxy overwrites it with a single trusted client IP (compose sets `x-real-ip`).
- [ ] Staging uses different keys and a different database from production.

## 3. Email (BLK-01, BLK-02)

- [ ] Mailboxes and DNS are at **Hostinger** (verified 2026-11-18). Confirm `support@wajhati.store` exists, then enter `smtp.hostinger.com`, port 587 (or 465), the full address as username, and the mailbox password in `/ar/platform/settings` as the platform owner with fresh MFA. Details and evidence: `docs/operations/EMAIL_DNS_VERIFICATION.md`.
- [ ] **Run the mailer.** Queued notifications (trial, due, activated, expired, review) are sent by the separate `mailer` process, which holds `SMTP_CONFIG_KEY` and its own database login `dar_mailer` (migration `0027`). Create the role in the bootstrap, give the mailer `infra/env/mailer.env.example`-style variables, and confirm its health check passes. The same `SMTP_CONFIG_KEY` value goes to the app and the mailer. Resend is optional.
- [ ] Press the test-send button; confirm `verified_at` is set and the message arrives in an external inbox.
- [ ] SPF, DKIM (selector `hostingermail-a`) and a monitoring-only DMARC record **already exist** in Hostinger DNS. What is missing is proof: in a Gmail message source confirm `spf=pass; dkim=pass` with `d=wajhati.store` and `dmarc=pass`, then add a real `rua` mailbox to DMARC. Keep `p=none` for at least two weeks before tightening.
- [ ] Trigger one real signup verification, one password reset and one trial-started email end to end.
- [ ] Watch the notification queue on the settings page for a day: pending should drain, failed should be 0.

## 4. WhatsApp support (BLK-04)

- [ ] The official number `+972567508786` is monitored by named staff during business hours.
- [ ] Staff have walked through `/platform/subscriptions` activation (per-store, 1/3/6/12 months, dual approval above the threshold, MFA step-up) on staging with a test store.
- [ ] A written response-time promise exists for merchants.

## 4b. Hosting (not yet chosen)

- [ ] `wajhati.store` is currently a **Hostinger parked domain**. Choose the application host first; nothing else in sections 2, 5 and 7 can be verified without it.
- [ ] Decide the staging name (`staging.wajhati.store`) and add it in Hostinger DNS only with owner approval (the zone also carries live mail records). See `docs/operations/STAGING_DEPLOYMENT_REPORT.md`.
- [ ] Dokploy staging: use `infra/dokploy/compose.staging.yaml` and follow `infra/dokploy/README.md` (prepared and validated offline, not deployed). Confirm Traefik overwrites a client-supplied `X-Real-Ip`.

## 5. Deployment checks

- [ ] HTTPS certificate valid; HTTP redirects to HTTPS.
- [ ] Response headers include HSTS, `X-Content-Type-Options`, `X-Frame-Options`, `Permissions-Policy`:

```bash
curl -sI https://<your-domain>/ar | grep -iE "strict-transport|x-frame|x-content-type|permissions-policy|content-security"
```

- [ ] `/api/metrics` is not reachable from the internet (the bundled Caddyfile returns 404; on Dokploy/Traefik confirm the equivalent).
- [ ] `/api/health` returns 200 and `/api/ready` returns 200 only when database, storage and renderer are up.
- [ ] Scheduler worker is running with its health check passing; confirm `ops:notifications` (every 5 min), `billing:expire`, `media:cleanup`, `orders:cleanup` and `ops:maintenance` all appear in the job table and the maintenance job reports `abandoned: 0`.
- [ ] Resource limits from `compose.yaml` fit the host.

## 6. Indexing

- [ ] Production: `curl https://<your-domain>/robots.txt` shows the allow rules and a `Sitemap:` line; `curl https://<your-domain>/sitemap.xml` lists 8 URLs.
- [ ] Staging: `curl https://<staging-host>/robots.txt` shows `Disallow: /`. Also put staging behind authentication or an IP allow-list, because robots.txt is advisory.
- [ ] Submit the sitemap in Search Console after launch.

## 7. Backups and recovery (BLK-05)

Measured so far, locally only: a backup of the verification database (real browser-journey data) restored into a fresh database with every table's row count, RLS, policy, index and function count matching. See `docs/operations/DISASTER_RECOVERY_REPORT.md`.


- [ ] Enable the systemd backup timer (`infra/systemd`) with its encryption key stored separately from the backups.
- [ ] Restore the latest real backup into an empty database and bucket on staging using `npm run ops:restore`; check store, product and order counts match. The local rehearsal used a fixture, not your data.
- [ ] Off-server copy of backups exists and its key is recoverable by a second person.
- [ ] **Media, keys and configuration are now covered by the tooling; switch them on.** Set `BACKUP_SOURCE_BUCKET` and a read-only credential so `backup.mjs all` also backs up media and a configuration manifest. Seal the keys once and after every rotation: `node scripts/ops/key-escrow.mjs seal --out <file> --upload`, with the passphrase (24+ characters) held by two people elsewhere, then `verify` after any key change. Enable versioning and a lifecycle on the backup bucket.
- [ ] **Alerts for a backup that never runs:** enable `dar-backup-check.timer` (hourly `backup.mjs check`, alerts when the newest manifest is older than `BACKUP_MAX_AGE_HOURS`, default 26) and set `DAR_ALERT_WEBHOOK`; also set `DAR_HEARTBEAT_URL` to an external dead-man monitor so alerts continue even if the host is down.
- [ ] Decide and document the rollback: previous image tag, and the rule that migrations are forward-only and additive.

## 8. Quality still owed (not done in the audit)

- [ ] Lighthouse or field data for Core Web Vitals on the home page, a pricing page and one storefront on a mid-range phone profile; set budgets from the result.
- [ ] Keyboard-only and screen-reader pass on sign-in, the designer, checkout and platform activation, including dialog focus return.
- [ ] 200% zoom and long Arabic/English content check on the dashboard.
- [ ] Compare the remaining 35 Figma frames with renders (`docs/wajhati-storefront-families.md` lists the node ids).
- [ ] Consider a nonce-based `script-src` CSP.

## 9. Go / no-go

- [ ] Sections 1–7 complete with evidence.
- [ ] Rollback rehearsed.
- [ ] Owner sign-off recorded.
