-- Anonymous platform visitors can see active offers. Payment instructions and tenant data are excluded.
CREATE FUNCTION public.billing_marketing() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT jsonb_build_object(
    'trialDays', CASE WHEN policy.allow_trials THEN config.trial_days END,
    'offers', coalesce((
      SELECT jsonb_agg(to_jsonb(offer) ORDER BY offer.country, offer.currency, offer.interval, offer.plan)
      FROM (
        SELECT DISTINCT ON (price.country, price.currency, price.interval, plan.code)
          price.country, price.currency, price.interval, price.amount, plan.code AS plan,
          plan.max_products AS "maxProducts", plan.storage_mib AS "storageMiB", plan.analytics,
          plan.luxury AND policy.luxury_enabled AS luxury
        FROM public.billing_prices price JOIN public.billing_plans plan ON plan.id = price.plan_id
        WHERE price.active AND EXISTS (
          SELECT 1 FROM public.billing_methods method WHERE method.active
            AND method.country = price.country AND method.currency = price.currency
        )
        ORDER BY price.country, price.currency, price.interval, plan.code, plan.version DESC
      ) offer
    ), '[]'::jsonb)
  )
  FROM public.billing_config config JOIN public.platform_policy policy ON policy.id = config.id
  WHERE config.id = 1;
$$;
REVOKE ALL ON FUNCTION public.billing_marketing() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.billing_marketing() TO storefront_app;
