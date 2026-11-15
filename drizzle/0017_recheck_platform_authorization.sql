-- Custom SQL migration file, put your code below! --
CREATE OR REPLACE FUNCTION public.platform_role_change(p_token text,p_user uuid,p_role public.platform_role,p_grant boolean) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE actor uuid:=public.platform_actor(p_token,'owner',true);
BEGIN
  IF actor IS NULL THEN RETURN 'denied'; END IF;
  PERFORM pg_advisory_xact_lock(781690423);
  actor:=public.platform_actor(p_token,'owner',true);
  IF actor IS NULL THEN RETURN 'denied'; END IF;
  IF actor=p_user OR NOT EXISTS (SELECT 1 FROM public.users u JOIN public.billing_verified_accounts v
    ON v.user_id=u.id AND v.email=u.email WHERE u.id=p_user) THEN RETURN 'invalid'; END IF;
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


CREATE OR REPLACE FUNCTION public.billing_review_payment(p_token text,p_id uuid,p_action text,p_amount integer,p_currency public.currency_code,
  p_transfer text,p_independent text,p_reason text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE actor uuid := public.platform_actor(p_token,'reviewer',true); r public.billing_requests;
  proposal public.platform_payment_checks; result text; threshold integer;
BEGIN
  IF actor IS NULL THEN RETURN 'denied'; END IF;
  SELECT * INTO r FROM public.billing_requests WHERE id=p_id;
  IF NOT FOUND OR EXISTS(SELECT 1 FROM public.store_memberships WHERE store_id=r.store_id AND user_id=actor) THEN RETURN 'denied'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(r.store_id::text,1));
  PERFORM pg_advisory_xact_lock_shared(781690423);
  IF public.platform_actor(p_token,'reviewer',true) IS DISTINCT FROM actor THEN RETURN 'denied'; END IF;
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


CREATE OR REPLACE FUNCTION public.platform_support(p_token text,p_store uuid,p_action text,p_reason text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE actor uuid:=coalesce(public.platform_actor(p_token,'owner',true),public.platform_actor(p_token,'administrator',true));
BEGIN
  IF actor IS NULL THEN RETURN 'denied'; END IF;
  IF p_action IN ('suspend','restore') AND public.platform_actor(p_token,'owner',true) IS NULL
    AND NOT EXISTS(SELECT 1 FROM public.platform_policy WHERE id=1 AND admin_may_suspend)
  THEN RETURN 'denied'; END IF;
  IF p_reason NOT IN ('security','abuse','support','billing') OR p_reason IS NULL
    OR p_action NOT IN ('suspend','restore','hold','release','end_legacy') THEN RETURN 'invalid'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_store::text,1));
  PERFORM pg_advisory_xact_lock_shared(781690423);
  IF coalesce(public.platform_actor(p_token,'owner',true),public.platform_actor(p_token,'administrator',true)) IS DISTINCT FROM actor THEN RETURN 'denied'; END IF;
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


CREATE OR REPLACE FUNCTION public.platform_configure(p_token text,p_action text,p_data jsonb) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE actor uuid:=public.platform_actor(p_token,'owner',true); target uuid; pair record;
BEGIN
  IF actor IS NULL THEN RETURN 'denied'; END IF;
  PERFORM pg_advisory_xact_lock_shared(781690423);
  IF public.platform_actor(p_token,'owner',true) IS DISTINCT FROM actor THEN RETURN 'denied'; END IF;
  IF jsonb_typeof(p_data)<>'object' THEN RETURN 'invalid'; END IF;
  IF p_action='rules' THEN
    IF jsonb_typeof(p_data->'dual') IS DISTINCT FROM 'object' THEN RETURN 'invalid'; END IF;
    FOR pair IN SELECT * FROM jsonb_each(p_data->'dual') LOOP
      PERFORM pair.key::public.currency_code;
      IF jsonb_typeof(pair.value)<>'number' OR (pair.value::text)::int NOT BETWEEN 1 AND 2000000000 THEN RETURN 'invalid'; END IF;
    END LOOP;
    UPDATE public.billing_config SET trial_days=(p_data->>'trialDays')::int,trial_products=(p_data->>'trialProducts')::int,grace_days=(p_data->>'graceDays')::int WHERE id=1;
    UPDATE public.platform_policy SET dual_thresholds=p_data->'dual',allow_trials=(p_data->>'allowTrials')::boolean,luxury_enabled=(p_data->>'luxury')::boolean,admin_may_suspend=(p_data->>'adminMaySuspend')::boolean WHERE id=1;
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

