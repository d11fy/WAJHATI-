# WAJHATI — final release checklist

Everything here needs production or staging access, a secret, a domain or owner content, so none of it was done in the local audit. Tick each box with evidence (a log line, a screenshot, a header dump), not a belief. Never paste secret values into tickets or chat.

## 0. Before anything else

- [ ] Review the diff on branch `audit/final-readiness` (`git log --oneline pre-final-audit-snapshot..HEAD` once committed) and merge by your own process. Nothing was pushed or merged by the audit.
- [ ] Re-run the gate on the exact commit you will deploy: `npm run local:verify` (needs PostgreSQL 18 binaries locally or `DAR_PG_BIN`). It must exit 0.
- [ ] Keep `PUBLIC_SIGNUP_ENABLED=false` unless you decide to open registration. Opening it is a business decision; it was left off.

## 1. Legal and content (blocker BLK-05)

- [ ] Terms of Service and Privacy Policy written or approved by the owner/counsel, in Arabic and English.
- [ ] Pages added and linked from the marketing footer, sign-up, and the storefront footer if required in your market. The audit did not draft legal text.
- [ ] Add the pages to `marketingPaths` in `src/lib/seo.ts` so they enter the sitemap, and remove them from `noindex` if any.
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

- [ ] Choose an SMTP provider and enter credentials in `/ar/platform/settings` as the platform owner with fresh MFA.
- [ ] Press the test-send button; confirm `verified_at` is set and the message arrives in an external inbox.
- [ ] Publish SPF, a 2048-bit DKIM key and `_dmarc` per `docs/smtp-deliverability.md`. In a Gmail/Outlook message source confirm `spf=pass; dkim=pass; dmarc=pass`.
- [ ] Trigger one real signup verification, one password reset and one trial-started email end to end.
- [ ] Watch the notification queue on the settings page for a day: pending should drain, failed should be 0.

## 4. WhatsApp support (BLK-04)

- [ ] The official number `+972567508786` is monitored by named staff during business hours.
- [ ] Staff have walked through `/platform/subscriptions` activation (per-store, 1/3/6/12 months, dual approval above the threshold, MFA step-up) on staging with a test store.
- [ ] A written response-time promise exists for merchants.

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

## 7. Backups and recovery (BLK-06)

- [ ] Enable the systemd backup timer (`infra/systemd`) with its encryption key stored separately from the backups.
- [ ] Restore the latest real backup into an empty database and bucket on staging using `npm run ops:restore`; check store, product and order counts match. The local rehearsal used a fixture, not your data.
- [ ] Off-server copy of backups exists and its key is recoverable by a second person.
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
