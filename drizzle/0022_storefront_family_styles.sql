-- Existing design rows are left intact. These defaults apply when styles are written or read.
CREATE FUNCTION public.theme_family_style(p_theme text) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT CASE WHEN colors IS NOT NULL THEN jsonb_build_object('theme', p_theme, 'font', 'sans', 'colors', colors) END
  FROM (SELECT CASE p_theme
    WHEN 'electro-x' THEN '{"background":"#080F1D","text":"#F9FCFF","accent":"#4BE7C5","onAccent":"#08101E"}'::jsonb
    WHEN 'maison-wear' THEN '{"background":"#F5F0E8","text":"#2D2822","accent":"#25231F","onAccent":"#FFFFFF"}'::jsonb
    WHEN 'aura-beauty' THEN '{"background":"#FBF4F1","text":"#382F35","accent":"#A45476","onAccent":"#FFFFFF"}'::jsonb
    WHEN 'luma-gifts' THEN '{"background":"#F9F5FF","text":"#31263E","accent":"#7452B5","onAccent":"#FFFFFF"}'::jsonb
    WHEN 'digital-hub' THEN '{"background":"#080E20","text":"#F5F8FF","accent":"#5EE9D3","onAccent":"#071324"}'::jsonb
    WHEN 'learnpro' THEN '{"background":"#F5F7FE","text":"#162440","accent":"#315DE7","onAccent":"#FFFFFF"}'::jsonb
  END AS colors) AS palette;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.theme_family_style(text) FROM PUBLIC;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.billing_design_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE caps jsonb; changed jsonb; family_style jsonb; basic jsonb;
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
  family_style := public.theme_family_style(changed->>'theme');
  basic := coalesce(family_style, public.billing_basic_style());
  IF (NEW.published IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.published_revision IS DISTINCT FROM OLD.published_revision)
      AND NOT (caps->>'publish')::boolean)
    OR (family_style IS NULL AND NOT coalesce(changed->>'theme' IN ('minimal-commerce','luxury-boutique'), false))
    OR (changed->>'theme' = 'luxury-boutique' AND NOT (caps->>'luxury')::boolean)
    OR (NOT (caps->>'premium')::boolean AND (changed->'colors' IS DISTINCT FROM basic->'colors'
      OR changed->>'font' IS DISTINCT FROM basic->>'font'))
  THEN RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'billing_theme_limit', MESSAGE = 'Design feature unavailable'; END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.theme_public_design(p_slug text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT (effective.design - 'sectionPreferences' - 'familyContent') ||
    CASE WHEN jsonb_typeof(effective.design->'familyContent'->(effective.design->>'theme')) = 'object'
      THEN jsonb_build_object('familyContent', jsonb_build_object(effective.design->>'theme', effective.design->'familyContent'->(effective.design->>'theme')))
      ELSE '{}'::jsonb END
  FROM public.get_public_store(p_slug) AS visible
  JOIN public.stores s ON s.slug = visible.slug JOIN public.store_designs d ON d.store_id = s.id
  CROSS JOIN LATERAL public.billing_capabilities(s.id) caps
  CROSS JOIN LATERAL (SELECT CASE WHEN caps->>'premium' = 'true' AND (d.published->>'theme' <> 'luxury-boutique' OR caps->>'luxury' = 'true')
    THEN d.published ELSE d.published || coalesce(public.theme_family_style(d.published->>'theme'), public.billing_basic_style()) END AS design) effective;
$$;
