INSERT INTO public.platform_legacy(store_id,until)
SELECT store_id,now()+interval '90 days' FROM public.billing_subscriptions WHERE legacy;

CREATE OR REPLACE FUNCTION public.get_public_store(p_slug text)
RETURNS TABLE(name varchar,slug varchar,country public.country_code,currency public.currency_code)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
  SELECT s.name,s.slug,s.country,s.currency FROM public.stores s
  WHERE s.slug=p_slug AND s.published_at<=now()
    AND NOT EXISTS (SELECT 1 FROM public.platform_controls c WHERE c.store_id=s.id AND c.suspended)
    AND EXISTS (SELECT 1 FROM public.catalog_products p WHERE p.store_id=s.id AND p.state='published');
$$;

ALTER FUNCTION public.billing_start_trial(uuid) RENAME TO billing_start_trial_v5;
REVOKE EXECUTE ON FUNCTION public.billing_start_trial_v5(uuid) FROM storefront_app;
CREATE FUNCTION public.billing_start_trial(p_store uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
  IF NOT public.billing_owner(p_store) THEN RETURN 'denied'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_store::text,1));
  IF NOT EXISTS(SELECT 1 FROM public.platform_policy WHERE id=1 AND allow_trials)
    OR EXISTS(SELECT 1 FROM public.platform_controls WHERE store_id=p_store AND (suspended OR hold))
  THEN RETURN 'ineligible'; END IF;
  RETURN public.billing_start_trial_v5(p_store);
END;
$$;

CREATE OR REPLACE FUNCTION public.billing_admin_session(p_token text) RETURNS uuid
LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $$
  SELECT public.platform_actor(p_token,'reviewer',false);
$$;

ALTER FUNCTION public.billing_review_payment(text,uuid,text,integer,public.currency_code,text,text,text) RENAME TO billing_review_payment_v5;
REVOKE EXECUTE ON FUNCTION public.billing_review_payment_v5(text,uuid,text,integer,public.currency_code,text,text,text) FROM storefront_app;
CREATE FUNCTION public.billing_review_payment(p_token text,p_id uuid,p_action text,p_amount integer,p_currency public.currency_code,
  p_transfer text,p_independent text,p_reason text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE actor uuid := public.platform_actor(p_token,'reviewer',true); r public.billing_requests;
  proposal public.platform_payment_checks; result text; threshold integer;
BEGIN
  IF actor IS NULL THEN RETURN 'denied'; END IF;
  SELECT * INTO r FROM public.billing_requests WHERE id=p_id;
  IF NOT FOUND OR EXISTS(SELECT 1 FROM public.store_memberships WHERE store_id=r.store_id AND user_id=actor) THEN RETURN 'denied'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(r.store_id::text,1));
  SELECT * INTO r FROM public.billing_requests WHERE id=p_id FOR UPDATE;
  IF p_action='approve' THEN
    IF r.status NOT IN ('submitted','under_review') THEN RETURN 'closed'; END IF;
    IF p_amount IS DISTINCT FROM r.plan_minor+r.setup_minor OR p_currency IS DISTINCT FROM r.currency
      OR p_transfer IS DISTINCT FROM r.transaction_ref OR p_independent IS NULL OR length(btrim(p_independent)) NOT BETWEEN 3 AND 120
      OR NOT EXISTS(SELECT 1 FROM public.billing_proofs WHERE request_id=p_id)
    THEN RETURN 'invalid'; END IF;
    SELECT (dual_thresholds->>r.currency::text)::int INTO threshold FROM public.platform_policy WHERE id=1;
    SELECT * INTO proposal FROM public.platform_payment_checks WHERE request_id=p_id;
    IF FOUND THEN
      IF proposal.reviewer=actor THEN RETURN 'independent'; END IF;
      IF proposal.reconciliation<>btrim(p_independent) THEN RETURN 'invalid'; END IF;
    ELSIF threshold IS NOT NULL AND p_amount>=threshold THEN
      INSERT INTO public.platform_payment_checks(request_id,reviewer,reconciliation) VALUES(p_id,actor,btrim(p_independent));
      UPDATE public.billing_requests SET status='under_review' WHERE id=p_id;
      PERFORM public.platform_log(actor,p_id,'payment_first_approval',jsonb_build_object('store',r.store_id));
      RETURN 'secondReview';
    END IF;
  END IF;
  result:=public.billing_review_payment_v5(p_token,p_id,p_action,p_amount,p_currency,p_transfer,p_independent,p_reason);
  IF result='ok' AND p_action IN ('approve','reject','review','complete_setup') THEN
    PERFORM public.platform_log(actor,p_id,'payment_'||p_action,jsonb_build_object('store',r.store_id,'dual',proposal.request_id IS NOT NULL));
  END IF;
  RETURN result;
END;
$$;

CREATE FUNCTION public.platform_payment_stage(p_token text,p_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
  SELECT jsonb_build_object('waiting',c.request_id IS NOT NULL,'initiatedHere',coalesce(c.reviewer=actor.id,false),
    'source',exists(select 1 from public.platform_proof_sources where request_id=p_id))
  FROM (SELECT public.platform_actor(p_token,'reviewer',false) AS id) actor
  LEFT JOIN public.platform_payment_checks c ON c.request_id=p_id WHERE actor.id IS NOT NULL;
$$;

ALTER FUNCTION public.billing_private_proof(text,uuid) RENAME TO billing_private_proof_v5;
REVOKE EXECUTE ON FUNCTION public.billing_private_proof_v5(text,uuid) FROM storefront_app;
CREATE FUNCTION public.billing_private_proof(p_token text,p_id uuid) RETURNS bytea
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE actor uuid:=public.platform_actor(p_token,'reviewer',true); body bytea;
BEGIN
  IF actor IS NULL THEN RETURN NULL; END IF;
  body:=public.billing_private_proof_v5(p_token,p_id);
  IF body IS NOT NULL THEN PERFORM public.platform_log(actor,p_id,'proof_preview_downloaded'); END IF;
  RETURN body;
END;
$$;

CREATE FUNCTION public.platform_proof_source(p_token text,p_id uuid) RETURNS TABLE(cipher bytea,original_type text,sha256 varchar)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE actor uuid:=public.platform_actor(p_token,'reviewer',true); tenant uuid;
BEGIN
  IF actor IS NULL THEN RETURN; END IF;
  SELECT store_id INTO tenant FROM public.billing_proofs WHERE request_id=p_id;
  IF NOT FOUND OR EXISTS(SELECT 1 FROM public.store_memberships WHERE store_id=tenant AND user_id=actor) THEN RETURN; END IF;
  RETURN QUERY SELECT s.cipher,s.original_type,s.sha256 FROM public.platform_proof_sources s WHERE s.request_id=p_id;
  IF FOUND THEN PERFORM public.platform_log(actor,p_id,'proof_original_downloaded'); END IF;
END;
$$;

CREATE FUNCTION public.platform_archive_proof(p_store uuid,p_id uuid,p_cipher bytea,p_type text,p_hash text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
  IF NOT public.billing_owner(p_store) OR NOT EXISTS(SELECT 1 FROM public.billing_proofs WHERE store_id=p_store AND request_id=p_id)
  THEN RETURN false; END IF;
  INSERT INTO public.platform_proof_sources(request_id,cipher,original_type,sha256) VALUES(p_id,p_cipher,p_type,p_hash)
  ON CONFLICT(request_id) DO NOTHING;
  RETURN EXISTS(SELECT 1 FROM public.platform_proof_sources WHERE request_id=p_id AND sha256=p_hash);
END;
$$;

CREATE FUNCTION public.platform_support(p_token text,p_store uuid,p_action text,p_reason text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE actor uuid:=coalesce(public.platform_actor(p_token,'owner',true),public.platform_actor(p_token,'administrator',true));
BEGIN
  IF actor IS NULL THEN RETURN 'denied'; END IF;
  IF p_reason NOT IN ('security','abuse','support','billing') OR p_reason IS NULL
    OR p_action NOT IN ('suspend','restore','hold','release','end_legacy') THEN RETURN 'invalid'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_store::text,1));
  IF NOT EXISTS(SELECT 1 FROM public.stores WHERE id=p_store) THEN RETURN 'invalid'; END IF;
  IF p_action='end_legacy' THEN
    UPDATE public.platform_legacy SET until=now() WHERE store_id=p_store AND until>now();
    IF NOT FOUND THEN RETURN 'invalid'; END IF;
    PERFORM public.platform_log(actor,p_store,'subscription_override',jsonb_build_object('reason',p_reason,'operation',p_action));
  ELSE
    INSERT INTO public.platform_controls(store_id) VALUES(p_store) ON CONFLICT(store_id) DO NOTHING;
    UPDATE public.platform_controls SET changed_at=now(),
      suspended=CASE p_action WHEN 'suspend' THEN true WHEN 'restore' THEN false ELSE suspended END,
      hold=CASE p_action WHEN 'hold' THEN true WHEN 'release' THEN false ELSE hold END WHERE store_id=p_store;
    PERFORM public.platform_log(actor,p_store,'store_'||p_action,jsonb_build_object('reason',p_reason));
  END IF;
  RETURN 'ok';
END;
$$;

CREATE FUNCTION public.platform_role_change(p_token text,p_user uuid,p_role public.platform_role,p_grant boolean) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE actor uuid:=public.platform_actor(p_token,'owner',true);
BEGIN
  IF actor IS NULL THEN RETURN 'denied'; END IF;
  IF actor=p_user OR NOT EXISTS (SELECT 1 FROM public.users u JOIN public.billing_verified_accounts v
    ON v.user_id=u.id AND v.email=u.email WHERE u.id=p_user) THEN RETURN 'invalid'; END IF;
  PERFORM pg_advisory_xact_lock(781690423);
  IF p_grant THEN
    INSERT INTO public.platform_roles(user_id,role) VALUES(p_user,p_role) ON CONFLICT DO NOTHING;
  ELSE
    DELETE FROM public.platform_roles WHERE user_id=p_user AND role=p_role;
  END IF;
  IF FOUND THEN
    DELETE FROM public.sessions WHERE user_id=p_user;
    PERFORM public.platform_log(actor,p_user,CASE WHEN p_grant THEN 'role_granted' ELSE 'role_revoked' END,jsonb_build_object('role',p_role));
  END IF;
  RETURN 'ok';
END;
$$;

CREATE FUNCTION public.platform_configure(p_token text,p_action text,p_data jsonb) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE actor uuid:=public.platform_actor(p_token,'owner',true); target uuid; pair record;
BEGIN
  IF actor IS NULL THEN RETURN 'denied'; END IF;
  IF jsonb_typeof(p_data)<>'object' THEN RETURN 'invalid'; END IF;
  IF p_action='rules' THEN
    IF jsonb_typeof(p_data->'dual') IS DISTINCT FROM 'object' THEN RETURN 'invalid'; END IF;
    FOR pair IN SELECT * FROM jsonb_each(p_data->'dual') LOOP
      PERFORM pair.key::public.currency_code;
      IF jsonb_typeof(pair.value)<>'number' OR (pair.value::text)::int NOT BETWEEN 1 AND 2000000000 THEN RETURN 'invalid'; END IF;
    END LOOP;
    UPDATE public.billing_config SET trial_days=(p_data->>'trialDays')::int,trial_products=(p_data->>'trialProducts')::int,grace_days=(p_data->>'graceDays')::int WHERE id=1;
    UPDATE public.platform_policy SET dual_thresholds=p_data->'dual',allow_trials=(p_data->>'allowTrials')::boolean,luxury_enabled=(p_data->>'luxury')::boolean WHERE id=1;
  ELSIF p_action='plan' THEN
    INSERT INTO public.billing_plans(code,version,name,max_products,storage_mib,analytics,luxury,premium)
    VALUES(p_data->>'code',(p_data->>'version')::int,left(p_data->>'name',100),(p_data->>'products')::int,(p_data->>'storage')::int,
      p_data->>'analytics',(p_data->>'luxury')::boolean,(p_data->>'premium')::boolean) RETURNING id INTO target;
  ELSIF p_action='price' THEN
    INSERT INTO public.billing_prices(plan_id,country,currency,interval,amount)
    VALUES((p_data->>'plan')::uuid,(p_data->>'country')::public.country_code,(p_data->>'currency')::public.currency_code,
      (p_data->>'interval')::public.billing_interval,(p_data->>'amount')::int) RETURNING id INTO target;
  ELSIF p_action='method' THEN
    INSERT INTO public.billing_methods(country,currency,label,instructions)
    VALUES((p_data->>'country')::public.country_code,(p_data->>'currency')::public.currency_code,p_data->>'label',p_data->>'instructions') RETURNING id INTO target;
  ELSIF p_action='setup' THEN
    INSERT INTO public.billing_setup_packages(country,currency,label,amount)
    VALUES((p_data->>'country')::public.country_code,(p_data->>'currency')::public.currency_code,p_data->>'label',(p_data->>'amount')::int) RETURNING id INTO target;
  ELSIF p_action IN ('price_active','method_active','setup_active') THEN
    target:=(p_data->>'id')::uuid;
    IF p_action='price_active' THEN UPDATE public.billing_prices SET active=(p_data->>'active')::boolean WHERE id=target;
    ELSIF p_action='method_active' THEN UPDATE public.billing_methods SET active=(p_data->>'active')::boolean WHERE id=target;
    ELSE UPDATE public.billing_setup_packages SET active=(p_data->>'active')::boolean WHERE id=target; END IF;
    IF NOT FOUND THEN RETURN 'invalid'; END IF;
  ELSE RETURN 'invalid'; END IF;
  PERFORM public.platform_log(actor,target,'configuration_'||p_action,
    CASE WHEN p_action='rules' THEN p_data ELSE '{}'::jsonb END);
  RETURN 'ok';
EXCEPTION WHEN check_violation OR unique_violation OR foreign_key_violation OR not_null_violation OR invalid_text_representation OR numeric_value_out_of_range
  THEN RETURN 'invalid';
END;
$$;

CREATE FUNCTION public.platform_query(p_token text,p_area text,p_search text,p_offset integer,p_filter text) RETURNS SETOF jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE manager uuid:=coalesce(public.platform_actor(p_token,'owner',false),public.platform_actor(p_token,'administrator',false));
  reviewer uuid:=public.platform_actor(p_token,'reviewer',false);
  q text:=left(coalesce(p_search,''),100); start_at integer:=greatest(0,least(p_offset,20000));
BEGIN
  IF manager IS NULL AND (reviewer IS NULL OR p_area NOT IN ('payments','setup')) THEN RETURN; END IF;
  IF p_area='overview' THEN RETURN QUERY SELECT jsonb_build_object(
    'merchants',(SELECT count(DISTINCT user_id) FROM public.store_memberships WHERE role='owner'),
    'stores',(SELECT count(*) FROM public.stores),
    'approved',(SELECT count(*) FROM public.billing_requests WHERE status='approved'),
    'pending',(SELECT count(*) FROM public.billing_requests WHERE status IN ('submitted','under_review')),
    'suspended',(SELECT count(*) FROM public.platform_controls WHERE suspended),
    'legacy',(SELECT count(*) FROM public.platform_legacy WHERE until>now()),
    'setup',(SELECT count(*) FROM public.billing_setup_requests WHERE status='paid'));
  ELSIF p_area='merchants' THEN RETURN QUERY
    SELECT jsonb_build_object('id',u.id,'name',u.name,'email',u.email,'verified',v.user_id IS NOT NULL,
      'stores',(SELECT count(*) FROM public.store_memberships m WHERE m.user_id=u.id AND m.role='owner'),
      'trialUsed',EXISTS(SELECT 1 FROM public.billing_trials WHERE user_id=u.id),
      'roles',coalesce((SELECT jsonb_agg(role) FROM public.platform_roles WHERE user_id=u.id),'[]'::jsonb))
    FROM public.users u LEFT JOIN public.billing_verified_accounts v ON v.user_id=u.id AND v.email=u.email
    WHERE (q='' OR strpos(lower(u.name),lower(q))>0 OR strpos(lower(u.email),lower(q))>0)
      AND (p_filter='' OR (p_filter='verified')=(v.user_id IS NOT NULL))
    ORDER BY u.created_at DESC,u.id OFFSET start_at LIMIT 21;
  ELSIF p_area IN ('stores','subscriptions','themes') THEN RETURN QUERY
    SELECT jsonb_build_object('id',s.id,'name',s.name,'slug',s.slug,'country',s.country,'published',s.published_at IS NOT NULL,
      'suspended',coalesce(c.suspended,false),'hold',coalesce(c.hold,false),'legacyUntil',l.until,'billing',state.value,
      'products',(SELECT count(*) FROM public.catalog_products WHERE store_id=s.id AND state<>'archived'),
      'storageBytes',public.billing_storage_used(s.id),'orders',(SELECT count(*) FROM public.order_intents WHERE store_id=s.id),
      'theme',d.published->>'theme','updated',greatest(s.created_at,c.changed_at,d.published_at),
      'lastBilling',(SELECT max(created_at) FROM public.billing_requests WHERE store_id=s.id))
    FROM public.stores s LEFT JOIN public.platform_controls c ON c.store_id=s.id LEFT JOIN public.platform_legacy l ON l.store_id=s.id
    LEFT JOIN public.store_designs d ON d.store_id=s.id CROSS JOIN LATERAL (SELECT public.billing_state(s.id) AS value) state
    WHERE (q='' OR strpos(lower(s.name),lower(q))>0 OR strpos(s.slug,lower(q))>0)
      AND (p_filter='' OR (p_filter='suspended' AND c.suspended) OR (p_filter='legacy' AND l.until>now()) OR state.value->>'status'=p_filter)
    ORDER BY s.created_at DESC,s.id OFFSET start_at LIMIT 21;
  ELSIF p_area IN ('payments','setup') THEN RETURN QUERY
    SELECT jsonb_build_object('id',r.id,'reference',r.reference,'store',s.name,'status',r.status,'currency',r.currency,
      'amount',r.plan_minor+r.setup_minor,'createdAt',r.created_at,'setup',x.label,'setupStatus',x.status,
      'dual',c.request_id IS NOT NULL,'canReview',reviewer IS NOT NULL)
    FROM public.billing_requests r JOIN public.stores s ON s.id=r.store_id LEFT JOIN public.billing_setup_requests x ON x.request_id=r.id
    LEFT JOIN public.platform_payment_checks c ON c.request_id=r.id
    WHERE (p_area<>'setup' OR x.request_id IS NOT NULL) AND (q='' OR strpos(lower(r.reference),lower(q))>0 OR strpos(lower(s.name),lower(q))>0)
      AND (p_filter='' OR r.status::text=p_filter OR x.status=p_filter)
    ORDER BY r.created_at DESC,r.id OFFSET start_at LIMIT 21;
  ELSIF p_area='plans' THEN RETURN QUERY SELECT jsonb_build_object(
    'plans',coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY code,version DESC) FROM public.billing_plans p),'[]'::jsonb),
    'prices',coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY country,currency) FROM public.billing_prices p),'[]'::jsonb),
    'methods',coalesce((SELECT jsonb_agg(CASE WHEN public.platform_actor(p_token,'owner',false) IS NULL
      THEN to_jsonb(m)-'instructions' ELSE to_jsonb(m) END ORDER BY country,currency) FROM public.billing_methods m),'[]'::jsonb),
    'setups',coalesce((SELECT jsonb_agg(to_jsonb(s) ORDER BY country,currency) FROM public.billing_setup_packages s),'[]'::jsonb));
  ELSIF p_area='settings' THEN RETURN QUERY SELECT to_jsonb(p)||to_jsonb(c) FROM public.platform_policy p JOIN public.billing_config c USING(id);
  ELSIF p_area='audit' THEN RETURN QUERY
    SELECT to_jsonb(e) FROM public.platform_events e WHERE q='' OR strpos(e.action,lower(q))>0 ORDER BY id DESC OFFSET start_at LIMIT 21;
  ELSIF p_area='jobs' THEN RETURN QUERY
    SELECT to_jsonb(j) FROM public.platform_jobs j WHERE q='' OR strpos(j.job,lower(q))>0 ORDER BY started_at DESC OFFSET start_at LIMIT 21;
  END IF;
END;
$$;

CREATE FUNCTION public.platform_job_start(p_job text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE run uuid;
BEGIN
  IF p_job NOT IN ('media','orders','billing') THEN RETURN NULL; END IF;
  DELETE FROM public.platform_jobs WHERE started_at<now()-interval '90 days';
  IF p_job='billing' THEN
    DELETE FROM public.identity_tokens WHERE expires_at<now();
    DELETE FROM public.identity_changes WHERE expires_at<now();
    DELETE FROM public.sessions WHERE expires_at<now();
  END IF;
  INSERT INTO public.platform_jobs(job) VALUES(p_job) RETURNING id INTO run;
  RETURN run;
END;
$$;
CREATE FUNCTION public.platform_job_finish(p_run uuid,p_success boolean,p_counts jsonb) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
  UPDATE public.platform_jobs SET finished_at=now(),success=p_success,details=p_counts
    WHERE id=p_run AND finished_at IS NULL;
$$;

REVOKE ALL ON FUNCTION public.billing_start_trial(uuid),public.billing_review_payment(text,uuid,text,integer,public.currency_code,text,text,text),
  public.billing_private_proof(text,uuid),public.platform_payment_stage(text,uuid),public.platform_proof_source(text,uuid),
  public.platform_archive_proof(uuid,uuid,bytea,text,text),public.platform_support(text,uuid,text,text),
  public.platform_role_change(text,uuid,public.platform_role,boolean),public.platform_configure(text,text,jsonb),
  public.platform_query(text,text,text,integer,text),public.platform_job_start(text),public.platform_job_finish(uuid,boolean,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.billing_start_trial(uuid),public.billing_review_payment(text,uuid,text,integer,public.currency_code,text,text,text),
  public.billing_private_proof(text,uuid),public.platform_payment_stage(text,uuid),public.platform_proof_source(text,uuid),
  public.platform_archive_proof(uuid,uuid,bytea,text,text),public.platform_support(text,uuid,text,text),
  public.platform_role_change(text,uuid,public.platform_role,boolean),public.platform_configure(text,text,jsonb),
  public.platform_query(text,text,text,integer,text) TO storefront_app;
GRANT EXECUTE ON FUNCTION public.platform_job_start(text),public.platform_job_finish(uuid,boolean,jsonb) TO storefront_media_worker;
CREATE OR REPLACE FUNCTION public.billing_state(p_store uuid) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT jsonb_build_object(
    'status', CASE
      WHEN current_term.ends_at > now() THEN 'active'
      WHEN current_term.ends_at IS NOT NULL AND sub.cancel_at = current_term.ends_at THEN 'canceled'
      WHEN current_term.grace_until > now() THEN 'grace_period'
      WHEN current_term.ends_at IS NOT NULL THEN 'suspended'
      WHEN sub.legacy AND legacy.until>now() THEN 'active'
      WHEN trial.ends_at > now() THEN 'trialing'
      WHEN pending.present THEN 'pending_payment'
      ELSE 'expired' END,
    'legacy', coalesce(sub.legacy AND legacy.until>now() AND current_term.ends_at IS NULL, false),
    'onboarding', current_term.ends_at IS NULL AND trial.ends_at IS NULL AND NOT coalesce(sub.legacy, false),
    'legacyUntil', legacy.until, 'trialEnd', trial.ends_at, 'trialProducts', coalesce(trial.max_products, cfg.trial_products),
    'periodStart', current_term.starts_at, 'periodEnd', current_term.ends_at, 'graceUntil', current_term.grace_until,
    'cancelAt', sub.cancel_at, 'nextPeriod', future.starts_at, 'nextPlan', future.code,
    'pending', coalesce(pending.present, false),
    'plan', plan.code, 'version', plan.version, 'interval', current_term.interval, 'currency', current_term.currency,
    'maxProducts', plan.max_products, 'storageMiB', plan.storage_mib, 'analytics', plan.analytics,
    'luxury', plan.luxury, 'premium', plan.premium)
  FROM public.billing_config AS cfg
  LEFT JOIN public.billing_subscriptions AS sub ON sub.store_id = p_store
  LEFT JOIN public.platform_legacy legacy ON legacy.store_id=p_store LEFT JOIN public.billing_trials AS trial ON trial.store_id = p_store
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


CREATE OR REPLACE FUNCTION public.billing_capabilities(p_store uuid) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT jsonb_build_object(
    'publish', state->>'status' IN ('active','trialing','grace_period') AND NOT EXISTS(SELECT 1 FROM public.platform_controls WHERE store_id=p_store AND (hold OR suspended)),
    'maxProducts', CASE WHEN state->>'legacy' = 'true' THEN 2500
      WHEN state->>'status' IN ('active','grace_period') THEN (state->>'maxProducts')::int
      WHEN state->>'status' = 'trialing' OR state->>'onboarding' = 'true' THEN (state->>'trialProducts')::int
      ELSE 0 END,
    'storageMiB', CASE WHEN state->>'legacy' = 'true' THEN 122880
      WHEN state->>'status' IN ('active','grace_period') THEN (state->>'storageMiB')::int
      WHEN state->>'status' = 'trialing' OR state->>'onboarding' = 'true' THEN 192 ELSE 0 END,
    'analytics', CASE WHEN state->>'legacy' = 'true' THEN 'enhanced'
      WHEN state->>'status' IN ('active','grace_period') THEN state->>'analytics' ELSE 'basic' END,
    'luxury', EXISTS(SELECT 1 FROM public.platform_policy WHERE id=1 AND luxury_enabled) AND (state->>'legacy' = 'true' OR (state->>'status' IN ('active','grace_period') AND state->>'luxury' = 'true')),
    'premium', state->>'legacy' = 'true' OR (state->>'status' IN ('active','grace_period') AND state->>'premium' = 'true'),
    'customDomain', false)
  FROM (SELECT public.billing_state(p_store) AS state) AS entitlement;
$$;


CREATE OR REPLACE FUNCTION public.billing_options(p_store uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT jsonb_build_object(
    'trialDays', (SELECT trial_days FROM public.billing_config WHERE id = 1),
    'eligible', EXISTS(SELECT 1 FROM public.platform_policy WHERE id=1 AND allow_trials) AND NOT EXISTS(SELECT 1 FROM public.platform_controls WHERE store_id=p_store AND (hold OR suspended)) AND EXISTS (SELECT 1 FROM public.billing_verified_accounts v JOIN public.users u ON u.id = v.user_id AND u.email = v.email
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


