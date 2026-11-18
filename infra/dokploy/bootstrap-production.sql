-- One-time role bootstrap for the production database, run by the `bootstrap` service in compose.production.yaml as dar_admin.
-- Passwords come from the environment of that container (never from this file) through psql backtick expansion.
-- It refuses to run unless the database is the empty production database.
\set ON_ERROR_STOP on
\set owner_pw `printenv DAR_OWNER_PASSWORD`
\set runtime_pw `printenv DAR_RUNTIME_PASSWORD`
\set identity_pw `printenv DAR_IDENTITY_PASSWORD`
\set worker_pw `printenv DAR_WORKER_PASSWORD`
\set mailer_pw `printenv DAR_MAILER_PASSWORD`
\set backup_pw `printenv DAR_BACKUP_PASSWORD`

DO $$ BEGIN
  IF current_database() <> 'dar_production' OR current_user <> 'dar_admin'
    OR to_regclass('public.stores') IS NOT NULL OR EXISTS (
      SELECT 1 FROM pg_roles WHERE rolname IN ('dar_owner','dar_runtime','dar_identity','dar_worker','dar_mailer','dar_backup',
        'storefront_app','storefront_identity','storefront_media_worker','storefront_mailer')
    ) THEN RAISE EXCEPTION 'Expected an uninitialized production database'; END IF;
END $$;

-- Refuse empty or short passwords: an unset variable must not create a login with a blank password.
SELECT (length(:'owner_pw') >= 24 AND length(:'runtime_pw') >= 24 AND length(:'identity_pw') >= 24 AND length(:'worker_pw') >= 24
  AND length(:'mailer_pw') >= 24 AND length(:'backup_pw') >= 24) AS passwords_ok \gset
\if :passwords_ok
\else
  \echo 'Every role password must be set and at least 24 characters (use: openssl rand -hex 24).'
  -- Deliberate error: with ON_ERROR_STOP psql then exits non-zero before any role is created.
  SELECT 1/0 AS passwords_missing_or_too_short;
\endif

BEGIN;
CREATE ROLE storefront_app NOLOGIN NOSUPERUSER NOBYPASSRLS;
CREATE ROLE storefront_identity NOLOGIN NOSUPERUSER NOBYPASSRLS;
CREATE ROLE storefront_media_worker NOLOGIN NOSUPERUSER NOBYPASSRLS;
CREATE ROLE storefront_mailer NOLOGIN NOSUPERUSER NOBYPASSRLS;
CREATE ROLE dar_owner LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD :'owner_pw' CONNECTION LIMIT 3;
CREATE ROLE dar_runtime LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD :'runtime_pw' IN ROLE storefront_app CONNECTION LIMIT 12;
CREATE ROLE dar_identity LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD :'identity_pw' IN ROLE storefront_identity CONNECTION LIMIT 6;
CREATE ROLE dar_worker LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD :'worker_pw' IN ROLE storefront_media_worker CONNECTION LIMIT 5;
-- Mail delivery login: the notification queue and the SMTP secret through SECURITY DEFINER functions only (migration 0027).
CREATE ROLE dar_mailer LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD :'mailer_pw' IN ROLE storefront_mailer CONNECTION LIMIT 3;
CREATE ROLE dar_backup LOGIN NOSUPERUSER BYPASSRLS PASSWORD :'backup_pw' IN ROLE pg_read_all_data CONNECTION LIMIT 3;
ALTER ROLE dar_backup SET default_transaction_read_only = on;
ALTER DATABASE dar_production OWNER TO dar_owner;
REVOKE CONNECT ON DATABASE dar_production FROM PUBLIC;
GRANT CONNECT ON DATABASE dar_production TO dar_runtime, dar_identity, dar_worker, dar_mailer, dar_backup;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
COMMIT;
