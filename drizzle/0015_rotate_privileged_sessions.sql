CREATE OR REPLACE FUNCTION public.platform_mfa_verify(p_token text,p_code text,p_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE actor uuid := public.platform_subject(p_token); m public.platform_mfa; seed bytea;
  base integer := floor(extract(epoch FROM clock_timestamp())/30); matched integer; codes text[]; code text; rotated text; deadline timestamptz;
BEGIN
  IF actor IS NULL THEN RETURN NULL; END IF;
  PERFORM 1 FROM public.users WHERE id=actor FOR UPDATE;
  IF p_code !~ '^[0-9]{6}$' OR length(p_key) IS DISTINCT FROM 64
    OR NOT coalesce(public.platform_mfa_limit(actor),false) THEN RETURN NULL; END IF;
  SELECT * INTO m FROM public.platform_mfa WHERE user_id=actor FOR UPDATE;
  IF m.secret IS NULL OR (NOT m.enabled AND (m.enrollment_session IS DISTINCT FROM public.platform_hash(p_token) OR m.enrollment_expiry<=now()))
  THEN RETURN NULL; END IF;
  seed := public.pgp_sym_decrypt_bytea(m.secret,p_key);
  FOR step IN base-1..base+1 LOOP
    IF step>m.last_counter AND public.platform_otp(seed,step)=p_code THEN matched:=step; EXIT; END IF;
  END LOOP;
  IF matched IS NULL THEN PERFORM public.platform_log(actor,actor,'mfa_failed'); RETURN NULL; END IF;
  UPDATE public.platform_mfa SET enabled=true,last_counter=matched,attempts=0,attempt_start=now(),enrollment_session=NULL,enrollment_expiry=NULL WHERE user_id=actor;
  IF NOT m.enabled THEN
    codes := ARRAY[]::text[];
    FOR i IN 1..8 LOOP
      code := encode(public.gen_random_bytes(16),'hex');
      INSERT INTO public.platform_recovery(user_id,hash) VALUES(actor,public.platform_hash(code));
      codes := array_append(codes,code);
    END LOOP;
  END IF;
  DELETE FROM public.sessions WHERE token_hash=public.platform_hash(p_token) AND user_id=actor AND expires_at>now() RETURNING expires_at INTO deadline;
  IF NOT FOUND THEN RETURN NULL; END IF;
  rotated:=translate(rtrim(encode(public.gen_random_bytes(32),'base64'),'='),'+/','-_');
  INSERT INTO public.sessions(user_id,token_hash,expires_at) VALUES(actor,public.platform_hash(rotated),deadline);
  INSERT INTO public.platform_elevations(session_hash,verified_at) VALUES(public.platform_hash(rotated),now());
  PERFORM public.platform_log(actor,actor,CASE WHEN m.enabled THEN 'mfa_verified' ELSE 'mfa_enrolled' END);
  RETURN jsonb_build_object('ok',true,'recovery',codes,'token',rotated,'expiresAt',deadline);
END;
$$;



CREATE FUNCTION public.identity_verified(p_token text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
  SELECT EXISTS(SELECT 1 FROM public.users u JOIN public.billing_verified_accounts v ON v.user_id=u.id AND v.email=u.email
    WHERE u.id=public.identity_actor(p_token));
$$;
REVOKE ALL ON FUNCTION public.identity_verified(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.identity_verified(text) TO storefront_app;
