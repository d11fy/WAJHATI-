CREATE FUNCTION public.billing_product_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE caps jsonb; was_published boolean := false; was_counted boolean := false; counted integer;
BEGIN
  IF TG_OP = 'INSERT' AND NEW.state = 'archived' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'billing_publication', MESSAGE = 'Save a product before archiving';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.store_id IS DISTINCT FROM OLD.store_id THEN RAISE EXCEPTION 'Store id is immutable'; END IF;
    was_published := OLD.state = 'published';
    was_counted := OLD.state <> 'archived';
  END IF;
  IF (was_published OR NEW.state <> 'published') AND (was_counted OR NEW.state = 'archived') THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.store_id::text, 1));
  caps := public.billing_capabilities(NEW.store_id);
  IF NEW.state = 'published' AND NOT was_published AND NOT (caps->>'publish')::boolean THEN
    RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'billing_publication', MESSAGE = 'Publishing is unavailable';
  END IF;
  IF NEW.state <> 'archived' AND (NOT was_counted OR (NEW.state = 'published' AND NOT was_published)) THEN
    SELECT count(*) INTO counted FROM public.catalog_products WHERE store_id = NEW.store_id AND state <> 'archived';
    IF counted + (NOT was_counted)::integer > (caps->>'maxProducts')::integer THEN
      RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'billing_product_limit', MESSAGE = 'Product capacity reached';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER billing_products_guard BEFORE INSERT OR UPDATE OF state, store_id ON public.catalog_products
  FOR EACH ROW EXECUTE FUNCTION public.billing_product_guard();

CREATE FUNCTION public.billing_store_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF NEW.published_at IS NOT NULL AND NEW.published_at IS DISTINCT FROM OLD.published_at THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(NEW.id::text, 1));
    IF NOT (public.billing_capabilities(NEW.id)->>'publish')::boolean THEN
      RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'billing_publication', MESSAGE = 'Publishing is unavailable';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER billing_store_guard BEFORE UPDATE OF published_at ON public.stores
  FOR EACH ROW EXECUTE FUNCTION public.billing_store_guard();

CREATE FUNCTION public.billing_storage_used(p_store uuid) RETURNS bigint
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT ((SELECT count(*) FROM public.catalog_images WHERE store_id = p_store)
    + (SELECT count(*) FROM public.store_design_assets WHERE store_id = p_store)) * 6291456;
$$;

CREATE FUNCTION public.billing_storage_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.store_id::text, 1));
  IF public.billing_storage_used(NEW.store_id) + 6291456 >
     (public.billing_capabilities(NEW.store_id)->>'storageMiB')::bigint * 1048576
  THEN RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'billing_storage_limit', MESSAGE = 'Storage capacity reached'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER billing_catalog_storage BEFORE INSERT ON public.catalog_images
  FOR EACH ROW EXECUTE FUNCTION public.billing_storage_guard();
CREATE TRIGGER billing_design_storage BEFORE INSERT ON public.store_design_assets
  FOR EACH ROW EXECUTE FUNCTION public.billing_storage_guard();

CREATE FUNCTION public.billing_basic_style() RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT '{"theme":"minimal-commerce","font":"sans","colors":{"background":"#F7F8F2","text":"#192D26","accent":"#215742","onAccent":"#FFFFFF"}}'::jsonb;
$$;

CREATE FUNCTION public.billing_design_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE caps jsonb; changed jsonb;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.published_revision IS DISTINCT FROM OLD.published_revision THEN
    changed := NEW.published;
  ELSIF TG_OP = 'INSERT' THEN
    changed := NEW.draft;
  ELSIF NEW.draft IS DISTINCT FROM OLD.draft AND NEW.draft IS DISTINCT FROM OLD.published THEN
    changed := NEW.draft;
  END IF;
  IF changed IS NULL THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.store_id::text, 1));
  caps := public.billing_capabilities(NEW.store_id);
  IF (NEW.published IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.published_revision IS DISTINCT FROM OLD.published_revision)
      AND NOT (caps->>'publish')::boolean)
    OR (changed->>'theme' = 'luxury-boutique' AND NOT (caps->>'luxury')::boolean)
    OR (NOT (caps->>'premium')::boolean AND (changed->'colors' IS DISTINCT FROM public.billing_basic_style()->'colors'
      OR changed->>'font' IS DISTINCT FROM public.billing_basic_style()->>'font'))
  THEN RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'billing_theme_limit', MESSAGE = 'Design feature unavailable'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER billing_design_guard BEFORE INSERT OR UPDATE ON public.store_designs
  FOR EACH ROW EXECUTE FUNCTION public.billing_design_guard();

CREATE OR REPLACE FUNCTION public.theme_public_design(p_slug text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT CASE WHEN caps->>'premium' = 'true' AND (d.published->>'theme' <> 'luxury-boutique' OR caps->>'luxury' = 'true')
    THEN d.published ELSE d.published || public.billing_basic_style() END
  FROM public.get_public_store(p_slug) AS visible
  JOIN public.stores s ON s.slug = visible.slug JOIN public.store_designs d ON d.store_id = s.id
  CROSS JOIN LATERAL public.billing_capabilities(s.id) caps;
$$;

CREATE FUNCTION public.billing_order_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.status = 'contact_opened' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(NEW.store_id::text, 1));
    IF NOT (public.billing_capabilities(NEW.store_id)->>'publish')::boolean THEN
      RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'billing_order_closed', MESSAGE = 'Ordering is unavailable';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER billing_orders_guard BEFORE INSERT OR UPDATE OF status ON public.order_intents
  FOR EACH ROW EXECUTE FUNCTION public.billing_order_guard();

CREATE FUNCTION public.billing_usage(p_store uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT jsonb_build_object('products', (SELECT count(*) FROM public.catalog_products WHERE store_id = p_store AND state <> 'archived'),
    'storageBytes', public.billing_storage_used(p_store), 'confirmed', (SELECT count(*) FROM public.order_intents
      WHERE store_id = p_store AND status = 'merchant_confirmed'),
    'byChannel', CASE WHEN public.billing_capabilities(p_store)->>'analytics' = 'enhanced' THEN
      (SELECT jsonb_object_agg(channel, n) FROM (SELECT channel, count(*) n FROM public.order_intents
        WHERE store_id = p_store AND status = 'merchant_confirmed' GROUP BY channel) counts) END)
  WHERE public.billing_owner(p_store);
$$;

REVOKE ALL ON FUNCTION public.billing_product_guard(), public.billing_store_guard(), public.billing_storage_used(uuid),
  public.billing_storage_guard(), public.billing_basic_style(), public.billing_design_guard(), public.billing_order_guard(),
  public.billing_usage(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.billing_usage(uuid) TO storefront_app;
CREATE OR REPLACE FUNCTION public.order_public_context(p_slug text, p_products text[]) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT jsonb_build_object('storeId', s.id, 'name', s.name, 'currency', s.currency, 'config', CASE WHEN (public.billing_capabilities(s.id)->>'publish')::boolean THEN settings.config END,
    'products', coalesce((SELECT jsonb_agg(jsonb_build_object(
      'product', p.slug, 'nameAr', p.name_ar, 'nameEn', p.name_en, 'unitMinor', p.price_minor, 'imageId', image.id,
      'groups', coalesce((SELECT jsonb_agg(jsonb_build_object('name', grouped.name, 'values', grouped.values) ORDER BY grouped.group_position)
        FROM (SELECT o.group_position, o.group_name AS name, jsonb_agg(o.value ORDER BY o.position) AS values
          FROM public.catalog_product_options AS o WHERE o.store_id = p.store_id AND o.product_id = p.id
          GROUP BY o.group_position, o.group_name) AS grouped), '[]')
    )) FROM public.catalog_products AS p
      LEFT JOIN public.catalog_images AS image ON image.store_id = p.store_id AND image.product_id = p.id AND image.is_primary
      WHERE p.store_id = s.id AND p.state = 'published' AND p.available AND p.slug = ANY(p_products)), '[]'))
  FROM public.get_public_store(p_slug) AS visible JOIN public.stores AS s ON s.slug = visible.slug
  LEFT JOIN public.order_settings AS settings ON settings.store_id = s.id
  WHERE cardinality(p_products) <= 12;
$$;

