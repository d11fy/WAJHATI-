# WhatsApp subscriptions and SMTP — migration plan

User approved one store per subscription; administrators choose that store beside the customer's email. Public prices stay ILS 35/month and ILS 245/year. Administrative durations are 1, 3, 6 and 12 calendar months. Platform WhatsApp: +972567508786. Store customer orders remain WhatsApp/Instagram contact orders.

Add separate immutable manual subscription records; do not rewrite historical requests, approved amounts, plan snapshots or paid periods. A new paid activation starts immediately (including during a trial); renewal appends after all already paid periods. Same-store locks, idempotency keys and unique receipt references prevent accidental double grants. Recent administrator MFA is required; reviewers and merchants cannot grant access. Above configured thresholds, a different administrator confirms a pending activation. Administrator self-activation is forbidden.

New accounts receive a fixed three-day window at creation, assigned to their first owned store. No resetting the clock by making another store. Existing accounts, historical trials and subscriptions are not restarted or shortened. In contact mode, old new-payment-request entry points are disabled while historical records remain readable/reviewable.

SMTP configuration is owner-only with recent MFA, separately encrypted using SMTP_CONFIG_KEY outside PostgreSQL. Passwords are write-only in the UI. Public SMTP hosts on TLS/STARTTLS ports only; private/reserved destinations are blocked and DNS resolution is pinned for each connection. No secrets or raw SMTP errors enter audit logs. Test delivery is explicit, rate limited and sent only to the signed-in owner's address. Registration stays gated by the existing PUBLIC_SIGNUP_ENABLED switch, verified provider configuration and abuse controls.

Rollback: disable contact mode, disable SMTP, and restore previous SQL functions from migrations. Preserve manual terms and their audits; do not drop financial data or revert to a mode that ignores active manual periods. Back up before applying to a non-disposable database. No deployment or push is part of this work.
