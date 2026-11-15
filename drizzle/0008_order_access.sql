DO $$
DECLARE target text;
BEGIN
  FOREACH target IN ARRAY ARRAY['order_settings','order_intents','order_intent_items','order_intent_events'] LOOP
    EXECUTE format('CREATE POLICY order_member ON public.%I FOR ALL TO storefront_app USING (public.theme_member(store_id)) WITH CHECK (public.theme_member(store_id))', target);
  END LOOP;
END;
$$;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON public.order_settings TO storefront_app;
--> statement-breakpoint
GRANT SELECT ON public.order_intents, public.order_intent_items, public.order_intent_events TO storefront_app;
--> statement-breakpoint
GRANT UPDATE (status, archived_at) ON public.order_intents TO storefront_app;
--> statement-breakpoint
CREATE FUNCTION public.order_channel_enabled(p_config jsonb, p_channel public.order_channel) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce(p_config->>'enabled' = 'true' AND p_config->>p_channel::text = 'true', false);
$$;
--> statement-breakpoint
CREATE FUNCTION public.order_public_context(p_slug text, p_products text[]) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT jsonb_build_object('storeId', s.id, 'name', s.name, 'currency', s.currency, 'config', settings.config,
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
--> statement-breakpoint
CREATE FUNCTION public.order_visitor_intent(p_slug text, p_key text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT jsonb_build_object('reference', i.reference, 'fingerprint', i.fingerprint, 'channel', i.channel, 'status', i.status,
    'archived', i.archived_at IS NOT NULL, 'currency', i.currency, 'total', i.total, 'locale', i.locale,
    'lines', (SELECT jsonb_agg(jsonb_build_object('product', l.product, 'nameAr', l.name_ar, 'nameEn', l.name_en,
      'options', l.options, 'quantity', l.quantity, 'unitMinor', l.unit_minor, 'imageId', l.image_id) ORDER BY l.position)
      FROM public.order_intent_items AS l WHERE l.store_id = i.store_id AND l.intent_id = i.id))
  FROM public.get_public_store(p_slug) AS visible JOIN public.stores AS s ON s.slug = visible.slug
  JOIN public.order_intents AS i ON i.store_id = s.id AND i.request_key = p_key;
$$;
--> statement-breakpoint
CREATE FUNCTION public.order_create_intent(p_slug text, p_key text, p_fingerprint text, p_reference text,
  p_channel public.order_channel, p_locale text, p_total bigint, p_lines jsonb) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE tenant uuid; intent uuid; currency_code public.currency_code;
BEGIN
  SELECT s.id, s.currency INTO tenant, currency_code FROM public.get_public_store(p_slug) AS visible
    JOIN public.stores AS s ON s.slug = visible.slug JOIN public.order_settings AS o ON o.store_id = s.id
    WHERE public.order_channel_enabled(o.config, p_channel);
  IF NOT FOUND OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) NOT BETWEEN 1 AND 12 OR
    p_total IS DISTINCT FROM (SELECT sum((entry->>'unitMinor')::bigint * (entry->>'quantity')::integer) FROM jsonb_array_elements(p_lines) AS entry)
  THEN RETURN false; END IF;
  INSERT INTO public.order_intents(store_id, reference, request_key, fingerprint, channel, currency, total, locale)
    VALUES (tenant, p_reference, p_key, p_fingerprint, p_channel, currency_code, p_total, p_locale)
    ON CONFLICT (store_id, request_key) DO NOTHING RETURNING id INTO intent;
  IF NOT FOUND THEN RETURN false; END IF;
  INSERT INTO public.order_intent_items(store_id, intent_id, position, product, name_ar, name_en, options, quantity, unit_minor, image_id)
    SELECT tenant, intent, l.position, l.entry->>'product', l.entry->>'nameAr', l.entry->>'nameEn', l.entry->'options',
      (l.entry->>'quantity')::integer, (l.entry->>'unitMinor')::integer, (l.entry->>'imageId')::uuid
      FROM jsonb_array_elements(p_lines) WITH ORDINALITY AS l(entry, position);
  RETURN true;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION public.order_contact_open(p_slug text, p_key text, p_reference text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE changed record;
BEGIN
  UPDATE public.order_intents AS i SET status = 'contact_opened'
    FROM public.get_public_store(p_slug) AS visible JOIN public.stores AS s ON s.slug = visible.slug
    JOIN public.order_settings AS o ON o.store_id = s.id
    WHERE i.store_id = s.id AND i.request_key = p_key AND i.reference = p_reference AND i.archived_at IS NULL
      AND i.status IN ('initiated','contact_opened') AND public.order_channel_enabled(o.config, i.channel)
    RETURNING i.store_id, i.id INTO changed;
  IF NOT FOUND THEN RETURN false; END IF;
  INSERT INTO public.order_intent_events(store_id, intent_id, type) VALUES (changed.store_id, changed.id, 'contact_opened') ON CONFLICT DO NOTHING;
  RETURN true;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION public.order_expire_intents(p_limit integer) RETURNS integer
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  WITH due AS (SELECT i.store_id, i.id FROM public.order_intents AS i
    WHERE (i.status <> 'merchant_confirmed' AND i.created_at <= now() - interval '90 days')
       OR (i.status = 'merchant_confirmed' AND i.created_at <= now() - interval '365 days')
    ORDER BY i.created_at LIMIT least(greatest(p_limit, 1), 1000) FOR UPDATE SKIP LOCKED), removed AS (
    DELETE FROM public.order_intents AS i USING due WHERE i.store_id = due.store_id AND i.id = due.id RETURNING 1
  ) SELECT count(*)::integer FROM removed;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.order_channel_enabled(jsonb, public.order_channel), public.order_public_context(text, text[]),
  public.order_visitor_intent(text, text), public.order_create_intent(text, text, text, text, public.order_channel, text, bigint, jsonb),
  public.order_contact_open(text, text, text), public.order_expire_intents(integer) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.order_public_context(text, text[]), public.order_visitor_intent(text, text),
  public.order_create_intent(text, text, text, text, public.order_channel, text, bigint, jsonb), public.order_contact_open(text, text, text) TO storefront_app;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.order_expire_intents(integer) TO storefront_media_worker;
