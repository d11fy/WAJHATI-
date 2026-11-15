CREATE FUNCTION public.ops_review_notice() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
  IF NEW.status='submitted' AND OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO public.ops_notifications(kind,recipient,subject,"window")
    SELECT 'review_pending',r.user_id,NEW.id,'submitted'
    FROM public.platform_roles r JOIN public.users u ON u.id=r.user_id
    JOIN public.billing_verified_accounts v ON v.user_id=u.id AND v.email=u.email
    WHERE r.role='reviewer'
      AND NOT EXISTS (SELECT 1 FROM public.store_memberships m WHERE m.store_id=NEW.store_id AND m.user_id=r.user_id)
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER ops_review_notice AFTER UPDATE OF status ON public.billing_requests
FOR EACH ROW EXECUTE FUNCTION public.ops_review_notice();

CREATE FUNCTION public.ops_schedule_reminders() RETURNS integer
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
  WITH pending AS (
    SELECT s.store_id, m.user_id, CASE state->>'status'
      WHEN 'trialing' THEN (state->>'trialEnd')::timestamptz
      WHEN 'active' THEN CASE WHEN state->>'cancelAt' IS NULL AND state->>'nextPeriod' IS NULL THEN (state->>'periodEnd')::timestamptz END
      WHEN 'grace_period' THEN (state->>'graceUntil')::timestamptz END AS deadline
    FROM public.billing_subscriptions s CROSS JOIN LATERAL public.billing_state(s.store_id) state
    JOIN public.store_memberships m ON m.store_id=s.store_id AND m.role='owner'
    JOIN public.users u ON u.id=m.user_id JOIN public.billing_verified_accounts v ON v.user_id=u.id AND v.email=u.email
  ), added AS (
    INSERT INTO public.ops_notifications(kind,recipient,subject,"window")
    SELECT 'billing_due', p.user_id, p.store_id, extract(epoch FROM p.deadline)::bigint::text
    FROM pending p WHERE p.deadline>now() AND p.deadline<=now()+interval '72 hours'
      AND NOT EXISTS (SELECT 1 FROM public.ops_notifications n WHERE n.kind='billing_due' AND n.recipient=p.user_id
        AND n.subject=p.store_id AND n."window"=extract(epoch FROM p.deadline)::bigint::text)
    ORDER BY p.deadline,p.store_id,p.user_id LIMIT 250 ON CONFLICT DO NOTHING RETURNING 1
  ) SELECT count(*)::integer FROM added;
$$;

CREATE FUNCTION public.ops_claim_mail(p_limit integer) RETURNS TABLE(id uuid, kind text, email varchar, lease uuid, slug varchar)
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
  WITH due AS (
    SELECT n.id FROM public.ops_notifications n
    WHERE n.sent_at IS NULL AND n.failed_at IS NULL AND n.attempts<6 AND n.due_at<=now() AND n.created_at>now()-interval '20 hours'
    ORDER BY n.due_at,n.id LIMIT least(greatest(p_limit,1),40) FOR UPDATE SKIP LOCKED
  ), claimed AS (
    UPDATE public.ops_notifications n SET due_at=now()+interval '5 minutes',attempts=n.attempts+1,lease=gen_random_uuid()
    FROM due WHERE n.id=due.id RETURNING n.*
  )
  SELECT n.id,n.kind,
    CASE WHEN n.kind='review_pending' AND r.status IN ('submitted','under_review') AND EXISTS (
      SELECT 1 FROM public.platform_roles pr WHERE pr.user_id=u.id AND pr.role='reviewer'
    ) AND NOT EXISTS (SELECT 1 FROM public.store_memberships m WHERE m.store_id=r.store_id AND m.user_id=u.id)
      OR n.kind='billing_due' AND s.id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.store_memberships m WHERE m.store_id=s.id AND m.user_id=u.id AND m.role='owner'
      ) AND CASE WHEN n.kind='billing_due' THEN to_timestamp(n."window"::bigint)>now() ELSE false END THEN v.email::varchar END,
    n.lease,s.slug
  FROM claimed n JOIN public.users u ON u.id=n.recipient
  LEFT JOIN public.billing_verified_accounts v ON v.user_id=u.id AND v.email=u.email
  LEFT JOIN public.billing_requests r ON n.kind='review_pending' AND r.id=n.subject
  LEFT JOIN public.stores s ON n.kind='billing_due' AND s.id=n.subject;
$$;

CREATE FUNCTION public.ops_finish_mail(p_id uuid,p_lease uuid,p_outcome text) RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
  UPDATE public.ops_notifications n SET
    sent_at=CASE WHEN p_outcome='sent' THEN now() END,
    failed_at=CASE WHEN p_outcome IN ('skipped','terminal') OR p_outcome='retry' AND n.attempts>=6 THEN now() END,
    due_at=CASE WHEN p_outcome='retry' THEN now()+make_interval(mins => power(2,n.attempts)::integer) ELSE n.due_at END,
    lease=NULL
  WHERE n.id=p_id AND n.lease=p_lease AND n.sent_at IS NULL AND n.failed_at IS NULL
    AND p_outcome IN ('sent','skipped','terminal','retry') RETURNING true;
$$;

CREATE FUNCTION public.ops_maintain() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE abandoned integer; removed integer; broken bigint;
BEGIN
  UPDATE public.ops_notifications SET failed_at=now(),lease=NULL WHERE sent_at IS NULL AND failed_at IS NULL
    AND (created_at<=now()-interval '20 hours' OR attempts>=6 AND due_at<=now());
  GET DIAGNOSTICS abandoned=ROW_COUNT;
  DELETE FROM public.ops_notifications WHERE coalesce(sent_at,failed_at)<=now()-interval '90 days';
  GET DIAGNOSTICS removed=ROW_COUNT;
  SELECT count(*) INTO broken FROM (
    SELECT previous,hash,lag(hash) over(order by id) AS prev,
      public.platform_hash(jsonb_build_array(id,actor,subject,action,detail,extract(epoch FROM created_at),previous)::text) AS expected
    FROM public.platform_events
  ) chain WHERE previous<>coalesce(prev,repeat('0',64)) OR hash<>expected;
  RETURN jsonb_build_object('abandoned',abandoned,'removed',removed,'audit_mismatch',broken);
END;
$$;

CREATE FUNCTION public.ops_missed_jobs() RETURNS TABLE(job text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
  SELECT expected.job FROM (VALUES ('billing',interval '20 minutes'),('media',interval '30 minutes'),
    ('orders',interval '26 hours'),('notifications',interval '12 minutes'),('maintenance',interval '26 hours')) expected(job,period)
  WHERE NOT EXISTS (SELECT 1 FROM public.platform_jobs j WHERE j.job=expected.job AND j.success AND j.finished_at>now()-expected.period);
$$;

CREATE FUNCTION public.platform_archive_proof_versioned(p_store uuid,p_id uuid,p_cipher bytea,p_type text,p_hash text,p_key text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
  IF NOT public.billing_owner(p_store) OR (p_key IS NOT NULL AND p_key !~ '^[a-z0-9][a-z0-9_-]{0,23}$') OR
    NOT EXISTS(SELECT 1 FROM public.billing_proofs WHERE store_id=p_store AND request_id=p_id)
  THEN RETURN false; END IF;
  INSERT INTO public.platform_proof_sources(request_id,cipher,original_type,sha256,key_id)
    VALUES(p_id,p_cipher,p_type,p_hash,p_key) ON CONFLICT(request_id) DO NOTHING;
  RETURN EXISTS(SELECT 1 FROM public.platform_proof_sources WHERE request_id=p_id AND sha256=p_hash);
END;
$$;

CREATE FUNCTION public.platform_proof_source_versioned(p_token text,p_id uuid)
RETURNS TABLE(cipher bytea,original_type text,sha256 varchar,key_id varchar)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE actor uuid:=public.platform_actor(p_token,'reviewer',true); tenant uuid;
BEGIN
  IF actor IS NULL THEN RETURN; END IF;
  SELECT store_id INTO tenant FROM public.billing_proofs WHERE request_id=p_id;
  IF NOT FOUND OR EXISTS(SELECT 1 FROM public.store_memberships WHERE store_id=tenant AND user_id=actor) THEN RETURN; END IF;
  RETURN QUERY SELECT s.cipher,s.original_type,s.sha256,s.key_id FROM public.platform_proof_sources s WHERE s.request_id=p_id;
  IF FOUND THEN PERFORM public.platform_log(actor,p_id,'proof_original_downloaded'); END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.ops_review_notice(),public.ops_schedule_reminders(),public.ops_claim_mail(integer),
  public.ops_finish_mail(uuid,uuid,text),public.ops_maintain(),public.ops_missed_jobs(),
  public.platform_archive_proof_versioned(uuid,uuid,bytea,text,text,text),public.platform_proof_source_versioned(text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ops_schedule_reminders(),public.ops_claim_mail(integer),
  public.ops_finish_mail(uuid,uuid,text),public.ops_maintain(),public.ops_missed_jobs() TO storefront_media_worker;
GRANT EXECUTE ON FUNCTION public.platform_archive_proof_versioned(uuid,uuid,bytea,text,text,text),
  public.platform_proof_source_versioned(text,uuid) TO storefront_app;
CREATE OR REPLACE FUNCTION public.platform_job_start(p_job text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE run uuid;
BEGIN
  IF p_job NOT IN ('media','orders','billing','notifications','maintenance') THEN RETURN NULL; END IF;
  DELETE FROM public.platform_jobs WHERE started_at<now()-interval '90 days';
  IF p_job='billing' THEN
    DELETE FROM public.identity_tokens WHERE expires_at<now();
    DELETE FROM public.identity_changes WHERE expires_at<now();
    DELETE FROM public.sessions WHERE expires_at<now();
  END IF;
  INSERT INTO public.platform_jobs(job) VALUES(p_job) RETURNING id INTO run;
  RETURN run;
END;
$$;

