-- Read-only public plan metadata. Retains purchasable offers for existing callers.
-- No subscriptions, payment snapshots or existing plan versions are modified.
CREATE OR REPLACE FUNCTION public.billing_marketing() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  WITH catalog AS (
    SELECT DISTINCT ON (price.country, price.currency, price.interval, plan.code)
      price.country, price.currency, price.interval, price.amount, plan.code AS plan,
      plan.name, plan.max_products AS "maxProducts", plan.storage_mib AS "storageMiB", plan.analytics,
      plan.luxury AND policy.luxury_enabled AS luxury, plan.premium,
      EXISTS (SELECT 1 FROM public.billing_methods method WHERE method.active
        AND method.country = price.country AND method.currency = price.currency) AS "canPurchase"
    FROM public.billing_prices price JOIN public.billing_plans plan ON plan.id = price.plan_id
      CROSS JOIN public.platform_policy policy
    WHERE price.active AND policy.id = 1
    ORDER BY price.country, price.currency, price.interval, plan.code, plan.version DESC
  )
  SELECT jsonb_build_object(
    'trialDays', CASE WHEN policy.allow_trials THEN config.trial_days END,
    'offers', coalesce((SELECT jsonb_agg(to_jsonb(offer) ORDER BY country,currency,interval,plan) FROM (
      SELECT country,currency,interval,amount,plan,"maxProducts","storageMiB",analytics,luxury
      FROM catalog WHERE "canPurchase"
    ) offer), '[]'::jsonb),
    'catalog', coalesce((SELECT jsonb_agg(to_jsonb(catalog) ORDER BY country,currency,plan,interval) FROM catalog), '[]'::jsonb)
  ) FROM public.billing_config config JOIN public.platform_policy policy ON policy.id = config.id WHERE config.id = 1;
$$;
REVOKE ALL ON FUNCTION public.billing_marketing() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.billing_marketing() TO storefront_app;
