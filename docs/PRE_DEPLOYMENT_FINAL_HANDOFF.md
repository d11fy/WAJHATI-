# WAJHATI — pre-deployment final handoff

Date: 2026-11-18 · Branch `audit/final-readiness` (local only: nothing pushed, merged or deployed) · Base `b055dd1`.
Companion documents: `docs/operations/PRODUCTION_GO_NO_GO.md` (blocker sheet), `infra/dokploy/README.md` (staging steps), `docs/operations/DISASTER_RECOVERY_REPORT.md`, `docs/operations/EMAIL_DNS_VERIFICATION.md`, `docs/legal/LEGAL_OWNER_REVIEW.md`.

## 0. Where things stand

| Scope | Verdict |
| --- | --- |
| Local codebase | **GO** |
| Staging | **CONDITIONAL GO**: the configuration is prepared and validated offline; no host, DNS name or access exists |
| Production | **NO-GO**: legal approval, a real host, a real send, real DNS authentication proof and a real backup restore are all still open |

`npm run local:verify` exits 0: lint, typecheck, 64 unit tests, 56 PostgreSQL integration tests, production build, 20 browser tests (including a 270-page responsive and accessibility sweep, 0 issues), all workers, a load test, and four isolated rehearsals (database restore, media, completeness, staging bootstrap). Details in section 7.

## 1. Priority 1 — unified SMTP delivery (done, verified locally)

**The gap.** Owner-configured SMTP reached only the app. The notification worker had no access to it (by design: it must not hold the identity login or the SMTP key), so trial, due, activation, renewal and expiry emails could only go through Resend, and every deployed environment was forced to configure Resend.

**The fix: a dedicated mail delivery process with the narrowest credential path.**

```
 owner (MFA) --saves--> platform_mail (AES-256-GCM cipher)   <- only SECURITY DEFINER functions touch this table
                                   |
        +--------------------------+---------------------------+
        | platform_mail_secret()   |   ops_mail_secret()       |
        | granted to: identity     |   granted to: mailer ONLY |
        |   login (dar_identity)   |   returns a row only when |
        v                          v   central SMTP is enabled v
   APP process                 MAILER process (new)
   identity emails             queued notifications (trial, due, activated, expired, review)
   holds SMTP_CONFIG_KEY       holds SMTP_CONFIG_KEY, nothing else of value
```

| Requirement | How it is met | Evidence |
| --- | --- | --- |
| All notification types through owner SMTP | `scripts/catalog-cleanup.ts --notifications` now runs as the mail login; `mailProvider()` selects the owner SMTP when it is enabled and verified | integration test: provider is `null` while enabled-but-unverified, `smtp` once verified; the notification job ran as the new login in the local pipeline |
| Owner-only credential management | unchanged: `platform_mail_save` still needs the owner role plus fresh MFA | existing platform tests still pass |
| No broad worker access | new group role `storefront_mailer` / login `dar_mailer` with **no table access at all**; only these functions: `ops_mail_secret`, `ops_schedule_reminders`, `ops_claim_mail`, `ops_finish_mail`, `platform_contact_public`, and two wrappers that can only start and finish a `notifications` run (`ops_mail_job_start/finish`). The queue functions were **revoked from the media worker** | 7-case integration suite: no select on the SMTP table, accounts, stores, queue, billing; cannot call identity, admin, billing, maintenance or generic job functions; cannot close a `media` run; runtime, identity and media-worker logins cannot read the secret |
| No decrypted password in APIs or logs | `ops_mail_secret()` returns the cipher only; opening happens at send time in two places; nothing logs it | integration: the cipher does not contain the plaintext; unit: no logging call near password, cipher or secret; `platform_mail_view` still returns `hasPassword` only |
| `SMTP_CONFIG_KEY` encryption preserved | untouched (`src/server/auth/smtp.ts`); validator now also rejects reusing the MFA key as the SMTP key | unit |
| Queue, retry, dedupe preserved | `ops_claim_mail` and `ops_finish_mail` unchanged, only their grantee changed | existing claim/retry/ack test moved to the new login and still passes |
| Identity emails unchanged | app path unchanged | existing identity tests pass |
| Arabic and English | templates untouched; all five operational kinds render in both | existing template tests |
| Resend optional | `validate-env`: a deployed app or mailer needs a valid `SMTP_CONFIG_KEY` **or** a complete Resend trio; the worker must hold neither | unit matrix |
| No RLS bypass | the role is `NOBYPASSRLS`, a client-side role check refuses any login that could do more (superuser, bypass, create-role, schema create, or direct read of the SMTP table or users) | integration: the app refuses the owner, media, runtime and identity logins as a mail login |

Related changes: the media worker's environment is now mail-free (`worker.env.example`), a new `infra/env/mailer.env.example`, a `mailer` compose service with its own health check, `scheduler.mjs --mailer`, role provisioning in every bootstrap path (production SQL, staging generator, local harness, dev auto-provisioner), and a latent bug fixed: queued emails always quoted the **default** WhatsApp number because the worker could not read the owner's setting.

**Staging safety for email.** `MAIL_ALLOWED_RECIPIENTS` (addresses or `@domain`) is required in a deployed staging environment and forbidden in production. `src/lib/mail-guard.ts` blocks any other recipient in code, including the owner test send, and counts it as a terminal failure.

**Deploying this** needs the role created before migration `0027` (the migration fails loudly if `storefront_mailer` is missing). For a new cluster the bootstrap SQL does it. Nothing was deployed yet, so no existing database needs repair.

## 2. Priority 2 — backup completeness (done, verified in isolated rehearsals)

| Component | Mechanism | Never plaintext? | Verified |
| --- | --- | --- | --- |
| PostgreSQL | existing encrypted dump; now also writes a manifest last (counts, sha256, key id, restore instructions) | yes | real journey data restored into a fresh database: 50 tables, 16,477 rows, 49 RLS tables, 26 policies, 62 FKs, 96 indexes, 356 functions identical |
| Media and object storage | `backup.mjs media`: incremental, per-object AES-256-GCM into `media/`, never deletes, list-digest manifest; `media-restore` into an empty, confirmed, isolated bucket | yes | 30 objects: ciphertext at rest, second run copies 0, a change copies 1, restore byte for byte, tamper, non-empty target, wrong confirmation and live bucket all refused |
| Application keys | `scripts/ops/key-escrow.mjs`: seals MFA key, proof keyring, SMTP key and backup keyring under a passphrase (scrypt + AES-256-GCM, passphrase from a file or env only, 24+ characters) with `verify` and `open` | yes (sealed) | unit: round trip, wrong passphrase, tampering, no plaintext or base64 of any key in the file |
| Deployment configuration | `backup.mjs config`: hashes of compose, Dockerfile, bootstrap SQL, lock file, migration journal; release id; environment variable **names only** | no values at all | rehearsal asserts no secret value in the manifest |
| Restore metadata and instructions | in every manifest, plus the runbook | n/a | manifest digest equals the artifact |
| Alerts | failure webhook; hourly `backup.mjs check` (timer unit and compose service) alerts and exits non-zero when any manifest kind is older than `BACKUP_MAX_AGE_HOURS` or missing; optional external heartbeat on success | n/a | fresh passes, aged threshold fails, empty backup bucket fails |

The combined entry point is `backup.mjs all` (database, then media, then configuration, then the heartbeat). Residual gaps (no point-in-time recovery, a rename on cutover, incremental media not re-verifying old backup objects, a 25 MiB per-object limit, escrow passphrase custody) are listed in the DR report. **No real external bucket or production data was touched.**

## 3. Priority 3 — legal safety (preserved and hardened)

- The Arabic and English Terms and Privacy pages are unchanged in substance.
- **Placeholder audit:** 12 visible placeholders per Privacy page, 11 per Terms page, 20 distinct items across all four. They render only as highlighted `OWNER REVIEW` / `LEGAL REVIEW` markers (test and browser check). A search of tracked source found no other placeholder text.
- **`LEGAL_APPROVED` stays false and now needs two keys:** approval requires the flag **and** zero unresolved placeholders in the text. Setting the flag early cannot present draft text as approved: the banner, `noindex` and sitemap exclusion all stay. Production still refuses to start without the flag. A test scans every deployable config and confirms none sets it to true; the production template and the staging compose say `false`.
- No legal fact was invented. The 20 open items and their code context are in `docs/legal/LEGAL_OWNER_REVIEW.md`.

## 4. Priority 4 — staging preparation (prepared, not deployed)

`infra/dokploy/` holds a Dokploy-compatible stack for **`staging.wajhati.store`**: `compose.staging.yaml`, `bootstrap-staging.sql` and `README.md` with the exact steps. DNS was **not** changed.

| Requirement | How |
| --- | --- |
| Isolated database | own PostgreSQL container, database `dar_staging`, six restricted logins (validator rejects any other name) |
| Isolated storage | own media and backup buckets with enforced name prefixes; separate app and worker storage credentials |
| Isolated sessions | host-only `__Host-` cookies plus a separate session table |
| Isolated secrets | all through Dokploy variables with `${NAME:?}` guards so a missing secret stops the deployment; each service receives only what it needs |
| Isolated workers | own `worker` and `mailer` containers; project name `wajhati-staging`; own volumes and networks |
| Isolated email destinations | `MAIL_ALLOWED_RECIPIENTS` required; blocked in code otherwise |
| Access-protected | Traefik basic auth first in the middleware chain |
| Noindex | `X-Robots-Tag: noindex, nofollow, noarchive` on every response, plus `robots.txt` and the draft-legal rules |
| Not exposed | no published ports; only the app joins Traefik's network; the database network has no internet route; workers use a project-private egress network |

Validated without Docker: the compose file is parsed and every service's environment passes the real validator in a unit test; the bootstrap SQL and all 28 migrations were applied to a throwaway cluster, a bad password is refused without creating anything, a second run is refused, and each login's capabilities were checked. **Not validated:** actual Dokploy and Traefik behaviour (label names, the `letsencrypt` resolver, `X-Real-Ip` overwrite, how `$` in the basic-auth hash is stored). The README marks each as **verify**.

## 5. Exact staging deployment steps (condensed; full detail in `infra/dokploy/README.md`)

1. **Approvals first.** Choose the host, approve the DNS record `A staging.wajhati.store`, approve pushing a branch.
2. Create the VPS (4 GB RAM, 2 vCPU, 40 GB) with Dokploy; create the two buckets and four credentials; generate every secret fresh (`openssl rand -hex 24 / 32`, `htpasswd -nbB`).
3. Add the DNS record in Hostinger (no change to MX, SPF, DKIM, `autodiscover`, `www`) and wait until it resolves.
4. In Dokploy create a **Compose** service from the repository branch with path `./infra/dokploy/compose.staging.yaml`, and paste the variables.
5. On the server: `up -d db`, then `--profile bootstrap run --rm bootstrap`, then `--profile operator run --rm operator`, then `up -d`.
6. Check access protection (401 without credentials, `X-Robots-Tag` present, `robots.txt` disallows all, HTTP redirects), then check the three Traefik items marked **verify**.
7. Provision the owner and synthetic merchants with the operator tools; enrol MFA.
8. As owner, enter Hostinger SMTP in the platform panel, send a test to an allow-listed inbox, read the `Authentication-Results` header.
9. Run the journeys (all eight themes, publish, restore, cart, WhatsApp and Instagram handoffs, subscription activation, trial and activation emails).
10. Run the first backup, seal the key escrow, restore into a scratch database and bucket, record timings.

## 6. External inputs needed (one consolidated list)

| # | Input | From | Needed for |
| --- | --- | --- | --- |
| 1 | Hosting choice and access (VPS with Dokploy, or another host) | owner | everything online |
| 2 | Approval to push a branch for deployment | owner | any online deployment |
| 3 | Approval to edit Hostinger DNS: add `staging`, later the apex `A`, later `_dmarc` with a real `rua` | owner | staging, mail authentication |
| 4 | S3-compatible HTTPS storage: media and backup buckets, four least-privilege credentials (table in the staging README) | owner / provider | storage, backups |
| 5 | `support@wajhati.store` confirmed to exist; its password typed by the owner into the platform panel; two approved test inboxes | owner | BLK-01, BLK-02 |
| 6 | All staging secrets generated and entered in Dokploy | owner | staging |
| 7 | The 20 legal facts, counsel review, then `LEGAL_APPROVED=true` in the production secret store | owner, counsel | BLK-06 |
| 8 | An escrow passphrase (24+ characters) held offline by two people | owner | key recovery |
| 9 | An external heartbeat monitor URL and an alert webhook (optional but recommended) | owner | backup alerts |
| 10 | Confirmation that the WhatsApp line `+972567508786` is staffed | owner | BLK-04 |
| 11 | Optional: a Resend account if you prefer it to, or alongside, the owner SMTP | owner | optional |

Never send secrets in chat or files: enter them in Dokploy, the platform panel or the secret store.

## 7. Verification

| Gate | Result |
| --- | --- |
| Lint, typecheck, production build | pass |
| Unit tests | **64/64** (adds mail delivery, key escrow, backup environment, staging compose, legal approval tests) |
| PostgreSQL integration | **56/56** (adds the mail-delivery suite and extends the platform and operations suites) |
| Browser E2E | **20/20** (legal journey now also asserts no raw placeholder token; onboarding and workspace link assertions) |
| Responsive and accessibility sweep | 270 page loads, 0 issues |
| Workers | media, orders, **notifications as the mail login (job recorded)**, maintenance (`abandoned: 0`, `audit_mismatch: 0`), billing expiry: all success |
| Load | 96 requests, 0 errors, p50 413 ms, p95 551 ms (local) |
| Database restore rehearsal | real journey data, 50 tables, 16,477 rows, security objects identical; backup 6.1 s and restore 1.4 s for 1.5 MiB (these vary between runs; do not extrapolate) |
| Backup completeness rehearsal | media, manifests, config snapshot, tamper, non-empty target, stale and missing alerts: all pass |
| Staging bootstrap rehearsal | six logins, 28 migrations, capability checks, refusal of bad passwords and a second run: pass |
| Secret scan of the change set | none found (only labelled test fixtures and template placeholders) |

**Not verified:** anything online; Docker image builds and the CI `containers` job (no Docker here; the smoke script now also starts and checks the mailer); a real SMTP send (the local pipeline uses the file sink, so the notification job reports `sent: 0`); Dokploy and Traefik behaviour; a real bucket.

## 8. Changed files

New: `drizzle/0027_mail_delivery_role.sql`, `src/lib/mail-guard.ts`, `scripts/ops/key-escrow.mjs`, `scripts/ops/rehearse-staging-bootstrap.mjs`, `infra/dokploy/*` (3), `infra/env/mailer.env.example`, `infra/systemd/dar-backup-check.*` (2), legal pages and components from the previous pass (`src/lib/legal.ts`, `src/components/legal-*.tsx`, `src/app/[locale]/{privacy,terms}`, `src/app/legal.css`), tests (`tests/unit/{mail-delivery,backup-completeness,staging-compose,legal}.test.ts`, `tests/integration/mail-delivery.test.ts`, `tests/e2e/legal.test.mjs`), and the reports under `docs/legal`, `docs/operations` and this file.

Modified: `drizzle/meta/_journal.json`; `src/server/db/client.ts`, `src/server/platform/contact.ts`, `src/server/auth/mail.ts`, `src/lib/seo.ts`; `scripts/catalog-cleanup.ts`, `scripts/local-env.mjs`, `scripts/ops/{backup,scheduler,validate-env,rehearse-backup,staging-env,dokploy-bootstrap}.mjs|sh`; `compose.yaml`, `Dockerfile`, `infra/bootstrap-production.sql`, `infra/env/{app,worker,backup}.env.example`; page and component links (`auth-page`, `store-wizard`, `workspace-frame`, `marketing`, `billing/forms`, locale layout); tests (`operations`, `platform`, `responsive`, `theme`); `docs/FINAL_RELEASE_CHECKLIST.md`, `docs/smtp-deliverability.md`.

## 9. Things to know before you rely on this

- **Migration `0027` requires the `storefront_mailer` role to exist first.** It fails with a clear message otherwise. All bootstrap paths now create it.
- **The mailer must run as its own container with its own login.** If the notification job is started with the media worker's login it will refuse to run (role check) rather than fall back.
- **Two processes hold `SMTP_CONFIG_KEY`** (app and mailer). Keep them identical and never replace the key once a password is saved.
- **Backups still do not give point-in-time recovery**; the proposed RPO is 24 h and the RTO of 4 h is unmeasured at real size.
- **Escrow is only as safe as its passphrase.** Lose it and the sealed file is useless; store it offline with two people.
- **I made one mistake worth knowing about:** an integration check of mine called `ops_claim_mail(0)` thinking it claimed nothing. The function always claims at least one row, so it leased a real notification. The suite caught it; the test now checks the privilege without executing the function.
