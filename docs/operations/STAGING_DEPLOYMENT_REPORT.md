# Staging deployment report

Date: 2026-11-18 · Revision: branch `audit/final-readiness`, base `b055dd1` (working-tree changes for this pass are described in `LAUNCH_INFRASTRUCTURE_FINAL_REPORT.md`).

**Status: no online staging exists and none could be created from this session. Online staging deployment is BLOCKED.** A Dokploy-compatible staging configuration for `staging.wajhati.store` is now **prepared and validated offline** in `infra/dokploy/` (compose file, role bootstrap, step-by-step README). It has not been deployed and the DNS record does not exist. Every automated journey was run against a production build locally; that is local evidence, not a staging result, and is labelled that way throughout.

## 1. Why online staging is blocked

| Needed | Finding |
| --- | --- |
| A host to deploy to | None identified. `wajhati.store` is a Hostinger parked domain (apex `A 2.57.91.91` serves "Parked Domain name on Hostinger DNS system"). Nothing in the repository, DNS or this session's tools names a VPS |
| A deployment platform | Recent commits mention Dokploy and Traefik, but no Dokploy instance, API token or SSH access is available here. Installing a second platform without need is explicitly out of scope |
| A staging name | `staging.wajhati.store` does not exist in DNS. Creating it needs Hostinger DNS write access (not available) and the host's IP (unknown) |
| Git access for a branch deploy | A push to `origin` (`github.com/d11fy/WAJHATI-`) would be needed to deploy from Git. Pushing was not authorised, and nothing was pushed |

I did not work around any of these.

## 2. What the repository already provides for staging

- **Isolation enforced in code.** `scripts/ops/validate-env.mjs` rejects a deployed environment unless: the database name is `dar_<environment>` (so staging cannot be pointed at `dar_production`); the media bucket starts with `dar-staging-media-` and the backup bucket with `dar-staging-backup-` and differs from the media bucket; the app and identity database logins are different roles with different passwords; the proof keyring does not reuse the MFA key; `APP_ORIGIN` is HTTPS, with no credentials, path or query; `TRUSTED_CLIENT_IP_HEADER=x-real-ip`; `PUBLIC_SIGNUP_ENABLED=false`; the PDF renderer socket is the private Unix socket; metrics need their own token. `scripts/ops/dokploy-bootstrap.mjs` runs this validator before starting the app in staging and production and exits on failure.
- **Local staging stack.** `npm run ops:staging-env` generates `.ops/staging/*` (random secrets, loopback origin). `compose.yaml` plus `infra/compose.staging.yaml` build app, pdf, worker, proxy, db and stage-s3 with read-only root filesystems, dropped capabilities, `no-new-privileges`, memory/CPU/pid limits and log rotation, with the database and renderer on private networks. CI (`.github/workflows/ci.yml`) builds those images and runs `scripts/ops/staging-smoke.sh` on every push. I could not run that Docker path here (no Docker on this machine); the same checks are exercised natively by `npm run local:staging-smoke`.
- **No indexing.** In this pass `robots.txt` is generated per request and returns `Disallow: /` for any `DAR_ENV` other than `production` over HTTPS, and legal pages carry `noindex` until approved (see the audit report). Robots is advisory, so staging must **also** be access-controlled (section 5).
- **Production safety gate.** `LEGAL_APPROVED` is required only for `DAR_ENV=production`; staging may leave it `false`.
- **Migrations.** 27 forward-only SQL migrations (`0000`–`0026`), journal consistent (`drizzle-kit check`: "Everything's fine"). A scan found no `DROP TABLE`, `TRUNCATE`, `DROP COLUMN` or `DROP SCHEMA`. The only drops are one `DROP DEFAULT` (`0002`) and one drop-and-recreate of a check constraint (`0025`, widening the allowed notification kinds). Functions are replaced with `CREATE OR REPLACE`. Existing data is preserved. Fresh-database application of all 27 is exercised on every `local:verify` run and by the backup rehearsal.

## 3. Facts the owner needs to know before building staging

1. **Deployed environments cannot self-register.** `validate-env` forces `PUBLIC_SIGNUP_ENABLED=false` for staging and production. Test accounts must be provisioned with the operator tools (`platform-operator.ts`, `billing-operator.ts`), as the README describes. This also means the sign-up email cannot be exercised end to end on a deployed staging unless the owner relaxes that rule, which was not done.
2. **Mail needs one provider, not two.** The earlier requirement for Resend in every deployed environment is gone: a deployed environment now needs the owner-managed SMTP (`SMTP_CONFIG_KEY`) **or** Resend. Queued notifications go through the new mail delivery process. In staging, `MAIL_ALLOWED_RECIPIENTS` is **required** and restricts every send to your test inboxes.
3. **The bundled `compose.yaml` proxy is Caddy**; Dokploy's edge is Traefik. The Dokploy stack therefore has its own file, `infra/dokploy/compose.staging.yaml`, without Caddy. Traefik labels, the certificate resolver name and `X-Real-Ip` handling are Dokploy conventions that could not be tested here (marked **verify** in `infra/dokploy/README.md`).
4. **The `Dockerfile` default target (`app`) runs `dokploy-bootstrap.mjs`.** For `DAR_ENV=development` it auto-provisions roles in whatever database `DATABASE_URL` points to. The staging compose pins `DAR_ENV=staging`, which skips that path and runs the strict validator instead. Never create a Dokploy "Application" from the Dockerfile for staging.
5. **Staging needs a real S3-compatible HTTPS bucket.** The `stage-s3` emulator is only valid for loopback fixtures (`DAR_STAGING_LOCAL`).

## 4. What is prepared (offline, not deployed)

| Item | Where | Evidence |
| --- | --- | --- |
| Dokploy compose for `staging.wajhati.store` | `infra/dokploy/compose.staging.yaml` | Parsed in a unit test; each service's environment is built from fixtures and passed through the real validator (`app`, `worker`, `mailer`, `backup` all pass); missing secrets stop the deployment; each process holds only its own credentials; only the app joins the Traefik network; no published ports; basic auth, noindex header, HTTPS redirect and the staging host verified in the labels; no literal secret; uniform hardening |
| Role bootstrap | `infra/dokploy/bootstrap-staging.sql` | Run for real on a throwaway cluster: refuses short or empty passwords and creates nothing, creates six logins, refuses a second run, then all 28 migrations apply and each login's capabilities are checked (`scripts/ops/rehearse-staging-bootstrap.mjs`, part of `local:verify`) |
| Exact deployment steps, required variables and resources | `infra/dokploy/README.md` | Written; Traefik and Dokploy specifics marked **verify** |
| Isolation of database, storage, sessions, secrets, workers and email destinations | see the README table | Enforced by the validator and the recipient guard, tested |
| Noindex and access control | Traefik basic auth plus `X-Robots-Tag` plus `robots.txt` | Labels tested; the live behaviour needs the host |
| No secrets created or stored | | none in the repository or the reports |

## 5. Staging plan with approval gates

Each gate needs the owner. Nothing below was performed.

| # | Step | Needs | Verify |
| --- | --- | --- | --- |
| 1 | Choose and provision the host (VPS) and, if Dokploy, confirm access to its dashboard | Owner decision, host access | SSH or dashboard login works |
| 2 | Add DNS `A staging.wajhati.store -> <staging IP>` in Hostinger DNS. **Approval needed** because DNS is shared with live mail records. Do not edit MX, SPF, DKIM, `autodiscover` or `www` | Hostinger DNS access | `Resolve-DnsName staging.wajhati.store` from two resolvers |
| 3 | Create separate staging secrets (variables listed in `infra/dokploy/README.md`): seven database passwords, `PLATFORM_MFA_KEY`, proof keyring, `OPS_METRICS_TOKEN`, `SMTP_CONFIG_KEY`, storage credentials, `STAGING_BASIC_AUTH`, `MAIL_ALLOWED_RECIPIENTS`. None shared with production | Secret store | `validate-env` exits 0 with `DAR_ENV=staging` |
| 4 | Bring up the database, run the `bootstrap` profile (`infra/dokploy/bootstrap-staging.sql`, creates all six logins); create buckets `dar-staging-media-*` and `dar-staging-backup-*` | DB and object storage | Roles listed, buckets private |
| 5 | **Take a recoverable backup of the empty staging DB**, then run migrations with the owner role only | Operator | 27 rows in `drizzle.__drizzle_migrations` |
| 6 | Deploy the revision under review. Needs the revision on a branch the host can fetch, which means a **push, which needs explicit authorisation** | Owner approval to push `audit/final-readiness` (or another named branch), never `main` | Image tag equals the commit hash |
| 7 | Protect the site: Traefik `basicAuth` middleware or an IP allow-list on the staging router, plus the app's `noindex` and robots | Host access | Anonymous request returns 401/403; `/robots.txt` shows `Disallow: /` |
| 8 | Provision synthetic test accounts and stores with the operator tools. Never copy production data | Operator | Accounts sign in; store shows the 72-hour trial |
| 9 | Run the smoke journeys from section 6 against the staging origin | Browser | Screenshots and logs saved |
| 10 | Verify background jobs, queue health, backup job, restore into an isolated DB (`DISASTER_RECOVERY_REPORT.md`) | Operator | Job table shows all workers succeeding; `abandoned: 0` |

## 6. Smoke journeys and where they ran

Your requested list, mapped to the automated suites. **All ran locally** against a production build (`next build`, `next start`) on isolated PostgreSQL and S3 emulator. None ran on an online staging.

| Journey | Suite | Local result |
| --- | --- | --- |
| Homepage Arabic and English, responsive | `responsive.test.mjs`, `merchant.test.mjs` | pass |
| Login, logout, registration policy | `registration.test.mjs`, `merchant.test.mjs` | pass |
| Email verification, recovery (local mail sink, not a real inbox) | `tests/integration/platform.test.ts`, identity flows | pass |
| MFA and platform roles | `platform.test.mjs`, `platform.test.ts` | pass |
| First store, 72-hour trial, no reset by a second store | `billing.test.ts` (PostgreSQL) | pass |
| Products, categories, images, variants | `catalog.test.mjs` | pass |
| Theme selection, designer, draft preview, publish, rollback | `theme.test.mjs`, `theme.test.ts` | pass |
| All eight storefront themes | `theme.test.mjs` (Minimal Commerce, Luxury Boutique), `storefront-families.test.mjs` (the six new themes) | pass |
| Cart totals, WhatsApp and Instagram handoff, order intent | `orders.test.mjs`, `orders.test.ts` | pass |
| Merchant billing, admin activation, SMTP settings, audit | `billing.test.mjs`, `platform.test.mjs` | pass |
| Background jobs | workers in `local:verify` | pass |
| Legal pages and entry points | `legal.test.mjs` (new) | pass |

Exact counts are in the final report. Unavailable online tests (secure access, tenant isolation on the real host, no production cross-contamination, real mail) are **not** reported as passed.

## 7. Verdict

Staging: **CONDITIONAL GO** for the codebase (isolated, validated, tested locally) and **BLOCKED** for the environment (no host, no DNS name, no access). The first real task is step 1.
