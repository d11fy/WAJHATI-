-- A published store whose trial or subscription has ended is not shown to the public (migration 0028). Visitors who open its link
-- should see a "temporarily paused" page instead of a bare 404, and the owner should see why in the dashboard.
-- This function returns only the store name for exactly that case: published, not suspended or held by the platform, and billing
-- status outside trialing, active and the renewal grace period. It never returns anything for a draft, a suspended or an unknown store.
-- Functions only. No table, column, row, role or grant on existing objects changes.

CREATE FUNCTION public.get_paused_store(p_slug text)
RETURNS TABLE(name varchar)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
  SELECT s.name FROM public.stores s
  WHERE s.slug=p_slug AND s.published_at<=now()
    AND NOT EXISTS (SELECT 1 FROM public.platform_controls c WHERE c.store_id=s.id AND (c.suspended OR c.hold))
    AND public.billing_state(s.id)->>'status' NOT IN ('active','trialing','grace_period');
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.get_paused_store(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.get_paused_store(text) TO storefront_app;
