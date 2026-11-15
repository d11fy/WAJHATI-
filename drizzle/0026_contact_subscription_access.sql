-- Additive workflow. Historical payments and subscription periods are untouched.
INSERT INTO public.platform_contact(id,enabled,whatsapp) VALUES(1,true,'972567508786');
UPDATE public.billing_config SET trial_days=3 WHERE id=1;
ALTER TABLE public.platform_manual_terms ADD CONSTRAINT platform_manual_terms_no_overlap
  EXCLUDE USING gist (store_id WITH =, tstzrange(starts_at, ends_at, '[)') WITH &&)
  WHERE (starts_at IS NOT NULL AND ends_at IS NOT NULL);
REVOKE ALL ON public.platform_contact,public.platform_mail,public.platform_account_trials,public.platform_manual_terms FROM PUBLIC,storefront_app,storefront_identity,storefront_media_worker;

CREATE FUNCTION public.platform_contact_public() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT jsonb_build_object('enabled',enabled,'whatsapp',whatsapp) FROM public.platform_contact WHERE id=1;
$$;
CREATE FUNCTION public.platform_contact_save(p_token text,p_phone text,p_enabled boolean DEFAULT true) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE actor uuid;
BEGIN
 PERFORM pg_advisory_xact_lock_shared(781690423);
 actor:=public.platform_actor(p_token,'owner',true);
 IF actor IS NULL THEN RETURN 'denied'; END IF;
 IF p_phone IS NULL OR p_phone !~ '^[1-9][0-9]{7,14}$' OR p_enabled IS NULL THEN RETURN 'invalid'; END IF;
 UPDATE public.platform_contact SET whatsapp=p_phone,enabled=p_enabled WHERE id=1;
 PERFORM public.platform_log(actor,NULL,'contact_settings_changed',jsonb_build_object('whatsapp',p_phone,'enabled',p_enabled));
 RETURN 'ok';
END;
$$;

CREATE FUNCTION public.platform_mail_view(p_token text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT jsonb_build_object('config',config,'enabled',enabled,'verifiedAt',verified_at,'changedAt',changed_at,'revision',revision,'hasPassword',true)
 FROM public.platform_mail WHERE id=1 AND public.platform_actor(p_token,'owner',false) IS NOT NULL;
$$;
CREATE FUNCTION public.platform_mail_secret() RETURNS TABLE(config jsonb,cipher bytea,enabled boolean,revision uuid,verified_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT config,cipher,enabled,revision,verified_at FROM public.platform_mail WHERE id=1;
$$;
CREATE FUNCTION public.platform_mail_save(p_token text,p_config jsonb,p_cipher bytea,p_enabled boolean) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE actor uuid;
BEGIN
 PERFORM pg_advisory_xact_lock_shared(781690423);
 actor:=public.platform_actor(p_token,'owner',true);
 IF actor IS NULL THEN RETURN 'denied'; END IF;
 IF p_config IS NULL OR jsonb_typeof(p_config)<>'object' OR p_enabled IS NULL
 OR (p_config->>'port')::int NOT IN (465,587) OR length(p_config::text)>2000
 OR p_config->>'host' IS NULL OR p_config->>'host' !~ '^[a-z0-9][a-z0-9.-]+\.[a-z]{2,}$'
 OR p_config->>'from' IS NULL OR p_config->>'user' IS NULL THEN RETURN 'invalid'; END IF;
 INSERT INTO public.platform_mail(id,config,cipher,enabled)
 VALUES(1,p_config,coalesce(p_cipher,(SELECT cipher FROM public.platform_mail WHERE id=1)),p_enabled)
 ON CONFLICT(id) DO UPDATE SET config=excluded.config,cipher=excluded.cipher,enabled=excluded.enabled,
 revision=gen_random_uuid(),verified_at=NULL,changed_at=now();
 PERFORM public.platform_log(actor,NULL,'smtp_settings_changed'); RETURN 'ok';
 EXCEPTION WHEN check_violation OR not_null_violation OR invalid_text_representation THEN RETURN 'invalid';
END;
$$;
CREATE FUNCTION public.platform_mail_tested(p_token text,p_revision uuid,p_ok boolean) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE actor uuid;
BEGIN
 PERFORM pg_advisory_xact_lock_shared(781690423);
 actor:=public.platform_actor(p_token,'owner',true);
 IF actor IS NULL THEN RETURN 'denied'; END IF;
 UPDATE public.platform_mail SET verified_at=CASE WHEN p_ok THEN now() ELSE NULL END WHERE id=1 AND revision=p_revision;
 IF NOT FOUND THEN RETURN 'invalid'; END IF;
 PERFORM public.platform_log(actor,NULL,CASE WHEN p_ok THEN 'smtp_test_sent' ELSE 'smtp_test_failed' END); RETURN 'ok';
END;
$$;

CREATE FUNCTION public.platform_account_trial_begin() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.platform_contact WHERE enabled) THEN
  INSERT INTO public.platform_account_trials(user_id,starts_at,ends_at) VALUES(NEW.id,NEW.created_at,NEW.created_at+interval '72 hours');
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER platform_account_trial_begin AFTER INSERT ON public.users FOR EACH ROW EXECUTE FUNCTION public.platform_account_trial_begin();
CREATE FUNCTION public.platform_trial_attach() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE trial public.platform_account_trials;
BEGIN
 IF NEW.role<>'owner' OR NOT EXISTS(SELECT 1 FROM public.platform_contact WHERE enabled) THEN RETURN NEW; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.user_id::text,12));
 SELECT * INTO trial FROM public.platform_account_trials WHERE user_id=NEW.user_id;
 IF NOT FOUND OR trial.ends_at<=now() OR EXISTS(SELECT 1 FROM public.billing_trials WHERE user_id=NEW.user_id)
 OR EXISTS(SELECT 1 FROM public.billing_subscriptions WHERE store_id=NEW.store_id)
 OR NOT EXISTS(SELECT 1 FROM public.platform_policy WHERE allow_trials) THEN RETURN NEW; END IF;
 INSERT INTO public.billing_subscriptions(store_id) VALUES(NEW.store_id);
 INSERT INTO public.billing_trials(store_id,user_id,starts_at,ends_at,max_products)
 SELECT NEW.store_id,NEW.user_id,trial.starts_at,trial.ends_at,trial_products FROM public.billing_config WHERE id=1;
 INSERT INTO public.billing_audit(store_id,actor_id,event) VALUES(NEW.store_id,NEW.user_id,'trial_started');
 INSERT INTO public.ops_notifications(kind,recipient,subject,"window") VALUES('trial_started',NEW.user_id,NEW.user_id,NEW.store_id::text) ON CONFLICT DO NOTHING;
 RETURN NEW;
END;
$$;
CREATE TRIGGER platform_trial_attach AFTER INSERT ON public.store_memberships FOR EACH ROW EXECUTE FUNCTION public.platform_trial_attach();

-- New contact-mode accounts cannot start a second trial or postpone the trial clock.
ALTER FUNCTION public.billing_start_trial(uuid) RENAME TO billing_start_trial_before_contact;
REVOKE ALL ON FUNCTION public.billing_start_trial_before_contact(uuid) FROM PUBLIC,storefront_app;
CREATE FUNCTION public.billing_start_trial(p_store uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE actor uuid := nullif(current_setting('dar.user_id', true), '')::uuid;
BEGIN
 IF NOT public.billing_owner(p_store) THEN RETURN 'denied'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_store::text, 1));
 PERFORM pg_advisory_xact_lock(hashtextextended(actor::text, 12));
 IF EXISTS(SELECT 1 FROM public.platform_contact WHERE enabled) THEN
  IF EXISTS(SELECT 1 FROM public.platform_policy WHERE id=1 AND allow_trials)
   AND NOT EXISTS(SELECT 1 FROM public.platform_controls WHERE store_id=p_store AND (suspended OR hold))
   AND EXISTS(SELECT 1 FROM public.billing_verified_accounts v JOIN public.users u ON u.id=v.user_id AND u.email=v.email WHERE v.user_id=actor)
   AND EXISTS(SELECT 1 FROM public.billing_trials t WHERE t.store_id=p_store AND t.user_id=actor AND t.ends_at>now())
   AND NOT EXISTS(SELECT 1 FROM public.billing_audit a WHERE a.store_id=p_store AND a.event='trial_confirmed')
  THEN
   INSERT INTO public.billing_audit(store_id,actor_id,event) VALUES(p_store,actor,'trial_confirmed');
   RETURN 'ok';
  END IF;
  RETURN 'ineligible';
 END IF;
 RETURN public.billing_start_trial_before_contact(p_store);
END;
$$;
ALTER FUNCTION public.billing_request_payment(uuid,uuid,uuid,uuid,uuid,integer,text) RENAME TO billing_request_payment_before_contact;
REVOKE ALL ON FUNCTION public.billing_request_payment_before_contact(uuid,uuid,uuid,uuid,uuid,integer,text) FROM PUBLIC,storefront_app;
CREATE FUNCTION public.billing_request_payment(p_store uuid,p_key uuid,p_price uuid,p_method uuid,p_setup uuid,p_expected integer,p_notes text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF NOT public.billing_owner(p_store) THEN RETURN jsonb_build_object('error','denied'); END IF;
 IF current_setting('dar.contact_enforce', true)='on' AND EXISTS(SELECT 1 FROM public.platform_contact WHERE enabled) THEN RETURN jsonb_build_object('error','unavailable'); END IF;
 RETURN public.billing_request_payment_before_contact(p_store,p_key,p_price,p_method,p_setup,p_expected,p_notes);
END;
$$;

CREATE FUNCTION public.platform_manual_activate(p_id uuid,p_actor uuid) RETURNS text
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
DECLARE term public.platform_manual_terms; begins timestamptz; finish timestamptz; plan_code text; owner_id uuid;
BEGIN
 SELECT * INTO term FROM public.platform_manual_terms WHERE id=p_id FOR UPDATE;
 IF NOT FOUND THEN RETURN 'invalid'; END IF;
 IF term.ends_at IS NOT NULL THEN RETURN 'ok'; END IF;
 IF EXISTS(SELECT 1 FROM public.billing_requests WHERE store_id=term.store_id AND
 (status IN ('submitted','under_review') OR (status='awaiting_payment' AND expires_at>now())))
 OR EXISTS(SELECT 1 FROM public.platform_controls WHERE store_id=term.store_id AND (suspended OR hold)) THEN RETURN 'invalid'; END IF;
 SELECT greatest(now(),max(ends_at)) INTO begins FROM (
 SELECT ends_at FROM public.billing_periods WHERE store_id=term.store_id
 UNION ALL SELECT ends_at FROM public.platform_manual_terms WHERE store_id=term.store_id AND ends_at IS NOT NULL) periods;
 finish := ((begins AT TIME ZONE 'UTC') + make_interval(months => term.months)) AT TIME ZONE 'UTC';
 SELECT code INTO plan_code FROM public.billing_plans WHERE id=term.plan_id;
 SELECT user_id INTO owner_id FROM public.store_memberships WHERE store_id=term.store_id AND role='owner' LIMIT 1;
 INSERT INTO public.billing_subscriptions(store_id) VALUES(term.store_id)
  ON CONFLICT (store_id) DO UPDATE SET cancel_at=NULL,cancel_requested_at=NULL;
 UPDATE public.platform_manual_terms SET starts_at=begins,ends_at=finish,approved_by=p_actor WHERE id=p_id;
 INSERT INTO public.billing_audit(store_id,actor_id,event) VALUES(term.store_id,p_actor,'manual_subscription_activated');
 PERFORM public.platform_log(p_actor,term.store_id,'manual_subscription_activated',jsonb_build_object(
  'activation',p_id,'merchant',owner_id,'plan',plan_code,'months',term.months,
  'amountMinor',term.amount_minor,'currency',term.currency,'reference',term.reference,
  'note',term.note,'startsAt',begins,'endsAt',finish));
 INSERT INTO public.ops_notifications(kind,recipient,subject,"window")
 SELECT 'subscription_active',user_id,term.store_id,p_id::text FROM public.store_memberships WHERE store_id=term.store_id AND role='owner' ON CONFLICT DO NOTHING;
 RETURN 'ok';
END;
$$;
CREATE FUNCTION public.platform_manual_grant(p_token text,p_user uuid,p_store uuid,p_id uuid,p_months integer,p_amount integer,p_reference text,p_plan text DEFAULT 'pro',p_currency public.currency_code DEFAULT 'ILS',p_note text DEFAULT '') RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE actor uuid; plan uuid; existing public.platform_manual_terms; threshold integer; result text; clean_note text := btrim(coalesce(p_note,''));
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(p_store::text,1));
 PERFORM pg_advisory_xact_lock_shared(781690423);
 actor:=coalesce(public.platform_actor(p_token,'owner',true),public.platform_actor(p_token,'administrator',true));
 IF actor IS NULL OR actor=p_user OR EXISTS(SELECT 1 FROM public.store_memberships WHERE store_id=p_store AND user_id=actor) THEN RETURN 'denied'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.store_memberships WHERE store_id=p_store AND user_id=p_user AND role='owner')
 OR p_id IS NULL OR p_months IS NULL OR p_months NOT IN (1,3,6,12) OR p_amount IS NULL OR p_amount NOT BETWEEN 1 AND 1000000000
 OR p_reference IS NULL OR length(btrim(p_reference)) NOT BETWEEN 3 AND 120
 OR p_plan IS NULL OR p_plan NOT IN ('starter','pro') OR p_currency IS NULL OR length(clean_note)>500 THEN RETURN 'invalid'; END IF;
 SELECT id INTO plan FROM public.billing_plans WHERE code=p_plan ORDER BY version DESC LIMIT 1;
 IF plan IS NULL THEN RETURN 'invalid'; END IF;
 SELECT * INTO existing FROM public.platform_manual_terms WHERE id=p_id;
 IF FOUND THEN RETURN CASE WHEN existing.store_id=p_store AND existing.plan_id=plan AND existing.months=p_months
  AND existing.amount_minor=p_amount AND existing.currency=p_currency AND existing.reference=btrim(p_reference)
  AND existing.note=clean_note THEN 'ok' ELSE 'invalid' END; END IF;
 IF EXISTS(SELECT 1 FROM public.platform_manual_terms WHERE store_id=p_store AND ends_at IS NULL) THEN RETURN 'invalid'; END IF;
 INSERT INTO public.platform_manual_terms(id,store_id,plan_id,months,amount_minor,currency,reference,note,actor)
 VALUES(p_id,p_store,plan,p_months,p_amount,p_currency,btrim(p_reference),clean_note,actor);
 SELECT (dual_thresholds->>p_currency::text)::int INTO threshold FROM public.platform_policy WHERE id=1;
 IF threshold IS NOT NULL AND p_amount>=threshold THEN
  PERFORM public.platform_log(actor,p_store,'manual_subscription_pending',jsonb_build_object(
   'activation',p_id,'merchant',p_user,'plan',p_plan,'months',p_months,
   'amountMinor',p_amount,'currency',p_currency,'reference',btrim(p_reference),'note',clean_note));
  RETURN 'ok';
 END IF;
 result:=public.platform_manual_activate(p_id,actor);
 IF result<>'ok' THEN DELETE FROM public.platform_manual_terms WHERE id=p_id; END IF;
 RETURN result;
 EXCEPTION WHEN unique_violation OR exclusion_violation THEN RETURN 'invalid';
END;
$$;
CREATE FUNCTION public.platform_manual_confirm(p_token text,p_id uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE actor uuid; term public.platform_manual_terms;
BEGIN
 SELECT * INTO term FROM public.platform_manual_terms WHERE id=p_id;
 IF NOT FOUND THEN RETURN 'invalid'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(term.store_id::text,1));
 PERFORM pg_advisory_xact_lock_shared(781690423);
 actor:=coalesce(public.platform_actor(p_token,'owner',true),public.platform_actor(p_token,'administrator',true));
 IF actor IS NULL OR actor=term.actor OR EXISTS(SELECT 1 FROM public.store_memberships WHERE store_id=term.store_id AND user_id=actor) THEN RETURN 'denied'; END IF;
 RETURN public.platform_manual_activate(p_id,actor);
END;
$$;
CREATE FUNCTION public.platform_manual_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF current_user='dar_owner' AND current_setting('dar.cleanup',true)='on' THEN RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END; END IF;
 IF OLD.ends_at IS NOT NULL OR (TG_OP='UPDATE' AND (to_jsonb(NEW)-'starts_at'-'ends_at'-'approved_by') IS DISTINCT FROM (to_jsonb(OLD)-'starts_at'-'ends_at'-'approved_by'))
 THEN RAISE EXCEPTION 'Activated subscription records are immutable'; END IF;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END;
$$;
CREATE TRIGGER platform_manual_immutable BEFORE UPDATE OR DELETE ON public.platform_manual_terms FOR EACH ROW EXECUTE FUNCTION public.platform_manual_immutable();
CREATE POLICY platform_manual_owner_read ON public.platform_manual_terms FOR SELECT TO storefront_app USING(public.billing_owner(store_id));
GRANT SELECT ON public.platform_manual_terms TO storefront_app;
CREATE POLICY billing_plans_read ON public.billing_plans FOR SELECT TO storefront_app USING(true);
GRANT SELECT ON public.billing_plans TO storefront_app;

-- Explicit function grants; ordinary runtime cannot read SMTP credentials or invoke private helpers.
REVOKE ALL ON FUNCTION public.platform_contact_public(),public.platform_contact_save(text,text,boolean),public.platform_mail_view(text),
 public.platform_mail_secret(),public.platform_mail_save(text,jsonb,bytea,boolean),public.platform_mail_tested(text,uuid,boolean),
 public.platform_account_trial_begin(),public.platform_trial_attach(),public.platform_manual_activate(uuid,uuid),
 public.platform_manual_grant(text,uuid,uuid,uuid,integer,integer,text,text,public.currency_code,text),public.platform_manual_confirm(text,uuid),public.platform_manual_immutable(),
 public.billing_start_trial(uuid),public.billing_request_payment(uuid,uuid,uuid,uuid,uuid,integer,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.platform_contact_public(),public.platform_contact_save(text,text,boolean),public.platform_mail_view(text),
 public.platform_mail_save(text,jsonb,bytea,boolean),public.platform_mail_tested(text,uuid,boolean),
 public.platform_manual_grant(text,uuid,uuid,uuid,integer,integer,text,text,public.currency_code,text),public.platform_manual_confirm(text,uuid),
 public.billing_start_trial(uuid),public.billing_request_payment(uuid,uuid,uuid,uuid,uuid,integer,text) TO storefront_app;
GRANT EXECUTE ON FUNCTION public.platform_mail_secret() TO storefront_identity;

CREATE OR REPLACE FUNCTION public.billing_state(p_store uuid) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT jsonb_build_object(
    'status', CASE
      WHEN current_term.ends_at > now() THEN 'active'
      WHEN current_term.ends_at IS NOT NULL AND sub.cancel_at = current_term.ends_at THEN 'canceled'
      WHEN current_term.grace_until > now() THEN 'grace_period'
      WHEN current_term.ends_at IS NOT NULL THEN 'suspended'
      WHEN sub.legacy AND legacy.until>now() THEN 'active'
      WHEN trial.ends_at > now() THEN 'trialing'
      WHEN pending.present THEN 'pending_payment'
      ELSE 'expired' END,
    'legacy', coalesce(sub.legacy AND legacy.until>now() AND current_term.ends_at IS NULL, false),
    'onboarding', current_term.ends_at IS NULL AND trial.ends_at IS NULL AND NOT coalesce(sub.legacy, false),
    'legacyUntil', legacy.until, 'trialEnd', trial.ends_at, 'accountTrialEnd', account_trial.ends_at,
    'trialProducts', coalesce(trial.max_products, cfg.trial_products),
    'manualMonths', current_term.months, 'periodStart', current_term.starts_at, 'periodEnd', current_term.ends_at,
    'paidUntil', greatest(current_term.ends_at, future.ends_at), 'graceUntil', current_term.grace_until,
    'cancelAt', sub.cancel_at, 'nextPeriod', future.starts_at, 'nextPlan', future.code,
    'pending', coalesce(pending.present, false),
    'plan', plan.code, 'version', plan.version, 'interval', current_term.interval, 'currency', current_term.currency,
    'maxProducts', plan.max_products, 'storageMiB', plan.storage_mib, 'analytics', plan.analytics,
    'luxury', plan.luxury, 'premium', plan.premium)
  FROM public.billing_config AS cfg
  LEFT JOIN public.billing_subscriptions AS sub ON sub.store_id = p_store
  LEFT JOIN public.platform_legacy legacy ON legacy.store_id=p_store
  LEFT JOIN public.billing_trials AS trial ON trial.store_id = p_store
  LEFT JOIN LATERAL (
    SELECT at.ends_at FROM public.store_memberships sm
    JOIN public.platform_account_trials at ON at.user_id = sm.user_id
    WHERE sm.store_id = p_store AND sm.role = 'owner' LIMIT 1
  ) account_trial ON true
  LEFT JOIN LATERAL (
    SELECT * FROM (
      SELECT term.starts_at,term.ends_at,term.grace_until,r.plan_id,r.interval,r.currency, NULL::integer AS months
      FROM public.billing_periods term JOIN public.billing_requests r ON r.id=term.request_id AND r.store_id=term.store_id WHERE term.store_id=p_store
      UNION ALL
      SELECT m.starts_at,
        coalesce((SELECT max(m2.ends_at) FROM public.platform_manual_terms m2
          WHERE m2.store_id=p_store AND m2.plan_id=m.plan_id AND m2.ends_at IS NOT NULL AND m2.starts_at>=m.starts_at
          AND NOT EXISTS (SELECT 1 FROM public.platform_manual_terms m3 WHERE m3.store_id=p_store AND m3.ends_at IS NOT NULL
            AND m3.starts_at>m.starts_at AND m3.starts_at<m2.starts_at AND m3.plan_id<>m.plan_id)), m.ends_at) AS ends_at,
        coalesce((SELECT max(m2.ends_at) FROM public.platform_manual_terms m2
          WHERE m2.store_id=p_store AND m2.plan_id=m.plan_id AND m2.ends_at IS NOT NULL AND m2.starts_at>=m.starts_at
          AND NOT EXISTS (SELECT 1 FROM public.platform_manual_terms m3 WHERE m3.store_id=p_store AND m3.ends_at IS NOT NULL
            AND m3.starts_at>m.starts_at AND m3.starts_at<m2.starts_at AND m3.plan_id<>m.plan_id)), m.ends_at) AS grace_until,
        m.plan_id,
        CASE WHEN m.months=12 THEN 'yearly'::public.billing_interval ELSE 'monthly'::public.billing_interval END,
        m.currency,
        m.months
      FROM public.platform_manual_terms m WHERE m.store_id=p_store AND m.ends_at IS NOT NULL
    ) terms WHERE starts_at<=now() ORDER BY starts_at DESC LIMIT 1
  ) current_term ON true
  LEFT JOIN public.billing_plans plan ON plan.id=current_term.plan_id
  LEFT JOIN LATERAL (
    SELECT future_term.starts_at,future_term.ends_at,plan.code FROM (
      SELECT term.starts_at,term.ends_at,r.plan_id FROM public.billing_periods term JOIN public.billing_requests r ON r.id=term.request_id WHERE term.store_id=p_store
      UNION ALL SELECT starts_at,ends_at,plan_id FROM public.platform_manual_terms WHERE store_id=p_store AND ends_at IS NOT NULL
    ) future_term JOIN public.billing_plans plan ON plan.id=future_term.plan_id
    WHERE future_term.starts_at > now() AND future_term.ends_at > coalesce(current_term.ends_at, now())
    ORDER BY starts_at LIMIT 1
  ) future ON true
  LEFT JOIN LATERAL (
    SELECT true AS present FROM public.billing_requests AS r WHERE r.store_id = p_store
      AND (r.status IN ('submitted','under_review') OR (r.status = 'awaiting_payment' AND r.expires_at > now()))
    UNION ALL
    SELECT true AS present FROM public.platform_manual_terms AS m WHERE m.store_id = p_store AND m.ends_at IS NULL
    LIMIT 1
  ) AS pending ON true WHERE cfg.id = 1;
$$;

CREATE OR REPLACE FUNCTION public.billing_cancel_at_end(p_store uuid, p_cancel boolean) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE state jsonb; deadline timestamptz;
BEGIN
  IF NOT public.billing_owner(p_store) THEN RETURN 'denied'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_store::text, 1));
  state := public.billing_state(p_store);
  IF (state->>'nextPeriod') IS NOT NULL
    OR EXISTS (SELECT 1 FROM public.billing_periods WHERE store_id = p_store AND starts_at > now())
    OR EXISTS (SELECT 1 FROM public.platform_manual_terms WHERE store_id = p_store AND ends_at IS NULL)
    OR EXISTS (SELECT 1 FROM public.billing_requests WHERE store_id = p_store
      AND (status IN ('submitted','under_review') OR (status = 'awaiting_payment' AND expires_at > now())))
  THEN RETURN 'pending'; END IF;
  IF state->>'status' NOT IN ('active','canceled') OR (state->>'periodEnd') IS NULL OR (state->>'periodEnd')::timestamptz <= now()
  THEN RETURN 'closed'; END IF;
  deadline := (state->>'periodEnd')::timestamptz;
  UPDATE public.billing_subscriptions SET cancel_at = CASE WHEN p_cancel THEN deadline END,
    cancel_requested_at = CASE WHEN p_cancel THEN now() END
    WHERE store_id = p_store AND (cancel_at IS NOT NULL) IS DISTINCT FROM p_cancel;
  IF FOUND THEN
    INSERT INTO public.billing_audit(store_id, actor_id, event)
      VALUES (p_store, nullif(current_setting('dar.user_id', true), '')::uuid, CASE WHEN p_cancel THEN 'cancel_scheduled' ELSE 'cancel_removed' END);
  END IF;
  RETURN 'ok';
END;
$$;

CREATE OR REPLACE FUNCTION public.billing_expire(p_limit integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE requests integer; subscriptions integer; proofs integer;
BEGIN
  WITH due AS (SELECT id FROM public.billing_requests WHERE status = 'awaiting_payment' AND expires_at <= now()
    ORDER BY expires_at, id LIMIT least(greatest(p_limit,1),1000) FOR UPDATE SKIP LOCKED),
  expired AS (UPDATE public.billing_requests r SET status = 'expired' FROM due WHERE r.id = due.id RETURNING r.store_id,r.id)
  INSERT INTO public.billing_audit(store_id, request_id, event) SELECT store_id,id,'request_expired' FROM expired;
  GET DIAGNOSTICS requests = ROW_COUNT;
  WITH due AS (SELECT s.store_id, (public.billing_state(s.store_id)->>'status')::public.billing_subscription_status AS state
    FROM public.billing_subscriptions s
    WHERE s.observed_status IS DISTINCT FROM (public.billing_state(s.store_id)->>'status')::public.billing_subscription_status
    ORDER BY s.store_id LIMIT least(greatest(p_limit,1),1000) FOR UPDATE OF s SKIP LOCKED),
  changed AS (UPDATE public.billing_subscriptions s SET observed_status = due.state, observed_at = now()
    FROM due WHERE s.store_id = due.store_id RETURNING s.store_id, s.observed_status),
  notified AS (
    INSERT INTO public.ops_notifications(kind,recipient,subject,"window")
    SELECT 'subscription_expired', m.user_id, c.store_id, to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD')
    FROM changed c JOIN public.store_memberships m ON m.store_id = c.store_id AND m.role = 'owner'
    WHERE c.observed_status IN ('expired','suspended')
    ON CONFLICT DO NOTHING
  )
  INSERT INTO public.billing_audit(store_id,event) SELECT store_id,'subscription_' || observed_status::text FROM changed;
  GET DIAGNOSTICS subscriptions = ROW_COUNT;
  WITH due AS (SELECT p.request_id FROM public.billing_proofs p JOIN public.billing_requests r ON r.id = p.request_id
    WHERE r.reviewed_at <= now() - interval '180 days' ORDER BY r.reviewed_at,p.request_id
    LIMIT least(greatest(p_limit,1),1000) FOR UPDATE OF p SKIP LOCKED),
  purged AS (DELETE FROM public.billing_proofs p USING due WHERE p.request_id = due.request_id RETURNING p.store_id,p.request_id)
  INSERT INTO public.billing_audit(store_id, request_id,event) SELECT store_id,request_id,'proof_purged' FROM purged;
  GET DIAGNOSTICS proofs = ROW_COUNT;
  UPDATE public.billing_setup_requests AS s SET status = 'closed' FROM public.billing_requests AS r
    WHERE s.request_id = r.id AND s.status = 'awaiting_payment' AND r.status = 'expired';
  RETURN jsonb_build_object('requests',requests,'subscriptions',subscriptions,'proofs',proofs);
END;
$$;

CREATE OR REPLACE FUNCTION public.ops_claim_mail(p_limit integer) RETURNS TABLE(id uuid, kind text, email varchar, lease uuid, slug varchar)
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
    CASE
      WHEN n.kind='review_pending' AND r.status IN ('submitted','under_review') AND EXISTS (
        SELECT 1 FROM public.platform_roles pr WHERE pr.user_id=u.id AND pr.role='reviewer'
      ) AND NOT EXISTS (SELECT 1 FROM public.store_memberships m WHERE m.store_id=r.store_id AND m.user_id=u.id)
      THEN v.email::varchar
      WHEN n.kind='billing_due' AND s.id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.store_memberships m WHERE m.store_id=s.id AND m.user_id=u.id AND m.role='owner'
      ) AND n."window" ~ '^[0-9]+$' AND to_timestamp(n."window"::bigint)>now()
      THEN v.email::varchar
      WHEN n.kind IN ('trial_started','subscription_active','subscription_expired') AND s.id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.store_memberships m WHERE m.store_id=s.id AND m.user_id=u.id AND m.role='owner'
      )
      THEN coalesce(v.email, u.email)::varchar
    END,
    n.lease,s.slug
  FROM claimed n JOIN public.users u ON u.id=n.recipient
  LEFT JOIN public.billing_verified_accounts v ON v.user_id=u.id AND v.email=u.email
  LEFT JOIN public.billing_requests r ON n.kind='review_pending' AND r.id=n.subject
  LEFT JOIN public.stores s ON s.id = CASE
    WHEN n.kind='trial_started' AND n."window" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN n."window"::uuid
    WHEN n.kind IN ('billing_due','subscription_active','subscription_expired','trial_started') THEN n.subject
  END;
$$;

-- Disambiguate the authorized reviewer variable from the joined reviewer column.
CREATE OR REPLACE FUNCTION public.platform_query(p_token text,p_area text,p_search text,p_offset integer,p_filter text) RETURNS SETOF jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE manager uuid:=coalesce(public.platform_actor(p_token,'owner',false),public.platform_actor(p_token,'administrator',false));
  review_actor uuid:=public.platform_actor(p_token,'reviewer',false);
  q text:=btrim(left(coalesce(p_search,''),100)); start_at integer:=greatest(0,least(p_offset,20000));
BEGIN
  IF manager IS NULL AND (review_actor IS NULL OR p_area NOT IN ('payments','setup')) THEN RETURN; END IF;
  IF p_area='overview' THEN RETURN QUERY SELECT jsonb_build_object(
    'merchants',(SELECT count(DISTINCT user_id) FROM public.store_memberships WHERE role='owner'),
    'stores',(SELECT count(*) FROM public.stores),
    'approved',(SELECT count(*) FROM public.billing_requests WHERE status='approved') + (SELECT count(*) FROM public.platform_manual_terms WHERE ends_at IS NOT NULL),
    'pending',(SELECT count(*) FROM public.billing_requests WHERE status IN ('submitted','under_review')) + (SELECT count(*) FROM public.platform_manual_terms WHERE ends_at IS NULL),
    'manualActivated',(SELECT count(*) FROM public.platform_manual_terms WHERE ends_at IS NOT NULL),
    'manualPending',(SELECT count(*) FROM public.platform_manual_terms WHERE ends_at IS NULL),
    'suspended',(SELECT count(*) FROM public.platform_controls WHERE suspended),
    'legacy',(SELECT count(*) FROM public.platform_legacy WHERE until>now()),
    'setup',(SELECT count(*) FROM public.billing_setup_requests WHERE status='paid'));
  ELSIF p_area='merchants' THEN RETURN QUERY
    SELECT jsonb_build_object('id',u.id,'name',u.name,'email',u.email,'createdAt',u.created_at,'verified',v.user_id IS NOT NULL,
      'exactEmail',q<>'' AND lower(u.email)=lower(q),
      'stores',(SELECT count(*) FROM public.store_memberships m WHERE m.user_id=u.id AND m.role='owner'),
      'trialUsed',EXISTS(SELECT 1 FROM public.billing_trials WHERE user_id=u.id),
      'trialStartsAt',coalesce(at.starts_at,(SELECT min(starts_at) FROM public.billing_trials WHERE user_id=u.id)),
      'trialEndsAt',coalesce(at.ends_at,(SELECT max(ends_at) FROM public.billing_trials WHERE user_id=u.id)),
      'managedStores',coalesce((SELECT jsonb_agg(jsonb_build_object(
        'id',s.id,'name',s.name,'slug',s.slug,'country',s.country,'currency',s.currency,'published',s.published_at IS NOT NULL,
        'suspended',coalesce(c.suspended,false),'hold',coalesce(c.hold,false),
        'state',public.billing_state(s.id),
        'manual',coalesce((SELECT jsonb_agg(jsonb_build_object(
          'id',a.id,'plan',bp.code,'months',a.months,'amountMinor',a.amount_minor,'currency',a.currency,
          'reference',a.reference,'note',a.note,'startsAt',a.starts_at,'endsAt',a.ends_at,'createdAt',a.created_at,
          'actor',a.actor,'actorEmail',(SELECT email FROM public.users WHERE id=a.actor),
          'approvedBy',a.approved_by,'approvedByEmail',(SELECT email FROM public.users WHERE id=a.approved_by)
        ) ORDER BY a.created_at DESC) FROM public.platform_manual_terms a JOIN public.billing_plans bp ON bp.id=a.plan_id WHERE a.store_id=s.id),'[]'::jsonb)
      ) ORDER BY s.created_at ASC,s.id) FROM public.stores s JOIN public.store_memberships sm ON sm.store_id=s.id LEFT JOIN public.platform_controls c ON c.store_id=s.id WHERE sm.user_id=u.id AND sm.role='owner'),'[]'::jsonb),
      'roles',coalesce((SELECT jsonb_agg(role) FROM public.platform_roles WHERE user_id=u.id),'[]'::jsonb))
    FROM public.users u
    LEFT JOIN public.billing_verified_accounts v ON v.user_id=u.id AND v.email=u.email
    LEFT JOIN public.platform_account_trials at ON at.user_id=u.id
    WHERE (q='' OR strpos(lower(u.name),lower(q))>0 OR strpos(lower(u.email),lower(q))>0)
      AND (p_filter='' OR (p_filter='verified')=(v.user_id IS NOT NULL))
    ORDER BY (q<>'' AND lower(u.email)=lower(q)) DESC, u.created_at DESC, u.id OFFSET start_at LIMIT 21;
  ELSIF p_area IN ('stores','subscriptions','themes') THEN RETURN QUERY
    SELECT jsonb_build_object('id',s.id,'name',s.name,'slug',s.slug,'country',s.country,'currency',s.currency,'published',s.published_at IS NOT NULL,
      'ownerId',(SELECT sm.user_id FROM public.store_memberships sm WHERE sm.store_id=s.id AND sm.role='owner' LIMIT 1),
      'ownerEmail',(SELECT u.email FROM public.store_memberships sm JOIN public.users u ON u.id=sm.user_id WHERE sm.store_id=s.id AND sm.role='owner' LIMIT 1),
      'ownerName',(SELECT u.name FROM public.store_memberships sm JOIN public.users u ON u.id=sm.user_id WHERE sm.store_id=s.id AND sm.role='owner' LIMIT 1),
      'suspended',coalesce(c.suspended,false),'hold',coalesce(c.hold,false),'legacyUntil',l.until,'billing',state.value,
      'manual',coalesce((SELECT jsonb_agg(jsonb_build_object(
        'id',a.id,'plan',bp.code,'months',a.months,'amountMinor',a.amount_minor,'currency',a.currency,
        'reference',a.reference,'note',a.note,'startsAt',a.starts_at,'endsAt',a.ends_at,'createdAt',a.created_at,
        'actor',a.actor,'actorEmail',(SELECT email FROM public.users WHERE id=a.actor),
        'approvedBy',a.approved_by,'approvedByEmail',(SELECT email FROM public.users WHERE id=a.approved_by)
      ) ORDER BY a.created_at DESC) FROM public.platform_manual_terms a JOIN public.billing_plans bp ON bp.id=a.plan_id WHERE a.store_id=s.id),'[]'::jsonb),
      'products',(SELECT count(*) FROM public.catalog_products WHERE store_id=s.id AND state<>'archived'),
      'storageBytes',public.billing_storage_used(s.id),'orders',(SELECT count(*) FROM public.order_intents WHERE store_id=s.id),
      'theme',d.published->>'theme','updated',greatest(s.created_at,c.changed_at,d.published_at),
      'lastBilling',greatest((SELECT max(created_at) FROM public.billing_requests WHERE store_id=s.id),(SELECT max(created_at) FROM public.platform_manual_terms WHERE store_id=s.id)))
    FROM public.stores s LEFT JOIN public.platform_controls c ON c.store_id=s.id LEFT JOIN public.platform_legacy l ON l.store_id=s.id
    LEFT JOIN public.store_designs d ON d.store_id=s.id CROSS JOIN LATERAL (SELECT public.billing_state(s.id) AS value) state
    WHERE (q='' OR strpos(lower(s.name),lower(q))>0 OR strpos(s.slug,lower(q))>0
      OR EXISTS(SELECT 1 FROM public.store_memberships sm JOIN public.users u ON u.id=sm.user_id WHERE sm.store_id=s.id AND sm.role='owner' AND strpos(lower(u.email),lower(q))>0))
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
  ELSIF p_area='settings' THEN RETURN QUERY
    SELECT to_jsonb(p)||to_jsonb(c)||jsonb_build_object(
      'contact',public.platform_contact_public(),
      'mail',public.platform_mail_view(p_token),
      'notificationStats',jsonb_build_object(
        'pending',(SELECT count(*) FROM public.ops_notifications WHERE sent_at IS NULL AND failed_at IS NULL),
        'sent',(SELECT count(*) FROM public.ops_notifications WHERE sent_at IS NOT NULL),
        'failed',(SELECT count(*) FROM public.ops_notifications WHERE failed_at IS NOT NULL),
        'recent',coalesce((SELECT jsonb_agg(jsonb_build_object(
          'id',n.id,'kind',n.kind,'createdAt',n.created_at,'dueAt',n.due_at,'attempts',n.attempts,'sentAt',n.sent_at,'failedAt',n.failed_at
        ) ORDER BY n.created_at DESC) FROM (SELECT * FROM public.ops_notifications ORDER BY created_at DESC LIMIT 12) n),'[]'::jsonb)
      )
    ) FROM public.platform_policy p JOIN public.billing_config c USING(id);
  ELSIF p_area='audit' THEN RETURN QUERY
    SELECT to_jsonb(e) FROM public.platform_events e WHERE q='' OR strpos(e.action,lower(q))>0 ORDER BY id DESC OFFSET start_at LIMIT 21;
  ELSIF p_area='jobs' THEN RETURN QUERY
    SELECT to_jsonb(j) FROM public.platform_jobs j WHERE q='' OR strpos(j.job,lower(q))>0 ORDER BY started_at DESC OFFSET start_at LIMIT 21;
  END IF;
END;
$$;
