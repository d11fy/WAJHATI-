# WAJHATI — launch infrastructure final report

> **Superseded in part by [`PRE_DEPLOYMENT_FINAL_HANDOFF.md`](PRE_DEPLOYMENT_FINAL_HANDOFF.md).** The follow-up pass fixed the two architecture gaps found here (queued notifications could not use the owner-managed SMTP; backups omitted media, keys and a staleness alert), prepared the Dokploy staging configuration, and hardened the legal approval gate. Where the two documents differ, the handoff is current.

Date: 2026-11-18. Detail lives in `docs/legal/LEGAL_OWNER_REVIEW.md`, `docs/operations/EMAIL_DNS_VERIFICATION.md`, `STAGING_DEPLOYMENT_REPORT.md`, `DISASTER_RECOVERY_REPORT.md` and `PRODUCTION_GO_NO_GO.md`. This report summarises them. Nothing was pushed, merged, deployed, or changed outside this working tree and the local throwaway test cluster. No DNS record was changed, no credential was used or created, no email was sent.

## 1. Executive summary

The code side of the five deliverables is done and verified. The infrastructure side is mostly blocked, because **the application has no host yet**: `wajhati.store` is a Hostinger parked domain.

| Deliverable | Result |
| --- | --- |
| 1. Terms and Privacy | **Implemented as drafts**, in Arabic and English, built from what the code does, with 20 clearly marked owner-review items. Linked from the footer, sign-in/up, onboarding, workspace and billing. Gated: production will not start until `LEGAL_APPROVED=true`. **Not legally approved** |
| 2. Official email and live SMTP | **Compatibility proven, live send BLOCKED.** Hostinger SMTP is reachable and TLS-verified on 465 and 587; the app already supports it. No password, no deployed app, so no real send. **A design finding**: queued notifications cannot use the owner-panel SMTP |
| 3. SPF, DKIM, DMARC | **Records exist and are well formed; authentication unverified.** No real received message exists to inspect. DMARC has no report address. No DNS write access |
| 4. Hosting and staging | **BLOCKED** (no host, no DNS name, no access). Repository checked and strengthened; plan with approval gates written |
| 5. Backup and recovery | **Rehearsal strengthened and passing locally with real journey data; real external recovery BLOCKED.** Three coverage gaps documented (media, keys, never-ran alert) |

Final automated gate: `npm run local:verify` exit 0.

## 2. Exact Git revision

Branch `audit/final-readiness`, `HEAD` = `b055dd1` ("Final launch-readiness audit…"), base tag `pre-final-audit-snapshot` at `cebd7e1`. This pass's changes are **uncommitted** in the working tree (15 modified files, 148 insertions and 30 deletions, plus new files). `.claude-flow/` is excluded locally via `.git/info/exclude`. Remote `origin` is `github.com/d11fy/WAJHATI-`; no push was made.

## 3. Actual hosting provider

**Unknown. None deployed.** `https://wajhati.store/` answers with Hostinger's parked-domain page through its CDN (`Server: hcdn`); `/api/health` returns that HTML, not the app. Apex `A` is `2.57.91.91` (Hostinger parking). Recent commits mention Dokploy/Traefik, but no instance is reachable from this session.

## 4. Actual DNS provider

**Hostinger** (`aurora.dns-parking.com`, `nebula.dns-parking.com`), confirmed from the authoritative server and 8.8.8.8 and 1.1.1.1. No DNSSEC.

## 5. Actual email provider

**Hostinger Email**: MX `mx1.hostinger.com` (5) and `mx2.hostinger.com` (10), SMTP `smtp.hostinger.com`. Whether a Resend account exists is unknown (the worker needs one, section 8).

## 6. Legal pages created

`/ar/privacy`, `/en/privacy`, `/ar/terms`, `/en/terms` (`src/lib/legal.ts`, `src/components/legal-page.tsx`, `src/app/[locale]/{privacy,terms}/page.tsx`, `src/app/legal.css`). Brand colours, Cairo for Arabic and Poppins for English (the app's existing font setup), tables that stack on phones, table of contents, skip link, canonical and hreflang. Entry points: marketing footer, sign-in, sign-up (acknowledgement line), store onboarding step 2, merchant workspace footer, billing card ("subscription and activation terms" deep link). The eight merchant themes were not changed, so storefront footers carry no platform legal link; counsel may want a merchant-facing template.

Screenshots: `.dar-local/screenshots/legal/` (`privacy` and `terms`, Arabic and English, desktop and mobile; git-ignored) and `.dar-local/screenshots/responsive-sweep/`.

## 7. Missing legal owner decisions

Twenty items, each highlighted on the page and in `docs/legal/LEGAL_OWNER_REVIEW.md`: operator legal name and address, governing law and courts, refund and paid-period cancellation policy (**the platform has no refund function**), warranty and liability limits, minimum age, legal roles under data-protection law, hosting region, storage and email providers, account-deletion procedure (**no self-service deletion or export exists**), audit and backup retention, response times, effect of expiry on a store's public page, payment methods, support hours, uptime, tax, access logs. A unit test fails if any open item is not documented, and another checks the Privacy retention figures against the SQL (90 and 365 days for order intents).

## 8. SMTP configuration status

**Not configured and cannot be from here.** Prepared values for the owner panel: host `smtp.hostinger.com`, port 587 (or 465), username `support@wajhati.store`, From and Reply-To `support@wajhati.store`, sender name `WAJHATI | واجهتي`; the password is entered by the owner. The module supports exactly this, with TLS 1.2+ certificate verification and no insecure fallback, so no change was needed.

**Finding D1 (needs a decision, not changed):** the notification worker is forbidden the identity database credential and has no `SMTP_CONFIG_KEY`, so it cannot read the owner-panel SMTP. Trial, due, activated, expired and review emails can only go via Resend (or the local sink), and deployed validation requires the Resend variables. Recommendation: keep Hostinger SMTP for identity mail and add Resend for the worker (option A). Options in `EMAIL_DNS_VERIFICATION.md` section 5.

## 9. Actual mail sending test results

**None.** No email was sent: no credentials, no deployed app. Read-only TLS probes only (section 11).

## 10. Incoming mailbox test results

**Not tested.** A recipient check against the MX needs port 25, which is blocked from this network (timed out). Mailbox existence is unverified; inbound mail is unverified.

## 11. SPF, DKIM and DMARC

- **SPF:** one record, `v=spf1 include:_spf.mail.hostinger.com ~all`; the include expands to Hostinger and MailChannels relays (about 3 lookups of 10). Valid. Not tested against a received message.
- **DKIM:** CNAMEs `hostingermail-a/b/c._domainkey` to Hostinger; selector `a` publishes a 2048-bit key (TXT length 408); `b` and `c` are empty reserve selectors. Signature on a real message unverified.
- **DMARC:** `v=DMARC1; p=none`, no `rua`. Monitoring only. Alignment unverified. Do not tighten until reports show every sender aligned; Resend, if used, needs its own SPF and DKIM.
- **SMTP transport (read-only):** `smtp.hostinger.com` → `172.65.255.143` (public; the app's SSRF guard accepts it); 465 TLS 1.3, Sectigo chain valid to 2027-01-16, hostname verified; 587 STARTTLS offered and completed, verified. Hostinger's docs and Google's sender guidelines were read; both agree with these findings.

## 12. Staging environment status

None exists. The validator, isolation rules, robots handling and migrations were verified; the deployment plan has ten gated steps (`STAGING_DEPLOYMENT_REPORT.md`). Facts to know: deployed environments cannot self-register (forced off), require Resend variables, and the bundled proxy is Caddy while Dokploy normally uses Traefik.

## 13. HTTPS and security status

Locally: HSTS and Permissions-Policy sent by the app (previous pass), cookies `__Host-` prefixed and Secure in production, preview frames restricted, `robots.txt` per request (`Disallow: /` outside production). Online: not testable. Public site today is the parking page, certificate issued today by Let's Encrypt via Hostinger. Staging access control (basic auth or allow-list) is planned, not built.

## 14. Database isolation results

Enforced in code: database name must be `dar_<environment>`, separate app and identity roles and passwords, separate media and backup buckets per environment, keyring distinct from the MFA key. Tested locally: 48 PostgreSQL integration tests (RLS, restricted roles, cross-tenant denial). Not tested on real infrastructure.

## 15. Background worker results

All pass in the final run: media cleanup, order retention, notifications (local sink), maintenance (`abandoned: 0`, `audit_mismatch: 0`), billing expiry. The verification harness no longer fails on stale fixtures (previous pass). On real infrastructure: not run.

## 16. External backup status

**No external backup exists** (no host, bucket or schedule). The tooling and unit files are ready and not installed anywhere.

## 17. Real restore results

**None on real infrastructure.** Local, from real journey data: restored 50 tables and 15,631 rows into a fresh isolated database; row counts, 49 RLS tables, 26 policies, 62 foreign keys, 96 indexes and 353 functions identical; tampered copy and non-empty target rejected. Not covered: application connection to the restored database, media references.

## 18. RPO and RTO

Proposed 24 h and 4 h (the repository's own targets). **Not achieved or measured at real scale.** Local timings for a 1.5 MiB backup: 0.98 s backup, 1.37 s restore (an earlier run: 2.59 s and 2.96 s). Do not extrapolate.

## 19. Gaps in backup coverage

Media files are not in the database backup; the keys that decrypt MFA seeds, proofs and the SMTP password live elsewhere and need their own protection; a backup that never runs raises no alert; no point-in-time recovery; app cutover onto a restored database needs a rename because the app requires the name `dar_<environment>`. See the DR report.

## 20. Other code changes in this pass

| Change | Why |
| --- | --- |
| `scripts/ops/validate-env.mjs` requires `LEGAL_APPROVED=true` in production; `infra/env/app.env.example` documents it | Prevents the draft legal text reaching production |
| `src/lib/seo.ts`: legal pages enter the sitemap only when approved; draft pages are `noindex` | Proper indexing rules |
| `scripts/ops/rehearse-backup.mjs`: second phase over real journey data with full integrity comparison and timings; role cleanup fixed; stale-role sweep | Stronger restore evidence |
| `tests/unit/legal.test.ts`, `tests/e2e/legal.test.mjs`, sweep extended to the legal pages (now 270 page loads), onboarding and workspace link assertions, production-gate tests | Regression coverage |
| `docs/smtp-deliverability.md`, `docs/FINAL_RELEASE_CHECKLIST.md` | Updated to the real domain, provider and findings |

Two mistakes of mine along the way, both fixed and caught by tests: a bad assertion about where the workspace footer appears, and a cleanup that could not drop a role holding a connect grant. Python edits on Windows had also rewritten some files with CRLF line endings; I normalised them back so the diff shows only real changes.

## 21. Automated test results (final run, exit 0)

| Gate | Result |
| --- | --- |
| Lint, typecheck, production build | pass |
| `npm test` | 47/47 |
| `npm run test:db` | 48/48 |
| `npm run test:e2e` | 20/20 |
| Responsive and accessibility sweep | 270 page loads, 0 issues |
| Workers | all `success: true`, `abandoned: 0`, `audit_mismatch: 0` |
| Load | 96 requests, 0 errors, p50 437 ms, p95 574 ms, p99 796 ms (local) |
| Backup and restore rehearsal | passed, both phases |
| Post-normalisation sanity | lint, typecheck, 47/47 unit re-run, all pass |

`test:db` and `test:e2e` ran sequentially against one database. Not run: any online or staging test, any real email, Docker image builds (no Docker on this machine; CI does them).

## 22. Screenshots and evidence

Local, git-ignored: `.dar-local/screenshots/legal/*`, `.dar-local/screenshots/responsive-sweep/*` and `report.json`, run logs `.dar-local/audit-verify-*.log`. DNS and TLS evidence is quoted in `EMAIL_DNS_VERIFICATION.md`; probe scripts were kept out of the repository.

## 23. Unresolved blockers

BLK-01 to BLK-06 and new BLK-07 to BLK-09, each with status and evidence in `PRODUCTION_GO_NO_GO.md`. (Numbering follows your latest list: BLK-05 is backup and BLK-06 is legal; the earlier audit report numbered those two the other way round.)

## 24. Exact owner actions remaining

1. Decide the host and give access through its console (never chat).
2. Approve pushing a branch for deployment.
3. Approve Hostinger DNS edits: add `staging`, later the apex `A`, later `_dmarc` with a real `rua`.
4. Confirm `support@wajhati.store` exists; send and reply once.
5. Enter the SMTP password in the platform panel; supply two approved test inboxes; read the received headers.
6. Decide D1 (notification mail path) and obtain a Resend key if option A.
7. Provide the 20 legal facts, have counsel review, then set `LEGAL_APPROVED=true`.
8. Provision backup bucket, schedule, key custody and the never-ran alert; run a staging restore.
9. Confirm the WhatsApp line is staffed.

## 25. Final release verdict

| Scope | Verdict |
| --- | --- |
| **Local codebase** | **GO** |
| **Staging** | **CONDITIONAL GO** (code ready; environment missing) |
| **Production** | **NO-GO** |

I stopped before any public launch. A green suite is not production readiness: every open item above is an external fact that has to be done and evidenced, not assumed.
