\set ON_ERROR_STOP on
-- Initial bootstrap only, through local psql as dar_admin on the new production cluster.
DO $$ BEGIN
  IF current_database()<>'dar_production' OR current_user<>'dar_admin'
    OR to_regclass('public.stores') IS NOT NULL OR EXISTS (
      SELECT 1 FROM pg_roles WHERE rolname IN ('dar_owner','dar_runtime','dar_identity','dar_worker','dar_mailer','dar_backup')
    ) THEN RAISE EXCEPTION 'Expected an uninitialized production cluster'; END IF;
END $$;
BEGIN;
CREATE ROLE storefront_app NOLOGIN NOSUPERUSER NOBYPASSRLS;
CREATE ROLE storefront_identity NOLOGIN NOSUPERUSER NOBYPASSRLS;
CREATE ROLE storefront_media_worker NOLOGIN NOSUPERUSER NOBYPASSRLS;
CREATE ROLE storefront_mailer NOLOGIN NOSUPERUSER NOBYPASSRLS;
CREATE ROLE dar_owner LOGIN NOSUPERUSER NOBYPASSRLS CONNECTION LIMIT 3;
CREATE ROLE dar_runtime LOGIN NOSUPERUSER NOBYPASSRLS IN ROLE storefront_app CONNECTION LIMIT 12;
CREATE ROLE dar_identity LOGIN NOSUPERUSER NOBYPASSRLS IN ROLE storefront_identity CONNECTION LIMIT 6;
CREATE ROLE dar_worker LOGIN NOSUPERUSER NOBYPASSRLS IN ROLE storefront_media_worker CONNECTION LIMIT 5;
-- Mail delivery process: queue functions and the SMTP secret, no table access (migration 0027).
CREATE ROLE dar_mailer LOGIN NOSUPERUSER NOBYPASSRLS IN ROLE storefront_mailer CONNECTION LIMIT 3;
CREATE ROLE dar_backup LOGIN NOSUPERUSER BYPASSRLS IN ROLE pg_read_all_data CONNECTION LIMIT 3;
ALTER ROLE dar_backup SET default_transaction_read_only=on;
ALTER DATABASE dar_production OWNER TO dar_owner;
REVOKE CONNECT ON DATABASE dar_production FROM PUBLIC;
GRANT CONNECT ON DATABASE dar_production TO dar_runtime,dar_identity,dar_worker,dar_mailer,dar_backup;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
COMMIT;
\password dar_owner
\password dar_runtime
\password dar_identity
\password dar_worker
\password dar_mailer
\password dar_backup
