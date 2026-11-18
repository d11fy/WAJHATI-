# Disaster recovery report

Date: 2026-11-18 · Scope: backup audit, a measured local restore rehearsal, and a recovery runbook.

**Bottom line.** The backup tooling is well designed, and the pre-deployment pass closed the three biggest coverage gaps in code: media files, the application keys, and "a backup that never ran" now have mechanisms, each proven in an isolated local rehearsal. **No real external backup exists to test** (no production or staging host, no off-host bucket, no real data), so BLK-05 (real external backup and restore) stays **BLOCKED**. Local rehearsals prove the mechanism, not your disaster recovery.

## 1. Backup audit

Read from `scripts/ops/backup.mjs`, `scripts/ops/validate-env.mjs`, `infra/systemd/*`, `infra/env/backup.env.example` and `docs/phase6b-operations.md`.

| Property | Finding | Verified how |
| --- | --- | --- |
| Automated | A daily systemd timer (02:30 UTC, `Persistent=true`) runs the `backup` compose profile | Unit files read. **Not installed anywhere**: there is no host |
| Format and encryption | `pg_dump --format=custom` streamed through AES-256-GCM with the header as authenticated data and a trailing tag; key ID plus keyring allow rotation | Code read; rehearsal proves a flipped byte is rejected |
| Off-host | Uploads to an S3-compatible bucket under `postgres/`, then `HEAD`-checks the size; a local `.uploaded` marker is only written after confirmation | Code read; rehearsal uploads to an S3 emulator |
| Credential isolation | Dedicated login: not superuser, `BYPASSRLS`, member of `pg_read_all_data`, default read-only, and **not** a member of any application role. `validate-env` (backup scope) refuses to start if app, identity, worker, MFA or proof secrets are present; the app scope refuses `BACKUP_DATABASE_URL`. The backup bucket must start with `dar-<env>-backup-` and differ from the media bucket | Code read; rehearsal uses such a role |
| Concurrency | Advisory lock stops two backups at once | Code read |
| Restore safety | Only into an **empty** database named `dar_restore_*`, with `RESTORE_CONFIRM` equal to that name, source and target must differ, authentication of the ciphertext happens before any SQL, restore is a single transaction with `--exit-on-error` | Rehearsal proves tamper rejection and non-empty-target rejection |
| Retention | Local spool keeps confirmed copies **7 days** (code). Off-site retention is a bucket lifecycle setting (the runbook recommends 35 days, versioning and immutability). **None of that is codified, and I did not change any retention** | Docs read; no bucket exists |
| Size limits | One upload, 5 GB maximum, 180 s deadline; `pg_dump` watchdog 20 min | Code read. The tool itself says to move to multipart or WAL before nearing them |
| Alerts | A failing run posts `backup_failed` to `DAR_ALERT_WEBHOOK` (HTTPS only) | Code read. See gap G3 |

## 2. Rehearsal: what was measured

`scripts/ops/rehearse-backup.mjs` runs inside `npm run local:verify` against an isolated local PostgreSQL cluster and an S3 emulator. This pass strengthened it with a second phase:

1. **Phase 1 (existing).** Seed one store, back up as the dedicated read-only role, upload, reject a tampered copy, restore into a new empty database, compare a fingerprint of stores, memberships and migrations, then reject a second restore into the now-populated target.
2. **Phase 2 (new).** Back up the **verification database itself**, which holds data written by the real browser journeys (many tenants, orders, billing, themes, notifications), download it from the bucket, decrypt, restore into a fresh isolated database, and compare the two databases table by table.

3. **Phase 3 (added in the pre-deployment pass).** Against the same emulator: 30 generated media objects (five real WebP images) are backed up encrypted; a second run copies nothing; a changed object copies exactly one; the configuration snapshot is checked for file hashes and for the absence of any secret value; the media restores into an empty isolated bucket byte for byte; a tampered backup object, a non-empty target, a wrong confirmation and a live bucket are all refused; the database manifest digest matches the artifact; and the freshness check passes when fresh, fails with an aged threshold, and fails when the backup bucket holds no database manifest. Outcome is recorded as the event `backup_completeness_rehearsal_passed`.

Result of the final run (`EXIT 0`):

| Measure | Value |
| --- | --- |
| Tables compared | 50, row counts identical in all |
| Rows | 15,631 |
| Tables with row-level security | 49 (identical after restore) |
| Policies / indexes / functions | 26 / 96 / 353 (identical) |
| Foreign keys | 62, unvalidated 0 (identical) |
| Migrations | 27 |
| Encrypted backup size | 1,539,701 bytes (about 1.5 MiB) |
| Backup duration | 0.98 s (an earlier run of the same data: 2.59 s) |
| Restore duration | 1.37 s (earlier run: 2.96 s) |
| Tamper rejected / non-empty target rejected | yes / yes |

Not covered by this rehearsal: the application connecting to the restored database and exercising merchant flows (the isolated restore was checked at the database level only), media object references, and anything on real infrastructure. Do not extrapolate these durations. They describe a 1.5 MiB fixture on a laptop with an in-process bucket, and restore time grows with data volume and network speed.

## 3. Coverage after the pre-deployment pass

| Component | What protects it now | Encrypted | Alerts | Proven (local rehearsal) | Still needed for real |
| --- | --- | --- | --- | --- | --- |
| PostgreSQL | `backup.mjs backup`: custom-format dump, AES-256-GCM, off-host upload, manifest written last | yes | failure webhook, freshness check, optional heartbeat | backup, upload, restore of real journey data into a fresh database with every table and security object compared | a real bucket, a schedule, a staging restore with timings |
| Media and object storage | `backup.mjs media`: incremental per-object AES-256-GCM into `media/`, never deletes, manifest with a list digest | yes (per object) | same freshness check (media kind) | 30 generated objects: ciphertext at rest, second run copies 0, a changed object copies 1, restore into an empty bucket byte for byte, tamper and non-empty target rejected | read-only credential on the media bucket; versioning and a lifecycle on the backup bucket |
| Application keys | `key-escrow.mjs seal`: MFA key, proof keyring, SMTP key, backup keyring sealed with scrypt + AES-256-GCM under a passphrase held elsewhere; `verify` compares fingerprints with the live environment; `open` writes a 0600 env file for recovery | yes (separate passphrase) | none (run `verify` after every key change) | unit tests: round trip, wrong passphrase, tampering, no plaintext in the file | the owner chooses and safeguards the passphrase; run `seal --upload` once and after every rotation |
| Deployment configuration | `backup.mjs config`: manifest with file hashes (compose, Dockerfile, bootstrap SQL, lock file, migration journal), release id and the **names** of environment variables, never values | n/a (no secrets inside) | same freshness check | manifest verified secret-free in the rehearsal | set `DAR_RELEASE` at deploy time |
| Restore metadata and instructions | every manifest carries plain-language restore steps, key id, counts, sizes and digests | n/a (no secrets inside) | n/a | database manifest sha256 equals the artifact; counts match | none |
| Roles and grants | `infra/bootstrap-production.sql`, `infra/dokploy/bootstrap-staging.sql` (now include the mail role) | n/a | n/a | the staging bootstrap rehearsal rebuilds all six logins and 28 migrations on a throwaway cluster | keep the SQL current |

Alerting: a failing run posts `backup_failed` (webhook). `backup.mjs check`, run hourly by `dar-backup-check.timer` or the `backup-check` compose service, posts `backup_stale` and exits non-zero when the newest manifest of any kind (database, and media when configured) is older than `BACKUP_MAX_AGE_HOURS` (default 26) or missing. The optional `DAR_HEARTBEAT_URL` is pinged only after a fully successful run, so an **external** dead-man monitor also alerts when backups simply stop, even if this host is down. All three paths were exercised in the rehearsal: fresh passes, an aged threshold fails, an empty backup bucket fails.

Residual gaps (unchanged by design or not yet closable):

| # | Gap | Impact | Mitigation |
| --- | --- | --- | --- |
| G4 | Roles and provider settings are bootstrap SQL, not dumped | recovery needs the SQL and fresh role passwords | the bootstrap files are tracked and hashed in the config manifest |
| G5 | No point-in-time recovery | up to 24 h of data lost | accept for a pilot or add WAL archiving later |
| G7 | App cutover onto a restored database needs a rename (the app requires the name `dar_<environment>`) | extra step | runbook step 8; rehearse on staging |
| G8 | Incremental media backup trusts the stored size and source ETag, so a backup object damaged later is not re-verified by the next backup | silent corruption until a restore | run the monthly restore rehearsal (`media-restore` verifies every object and the list digest) |
| G9 | Media objects are copied through memory with a 25 MiB limit per object and fail the run above it | a very large object stops the job | images are normalised WebP under a quota; raise the limit or stream if that changes |
| G10 | The escrow passphrase is a single point of failure | losing it makes the escrow file useless | store it with two people, offline |

## 4. Recovery objectives (proposed, not achieved)

| Objective | Proposed | Basis | Status |
| --- | --- | --- | --- |
| RPO | 24 hours | Daily backup (`docs/phase6b-operations.md`) | **Not measured**: no scheduled real backup has run. A missed day extends it |
| RTO | 4 hours for a pilot | Same document | **Not measured**: only a 1.5 MiB local restore was timed (1.4 to 3.0 s). Real RTO also includes provisioning, key retrieval, cutover and verification |

To turn these into measured numbers: run section 5 on staging with a backup of a staging database that holds a realistic volume, record each step's wall-clock time, and repeat monthly.

## 5. Recovery runbook with approval gates

Every gate needs a named human. Never restore over a live database. Never place production personal data in an unsecured environment.

**Gate A: declare the incident.** Incident commander and owner agree restore is needed and name the cause (loss, corruption, compromise). If compromise is suspected, rotate credentials before restoring.

1. Stop writes: stop the app and worker so nothing changes the source of truth.
2. Retrieve keys: from the secret manager if it survived, otherwise open the key escrow with the passphrase held separately (`ESCROW_PASSPHRASE_FILE=<file> node scripts/ops/key-escrow.mjs open --in <escrow file> --out <new env file>`, then load it into the secret store and delete the file). The set is `BACKUP_KEY_ID` with `BACKUP_KEY` or `BACKUP_KEYRING` for the version used, plus the MFA key, the payment-proof keyring and `SMTP_CONFIG_KEY`.
3. **Gate B: choose the artifact.** List `postgres/` in the backup bucket with the time-limited recovery credential; confirm the newest object is the intended one and its size is plausible.
4. Provision an **isolated, access-restricted** environment: a separate cluster or host, scratch space larger than the dump, no public network path.
5. Create roles with `infra/bootstrap-production.sql` (adapted) and an empty database named `dar_restore_<ticket>`.
6. Restore:

```bash
RESTORE_DATABASE_URL=postgresql://<owner>@<host>/dar_restore_<ticket> \
RESTORE_CONFIRM=dar_restore_<ticket> \
BACKUP_BUCKET=<bucket> BACKUP_DIR=<private-scratch-dir> BACKUP_KEY_ID=<id> BACKUP_KEY=<from-secret-store> \
node scripts/ops/backup.mjs restore postgres/<artifact>.enc
```

   (credentials for the bucket and database come from the secret store, not the shell history). The script authenticates the ciphertext first, refuses a non-empty target, and restores in one transaction. A non-zero exit means nothing was restored.
7. Verify (the same checks the rehearsal automates): migrations = expected count; row counts of key tables against the last known figures; RLS enabled on all tenant tables (49 today); policies, foreign keys validated, indexes and functions present; the application can connect with the **restricted** runtime role; sign in as a test merchant; a store page renders; restore the media into an empty bucket named `dar-<env>-restore-media-<ticket>` with `node scripts/ops/backup.mjs media-restore` (it verifies every object and the manifest digest, and refuses a non-empty or live bucket); decrypt one stored proof and send one SMTP test to prove the keys.
8. **Gate C: cutover approval.** Owner signs off the verification record. Retire the damaged database (rename, do not drop), rename the verified restore to `dar_<environment>` or repoint the app to a cluster that has that name, then start the app and worker.
9. After cutover: revoke all sessions (a restored session table may include sessions created after the compromise), confirm `ops_missed_jobs` is empty after one worker cycle, watch error and queue metrics, and write the timings and the data-loss window into the incident record.
10. Keep the damaged database until the owner approves deletion.

## 6. Verdict

- Backup tooling: **sound by design and by rehearsal**, now covering database, media, keys, configuration and restore metadata, with failure, staleness and heartbeat alerts.
- **BLK-05: BLOCKED.** Needs a real host, an off-host bucket with the backup credentials, a first real backup, a sealed escrow stored off-host, and a staging restore with timings.
