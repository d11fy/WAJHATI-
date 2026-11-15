CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE public.billing_periods ADD CONSTRAINT billing_periods_no_overlap
  EXCLUDE USING gist (store_id WITH =, tstzrange(starts_at, ends_at, '[)') WITH &&);

INSERT INTO public.billing_config DEFAULT VALUES;
INSERT INTO public.billing_plans(code, version, name, max_products, storage_mib, analytics, luxury, premium) VALUES
  ('starter', 1, 'Starter', 30, 1536, 'basic', false, false),
  ('pro', 1, 'Pro', 200, 12288, 'enhanced', true, true);
INSERT INTO public.billing_subscriptions(store_id, legacy) SELECT id, true FROM public.stores;

CREATE FUNCTION public.billing_owner(p_store uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce(p_store = nullif(current_setting('dar.store_id', true), '')::uuid AND EXISTS (
    SELECT 1 FROM public.store_memberships AS m WHERE m.store_id = p_store AND m.role = 'owner'
      AND m.user_id = nullif(current_setting('dar.user_id', true), '')::uuid), false);
$$;

DO $$
DECLARE target text;
BEGIN
  FOREACH target IN ARRAY ARRAY['billing_subscriptions','billing_trials','billing_requests','billing_periods','billing_reviews','billing_setup_requests','billing_audit'] LOOP
    EXECUTE format('CREATE POLICY billing_owner_read ON public.%I FOR SELECT TO storefront_app USING (public.billing_owner(store_id))', target);
    EXECUTE format('GRANT SELECT ON public.%I TO storefront_app', target);
  END LOOP;
END;
$$;

CREATE FUNCTION public.billing_guard_catalog() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' OR TG_TABLE_NAME = 'billing_plans'
    OR (to_jsonb(NEW) - 'active') IS DISTINCT FROM (to_jsonb(OLD) - 'active')
  THEN RAISE EXCEPTION 'Billing definitions are immutable. Add a new version or record.'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER billing_plan_immutable BEFORE UPDATE OR DELETE ON public.billing_plans
  FOR EACH ROW EXECUTE FUNCTION public.billing_guard_catalog();
CREATE TRIGGER billing_price_immutable BEFORE UPDATE OR DELETE ON public.billing_prices
  FOR EACH ROW EXECUTE FUNCTION public.billing_guard_catalog();
CREATE TRIGGER billing_method_immutable BEFORE UPDATE OR DELETE ON public.billing_methods
  FOR EACH ROW EXECUTE FUNCTION public.billing_guard_catalog();
CREATE TRIGGER billing_package_immutable BEFORE UPDATE OR DELETE ON public.billing_setup_packages
  FOR EACH ROW EXECUTE FUNCTION public.billing_guard_catalog();

CREATE FUNCTION public.billing_state(p_store uuid) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT jsonb_build_object(
    'status', CASE
      WHEN current_term.ends_at > now() THEN 'active'
      WHEN current_term.ends_at IS NOT NULL AND sub.cancel_at = current_term.ends_at THEN 'canceled'
      WHEN current_term.grace_until > now() THEN 'grace_period'
      WHEN current_term.ends_at IS NOT NULL THEN 'suspended'
      WHEN sub.legacy THEN 'active'
      WHEN trial.ends_at > now() THEN 'trialing'
      WHEN pending.present THEN 'pending_payment'
      ELSE 'expired' END,
    'legacy', coalesce(sub.legacy AND current_term.ends_at IS NULL, false),
    'onboarding', current_term.ends_at IS NULL AND trial.ends_at IS NULL AND NOT coalesce(sub.legacy, false),
    'trialEnd', trial.ends_at, 'trialProducts', coalesce(trial.max_products, cfg.trial_products),
    'periodStart', current_term.starts_at, 'periodEnd', current_term.ends_at, 'graceUntil', current_term.grace_until,
    'cancelAt', sub.cancel_at, 'nextPeriod', future.starts_at, 'nextPlan', future.code,
    'pending', coalesce(pending.present, false),
    'plan', plan.code, 'version', plan.version, 'interval', current_term.interval, 'currency', current_term.currency,
    'maxProducts', plan.max_products, 'storageMiB', plan.storage_mib, 'analytics', plan.analytics,
    'luxury', plan.luxury, 'premium', plan.premium)
  FROM public.billing_config AS cfg
  LEFT JOIN public.billing_subscriptions AS sub ON sub.store_id = p_store
  LEFT JOIN public.billing_trials AS trial ON trial.store_id = p_store
  LEFT JOIN LATERAL (
    SELECT term.*, r.plan_id, r.interval, r.currency FROM public.billing_periods AS term
    JOIN public.billing_requests AS r ON r.store_id = term.store_id AND r.id = term.request_id
    WHERE term.store_id = p_store AND term.starts_at <= now() ORDER BY term.starts_at DESC LIMIT 1
  ) AS current_term ON true
  LEFT JOIN public.billing_plans AS plan ON plan.id = current_term.plan_id
  LEFT JOIN LATERAL (
    SELECT term.starts_at, plan.code FROM public.billing_periods AS term
    JOIN public.billing_requests AS r ON r.store_id = term.store_id AND r.id = term.request_id
    JOIN public.billing_plans AS plan ON plan.id = r.plan_id
    WHERE term.store_id = p_store AND term.starts_at > now() ORDER BY term.starts_at LIMIT 1
  ) AS future ON true
  LEFT JOIN LATERAL (
    SELECT true AS present FROM public.billing_requests AS r WHERE r.store_id = p_store
      AND (r.status IN ('submitted','under_review') OR (r.status = 'awaiting_payment' AND r.expires_at > now())) LIMIT 1
  ) AS pending ON true WHERE cfg.id = 1;
$$;

CREATE FUNCTION public.billing_capabilities(p_store uuid) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT jsonb_build_object(
    'publish', state->>'status' IN ('active','trialing','grace_period'),
    'maxProducts', CASE WHEN state->>'legacy' = 'true' THEN 2500
      WHEN state->>'status' IN ('active','grace_period') THEN (state->>'maxProducts')::int
      WHEN state->>'status' = 'trialing' OR state->>'onboarding' = 'true' THEN (state->>'trialProducts')::int
      ELSE 0 END,
    'storageMiB', CASE WHEN state->>'legacy' = 'true' THEN 122880
      WHEN state->>'status' IN ('active','grace_period') THEN (state->>'storageMiB')::int
      WHEN state->>'status' = 'trialing' OR state->>'onboarding' = 'true' THEN 192 ELSE 0 END,
    'analytics', CASE WHEN state->>'legacy' = 'true' THEN 'enhanced'
      WHEN state->>'status' IN ('active','grace_period') THEN state->>'analytics' ELSE 'basic' END,
    'luxury', state->>'legacy' = 'true' OR (state->>'status' IN ('active','grace_period') AND state->>'luxury' = 'true'),
    'premium', state->>'legacy' = 'true' OR (state->>'status' IN ('active','grace_period') AND state->>'premium' = 'true'),
    'customDomain', false)
  FROM (SELECT public.billing_state(p_store) AS state) AS entitlement;
$$;

CREATE FUNCTION public.billing_merchant_state(p_store uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT public.billing_state(p_store) WHERE public.billing_owner(p_store);
$$;

CREATE FUNCTION public.billing_entitlements(p_store uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT public.billing_capabilities(p_store) WHERE public.theme_member(p_store);
$$;

CREATE FUNCTION public.billing_options(p_store uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT jsonb_build_object(
    'trialDays', (SELECT trial_days FROM public.billing_config WHERE id = 1),
    'eligible', EXISTS (SELECT 1 FROM public.billing_verified_accounts v JOIN public.users u ON u.id = v.user_id AND u.email = v.email
      WHERE v.user_id = nullif(current_setting('dar.user_id', true), '')::uuid)
      AND NOT EXISTS (SELECT 1 FROM public.billing_trials t WHERE t.store_id = p_store
        OR t.user_id = nullif(current_setting('dar.user_id', true), '')::uuid)
      AND NOT EXISTS (SELECT 1 FROM public.billing_subscriptions s WHERE s.store_id = p_store),
    'prices', coalesce((SELECT jsonb_agg(jsonb_build_object('id', price.id, 'plan', plan.code,
      'version', plan.version, 'maxProducts', plan.max_products, 'interval', price.interval, 'country', price.country,
      'currency', price.currency, 'amount', price.amount) ORDER BY price.country, price.currency, plan.code, price.interval)
      FROM public.billing_prices price JOIN public.billing_plans plan ON plan.id = price.plan_id
      WHERE price.active AND EXISTS (SELECT 1 FROM public.billing_methods m
        WHERE m.active AND m.country = price.country AND m.currency = price.currency)), '[]'),
    'methods', coalesce((SELECT jsonb_agg(jsonb_build_object('id', m.id, 'country', m.country, 'currency', m.currency, 'label', m.label,
      'instructions', m.instructions) ORDER BY m.label)
      FROM public.billing_methods m WHERE m.active AND EXISTS (SELECT 1 FROM public.billing_prices p WHERE p.active AND p.country = m.country AND p.currency = m.currency)), '[]'),
    'packages', coalesce((SELECT jsonb_agg(jsonb_build_object('id', s.id, 'country', s.country, 'currency', s.currency,
      'label', s.label, 'amount', s.amount) ORDER BY s.label) FROM public.billing_setup_packages s WHERE s.active), '[]'))
  WHERE public.billing_owner(p_store);
$$;

CREATE FUNCTION public.billing_start_trial(p_store uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor uuid := nullif(current_setting('dar.user_id', true), '')::uuid;
BEGIN
  IF NOT public.billing_owner(p_store) THEN RETURN 'denied'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_store::text, 1));
  PERFORM pg_advisory_xact_lock(hashtextextended(actor::text, 12));
  IF EXISTS (SELECT 1 FROM public.billing_subscriptions s WHERE s.store_id = p_store)
    OR EXISTS (SELECT 1 FROM public.billing_trials t WHERE t.user_id = actor OR t.store_id = p_store)
    OR EXISTS (SELECT 1 FROM public.billing_requests r WHERE r.store_id = p_store AND r.status IN ('submitted','under_review'))
    OR NOT EXISTS (SELECT 1 FROM public.billing_verified_accounts v JOIN public.users u ON u.id = v.user_id AND u.email = v.email WHERE v.user_id = actor)
  THEN RETURN 'ineligible'; END IF;
  INSERT INTO public.billing_subscriptions(store_id) VALUES (p_store);
  INSERT INTO public.billing_trials(store_id, user_id, ends_at, max_products)
    SELECT p_store, actor, now() + trial_days * interval '24 hours', trial_products FROM public.billing_config WHERE id = 1;
  INSERT INTO public.billing_audit(store_id, actor_id, event) VALUES (p_store, actor, 'trial_started');
  RETURN 'ok';
END;
$$;

CREATE FUNCTION public.billing_request_payment(p_store uuid, p_key uuid, p_price uuid, p_method uuid, p_setup uuid,
  p_expected integer, p_notes text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor uuid := nullif(current_setting('dar.user_id', true), '')::uuid;
  price public.billing_prices; method public.billing_methods; setup public.billing_setup_packages;
  request public.billing_requests;
BEGIN
  IF NOT public.billing_owner(p_store) THEN RETURN jsonb_build_object('error','denied'); END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_store::text, 1));
  SELECT * INTO request FROM public.billing_requests WHERE store_id = p_store AND idempotency_key = p_key;
  IF FOUND THEN
    IF request.price_id = p_price AND request.method_id = p_method AND request.plan_minor + request.setup_minor = p_expected
      AND p_setup IS NOT DISTINCT FROM (SELECT package_id FROM public.billing_setup_requests WHERE request_id = request.id)
      AND coalesce(p_notes,'') = coalesce((SELECT notes FROM public.billing_setup_requests WHERE request_id = request.id),'')
    THEN RETURN jsonb_build_object('id', request.id); END IF;
    RETURN jsonb_build_object('error','duplicate');
  END IF;
  WITH expired AS (UPDATE public.billing_requests SET status = 'expired' WHERE store_id = p_store
    AND status = 'awaiting_payment' AND expires_at <= now() RETURNING id)
  INSERT INTO public.billing_audit(store_id, request_id, event) SELECT p_store, id, 'request_expired' FROM expired;
  IF EXISTS (SELECT 1 FROM public.billing_requests WHERE store_id = p_store AND status IN ('awaiting_payment','submitted','under_review'))
    OR EXISTS (SELECT 1 FROM public.billing_periods WHERE store_id = p_store AND starts_at > now())
  THEN RETURN jsonb_build_object('error','pending'); END IF;
  SELECT * INTO price FROM public.billing_prices WHERE id = p_price AND active FOR SHARE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','price'); END IF;
  SELECT * INTO method FROM public.billing_methods WHERE id = p_method AND active AND country = price.country AND currency = price.currency FOR SHARE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','price'); END IF;
  IF p_setup IS NOT NULL THEN
    SELECT * INTO setup FROM public.billing_setup_packages WHERE id = p_setup AND active AND country = price.country AND currency = price.currency FOR SHARE;
    IF NOT FOUND OR length(coalesce(p_notes,'')) > 1600 THEN RETURN jsonb_build_object('error','price'); END IF;
  ELSIF coalesce(p_notes,'') <> '' THEN RETURN jsonb_build_object('error','price');
  END IF;
  IF p_expected IS DISTINCT FROM price.amount + coalesce(setup.amount, 0) THEN RETURN jsonb_build_object('error','price'); END IF;
  INSERT INTO public.billing_requests(store_id, requested_by, idempotency_key, reference, price_id, plan_id, interval,
    country, currency, plan_minor, setup_minor, method_id, method_label, instructions, expires_at)
  VALUES (p_store, actor, p_key, 'DAR-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,20)), p_price,
    price.plan_id, price.interval, price.country, price.currency, price.amount, coalesce(setup.amount,0),
    p_method, method.label, method.instructions, now() + interval '72 hours') RETURNING * INTO request;
  IF setup.id IS NOT NULL THEN
    INSERT INTO public.billing_setup_requests(store_id, request_id, package_id, label, notes)
      VALUES (p_store, request.id, setup.id, setup.label, coalesce(p_notes,''));
  END IF;
  INSERT INTO public.billing_audit(store_id, request_id, actor_id, event) VALUES (p_store, request.id, actor, 'payment_requested');
  RETURN jsonb_build_object('id', request.id);
END;
$$;

CREATE FUNCTION public.billing_submit_proof(p_store uuid, p_request uuid, p_reference text, p_content bytea, p_hash text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE request public.billing_requests;
BEGIN
  IF NOT public.billing_owner(p_store) THEN RETURN 'denied'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_store::text, 1));
  SELECT * INTO request FROM public.billing_requests WHERE id = p_request AND store_id = p_store FOR UPDATE;
  IF NOT FOUND THEN RETURN 'denied'; END IF;
  IF p_reference IS NULL OR length(p_reference) NOT BETWEEN 3 AND 100
    OR p_content IS NULL OR octet_length(p_content) NOT BETWEEN 16 AND 5242880
    OR substring(p_content FROM 1 FOR 4) <> convert_to('RIFF', 'UTF8')
    OR substring(p_content FROM 9 FOR 4) <> convert_to('WEBP', 'UTF8')
    OR p_hash IS DISTINCT FROM encode(sha256(p_content), 'hex')
  THEN RETURN 'invalid'; END IF;
  IF request.status IN ('submitted','under_review') AND request.transaction_ref = p_reference
    AND EXISTS (SELECT 1 FROM public.billing_proofs WHERE request_id = p_request AND sha256 = p_hash)
  THEN RETURN 'ok'; END IF;
  IF request.status <> 'awaiting_payment' OR request.expires_at <= now() THEN RETURN 'closed'; END IF;
  INSERT INTO public.billing_proofs(store_id, request_id, sha256, content) VALUES (p_store, p_request, p_hash, p_content)
    ON CONFLICT (sha256) DO NOTHING;
  IF NOT FOUND THEN RETURN 'duplicate'; END IF;
  UPDATE public.billing_requests SET status = 'submitted', transaction_ref = p_reference, submitted_at = now() WHERE id = p_request;
  INSERT INTO public.billing_audit(store_id, request_id, actor_id, event)
    VALUES (p_store, p_request, nullif(current_setting('dar.user_id', true), '')::uuid, 'proof_submitted');
  RETURN 'ok';
END;
$$;

CREATE FUNCTION public.billing_admin_session(p_token text) RETURNS uuid
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT admin.user_id FROM public.billing_admins AS admin JOIN public.sessions AS session ON session.user_id = admin.user_id
  JOIN public.users AS account ON account.id = admin.user_id
  JOIN public.billing_verified_accounts AS verified ON verified.user_id = account.id AND verified.email = account.email
  WHERE octet_length(p_token) = 43 AND session.token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex') AND session.expires_at > now();
$$;

CREATE FUNCTION public.billing_review_access(p_token text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT public.billing_admin_session(p_token) IS NOT NULL;
$$;

CREATE FUNCTION public.billing_review_list(p_token text, p_id uuid, p_pending boolean, p_offset integer)
RETURNS SETOF jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT jsonb_build_object('id', r.id, 'reference', r.reference, 'status', r.status, 'plan', p.code, 'version', p.version,
    'interval', r.interval, 'country', r.country, 'currency', r.currency, 'planMinor', r.plan_minor, 'setupMinor', r.setup_minor,
    'merchant', u.email, 'store', s.name, 'createdAt', r.created_at, 'method', r.method_label, 'transactionRef', r.transaction_ref,
    'reason', review.reason, 'reconciliation', review.reconciliation_ref, 'hasProof', proof.request_id IS NOT NULL,
    'setupLabel', setup.label, 'setupStatus', setup.status, 'setupNotes', setup.notes,
    'mayReview', NOT EXISTS (SELECT 1 FROM public.store_memberships m WHERE m.store_id = r.store_id AND m.user_id = admin.id))
  FROM (SELECT public.billing_admin_session(p_token) AS id) admin
  JOIN public.billing_requests r ON admin.id IS NOT NULL
  JOIN public.billing_plans p ON p.id = r.plan_id JOIN public.stores s ON s.id = r.store_id JOIN public.users u ON u.id = r.requested_by
  LEFT JOIN public.billing_reviews review ON review.request_id = r.id
  LEFT JOIN public.billing_proofs proof ON proof.request_id = r.id
  LEFT JOIN public.billing_setup_requests setup ON setup.request_id = r.id
  WHERE (p_id IS NULL OR r.id = p_id) AND (p_id IS NOT NULL OR CASE WHEN p_pending
    THEN r.status IN ('submitted','under_review') ELSE r.status IN ('approved','rejected','expired') END)
  ORDER BY r.created_at DESC, r.id OFFSET greatest(0, least(20000,p_offset)) LIMIT 21;
$$;

CREATE FUNCTION public.billing_private_proof(p_token text, p_id uuid) RETURNS bytea
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE reviewer uuid := public.billing_admin_session(p_token); proof public.billing_proofs;
BEGIN
  IF reviewer IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO proof FROM public.billing_proofs WHERE request_id = p_id;
  IF NOT FOUND OR EXISTS (SELECT 1 FROM public.store_memberships WHERE store_id = proof.store_id AND user_id = reviewer)
  THEN RETURN NULL; END IF;
  INSERT INTO public.billing_audit(store_id, request_id, actor_id, event) VALUES (proof.store_id, p_id, reviewer, 'proof_downloaded');
  RETURN proof.content;
END;
$$;

CREATE FUNCTION public.billing_period_end(p_start timestamptz, p_interval public.billing_interval) RETURNS timestamptz
LANGUAGE sql IMMUTABLE STRICT SET search_path = pg_catalog, pg_temp AS $$
  SELECT ((p_start AT TIME ZONE 'UTC') + CASE WHEN p_interval = 'yearly' THEN interval '1 year' ELSE interval '1 month' END) AT TIME ZONE 'UTC';
$$;

CREATE FUNCTION public.billing_review_payment(p_token text, p_id uuid, p_action text, p_amount integer, p_currency public.currency_code,
  p_transfer text, p_independent text, p_reason text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE reviewer uuid := public.billing_admin_session(p_token); tenant uuid; request public.billing_requests;
  first_day timestamptz; last_day timestamptz;
BEGIN
  IF reviewer IS NULL THEN RETURN 'denied'; END IF;
  SELECT store_id INTO tenant FROM public.billing_requests WHERE id = p_id;
  IF NOT FOUND OR EXISTS (SELECT 1 FROM public.store_memberships WHERE store_id = tenant AND user_id = reviewer)
  THEN RETURN 'denied'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(tenant::text, 1));
  SELECT * INTO request FROM public.billing_requests WHERE id = p_id FOR UPDATE;
  IF p_action = 'complete_setup' THEN
    UPDATE public.billing_setup_requests SET status = 'completed' WHERE request_id = p_id AND status = 'paid';
    IF NOT FOUND THEN RETURN 'closed'; END IF;
  ELSIF p_action = 'review' THEN
    IF request.status = 'under_review' THEN RETURN 'ok'; END IF;
    IF request.status <> 'submitted' THEN RETURN 'closed'; END IF;
    UPDATE public.billing_requests SET status = 'under_review' WHERE id = p_id;
  ELSIF p_action = 'reject' THEN
    IF request.status NOT IN ('submitted','under_review') THEN RETURN 'closed'; END IF;
    IF p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 3 AND 800 THEN RETURN 'invalid'; END IF;
    INSERT INTO public.billing_reviews(store_id, request_id, reviewer, approved, reason)
      VALUES (tenant, p_id, reviewer, false, btrim(p_reason));
    UPDATE public.billing_requests SET status = 'rejected', reviewed_at = now() WHERE id = p_id;
    UPDATE public.billing_setup_requests SET status = 'closed' WHERE request_id = p_id;
  ELSIF p_action = 'approve' THEN
    IF request.status NOT IN ('submitted','under_review') THEN RETURN 'closed'; END IF;
    IF p_amount IS DISTINCT FROM request.plan_minor + request.setup_minor OR p_currency IS DISTINCT FROM request.currency
      OR p_transfer IS DISTINCT FROM request.transaction_ref OR p_independent IS NULL OR length(btrim(p_independent)) NOT BETWEEN 3 AND 120
      OR NOT EXISTS (SELECT 1 FROM public.billing_proofs WHERE request_id = p_id)
    THEN RETURN 'invalid'; END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended(request.method_id::text || ':' || lower(p_transfer), 21));
    IF EXISTS (SELECT 1 FROM public.billing_requests r WHERE r.method_id = request.method_id
      AND lower(r.transaction_ref) = lower(p_transfer) AND r.status = 'approved')
    THEN RETURN 'duplicate'; END IF;
    IF EXISTS (SELECT 1 FROM public.billing_periods WHERE store_id = tenant AND starts_at > now()) THEN RETURN 'pending'; END IF;
    SELECT greatest(now(), max(ends_at)) INTO first_day FROM public.billing_periods WHERE store_id = tenant;
    last_day := public.billing_period_end(first_day, request.interval);
    INSERT INTO public.billing_subscriptions(store_id) VALUES (tenant)
      ON CONFLICT (store_id) DO UPDATE SET cancel_at = NULL, cancel_requested_at = NULL;
    INSERT INTO public.billing_periods(store_id, request_id, starts_at, ends_at, grace_until)
      SELECT tenant, p_id, first_day, last_day, last_day + grace_days * interval '24 hours' FROM public.billing_config WHERE id = 1;
    INSERT INTO public.billing_reviews(store_id, request_id, reviewer, approved, reconciliation_ref)
      VALUES (tenant, p_id, reviewer, true, btrim(p_independent));
    UPDATE public.billing_requests SET status = 'approved', reviewed_at = now() WHERE id = p_id;
    UPDATE public.billing_setup_requests SET status = 'paid' WHERE request_id = p_id;
  ELSE RETURN 'invalid'; END IF;
  INSERT INTO public.billing_audit(store_id, request_id, actor_id, event) VALUES (tenant, p_id, reviewer, p_action);
  RETURN 'ok';
END;
$$;

CREATE FUNCTION public.billing_cancel_at_end(p_store uuid, p_cancel boolean) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE deadline timestamptz;
BEGIN
  IF NOT public.billing_owner(p_store) THEN RETURN 'denied'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_store::text, 1));
  IF EXISTS (SELECT 1 FROM public.billing_periods WHERE store_id = p_store AND starts_at > now())
    OR EXISTS (SELECT 1 FROM public.billing_requests WHERE store_id = p_store
      AND (status IN ('submitted','under_review') OR (status = 'awaiting_payment' AND expires_at > now())))
  THEN RETURN 'pending'; END IF;
  SELECT ends_at INTO deadline FROM public.billing_periods WHERE store_id = p_store AND starts_at <= now() AND ends_at > now();
  IF NOT FOUND THEN RETURN 'closed'; END IF;
  UPDATE public.billing_subscriptions SET cancel_at = CASE WHEN p_cancel THEN deadline END,
    cancel_requested_at = CASE WHEN p_cancel THEN now() END
    WHERE store_id = p_store AND (cancel_at IS NOT NULL) IS DISTINCT FROM p_cancel;
  IF FOUND THEN
    INSERT INTO public.billing_audit(store_id, actor_id, event)
      VALUES (p_store, nullif(current_setting('dar.user_id', true), '')::uuid, CASE WHEN p_cancel THEN 'cancel_scheduled' ELSE 'cancel_removed' END);
  END IF;
  RETURN 'ok';
END;
$$;

CREATE FUNCTION public.billing_expire(p_limit integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE requests integer; subscriptions integer; proofs integer;
BEGIN
  WITH due AS (SELECT id FROM public.billing_requests WHERE status = 'awaiting_payment' AND expires_at <= now()
    ORDER BY expires_at, id LIMIT least(greatest(p_limit,1),1000) FOR UPDATE SKIP LOCKED),
  expired AS (UPDATE public.billing_requests r SET status = 'expired' FROM due WHERE r.id = due.id RETURNING r.store_id,r.id)
  INSERT INTO public.billing_audit(store_id, request_id, event) SELECT store_id,id,'request_expired' FROM expired;
  GET DIAGNOSTICS requests = ROW_COUNT;
  WITH due AS (SELECT s.store_id, (public.billing_state(s.store_id)->>'status')::public.billing_subscription_status AS state
    FROM public.billing_subscriptions s
    WHERE s.observed_status IS DISTINCT FROM (public.billing_state(s.store_id)->>'status')::public.billing_subscription_status
    ORDER BY s.store_id LIMIT least(greatest(p_limit,1),1000) FOR UPDATE OF s SKIP LOCKED),
  changed AS (UPDATE public.billing_subscriptions s SET observed_status = due.state, observed_at = now()
    FROM due WHERE s.store_id = due.store_id RETURNING s.store_id, s.observed_status)
  INSERT INTO public.billing_audit(store_id,event) SELECT store_id,'subscription_' || observed_status::text FROM changed;
  GET DIAGNOSTICS subscriptions = ROW_COUNT;
  WITH due AS (SELECT p.request_id FROM public.billing_proofs p JOIN public.billing_requests r ON r.id = p.request_id
    WHERE r.reviewed_at <= now() - interval '180 days' ORDER BY r.reviewed_at,p.request_id
    LIMIT least(greatest(p_limit,1),1000) FOR UPDATE OF p SKIP LOCKED),
  purged AS (DELETE FROM public.billing_proofs p USING due WHERE p.request_id = due.request_id RETURNING p.store_id,p.request_id)
  INSERT INTO public.billing_audit(store_id, request_id,event) SELECT store_id,request_id,'proof_purged' FROM purged;
  GET DIAGNOSTICS proofs = ROW_COUNT;
  UPDATE public.billing_setup_requests AS s SET status = 'closed' FROM public.billing_requests AS r
    WHERE s.request_id = r.id AND s.status = 'awaiting_payment' AND r.status = 'expired';
  RETURN jsonb_build_object('requests',requests,'subscriptions',subscriptions,'proofs',proofs);
END;
$$;

DO $$
DECLARE fn regprocedure;
BEGIN
  FOR fn IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname LIKE 'billing_%'
  LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn); END LOOP;
END;
$$;
GRANT EXECUTE ON FUNCTION public.billing_owner(uuid), public.billing_merchant_state(uuid), public.billing_entitlements(uuid),
  public.billing_options(uuid), public.billing_start_trial(uuid), public.billing_request_payment(uuid,uuid,uuid,uuid,uuid,integer,text),
  public.billing_submit_proof(uuid,uuid,text,bytea,text), public.billing_review_access(text), public.billing_review_list(text,uuid,boolean,integer),
  public.billing_private_proof(text,uuid), public.billing_review_payment(text,uuid,text,integer,public.currency_code,text,text,text),
  public.billing_cancel_at_end(uuid,boolean) TO storefront_app;
GRANT EXECUTE ON FUNCTION public.billing_expire(integer) TO storefront_media_worker;
