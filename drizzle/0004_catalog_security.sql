DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['catalog_categories', 'catalog_products', 'catalog_product_categories', 'catalog_product_options', 'catalog_images'] LOOP
    EXECUTE format($policy$
      CREATE POLICY catalog_member ON public.%1$I FOR ALL TO storefront_app
      USING (store_id = nullif(current_setting('dar.store_id', true), '')::uuid AND EXISTS (
        SELECT 1 FROM public.store_memberships AS m WHERE m.store_id = %1$I.store_id
          AND m.user_id = nullif(current_setting('dar.user_id', true), '')::uuid
      ))
    $policy$, table_name);
  END LOOP;
END;
$$;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON public.catalog_products TO storefront_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.catalog_categories, public.catalog_product_categories,
  public.catalog_product_options, public.catalog_images TO storefront_app;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.get_public_store(p_slug text)
RETURNS TABLE (name varchar, slug varchar, country public.country_code, currency public.currency_code)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
  SELECT s.name, s.slug, s.country, s.currency FROM public.stores AS s
  WHERE s.slug = p_slug AND s.published_at <= now()
    AND EXISTS (SELECT 1 FROM public.catalog_products AS p WHERE p.store_id = s.id AND p.state = 'published');
$$;
--> statement-breakpoint
CREATE FUNCTION public.catalog_set_store_publication(p_store uuid, p_publish boolean)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF p_store IS DISTINCT FROM nullif(current_setting('dar.store_id', true), '')::uuid OR NOT EXISTS (
    SELECT 1 FROM public.store_memberships AS m WHERE m.store_id = p_store AND m.role = 'owner'
      AND m.user_id = nullif(current_setting('dar.user_id', true), '')::uuid
  ) THEN RETURN 'denied'; END IF;
  IF p_publish AND NOT EXISTS (
    SELECT 1 FROM public.catalog_products AS p WHERE p.store_id = p_store AND p.state = 'published'
  ) THEN RETURN 'empty'; END IF;
  UPDATE public.stores SET published_at = CASE WHEN p_publish THEN now() ELSE NULL END WHERE id = p_store;
  RETURN 'ok';
END;
$$;
--> statement-breakpoint
CREATE FUNCTION public.catalog_public_categories(p_store text)
RETURNS TABLE (slug varchar, name_ar varchar, name_en varchar, image_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
  SELECT c.slug, c.name_ar, c.name_en, i.id FROM public.get_public_store(p_store) AS visible
  JOIN public.stores AS s ON s.slug = visible.slug
  JOIN public.catalog_categories AS c ON c.store_id = s.id AND c.visible
  LEFT JOIN public.catalog_images AS i ON i.store_id = s.id AND i.category_id = c.id AND i.state = 'ready'
  ORDER BY c.position, c.id;
$$;
--> statement-breakpoint
CREATE FUNCTION public.catalog_public_products(p_store text, p_pattern text, p_category text, p_sort text,
  p_available boolean, p_offset integer, p_limit integer)
RETURNS TABLE (slug varchar, name_ar varchar, name_en varchar, price_minor integer, compare_at_minor integer,
  featured boolean, available boolean, image_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
  SELECT p.slug, p.name_ar, p.name_en, p.price_minor, p.compare_at_minor, p.featured, p.available, i.id
  FROM public.stores AS s JOIN public.catalog_products AS p ON p.store_id = s.id AND p.state = 'published'
  LEFT JOIN public.catalog_images AS i ON i.store_id = p.store_id AND i.product_id = p.id AND i.is_primary AND i.state = 'ready'
  WHERE s.slug = p_store AND s.published_at <= now() AND (NOT p_available OR p.available)
    AND (p_pattern IS NULL OR p.name_ar ILIKE p_pattern OR p.name_en ILIKE p_pattern
      OR p.description_ar ILIKE p_pattern OR p.description_en ILIKE p_pattern)
    AND (p_category IS NULL OR EXISTS (
      SELECT 1 FROM public.catalog_product_categories AS l
      JOIN public.catalog_categories AS c ON c.store_id = l.store_id AND c.id = l.category_id
      WHERE l.store_id = p.store_id AND l.product_id = p.id AND c.visible AND c.slug = p_category
    ))
  ORDER BY CASE WHEN p_sort = 'price-asc' THEN p.price_minor END,
    CASE WHEN p_sort = 'price-desc' THEN p.price_minor END DESC,
    CASE WHEN p_sort = 'newest' THEN p.created_at END DESC, p.featured DESC, p.position, p.id
  OFFSET least(greatest(p_offset, 0), 12000) LIMIT least(greatest(p_limit, 1), 25);
$$;
--> statement-breakpoint
CREATE FUNCTION public.catalog_public_product(p_store text, p_slug text)
RETURNS TABLE (slug varchar, name_ar varchar, name_en varchar, description_ar text, description_en text,
  price_minor integer, compare_at_minor integer, featured boolean, available boolean, images jsonb, options jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
  SELECT p.slug, p.name_ar, p.name_en, p.description_ar, p.description_en, p.price_minor, p.compare_at_minor,
    p.featured, p.available,
    coalesce((SELECT jsonb_agg(i.id ORDER BY i.is_primary DESC, i.position, i.id)
      FROM public.catalog_images AS i WHERE i.store_id = p.store_id AND i.product_id = p.id AND i.state = 'ready'), '[]'),
    coalesce((SELECT jsonb_agg(jsonb_build_object('name', grouped.name, 'values', grouped.values) ORDER BY grouped.group_position)
      FROM (SELECT o.group_position, o.group_name AS name, jsonb_agg(o.value ORDER BY o.position) AS values
        FROM public.catalog_product_options AS o WHERE o.store_id = p.store_id AND o.product_id = p.id
        GROUP BY o.group_position, o.group_name) AS grouped), '[]')
  FROM public.stores AS s JOIN public.catalog_products AS p ON p.store_id = s.id AND p.state = 'published'
  WHERE s.slug = p_store AND s.published_at <= now() AND p.slug = p_slug;
$$;
--> statement-breakpoint
CREATE FUNCTION public.catalog_public_image(p_store text, p_id uuid)
RETURNS TABLE (object_key text) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
  SELECT i.object_key FROM public.get_public_store(p_store) AS visible
  JOIN public.stores AS s ON s.slug = visible.slug
  JOIN public.catalog_images AS i ON i.store_id = s.id AND i.id = p_id AND i.state = 'ready'
  WHERE EXISTS (SELECT 1 FROM public.catalog_products AS p WHERE p.store_id = i.store_id AND p.id = i.product_id AND p.state = 'published')
     OR EXISTS (SELECT 1 FROM public.catalog_categories AS c WHERE c.store_id = i.store_id AND c.id = i.category_id AND c.visible);
$$;
--> statement-breakpoint
CREATE FUNCTION public.catalog_queue_image_removal()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  INSERT INTO public.catalog_media_gc (object_key, store_id, available_at)
  VALUES (OLD.object_key, OLD.store_id,
    CASE WHEN OLD.state = 'pending' THEN greatest(now(), OLD.created_at + interval '1 hour') ELSE now() END)
  ON CONFLICT (object_key) DO NOTHING;
  RETURN OLD;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER catalog_queue_image_removal AFTER DELETE ON public.catalog_images
  FOR EACH ROW EXECUTE FUNCTION public.catalog_queue_image_removal();
--> statement-breakpoint
CREATE FUNCTION public.catalog_claim_image_cleanup(p_limit integer)
RETURNS TABLE (object_key text) LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE batch integer := least(greatest(p_limit, 1), 100);
BEGIN
  DELETE FROM public.catalog_images AS i USING (
    SELECT j.store_id, j.id FROM public.catalog_images AS j
    WHERE j.state = 'pending' AND j.created_at <= now() - interval '1 hour'
    ORDER BY j.created_at LIMIT batch FOR UPDATE SKIP LOCKED
  ) AS expired WHERE i.store_id = expired.store_id AND i.id = expired.id;
  RETURN QUERY UPDATE public.catalog_media_gc AS q SET available_at = now() + interval '5 minutes'
  FROM (SELECT j.object_key FROM public.catalog_media_gc AS j WHERE j.available_at <= now()
    ORDER BY j.available_at LIMIT batch FOR UPDATE SKIP LOCKED) AS due
  WHERE q.object_key = due.object_key RETURNING q.object_key;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION public.catalog_ack_image_cleanup(p_key text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$ DELETE FROM public.catalog_media_gc WHERE object_key = p_key AND available_at > now(); $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.catalog_set_store_publication(uuid, boolean), public.catalog_public_categories(text),
  public.catalog_public_products(text, text, text, text, boolean, integer, integer), public.catalog_public_product(text, text),
  public.catalog_public_image(text, uuid), public.catalog_queue_image_removal(), public.catalog_claim_image_cleanup(integer),
  public.catalog_ack_image_cleanup(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.catalog_set_store_publication(uuid, boolean), public.catalog_public_categories(text),
  public.catalog_public_products(text, text, text, text, boolean, integer, integer), public.catalog_public_product(text, text),
  public.catalog_public_image(text, uuid) TO storefront_app;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO storefront_media_worker;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.catalog_claim_image_cleanup(integer), public.catalog_ack_image_cleanup(text) TO storefront_media_worker;
