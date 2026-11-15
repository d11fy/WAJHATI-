-- Disambiguate the authorized reviewer variable from the joined reviewer column.
CREATE OR REPLACE FUNCTION public.platform_query(p_token text,p_area text,p_search text,p_offset integer,p_filter text) RETURNS SETOF jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE manager uuid:=coalesce(public.platform_actor(p_token,'owner',false),public.platform_actor(p_token,'administrator',false));
  review_actor uuid:=public.platform_actor(p_token,'reviewer',false);
  q text:=left(coalesce(p_search,''),100); start_at integer:=greatest(0,least(p_offset,20000));
BEGIN
  IF manager IS NULL AND (review_actor IS NULL OR p_area NOT IN ('payments','setup')) THEN RETURN; END IF;
  IF p_area='overview' THEN RETURN QUERY SELECT jsonb_build_object(
    'merchants',(SELECT count(DISTINCT user_id) FROM public.store_memberships WHERE role='owner'),
    'stores',(SELECT count(*) FROM public.stores),
    'approved',(SELECT count(*) FROM public.billing_requests WHERE status='approved'),
    'pending',(SELECT count(*) FROM public.billing_requests WHERE status IN ('submitted','under_review')),
    'suspended',(SELECT count(*) FROM public.platform_controls WHERE suspended),
    'legacy',(SELECT count(*) FROM public.platform_legacy WHERE until>now()),
    'setup',(SELECT count(*) FROM public.billing_setup_requests WHERE status='paid'));
  ELSIF p_area='merchants' THEN RETURN QUERY
    SELECT jsonb_build_object('id',u.id,'name',u.name,'email',u.email,'verified',v.user_id IS NOT NULL,
      'stores',(SELECT count(*) FROM public.store_memberships m WHERE m.user_id=u.id AND m.role='owner'),
      'trialUsed',EXISTS(SELECT 1 FROM public.billing_trials WHERE user_id=u.id),
      'roles',coalesce((SELECT jsonb_agg(role) FROM public.platform_roles WHERE user_id=u.id),'[]'::jsonb))
    FROM public.users u LEFT JOIN public.billing_verified_accounts v ON v.user_id=u.id AND v.email=u.email
    WHERE (q='' OR strpos(lower(u.name),lower(q))>0 OR strpos(lower(u.email),lower(q))>0)
      AND (p_filter='' OR (p_filter='verified')=(v.user_id IS NOT NULL))
    ORDER BY u.created_at DESC,u.id OFFSET start_at LIMIT 21;
  ELSIF p_area IN ('stores','subscriptions','themes') THEN RETURN QUERY
    SELECT jsonb_build_object('id',s.id,'name',s.name,'slug',s.slug,'country',s.country,'published',s.published_at IS NOT NULL,
      'suspended',coalesce(c.suspended,false),'hold',coalesce(c.hold,false),'legacyUntil',l.until,'billing',state.value,
      'products',(SELECT count(*) FROM public.catalog_products WHERE store_id=s.id AND state<>'archived'),
      'storageBytes',public.billing_storage_used(s.id),'orders',(SELECT count(*) FROM public.order_intents WHERE store_id=s.id),
      'theme',d.published->>'theme','updated',greatest(s.created_at,c.changed_at,d.published_at),
      'lastBilling',(SELECT max(created_at) FROM public.billing_requests WHERE store_id=s.id))
    FROM public.stores s LEFT JOIN public.platform_controls c ON c.store_id=s.id LEFT JOIN public.platform_legacy l ON l.store_id=s.id
    LEFT JOIN public.store_designs d ON d.store_id=s.id CROSS JOIN LATERAL (SELECT public.billing_state(s.id) AS value) state
    WHERE (q='' OR strpos(lower(s.name),lower(q))>0 OR strpos(s.slug,lower(q))>0)
      AND (p_filter='' OR (p_filter='suspended' AND c.suspended) OR (p_filter='legacy' AND l.until>now()) OR state.value->>'status'=p_filter)
    ORDER BY s.created_at DESC,s.id OFFSET start_at LIMIT 21;
  ELSIF p_area IN ('payments','setup') THEN RETURN QUERY
    SELECT jsonb_build_object('id',r.id,'reference',r.reference,'store',s.name,'status',r.status,'currency',r.currency,
      'amount',r.plan_minor+r.setup_minor,'createdAt',r.created_at,'setup',x.label,'setupStatus',x.status,
      'dual',c.request_id IS NOT NULL,'canReview',review_actor IS NOT NULL)
    FROM public.billing_requests r JOIN public.stores s ON s.id=r.store_id LEFT JOIN public.billing_setup_requests x ON x.request_id=r.id
    LEFT JOIN public.platform_payment_checks c ON c.request_id=r.id
    WHERE (p_area<>'setup' OR x.request_id IS NOT NULL) AND (q='' OR strpos(lower(r.reference),lower(q))>0 OR strpos(lower(s.name),lower(q))>0)
      AND (p_filter='' OR r.status::text=p_filter OR x.status=p_filter)
    ORDER BY r.created_at DESC,r.id OFFSET start_at LIMIT 21;
  ELSIF p_area='plans' THEN RETURN QUERY SELECT jsonb_build_object(
    'plans',coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY code,version DESC) FROM public.billing_plans p),'[]'::jsonb),
    'prices',coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY country,currency) FROM public.billing_prices p),'[]'::jsonb),
    'methods',coalesce((SELECT jsonb_agg(CASE WHEN public.platform_actor(p_token,'owner',false) IS NULL
      THEN to_jsonb(m)-'instructions' ELSE to_jsonb(m) END ORDER BY country,currency) FROM public.billing_methods m),'[]'::jsonb),
    'setups',coalesce((SELECT jsonb_agg(to_jsonb(s) ORDER BY country,currency) FROM public.billing_setup_packages s),'[]'::jsonb));
  ELSIF p_area='settings' THEN RETURN QUERY SELECT to_jsonb(p)||to_jsonb(c) FROM public.platform_policy p JOIN public.billing_config c USING(id);
  ELSIF p_area='audit' THEN RETURN QUERY
    SELECT to_jsonb(e) FROM public.platform_events e WHERE q='' OR strpos(e.action,lower(q))>0 ORDER BY id DESC OFFSET start_at LIMIT 21;
  ELSIF p_area='jobs' THEN RETURN QUERY
    SELECT to_jsonb(j) FROM public.platform_jobs j WHERE q='' OR strpos(j.job,lower(q))>0 ORDER BY started_at DESC OFFSET start_at LIMIT 21;
  END IF;
END;
$$;
