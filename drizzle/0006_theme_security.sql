CREATE FUNCTION public.theme_member(p_store uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp
AS $$
  SELECT p_store = nullif(current_setting('dar.store_id', true), '')::uuid AND EXISTS (
    SELECT 1 FROM public.store_memberships AS m WHERE m.store_id = p_store
      AND m.user_id = nullif(current_setting('dar.user_id', true), '')::uuid
  );
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.theme_member(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.theme_member(uuid) TO storefront_app;
--> statement-breakpoint
CREATE POLICY store_design_member ON public.store_designs FOR ALL TO storefront_app
  USING (public.theme_member(store_id)) WITH CHECK (public.theme_member(store_id));
--> statement-breakpoint
CREATE POLICY theme_asset_read ON public.store_design_assets FOR SELECT TO storefront_app USING (public.theme_member(store_id));
--> statement-breakpoint
CREATE POLICY theme_asset_insert ON public.store_design_assets FOR INSERT TO storefront_app WITH CHECK (public.theme_member(store_id));
--> statement-breakpoint
CREATE POLICY theme_asset_update ON public.store_design_assets FOR UPDATE TO storefront_app
  USING (public.theme_member(store_id)) WITH CHECK (public.theme_member(store_id));
--> statement-breakpoint
CREATE POLICY theme_asset_delete ON public.store_design_assets FOR DELETE TO storefront_app USING (
  public.theme_member(store_id) AND NOT EXISTS (
    SELECT 1 FROM public.store_designs AS d WHERE d.store_id = store_design_assets.store_id
      AND (d.draft->'assets'->>store_design_assets.kind::text = store_design_assets.id::text
        OR d.published->'assets'->>store_design_assets.kind::text = store_design_assets.id::text)
  )
);
--> statement-breakpoint
GRANT SELECT ON public.store_designs TO storefront_app;
--> statement-breakpoint
GRANT INSERT (store_id, draft, revision), UPDATE (draft, revision) ON public.store_designs TO storefront_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.store_design_assets TO storefront_app;
--> statement-breakpoint
CREATE FUNCTION public.theme_publish(p_store uuid, p_revision integer) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE design jsonb;
BEGIN
  IF p_store IS DISTINCT FROM nullif(current_setting('dar.store_id', true), '')::uuid OR NOT EXISTS (
    SELECT 1 FROM public.store_memberships AS m WHERE m.store_id = p_store AND m.role = 'owner'
      AND m.user_id = nullif(current_setting('dar.user_id', true), '')::uuid
  ) THEN RETURN 'denied'; END IF;
  SELECT d.draft INTO design FROM public.store_designs AS d
    WHERE d.store_id = p_store AND d.revision = p_revision FOR UPDATE;
  IF NOT FOUND THEN RETURN 'conflict'; END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_each_text(design->'assets') AS selected(kind, id)
    WHERE selected.id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.store_design_assets AS a WHERE a.store_id = p_store AND a.kind::text = selected.kind
        AND a.id::text = selected.id AND a.state = 'ready'
    )
  ) THEN RETURN 'invalidReferences'; END IF;
  UPDATE public.store_designs SET published = design, published_revision = p_revision, published_at = now()
    WHERE store_id = p_store;
  RETURN 'ok';
END;
$$;
--> statement-breakpoint
CREATE FUNCTION public.theme_public_design(p_slug text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
  SELECT d.published FROM public.get_public_store(p_slug) AS visible
    JOIN public.stores AS s ON s.slug = visible.slug JOIN public.store_designs AS d ON d.store_id = s.id;
$$;
--> statement-breakpoint
CREATE FUNCTION public.theme_public_asset(p_slug text, p_asset uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
  SELECT a.object_key FROM public.get_public_store(p_slug) AS visible
    JOIN public.stores AS s ON s.slug = visible.slug JOIN public.store_designs AS d ON d.store_id = s.id
    JOIN public.store_design_assets AS a ON a.store_id = s.id AND a.id = p_asset AND a.state = 'ready'
    WHERE d.published->'assets'->>a.kind::text = a.id::text;
$$;
--> statement-breakpoint
CREATE FUNCTION public.theme_public_highlights(p_slug text, p_products uuid[], p_categories uuid[])
RETURNS TABLE (products jsonb, categories jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
  SELECT coalesce((SELECT jsonb_agg(to_jsonb(p) - 'sequence' ORDER BY p.sequence) FROM (
    SELECT item.slug, item.name_ar AS "nameAr", item.name_en AS "nameEn", item.price_minor AS "priceMinor",
      item.compare_at_minor AS "compareAtMinor", item.available, true AS featured, i.id AS "imageId",
      row_number() OVER (ORDER BY array_position(p_products, item.id), item.position, item.id) AS sequence
    FROM public.catalog_products AS item
    LEFT JOIN public.catalog_images AS i ON i.store_id = item.store_id AND i.product_id = item.id AND i.is_primary
    WHERE item.store_id = s.id AND item.state = 'published'
      AND (CASE WHEN cardinality(p_products) > 0 THEN item.id = ANY(p_products) ELSE item.featured END)
    ORDER BY sequence LIMIT 8
  ) AS p), '[]'), coalesce((SELECT jsonb_agg(to_jsonb(c) - 'sequence' ORDER BY c.sequence) FROM (
    SELECT item.slug, item.name_ar AS "nameAr", item.name_en AS "nameEn", i.id AS "imageId",
      row_number() OVER (ORDER BY array_position(p_categories, item.id), item.position, item.id) AS sequence
    FROM public.catalog_categories AS item
    LEFT JOIN public.catalog_images AS i ON i.store_id = item.store_id AND i.category_id = item.id AND i.state = 'ready'
    WHERE item.store_id = s.id AND item.visible AND (cardinality(p_categories) = 0 OR item.id = ANY(p_categories))
    ORDER BY sequence LIMIT 8
  ) AS c), '[]')
  FROM public.get_public_store(p_slug) AS visible JOIN public.stores AS s ON s.slug = visible.slug;
$$;
--> statement-breakpoint
CREATE TRIGGER theme_queue_image_removal AFTER DELETE ON public.store_design_assets
  FOR EACH ROW EXECUTE FUNCTION public.catalog_queue_image_removal();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.catalog_claim_image_cleanup(p_limit integer)
RETURNS TABLE (object_key text) LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE batch integer := least(greatest(p_limit, 1), 100);
BEGIN
  DELETE FROM public.catalog_images AS i USING (
    SELECT j.store_id, j.id FROM public.catalog_images AS j WHERE j.state = 'pending' AND j.created_at <= now() - interval '1 hour'
    ORDER BY j.created_at LIMIT batch FOR UPDATE SKIP LOCKED
  ) AS expired WHERE i.store_id = expired.store_id AND i.id = expired.id;
  DELETE FROM public.store_design_assets AS i USING (
    SELECT j.store_id, j.id FROM public.store_design_assets AS j WHERE j.state = 'pending' AND j.created_at <= now() - interval '1 hour'
    ORDER BY j.created_at LIMIT batch FOR UPDATE SKIP LOCKED
  ) AS expired WHERE i.store_id = expired.store_id AND i.id = expired.id;
  RETURN QUERY UPDATE public.catalog_media_gc AS q SET available_at = now() + interval '5 minutes'
  FROM (SELECT j.object_key FROM public.catalog_media_gc AS j WHERE j.available_at <= now()
    ORDER BY j.available_at LIMIT batch FOR UPDATE SKIP LOCKED) AS due
  WHERE q.object_key = due.object_key RETURNING q.object_key;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.theme_publish(uuid, integer), public.theme_public_design(text), public.theme_public_asset(text, uuid),
  public.theme_public_highlights(text, uuid[], uuid[]) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.theme_publish(uuid, integer), public.theme_public_design(text), public.theme_public_asset(text, uuid),
  public.theme_public_highlights(text, uuid[], uuid[]) TO storefront_app;
