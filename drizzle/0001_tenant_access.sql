CREATE POLICY memberships_read_self ON public.store_memberships
  FOR SELECT TO storefront_app
  USING (user_id = nullif(current_setting('dar.user_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY stores_read_member ON public.stores
  FOR SELECT TO storefront_app
  USING (EXISTS (
    SELECT 1 FROM public.store_memberships AS member
    WHERE member.store_id = stores.id
      AND member.user_id = nullif(current_setting('dar.user_id', true), '')::uuid
  ));
--> statement-breakpoint
-- The schema owner creates both rows atomically. The runtime role cannot write either table directly.
CREATE FUNCTION public.create_store(p_name text, p_slug text, p_country public.country_code, p_currency public.currency_code)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  actor_id uuid := nullif(current_setting('dar.user_id', true), '')::uuid;
  new_store_id uuid;
BEGIN
  IF actor_id IS NULL THEN
    RAISE EXCEPTION 'Store creation requires an authenticated actor' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.stores (name, slug, country, currency)
    VALUES (p_name, p_slug, p_country, p_currency) RETURNING id INTO new_store_id;
  INSERT INTO public.store_memberships (store_id, user_id, role)
    VALUES (new_store_id, actor_id, 'owner');
END;
$$;
--> statement-breakpoint
CREATE FUNCTION public.get_public_store(p_slug text)
RETURNS TABLE (name varchar, slug varchar, country public.country_code, currency public.currency_code)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
  SELECT s.name, s.slug, s.country, s.currency
  FROM public.stores AS s
  WHERE s.slug = p_slug AND s.published_at <= now();
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.create_store(text, text, public.country_code, public.currency_code) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.get_public_store(text) FROM PUBLIC;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO storefront_app;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.create_store(text, text, public.country_code, public.currency_code) TO storefront_app;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.get_public_store(text) TO storefront_app;
--> statement-breakpoint
GRANT SELECT ON public.stores, public.store_memberships TO storefront_app;
--> statement-breakpoint
GRANT SELECT (id, name, email, password_hash), INSERT (name, email, password_hash) ON public.users TO storefront_app;
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON public.sessions TO storefront_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON public.auth_limits TO storefront_app;
