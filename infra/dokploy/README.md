# WAJHATI staging on Dokploy

Files: `compose.staging.yaml` (the stack) and `bootstrap-staging.sql` (one-time database roles). **Nothing here has been deployed.** The configuration was validated without Docker: the compose file is parsed and each service's environment is run through the real `scripts/ops/validate-env.mjs`; the bootstrap SQL and all migrations are applied to a throwaway PostgreSQL cluster (`scripts/ops/rehearse-staging-bootstrap.mjs`). The Dokploy and Traefik behaviour (labels, certificate resolver, header forwarding) could not be tested here and is marked **verify** below.

Address: `https://staging.wajhati.store` (the DNS record does not exist yet).

## What it gives you

| Property | How |
| --- | --- |
| Separate database | Its own PostgreSQL container, database `dar_staging`, six restricted logins; the validator rejects any other database name |
| Separate storage | Its own media bucket `dar-staging-media-*` and backup bucket `dar-staging-backup-*` (the validator enforces both prefixes) |
| Separate sessions | Host-only `__Host-` cookies on `staging.wajhati.store` plus a separate session table in the staging database |
| Separate secrets | Every key and password is staging-only and enters through Dokploy's environment, never the repository |
| Separate workers | Its own `worker` (media, orders, billing, maintenance) and `mailer` (notification email) containers, each with only its own credentials |
| Isolated email | `MAIL_ALLOWED_RECIPIENTS` is required. Mail to anyone else is blocked in code and counted as a terminal failure |
| Access-protected | Traefik basic auth in front of everything; plain HTTP only redirects |
| Not indexed | `X-Robots-Tag: noindex, nofollow, noarchive` on every response, `robots.txt` disallows all, no sitemap entries |
| Not exposed | No published ports. Only the app joins Dokploy's Traefik network. The database network has no internet route |

## Resources you must provide

| Resource | Detail |
| --- | --- |
| VPS with Dokploy | At least 4 GB RAM, 2 vCPU, 40 GB disk (container limits add up to about 2.8 GB; the image build needs headroom). Dokploy with Traefik running, ports 80 and 443 open |
| DNS | `A staging.wajhati.store` pointing at the VPS public IP, in Hostinger DNS. Needs owner approval (the zone also carries live mail records). Do not touch MX, SPF, DKIM, `autodiscover` or `www`. Wait until it resolves before the first deploy so the certificate can be issued |
| Object storage | An S3-compatible service reachable over HTTPS with two private buckets. Credentials below |
| Git access | Dokploy must be able to read the repository branch to deploy. Pushing a branch needs the owner's explicit approval |
| Mailbox | The Hostinger mailbox `support@wajhati.store` and its password, entered by the owner in the platform panel (not in Dokploy) |
| Test inboxes | One or more addresses you control for `MAIL_ALLOWED_RECIPIENTS` |

Storage credentials (least privilege):

| Credential | Needs |
| --- | --- |
| App (`S3_APP_*`) | Get and Put on `*/catalog/*.webp` and `*/theme/*.webp`; Get on `ops/readiness` in the media bucket |
| Worker (`S3_WORKER_*`) | Delete on the same prefixes |
| Backup writer (`BACKUP_AWS_*`) | Put, Head and List in the backup bucket (prefixes `postgres/`, `media/`, `meta/`, `escrow/`); **no delete** |
| Backup media reader (`S3_BACKUP_READ_*`) | Read-only Get and List on the media bucket |

## Variables to set in Dokploy (Environment tab)

Generate every secret fresh. Never reuse a production value.

```bash
openssl rand -hex 24   # each DAR_*_PASSWORD (48 hex characters, safe inside URLs)
openssl rand -hex 32   # PLATFORM_MFA_KEY, a proof key, OPS_METRICS_TOKEN, SMTP_CONFIG_KEY, BACKUP_KEY
htpasswd -nbB qa '<a-strong-password>'   # STAGING_BASIC_AUTH ("user:hash")
```

| Variable | Notes |
| --- | --- |
| `STAGING_BASIC_AUTH` | The `htpasswd` output. Each `$` may need to be written `$$` depending on how Dokploy writes `.env`. **Verify** with step 5 |
| `STAGING_ORIGIN` | Optional. Defaults to `https://staging.wajhati.store` |
| `DAR_DB_ADMIN_PASSWORD`, `DAR_OWNER_PASSWORD`, `DAR_RUNTIME_PASSWORD`, `DAR_IDENTITY_PASSWORD`, `DAR_WORKER_PASSWORD`, `DAR_MAILER_PASSWORD`, `DAR_BACKUP_PASSWORD` | Seven different values |
| `PLATFORM_MFA_KEY`, `SMTP_CONFIG_KEY`, `OPS_METRICS_TOKEN` | Three different 64-hex values (the validator rejects reusing one key for two purposes) |
| `PAYMENT_PROOF_ACTIVE_KEY`, `PAYMENT_PROOF_KEYRING` | For example `stage_v1` and `{"stage_v1":"<64 hex>"}` |
| `S3_BUCKET`, `S3_REGION`, `S3_ENDPOINT`, `S3_FORCE_PATH_STYLE` | Bucket must start `dar-staging-media-`; endpoint must be HTTPS |
| `S3_APP_ACCESS_KEY_ID`, `S3_APP_SECRET_ACCESS_KEY`, `S3_WORKER_ACCESS_KEY_ID`, `S3_WORKER_SECRET_ACCESS_KEY` | Two different credentials |
| `MAIL_ALLOWED_RECIPIENTS` | Comma separated addresses or `@domain`, for example `you@example.com`. Required |
| Optional: Resend | `MAIL_PROVIDER=resend`, `RESEND_API_KEY`, `MAIL_FROM` (add to `app` and `mailer`). Not needed when the owner-managed SMTP is used |
| Backups (needed only for the `backup` profile) | `BACKUP_BUCKET` (starts `dar-staging-backup-`), `BACKUP_S3_ENDPOINT`, `BACKUP_KEY_ID`, `BACKUP_KEY`, `BACKUP_AWS_*`, `S3_BACKUP_READ_*`; optional `BACKUP_MAX_AGE_HOURS`, `DAR_HEARTBEAT_URL`, `DAR_ALERT_WEBHOOK` |

`SMTP_CONFIG_KEY` encrypts the stored SMTP password. Do not change it after the password has been saved; a new key makes the stored password unreadable and it must be re-entered.

## Exact deployment steps

Run steps 3 onward only after the owner has approved the DNS record and the branch push.

1. **Dokploy project.** Create a project, add a **Compose** service of type Docker Compose, Provider Git, repository `d11fy/WAJHATI-`, the branch you approved, Compose Path `./infra/dokploy/compose.staging.yaml`. Do **not** use the root `compose.yaml` (it bundles Caddy and expects local files) and do **not** create an "Application" from the Dockerfile (without `DAR_ENV` its default start mode provisions a development database).
2. **Environment.** Paste the variables above. Leave `LEGAL_APPROVED` alone: the file pins it to `false`.
3. **Database first.** In the Dokploy server terminal, in the directory Dokploy checked the repository out to (it contains the `.env` Dokploy wrote):
   ```bash
   docker compose -f infra/dokploy/compose.staging.yaml up -d db
   docker compose -f infra/dokploy/compose.staging.yaml --profile bootstrap run --rm bootstrap
   docker compose -f infra/dokploy/compose.staging.yaml --profile operator run --rm operator
   ```
   The bootstrap refuses to run twice, refuses empty or short passwords and creates nothing in either case. The operator applies the migrations.
4. **Everything else.** Deploy from the Dokploy UI (or `docker compose -f infra/dokploy/compose.staging.yaml up -d`). Wait until `app`, `pdf`, `db`, `worker` and `mailer` are healthy.
5. **Verify access protection** (from your machine):
   ```bash
   curl -sI https://staging.wajhati.store/ar | head -1                         # HTTP/2 401
   curl -sI -u qa:<password> https://staging.wajhati.store/ar | grep -i -E "^HTTP|x-robots-tag|strict-transport"
   curl -s  -u qa:<password> https://staging.wajhati.store/robots.txt          # Disallow: /
   curl -sI http://staging.wajhati.store/ar | head -2                          # 308 redirect to https
   ```
   **Verify (Traefik):** that the certificate was issued by Let's Encrypt, that the basic-auth hash works (a wrong `$` escape makes every login fail), and that Traefik overwrites a client-supplied `X-Real-Ip`. The app trusts that header for rate limiting.
6. **Test accounts.** Create the platform owner and synthetic merchants with the operator tools, inside the operator container (they need the schema-owner login):
   ```bash
   docker compose -f infra/dokploy/compose.staging.yaml --profile operator run --rm operator \
     node --conditions=react-server --import tsx scripts/platform-operator.ts bootstrap-owner owner@example.test
   ```
   Follow the README "Phase 6A" steps for MFA enrolment and `scripts/billing-operator.ts provision-account` for merchants. Deployed environments cannot self-register by design. Use synthetic data only.
7. **Email.** As the platform owner with fresh MFA open `/ar/platform/settings`, enter Hostinger SMTP (`smtp.hostinger.com`, 587, `support@wajhati.store`, the mailbox password), press the test button and send to an address on your allow-list. Confirm the message arrived and read `Authentication-Results`. A send to any other address is refused.
8. **Smoke journeys.** Sign in, create a store (72-hour trial), add products, switch through all eight themes, edit and publish, restore, add to cart, open the WhatsApp and Instagram handoffs, activate a subscription as an administrator, confirm the trial and activation emails arrive at the allow-listed inbox and that nothing else is emailed.
9. **Backups.** `docker compose -f infra/dokploy/compose.staging.yaml --profile backup run --rm backup`, then `... run --rm backup-check`. Seal the keys (`scripts/ops/key-escrow.mjs seal`) and store the passphrase elsewhere. Restore into a scratch database and bucket as in `docs/operations/DISASTER_RECOVERY_REPORT.md`.
10. **Rollback.** Redeploy the previous commit from Dokploy. Migrations are forward-only and additive, so keep the database; restore from backup only for data problems.

## What this does not do

- It does not create the DNS record, the VPS, the buckets or any secret.
- It does not enable sign-up (the validator forces it off in every deployed environment).
- It does not approve the legal text. Staging shows the draft banner like every non-production environment.
