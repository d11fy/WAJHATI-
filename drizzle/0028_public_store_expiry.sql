-- A store is publicly visible only while its billing state allows publishing: trial, active, or the renewal grace period.
-- After the trial or paid period (and any grace period) ends, the public storefront disappears and stops taking orders.
-- Store data, products and design are untouched; the storefront returns as soon as the subscription is renewed.
-- Only functions are replaced. No table, column, row, role or grant changes.

CREATE OR REPLACE FUNCTION public.get_public_store(p_slug text)
RETURNS TABLE(name varchar,slug varchar,country public.country_code,currency public.currency_code)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
  SELECT s.name,s.slug,s.country,s.currency FROM public.stores s
  WHERE s.slug=p_slug AND s.published_at<=now()
    AND NOT EXISTS (SELECT 1 FROM public.platform_controls c WHERE c.store_id=s.id AND c.suspended)
    AND public.billing_state(s.id)->>'status' IN ('active','trialing','grace_period')
    AND EXISTS (SELECT 1 FROM public.catalog_products p WHERE p.store_id=s.id AND p.state='published');
$$;
--> statement-breakpoint
-- The product list and product page read the store directly. They follow the same rule so an expired or suspended store
-- exposes nothing even if a caller skips the store lookup.
CREATE OR REPLACE FUNCTION public.catalog_public_products(p_store text, p_pattern text, p_category text, p_sort text,
  p_available boolean, p_offset integer, p_limit integer)
RETURNS TABLE (slug varchar, name_ar varchar, name_en varchar, price_minor integer, compare_at_minor integer,
  featured boolean, available boolean, image_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
  SELECT p.slug, p.name_ar, p.name_en, p.price_minor, p.compare_at_minor, p.featured, p.available, i.id
  FROM public.stores AS s JOIN public.catalog_products AS p ON p.store_id = s.id AND p.state = 'published'
  LEFT JOIN public.catalog_images AS i ON i.store_id = p.store_id AND i.product_id = p.id AND i.is_primary AND i.state = 'ready'
  WHERE s.slug = p_store AND s.published_at <= now() AND (NOT p_available OR p.available)
    AND EXISTS (SELECT 1 FROM public.get_public_store(p_store))
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
CREATE OR REPLACE FUNCTION public.catalog_public_product(p_store text, p_slug text)
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
  WHERE s.slug = p_store AND s.published_at <= now() AND p.slug = p_slug
    AND EXISTS (SELECT 1 FROM public.get_public_store(p_store));
$$;
