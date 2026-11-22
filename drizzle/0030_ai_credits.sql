-- WAJHATI AI: per-store AI Credits (wallet, monthly allocations, immutable ledger, request log) and the administrator controls.
-- Additive only: new tables and functions. No existing table, column, role, grant or financial record changes, and billing_* rows are
-- never written; credits are derived from public.billing_state(store) when a wallet is read or used.
--
-- Access model: storefront_app can only READ the rows of stores it is a member of (RLS via public.theme_member). Every write goes through the
-- SECURITY DEFINER functions below, so a merchant session can never edit a balance, a ledger line or a request directly.

CREATE TABLE "ai_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"per_minute" integer DEFAULT 6 NOT NULL,
	"per_day" integer DEFAULT 150 NOT NULL,
	"trial_credits" integer DEFAULT 30 NOT NULL,
	"monthly_credits" integer DEFAULT 600 NOT NULL,
	"usd_per_million_input" numeric(10,4) DEFAULT 0.14 NOT NULL,
	"usd_per_million_output" numeric(10,4) DEFAULT 0.28 NOT NULL,
	"reservation_minutes" integer DEFAULT 5 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_settings_bounds" CHECK ("id" = 1 AND "per_minute" BETWEEN 1 AND 600 AND "per_day" BETWEEN 1 AND 100000
		AND "trial_credits" BETWEEN 0 AND 100000 AND "monthly_credits" BETWEEN 0 AND 1000000
		AND "usd_per_million_input" BETWEEN 0 AND 1000 AND "usd_per_million_output" BETWEEN 0 AND 1000 AND "reservation_minutes" BETWEEN 1 AND 60)
);
--> statement-breakpoint
ALTER TABLE "ai_settings" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
INSERT INTO "ai_settings" ("id") VALUES (1);
--> statement-breakpoint
CREATE TABLE "ai_operation_costs" (
	"operation" text PRIMARY KEY NOT NULL,
	"credits" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "ai_operation_costs_valid" CHECK ("operation" ~ '^[a-z_]{3,40}$' AND "credits" BETWEEN 0 AND 1000)
);
--> statement-breakpoint
ALTER TABLE "ai_operation_costs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
INSERT INTO "ai_operation_costs" ("operation", "credits") VALUES
	('headline', 1), ('product_description', 2), ('section_description', 2), ('about_store', 3), ('theme_fill', 15), ('store_from_idea', 20);
--> statement-breakpoint
CREATE TABLE "ai_store_controls" (
	"store_id" uuid PRIMARY KEY NOT NULL REFERENCES "stores"("id") ON DELETE cascade,
	"suspended" boolean DEFAULT false NOT NULL,
	"reason" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_store_controls_reason" CHECK ("reason" IS NULL OR length("reason") <= 300)
);
--> statement-breakpoint
ALTER TABLE "ai_store_controls" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
-- "balance" is the current monthly/trial cycle (it expires, no rollover). "extra" is administrator-granted or, later, purchased credit that does not expire.
CREATE TABLE "ai_wallets" (
	"store_id" uuid PRIMARY KEY NOT NULL REFERENCES "stores"("id") ON DELETE cascade,
	"balance" integer DEFAULT 0 NOT NULL,
	"extra" integer DEFAULT 0 NOT NULL,
	"cycle_key" text,
	"cycle_kind" text,
	"cycle_credits" integer DEFAULT 0 NOT NULL,
	"cycle_start" timestamp with time zone,
	"cycle_end" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_wallet_non_negative" CHECK ("balance" >= 0 AND "extra" >= 0 AND "cycle_credits" >= 0),
	CONSTRAINT "ai_wallet_cycle" CHECK (("cycle_key" IS NULL) = ("cycle_end" IS NULL) AND ("cycle_kind" IS NULL OR "cycle_kind" IN ('trial', 'subscription')))
);
--> statement-breakpoint
ALTER TABLE "ai_wallets" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "ai_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL REFERENCES "stores"("id") ON DELETE cascade,
	"kind" text NOT NULL,
	"cycle_key" text NOT NULL,
	"credits" integer NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_allocation_once" UNIQUE ("store_id", "cycle_key"),
	CONSTRAINT "ai_allocation_valid" CHECK ("kind" IN ('trial', 'subscription') AND "credits" >= 0 AND "ends_at" > "starts_at")
);
--> statement-breakpoint
ALTER TABLE "ai_allocations" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
-- One free trial allocation per account (owner user), however many stores or trial windows the account has.
CREATE TABLE "ai_trial_claims" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"store_id" uuid NOT NULL REFERENCES "stores"("id") ON DELETE cascade,
	"claimed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_trial_claims" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
-- The log stores metadata only (operation, tokens, cost, outcome). Prompts and generated text are never stored.
CREATE TABLE "ai_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL REFERENCES "stores"("id") ON DELETE cascade,
	"user_id" uuid,
	"operation" text NOT NULL REFERENCES "ai_operation_costs"("operation"),
	"idempotency_key" uuid NOT NULL,
	"status" text DEFAULT 'reserved' NOT NULL,
	"credits" integer NOT NULL,
	"from_cycle" integer NOT NULL,
	"from_extra" integer NOT NULL,
	"cycle_key" text,
	"provider" text,
	"model" text,
	"input_tokens" integer,
	"output_tokens" integer,
	"est_cost_usd" numeric(12,6),
	"latency_ms" integer,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "ai_request_key" UNIQUE ("store_id", "idempotency_key"),
	CONSTRAINT "ai_request_valid" CHECK ("status" IN ('reserved', 'succeeded', 'failed', 'expired') AND "credits" >= 0 AND "from_cycle" >= 0 AND "from_extra" >= 0
		AND "from_cycle" + "from_extra" = "credits" AND ("error_code" IS NULL OR length("error_code") <= 60))
);
--> statement-breakpoint
CREATE INDEX "ai_request_recent" ON "ai_requests" ("store_id", "created_at" DESC);
--> statement-breakpoint
CREATE INDEX "ai_request_open" ON "ai_requests" ("expires_at") WHERE "status" = 'reserved';
--> statement-breakpoint
ALTER TABLE "ai_requests" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "ai_ledger" (
	"id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY NOT NULL,
	"store_id" uuid NOT NULL REFERENCES "stores"("id") ON DELETE cascade,
	"kind" text NOT NULL,
	"delta" integer NOT NULL,
	"balance_after" integer NOT NULL,
	"extra_after" integer NOT NULL,
	"request_id" uuid,
	"actor_id" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_ledger_valid" CHECK ("kind" IN ('allocation', 'expire', 'reserve', 'commit', 'release', 'admin_grant', 'admin_withdraw')
		AND "balance_after" >= 0 AND "extra_after" >= 0 AND ("note" IS NULL OR length("note") <= 300))
);
--> statement-breakpoint
CREATE INDEX "ai_ledger_store" ON "ai_ledger" ("store_id", "id" DESC);
--> statement-breakpoint
ALTER TABLE "ai_ledger" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
-- Ledger lines are append-only. Updates are always refused; a direct delete is refused. Only a cascade from deleting the whole store is allowed.
CREATE FUNCTION public.ai_ledger_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'ai_ledger is append-only' USING ERRCODE = 'restrict_violation';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER ai_ledger_append_only BEFORE UPDATE OR DELETE ON public.ai_ledger FOR EACH ROW EXECUTE FUNCTION public.ai_ledger_immutable();
--> statement-breakpoint
CREATE POLICY ai_wallet_member ON public.ai_wallets FOR SELECT TO storefront_app USING (public.theme_member(store_id));
--> statement-breakpoint
CREATE POLICY ai_allocation_member ON public.ai_allocations FOR SELECT TO storefront_app USING (public.theme_member(store_id));
--> statement-breakpoint
CREATE POLICY ai_request_member ON public.ai_requests FOR SELECT TO storefront_app USING (public.theme_member(store_id));
--> statement-breakpoint
CREATE POLICY ai_ledger_member ON public.ai_ledger FOR SELECT TO storefront_app USING (public.theme_member(store_id));
--> statement-breakpoint
CREATE POLICY ai_costs_read ON public.ai_operation_costs FOR SELECT TO storefront_app USING (true);
--> statement-breakpoint
CREATE POLICY ai_settings_read ON public.ai_settings FOR SELECT TO storefront_app USING (true);
--> statement-breakpoint
GRANT SELECT ON public.ai_wallets, public.ai_allocations, public.ai_requests, public.ai_ledger TO storefront_app;
--> statement-breakpoint
GRANT SELECT ON public.ai_operation_costs TO storefront_app;
--> statement-breakpoint
GRANT SELECT (id, enabled, per_minute, per_day, trial_credits, monthly_credits, usd_per_million_input, usd_per_million_output, reservation_minutes) ON public.ai_settings TO storefront_app;
--> statement-breakpoint
-- Releases one reservation. The caller must already hold the wallet row lock. Cycle credit returns only while the request's cycle is still current
-- (an expired cycle is forfeited, never re-granted); extra credit always returns.
CREATE FUNCTION public.ai_release_locked(p_request uuid, p_status text, p_error text, p_in integer, p_out integer, p_cost numeric, p_provider text, p_model text, p_ms integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE req public.ai_requests; wallet public.ai_wallets; back_cycle integer := 0;
BEGIN
  SELECT * INTO req FROM public.ai_requests WHERE id = p_request AND status = 'reserved' FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT * INTO wallet FROM public.ai_wallets WHERE store_id = req.store_id;
  IF req.cycle_key IS NOT NULL AND wallet.cycle_key = req.cycle_key AND wallet.cycle_end > now() THEN back_cycle := req.from_cycle; END IF;
  UPDATE public.ai_wallets SET balance = balance + back_cycle, extra = extra + req.from_extra, updated_at = now() WHERE store_id = req.store_id
    RETURNING * INTO wallet;
  UPDATE public.ai_requests SET status = p_status, error_code = left(p_error, 60), input_tokens = p_in, output_tokens = p_out, est_cost_usd = p_cost,
    provider = p_provider, model = p_model, latency_ms = p_ms, finished_at = now() WHERE id = p_request;
  INSERT INTO public.ai_ledger(store_id, kind, delta, balance_after, extra_after, request_id, note)
  VALUES (req.store_id, 'release', back_cycle + req.from_extra, wallet.balance, wallet.extra, p_request, left(p_error, 120));
END;
$$;
--> statement-breakpoint
-- Brings one store's wallet up to date with its real subscription period, and returns it locked for the rest of the transaction:
-- recovers reservations that were never finished, expires the previous cycle's remainder, and creates the current cycle's allocation once.
-- Trial: settings.trial_credits once per owner account until the trial ends. Paid: settings.monthly_credits for each calendar month of the paid
-- period (a 3, 6 or 12 month term still gets one allocation per month, created when that month starts). Nothing is granted in grace, expired or suspended states.
CREATE FUNCTION public.ai_sync(p_store uuid) RETURNS public.ai_wallets
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  wallet public.ai_wallets; cfg public.ai_settings; state jsonb; stale record; owner uuid; claimed uuid; allocated uuid;
  kind text; ckey text; cstart timestamptz; cend timestamptz; credits integer; pstart timestamptz; pend timestamptz; k integer;
BEGIN
  SELECT * INTO cfg FROM public.ai_settings WHERE id = 1;
  INSERT INTO public.ai_wallets(store_id) VALUES (p_store) ON CONFLICT DO NOTHING;
  SELECT * INTO wallet FROM public.ai_wallets WHERE store_id = p_store FOR UPDATE;
  FOR stale IN SELECT id FROM public.ai_requests WHERE store_id = p_store AND status = 'reserved' AND expires_at <= now() ORDER BY created_at LOOP
    PERFORM public.ai_release_locked(stale.id, 'expired', 'reservation_expired', NULL, NULL, NULL, NULL, NULL, NULL);
  END LOOP;
  SELECT * INTO wallet FROM public.ai_wallets WHERE store_id = p_store;
  state := public.billing_state(p_store);
  IF state->>'status' = 'active' THEN
    pstart := coalesce((state->>'periodStart')::timestamptz, date_trunc('month', now()));
    pend := coalesce((state->>'periodEnd')::timestamptz, (state->>'legacyUntil')::timestamptz);
    IF pend IS NOT NULL AND pend > now() AND pstart <= now() THEN
      k := greatest(0, extract(year FROM age(now(), pstart))::int * 12 + extract(month FROM age(now(), pstart))::int);
      WHILE pstart + (k * interval '1 month') > now() AND k > 0 LOOP k := k - 1; END LOOP;
      WHILE pstart + ((k + 1) * interval '1 month') <= now() LOOP k := k + 1; END LOOP;
      cstart := pstart + (k * interval '1 month');
      cend := least(pstart + ((k + 1) * interval '1 month'), pend);
      kind := 'subscription'; credits := cfg.monthly_credits;
      ckey := 'sub:' || to_char(pstart AT TIME ZONE 'UTC', 'YYYYMMDD"T"HH24MISS') || ':' || k::text;
    END IF;
  ELSIF state->>'status' = 'trialing' AND (state->>'trialEnd')::timestamptz > now() THEN
    SELECT m.user_id INTO owner FROM public.store_memberships m WHERE m.store_id = p_store AND m.role = 'owner' LIMIT 1;
    IF owner IS NOT NULL THEN
      INSERT INTO public.ai_trial_claims(user_id, store_id) VALUES (owner, p_store) ON CONFLICT DO NOTHING;
      SELECT c.store_id INTO claimed FROM public.ai_trial_claims c WHERE c.user_id = owner;
      IF claimed = p_store THEN
        kind := 'trial'; ckey := 'trial'; credits := cfg.trial_credits;
        cstart := coalesce(wallet.cycle_start, now()); cend := (state->>'trialEnd')::timestamptz;
        SELECT a.starts_at INTO cstart FROM public.ai_allocations a WHERE a.store_id = p_store AND a.cycle_key = 'trial';
        cstart := coalesce(cstart, now());
        IF cend <= cstart THEN ckey := NULL; END IF;
      END IF;
    END IF;
  END IF;
  -- Whatever is left of a finished or replaced cycle is forfeited (no rollover).
  IF wallet.cycle_key IS NOT NULL AND (wallet.cycle_end <= now() OR ckey IS DISTINCT FROM wallet.cycle_key) THEN
    IF wallet.balance > 0 THEN
      INSERT INTO public.ai_ledger(store_id, kind, delta, balance_after, extra_after, note)
      VALUES (p_store, 'expire', -wallet.balance, 0, wallet.extra, wallet.cycle_key);
    END IF;
    UPDATE public.ai_wallets SET balance = 0, cycle_key = NULL, cycle_kind = NULL, cycle_credits = 0, cycle_start = NULL, cycle_end = NULL, updated_at = now()
      WHERE store_id = p_store RETURNING * INTO wallet;
  END IF;
  IF ckey IS NOT NULL AND wallet.cycle_key IS NULL THEN
    INSERT INTO public.ai_allocations(store_id, kind, cycle_key, credits, starts_at, ends_at) VALUES (p_store, kind, ckey, credits, cstart, cend)
      ON CONFLICT (store_id, cycle_key) DO NOTHING RETURNING id INTO allocated;
    IF allocated IS NOT NULL THEN
      UPDATE public.ai_wallets SET balance = credits, cycle_key = ckey, cycle_kind = kind, cycle_credits = credits, cycle_start = cstart, cycle_end = cend, updated_at = now()
        WHERE store_id = p_store RETURNING * INTO wallet;
      INSERT INTO public.ai_ledger(store_id, kind, delta, balance_after, extra_after, note) VALUES (p_store, 'allocation', credits, wallet.balance, wallet.extra, ckey);
    END IF;
  END IF;
  RETURN wallet;
END;
$$;
--> statement-breakpoint
-- What the merchant interface needs: the wallet, the billing status it follows and the current operation prices.
CREATE FUNCTION public.ai_wallet(p_store uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE wallet public.ai_wallets; cfg public.ai_settings; suspended boolean;
BEGIN
  IF NOT public.theme_member(p_store) THEN RETURN NULL; END IF;
  wallet := public.ai_sync(p_store);
  SELECT * INTO cfg FROM public.ai_settings WHERE id = 1;
  SELECT coalesce(c.suspended, false) INTO suspended FROM (SELECT 1) x LEFT JOIN public.ai_store_controls c ON c.store_id = p_store;
  RETURN jsonb_build_object(
    'enabled', cfg.enabled, 'suspended', coalesce(suspended, false), 'billing', public.billing_state(p_store)->>'status',
    'balance', wallet.balance, 'extra', wallet.extra, 'allocation', wallet.cycle_credits, 'kind', wallet.cycle_kind,
    'cycleStart', wallet.cycle_start, 'cycleEnd', wallet.cycle_end,
    'costs', (SELECT coalesce(jsonb_object_agg(operation, credits), '{}'::jsonb) FROM public.ai_operation_costs WHERE active));
END;
$$;
--> statement-breakpoint
-- Reserves the price of one operation atomically. The wallet row lock serializes concurrent requests for a store, so two requests can never spend the
-- same credits. Returns a status instead of raising so the caller can show the right message and never calls the provider unless the status is 'ok'.
CREATE FUNCTION public.ai_reserve(p_store uuid, p_operation text, p_key uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  wallet public.ai_wallets; cfg public.ai_settings; cost integer; take integer; existing public.ai_requests; request_id uuid;
  member uuid := nullif(current_setting('dar.user_id', true), '')::uuid;
BEGIN
  IF member IS NULL OR NOT public.theme_member(p_store) THEN RETURN jsonb_build_object('status', 'denied'); END IF;
  wallet := public.ai_sync(p_store);
  SELECT * INTO cfg FROM public.ai_settings WHERE id = 1;
  SELECT * INTO existing FROM public.ai_requests WHERE store_id = p_store AND idempotency_key = p_key;
  IF FOUND THEN RETURN jsonb_build_object('status', 'duplicate', 'requestId', existing.id, 'state', existing.status); END IF;
  IF NOT cfg.enabled THEN RETURN jsonb_build_object('status', 'disabled'); END IF;
  IF EXISTS (SELECT 1 FROM public.ai_store_controls WHERE store_id = p_store AND suspended) THEN RETURN jsonb_build_object('status', 'suspended'); END IF;
  SELECT credits INTO cost FROM public.ai_operation_costs WHERE operation = p_operation AND active;
  IF cost IS NULL THEN RETURN jsonb_build_object('status', 'invalid'); END IF;
  IF (SELECT count(*) FROM public.ai_requests WHERE store_id = p_store AND created_at > now() - interval '1 minute') >= cfg.per_minute
    OR (SELECT count(*) FROM public.ai_requests WHERE store_id = p_store AND created_at > now() - interval '1 day') >= cfg.per_day
  THEN RETURN jsonb_build_object('status', 'rate_limited'); END IF;
  IF wallet.cycle_key IS NULL AND wallet.extra = 0 THEN RETURN jsonb_build_object('status', 'no_plan', 'balance', 0); END IF;
  IF wallet.balance + wallet.extra < cost THEN
    RETURN jsonb_build_object('status', 'insufficient', 'balance', wallet.balance, 'extra', wallet.extra, 'cost', cost);
  END IF;
  take := least(wallet.balance, cost);
  UPDATE public.ai_wallets SET balance = balance - take, extra = extra - (cost - take), updated_at = now() WHERE store_id = p_store RETURNING * INTO wallet;
  INSERT INTO public.ai_requests(store_id, user_id, operation, idempotency_key, credits, from_cycle, from_extra, cycle_key, expires_at)
  VALUES (p_store, member, p_operation, p_key, cost, take, cost - take, CASE WHEN take > 0 THEN wallet.cycle_key END,
    now() + make_interval(mins => cfg.reservation_minutes)) RETURNING id INTO request_id;
  INSERT INTO public.ai_ledger(store_id, kind, delta, balance_after, extra_after, request_id, actor_id, note)
  VALUES (p_store, 'reserve', -cost, wallet.balance, wallet.extra, request_id, member, p_operation);
  RETURN jsonb_build_object('status', 'ok', 'requestId', request_id, 'cost', cost, 'balance', wallet.balance, 'extra', wallet.extra);
END;
$$;
--> statement-breakpoint
CREATE FUNCTION public.ai_commit(p_request uuid, p_in integer, p_out integer, p_cost numeric, p_provider text, p_model text, p_ms integer) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE req public.ai_requests; wallet public.ai_wallets;
BEGIN
  SELECT * INTO req FROM public.ai_requests WHERE id = p_request;
  IF NOT FOUND OR NOT public.theme_member(req.store_id) THEN RETURN false; END IF;
  SELECT * INTO wallet FROM public.ai_wallets WHERE store_id = req.store_id FOR UPDATE;
  UPDATE public.ai_requests SET status = 'succeeded', input_tokens = p_in, output_tokens = p_out, est_cost_usd = p_cost, provider = p_provider, model = p_model,
    latency_ms = p_ms, finished_at = now() WHERE id = p_request AND status = 'reserved';
  IF NOT FOUND THEN RETURN false; END IF;
  INSERT INTO public.ai_ledger(store_id, kind, delta, balance_after, extra_after, request_id, note)
  VALUES (req.store_id, 'commit', 0, wallet.balance, wallet.extra, p_request, req.operation);
  RETURN true;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION public.ai_release(p_request uuid, p_error text, p_in integer, p_out integer, p_cost numeric, p_provider text, p_model text, p_ms integer) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE req public.ai_requests; wallet public.ai_wallets;
BEGIN
  SELECT * INTO req FROM public.ai_requests WHERE id = p_request;
  IF NOT FOUND OR NOT public.theme_member(req.store_id) THEN RETURN false; END IF;
  SELECT * INTO wallet FROM public.ai_wallets WHERE store_id = req.store_id FOR UPDATE;
  IF req.status <> 'reserved' THEN RETURN false; END IF;
  PERFORM public.ai_release_locked(p_request, 'failed', p_error, p_in, p_out, p_cost, p_provider, p_model, p_ms);
  RETURN true;
END;
$$;
--> statement-breakpoint
-- ---------------------------------------------------------------- Platform administration (same token, MFA and audit rules as platform_configure)
CREATE FUNCTION public.ai_admin_actor(p_token text, p_fresh boolean, p_owner_only boolean) RETURNS uuid
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce(public.platform_actor(p_token, 'owner', p_fresh), CASE WHEN p_owner_only THEN NULL ELSE public.platform_actor(p_token, 'administrator', p_fresh) END);
$$;
--> statement-breakpoint
CREATE FUNCTION public.ai_admin_overview(p_token text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF public.ai_admin_actor(p_token, false, false) IS NULL THEN RETURN NULL; END IF;
  RETURN jsonb_build_object(
    'settings', (SELECT to_jsonb(s) - 'id' FROM public.ai_settings s WHERE id = 1),
    'costs', (SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY c.operation), '[]'::jsonb) FROM public.ai_operation_costs c),
    'totals', (SELECT jsonb_build_object('requests', count(*), 'succeeded', count(*) FILTER (WHERE status = 'succeeded'),
        'failed', count(*) FILTER (WHERE status IN ('failed', 'expired')), 'inputTokens', coalesce(sum(input_tokens), 0), 'outputTokens', coalesce(sum(output_tokens), 0),
        'costUsd', coalesce(sum(est_cost_usd), 0), 'consumed', coalesce(sum(credits) FILTER (WHERE status = 'succeeded'), 0))
      FROM public.ai_requests WHERE created_at > now() - interval '30 days'),
    'granted', (SELECT jsonb_build_object('allocated', coalesce(sum(delta) FILTER (WHERE kind = 'allocation'), 0),
        'adminGranted', coalesce(sum(delta) FILTER (WHERE kind = 'admin_grant'), 0), 'adminWithdrawn', coalesce(-sum(delta) FILTER (WHERE kind = 'admin_withdraw'), 0))
      FROM public.ai_ledger WHERE created_at > now() - interval '30 days'),
    'top', (SELECT coalesce(jsonb_agg(item ORDER BY (item->>'consumed')::int DESC), '[]'::jsonb) FROM (
        SELECT jsonb_build_object('store', s.name, 'slug', s.slug, 'consumed', sum(r.credits)::int, 'requests', count(*)::int, 'costUsd', coalesce(sum(r.est_cost_usd), 0)) AS item
        FROM public.ai_requests r JOIN public.stores s ON s.id = r.store_id WHERE r.status = 'succeeded' AND r.created_at > now() - interval '30 days'
        GROUP BY s.id ORDER BY sum(r.credits) DESC LIMIT 10) top),
    'failures', (SELECT coalesce(jsonb_agg(item), '[]'::jsonb) FROM (
        SELECT jsonb_build_object('store', s.slug, 'operation', r.operation, 'error', r.error_code, 'at', r.created_at) AS item
        FROM public.ai_requests r JOIN public.stores s ON s.id = r.store_id WHERE r.status IN ('failed', 'expired') ORDER BY r.created_at DESC LIMIT 10) f),
    'suspended', (SELECT coalesce(jsonb_agg(jsonb_build_object('slug', s.slug, 'reason', c.reason)), '[]'::jsonb)
      FROM public.ai_store_controls c JOIN public.stores s ON s.id = c.store_id WHERE c.suspended));
END;
$$;
--> statement-breakpoint
CREATE FUNCTION public.ai_admin_configure(p_token text, p_action text, p_data jsonb) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor uuid; target uuid;
BEGIN
  actor := public.ai_admin_actor(p_token, true, p_action <> 'store_suspend');
  IF actor IS NULL THEN RETURN 'denied'; END IF;
  IF jsonb_typeof(p_data) <> 'object' THEN RETURN 'invalid'; END IF;
  IF p_action = 'settings' THEN
    UPDATE public.ai_settings SET enabled = (p_data->>'enabled')::boolean, per_minute = (p_data->>'perMinute')::int, per_day = (p_data->>'perDay')::int,
      trial_credits = (p_data->>'trialCredits')::int, monthly_credits = (p_data->>'monthlyCredits')::int,
      usd_per_million_input = (p_data->>'usdInput')::numeric, usd_per_million_output = (p_data->>'usdOutput')::numeric, updated_at = now() WHERE id = 1;
  ELSIF p_action = 'cost' THEN
    UPDATE public.ai_operation_costs SET credits = (p_data->>'credits')::int, active = (p_data->>'active')::boolean WHERE operation = p_data->>'operation';
    IF NOT FOUND THEN RETURN 'invalid'; END IF;
  ELSIF p_action = 'store_suspend' THEN
    SELECT id INTO target FROM public.stores WHERE slug = p_data->>'slug';
    IF target IS NULL THEN RETURN 'invalid'; END IF;
    INSERT INTO public.ai_store_controls(store_id, suspended, reason) VALUES (target, (p_data->>'suspended')::boolean, left(nullif(btrim(p_data->>'reason'), ''), 300))
      ON CONFLICT (store_id) DO UPDATE SET suspended = EXCLUDED.suspended, reason = EXCLUDED.reason, updated_at = now();
  ELSE RETURN 'invalid'; END IF;
  PERFORM public.platform_log(actor, target, 'ai_' || p_action, CASE WHEN p_action = 'store_suspend' THEN jsonb_build_object('suspended', p_data->'suspended') ELSE p_data END);
  RETURN 'ok';
EXCEPTION WHEN check_violation OR invalid_text_representation OR numeric_value_out_of_range OR not_null_violation THEN RETURN 'invalid';
END;
$$;
--> statement-breakpoint
-- Manual grant (positive) or withdrawal (negative) on a store's non-expiring "extra" credit. A withdrawal takes extra first, then the current cycle,
-- and never goes below zero. Always written to the immutable ledger with the administrator and to the platform audit log.
CREATE FUNCTION public.ai_admin_adjust(p_token text, p_slug text, p_delta integer, p_note text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor uuid := public.ai_admin_actor(p_token, true, false); target uuid; wallet public.ai_wallets; from_extra integer; from_cycle integer; clean text := left(nullif(btrim(p_note), ''), 300);
BEGIN
  IF actor IS NULL THEN RETURN 'denied'; END IF;
  IF p_delta = 0 OR abs(p_delta) > 100000 OR clean IS NULL THEN RETURN 'invalid'; END IF;
  SELECT id INTO target FROM public.stores WHERE slug = p_slug;
  IF target IS NULL THEN RETURN 'invalid'; END IF;
  wallet := public.ai_sync(target);
  IF p_delta > 0 THEN
    UPDATE public.ai_wallets SET extra = extra + p_delta, updated_at = now() WHERE store_id = target RETURNING * INTO wallet;
    INSERT INTO public.ai_ledger(store_id, kind, delta, balance_after, extra_after, actor_id, note) VALUES (target, 'admin_grant', p_delta, wallet.balance, wallet.extra, actor, clean);
  ELSE
    from_extra := least(wallet.extra, -p_delta); from_cycle := least(wallet.balance, -p_delta - from_extra);
    IF from_extra + from_cycle = 0 THEN RETURN 'invalid'; END IF;
    UPDATE public.ai_wallets SET extra = extra - from_extra, balance = balance - from_cycle, updated_at = now() WHERE store_id = target RETURNING * INTO wallet;
    INSERT INTO public.ai_ledger(store_id, kind, delta, balance_after, extra_after, actor_id, note)
    VALUES (target, 'admin_withdraw', -(from_extra + from_cycle), wallet.balance, wallet.extra, actor, clean);
  END IF;
  PERFORM public.platform_log(actor, target, CASE WHEN p_delta > 0 THEN 'ai_credit_grant' ELSE 'ai_credit_withdraw' END, jsonb_build_object('credits', abs(p_delta)));
  RETURN 'ok';
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.ai_ledger_immutable(), public.ai_release_locked(uuid, text, text, integer, integer, numeric, text, text, integer), public.ai_sync(uuid),
  public.ai_wallet(uuid), public.ai_reserve(uuid, text, uuid), public.ai_commit(uuid, integer, integer, numeric, text, text, integer),
  public.ai_release(uuid, text, integer, integer, numeric, text, text, integer), public.ai_admin_actor(text, boolean, boolean), public.ai_admin_overview(text),
  public.ai_admin_configure(text, text, jsonb), public.ai_admin_adjust(text, text, integer, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.ai_wallet(uuid), public.ai_reserve(uuid, text, uuid), public.ai_commit(uuid, integer, integer, numeric, text, text, integer),
  public.ai_release(uuid, text, integer, integer, numeric, text, text, integer), public.ai_admin_overview(text), public.ai_admin_configure(text, text, jsonb),
  public.ai_admin_adjust(text, text, integer, text) TO storefront_app;
