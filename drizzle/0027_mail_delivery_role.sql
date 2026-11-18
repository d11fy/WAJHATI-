-- Unified SMTP delivery. The queued notification worker (trial, due, activated, expired, review) could not read
-- the owner-managed SMTP settings, because those are readable only by storefront_identity and the worker must
-- not hold the identity login. This adds the narrowest possible path: a dedicated, no-login group role for the
-- mail delivery process that can run the notification queue and read the SMTP secret, and nothing else.
--
-- The role is created by the cluster bootstrap (infra/bootstrap-production.sql, scripts/ops/staging-env.mjs,
-- scripts/local-env.mjs) because the schema owner cannot create roles. Fail loudly when it is missing.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'storefront_mailer') THEN
    RAISE EXCEPTION 'Role storefront_mailer is missing. Create it with the cluster bootstrap before applying migration 0027.';
  END IF;
END $$;--> statement-breakpoint

-- The SMTP secret, only while the owner has enabled central SMTP. A disabled configuration returns no row, so a
-- disabled secret is never exposed. The cipher is still AES-256-GCM encrypted: decrypting it needs SMTP_CONFIG_KEY,
-- which only the app and the mail delivery process hold.
CREATE FUNCTION public.ops_mail_secret() RETURNS TABLE(config jsonb, cipher bytea, enabled boolean, revision uuid, verified_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT config, cipher, enabled, revision, verified_at FROM public.platform_mail WHERE id = 1 AND enabled;
$$;--> statement-breakpoint

-- Job bookkeeping limited to the notifications job. The generic platform_job_start/finish accept any job name and
-- run record, so they are not granted to the mail role.
CREATE FUNCTION public.ops_mail_job_start() RETURNS uuid
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT public.platform_job_start('notifications');
$$;--> statement-breakpoint

CREATE FUNCTION public.ops_mail_job_finish(p_run uuid, p_success boolean, p_counts jsonb) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  UPDATE public.platform_jobs SET finished_at = now(), success = p_success, details = p_counts
    WHERE id = p_run AND job = 'notifications' AND finished_at IS NULL;
$$;--> statement-breakpoint

REVOKE ALL ON FUNCTION public.ops_mail_secret(), public.ops_mail_job_start(), public.ops_mail_job_finish(uuid, boolean, jsonb) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.ops_mail_secret(), public.ops_mail_job_start(), public.ops_mail_job_finish(uuid, boolean, jsonb) TO storefront_mailer;--> statement-breakpoint

-- The notification queue and the public WhatsApp number it quotes in message bodies.
GRANT EXECUTE ON FUNCTION public.ops_schedule_reminders(), public.ops_claim_mail(integer), public.ops_finish_mail(uuid, uuid, text),
  public.platform_contact_public() TO storefront_mailer;--> statement-breakpoint

-- The media worker no longer runs the notification queue. Its other duties (media cleanup, order retention,
-- billing expiry, maintenance, missed-job inspection) are unchanged.
REVOKE EXECUTE ON FUNCTION public.ops_schedule_reminders(), public.ops_claim_mail(integer), public.ops_finish_mail(uuid, uuid, text)
  FROM storefront_media_worker;--> statement-breakpoint

-- Belt and braces: the mail role has no table access at all. Every capability above is a SECURITY DEFINER function.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM storefront_mailer;
