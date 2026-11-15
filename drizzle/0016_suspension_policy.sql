ALTER TABLE "platform_policy" ADD COLUMN "admin_may_suspend" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
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



--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.platform_configure(p_token text,p_action text,p_data jsonb) RETURNS text
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


