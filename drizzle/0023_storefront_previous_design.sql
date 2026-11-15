ALTER TABLE public.store_designs ADD COLUMN previous_published jsonb
  CONSTRAINT store_design_previous_object CHECK (
    previous_published IS NULL OR (published IS NOT NULL AND jsonb_typeof(previous_published) = 'object')
  );
--> statement-breakpoint
ALTER POLICY theme_asset_delete ON public.store_design_assets USING (
  public.theme_member(store_id) AND NOT EXISTS (
    SELECT 1 FROM public.store_designs AS d WHERE d.store_id = store_design_assets.store_id
      AND (d.draft->'assets'->>store_design_assets.kind::text = store_design_assets.id::text
        OR d.published->'assets'->>store_design_assets.kind::text = store_design_assets.id::text
        OR d.previous_published->'assets'->>store_design_assets.kind::text = store_design_assets.id::text)
  )
);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.theme_publish(p_store uuid, p_revision integer) RETURNS text
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
  UPDATE public.store_designs
    SET previous_published = CASE WHEN published IS DISTINCT FROM design THEN published ELSE previous_published END,
        published = design, published_revision = p_revision, published_at = now()
    WHERE store_id = p_store;
  RETURN 'ok';
END;
$$;
