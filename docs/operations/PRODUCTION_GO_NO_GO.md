# Production go / no-go

Date: 2026-11-18 · Updated by the pre-deployment pass (see `docs/PRE_DEPLOYMENT_FINAL_HANDOFF.md`). Base commit `b055dd1`; the later commits on `audit/final-readiness` contain the infrastructure and pre-deployment work.

## Verdict

| Scope | Verdict |
| --- | --- |
| **Local codebase** | **GO** |
| **Staging** | **CONDITIONAL GO** for the code; the environment does not exist yet (no host, no DNS name, no access) |
| **Production** | **NO-GO** |

A passing test suite does not make production ready. Production is NO-GO because six launch blockers are open, none of which can be closed from a developer machine, plus an application host that has not been chosen. The blockers are listed with the status rule: **PASS** only with evidence, **BLOCKED** when it needs access or a decision I do not have, **FAIL** when I tested it and it does not work. Nothing is marked PASS on the strength of mocks or local fixtures.

## Launch blockers

| ID | Blocker | Status | Evidence and what is missing |
| --- | --- | --- | --- |
| BLK-01 | Real SMTP send and verified connection | **BLOCKED** | Proven: `smtp.hostinger.com` is public, the app's SSRF guard accepts it, port 465 completes TLS 1.3 with a valid Sectigo certificate, port 587 offers and completes STARTTLS (verified). Missing: the mailbox password, a deployed app, a test send that sets `verified_at`. A design finding also applies: queued notifications cannot use the owner-panel SMTP (decision D1 below) |
| BLK-02 | SPF, DKIM, DMARC and external inbox checks | **BLOCKED** | Proven: one valid SPF record, DKIM selector `hostingermail-a` publishing a 2048-bit key, DMARC `p=none` with no report address. Missing: a real received message showing `spf=pass`, `dkim=pass` (`d=wajhati.store`) and `dmarc=pass`. Records existing is not authentication passing |
| BLK-03 | Production `SMTP_CONFIG_KEY` provisioned safely | **BLOCKED** | No production host or secret store. No key was created or printed. Existing keys must not be replaced blindly |
| BLK-04 | Platform WhatsApp operationally ready | **BLOCKED** | The number `+972567508786` is wired into the product and shown on the legal pages and subscription card. Whether a trained person answers it cannot be verified from code |
| BLK-05 | Real external backup and restore | **BLOCKED** | Proven locally only: encrypted backup, upload to an S3 emulator, restore of real journey data into a fresh database with 50 tables, 15,631 rows and every security object matching, tamper rejected. Missing: a real off-host bucket, a scheduled real backup, a staging restore with timings. Gaps G1 to G3 (media, keys, never-ran alert) in `DISASTER_RECOVERY_REPORT.md` |
| BLK-06 | Legally reviewed Terms and Privacy Policy | **BLOCKED** | Draft pages exist in Arabic and English, built from what the code does, with 20 owner-review items highlighted and listed in `docs/legal/LEGAL_OWNER_REVIEW.md`. Not reviewed or approved. Production is mechanically prevented from starting until `LEGAL_APPROVED=true` |

Additional blockers found in this pass:

| ID | Blocker | Status | Evidence |
| --- | --- | --- | --- |
| BLK-07 | No application host | **BLOCKED** | `wajhati.store` is a Hostinger parked domain; `/api/health` returns the parking page. No VPS, Dokploy instance or database host is known |
| BLK-08 | Mail provider design for queued notifications | **FIXED IN CODE** (live send still under BLK-01) | A dedicated mail delivery process and database login (migration `0027`) now sends queued notifications through the owner-managed SMTP; Resend is optional. A dedicated integration suite plus extensions to the platform and operations suites cover the role boundaries, the secret function and the provider selection; the notification job ran end to end as the new login in the local pipeline. Not yet proven against a real SMTP server |
| BLK-09 | Backup coverage and monitoring | **FIXED IN CODE** (real bucket still under BLK-05) | Encrypted incremental media backup and restore, passphrase-sealed key escrow, configuration and restore manifests, a freshness check (hourly timer or compose service) and an optional external heartbeat. Proven in an isolated rehearsal: media restores byte for byte, tampering is refused, the stale and missing-backup alerts fire. No real bucket, schedule or sealed escrow exists yet |

## Decisions the owner must make

| # | Decision | Recommendation |
| --- | --- | --- |
| D1 | Queued notification mail | **Decided and implemented as option B in a narrower form**: a dedicated mail delivery login with only the queue and the SMTP secret function, not a widened worker. Resend is optional. Needs your confirmation when you review the migration |
| D2 | Application host and platform | Owner choice. Until then nothing can be deployed or verified online |
| D3 | Legal facts (20 items) and a stored acceptance record on sign-up | Counsel to decide |
| D4 | Whether deployed staging may allow self sign-up for testing (the validator forces it off) | Keep off. Provision test accounts with the operator tools |
| D5 | DMARC report mailbox, then the tightening schedule | Dedicated alias; stay at `p=none` two weeks |

## Single consolidated approval request

To proceed beyond local work I need, in one go:

1. **Choose the host** (D2) and give access through its own console or SSH, not through chat.
2. **Approve a push** of `audit/final-readiness` (or a named branch) so the host can fetch it. I did not push anything.
3. **Approve DNS edits in Hostinger** for exactly: add `A staging`, later change the apex `A`, and later replace `_dmarc`. No MX, SPF, DKIM, `autodiscover` or `www` change is planned. Prepared values are in `EMAIL_DNS_VERIFICATION.md`.
4. **The owner enters the SMTP password** in the platform panel and, separately, supplies two approved test inboxes.
5. **Counsel review** of the legal drafts, then the owner sets `LEGAL_APPROVED=true` in the production secret store.

Never send secrets in chat, files or screenshots. Use the secret store and the platform panel.

## What is verified (codebase)

| Check | Result | Evidence |
| --- | --- | --- |
| `npm run local:verify` | **PASS**, exit 0 | final run log |
| Lint, typecheck | **PASS** | inside `local:verify` |
| Unit tests | **PASS** 64/64 | includes legal, SEO, production-gate, mail delivery, key escrow and staging-compose tests |
| PostgreSQL integration tests | **PASS** 56/56 | isolated database, RLS, roles, the new mail delivery login |
| Production build | **PASS** | inside `local:verify` |
| Browser E2E | **PASS** 20/20 | includes the legal journey and a 270-page responsive and accessibility sweep with 0 issues |
| Workers | **PASS** | media, orders, notifications, maintenance (`abandoned: 0`, `audit_mismatch: 0`), billing expiry |
| Load | **PASS** | 96 requests, 0 errors, p95 574 ms (local, concurrency 8) |
| Backup and restore rehearsals | **PASS** (isolated local fixtures, not production) | database restore of real journey data (16,477 rows, 50 tables, security objects identical), media, manifests, config snapshot, escrow and freshness alerts, plus the Dokploy staging bootstrap on a throwaway cluster |
| Migrations | **PASS** | 28 (new `0027` adds a function and grants only), no destructive statements, `drizzle-kit check` clean |
| Secrets | **PASS** | none created, written or printed; CI runs gitleaks |

## What would flip the verdict

Production moves to CONDITIONAL GO when: a host exists and staging passes the journeys online (BLK-07); a real send and a real received message pass authentication (BLK-01, BLK-02); the keys are provisioned (BLK-03); a real backup restores on staging with timings and G1 to G3 are closed (BLK-05, BLK-09); counsel approves and `LEGAL_APPROVED=true` (BLK-06); the notification provider decision is implemented and tested (BLK-08); and the WhatsApp line is confirmed staffed (BLK-04). Public launch itself remains a separate owner decision.
