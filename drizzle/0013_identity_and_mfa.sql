CREATE EXTENSION IF NOT EXISTS pgcrypto;
REVOKE SELECT (password_hash) ON public.users FROM storefront_app;
REVOKE INSERT (name,email,password_hash) ON public.users FROM storefront_app;
REVOKE ALL ON public.sessions FROM storefront_app;
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
CREATE POLICY identity_own_profile ON public.users FOR SELECT TO storefront_app
  USING (id = nullif(current_setting('dar.user_id', true), '')::uuid);
GRANT USAGE ON SCHEMA public TO storefront_identity;

INSERT INTO public.platform_roles(user_id,role) SELECT user_id,'reviewer' FROM public.billing_admins;
INSERT INTO public.platform_policy DEFAULT VALUES;

CREATE FUNCTION public.platform_hash(p_value text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT SET search_path=pg_catalog,pg_temp AS $$
  SELECT encode(sha256(convert_to(p_value,'UTF8')),'hex');
$$;

CREATE FUNCTION public.platform_log(p_actor uuid,p_subject uuid,p_action text,p_detail jsonb DEFAULT '{}'::jsonb) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
DECLARE prior text; event_id bigint; ts timestamptz := clock_timestamp();
BEGIN
  PERFORM pg_advisory_xact_lock(674180332);
  SELECT hash INTO prior FROM public.platform_events ORDER BY id DESC LIMIT 1;
  prior := coalesce(prior, repeat('0',64));
  event_id := nextval('public.platform_events_id_seq');
  INSERT INTO public.platform_events(id,actor,subject,action,detail,created_at,previous,hash)
  VALUES (event_id,p_actor,p_subject,p_action,p_detail,ts,prior,
    public.platform_hash(jsonb_build_array(event_id,p_actor,p_subject,p_action,p_detail,extract(epoch FROM ts),prior)::text));
END;
$$;

CREATE FUNCTION public.identity_actor(p_token text) RETURNS uuid
LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $$
  SELECT user_id FROM public.sessions WHERE length(p_token)=43 AND token_hash=public.platform_hash(p_token) AND expires_at>now();
$$;

CREATE FUNCTION public.identity_profile(p_token text) RETURNS TABLE(id uuid,name varchar,email varchar)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
  SELECT u.id,u.name,u.email FROM public.users u WHERE u.id=public.identity_actor(p_token);
$$;

CREATE FUNCTION public.identity_sign_out(p_token text) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
  DELETE FROM public.sessions WHERE length(p_token)=43 AND token_hash=public.platform_hash(p_token);
$$;

CREATE FUNCTION public.identity_password(p_email text) RETURNS TABLE(id uuid,hash text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
  SELECT u.id,u.password_hash::text FROM public.users u WHERE u.email=p_email;
$$;

CREATE FUNCTION public.identity_create(p_name text,p_email text,p_hash text,p_session text,p_expiry timestamptz,p_previous text,p_signup text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE actor uuid;
BEGIN
  IF p_signup IS NOT NULL THEN
    DELETE FROM public.identity_tokens WHERE hash=public.platform_hash(p_signup) AND purpose='signup'
      AND email=p_email AND expires_at>now();
    IF NOT FOUND THEN RETURN false; END IF;
  END IF;
  INSERT INTO public.users(name,email,password_hash) VALUES(p_name,p_email,p_hash)
    ON CONFLICT (email) DO NOTHING RETURNING id INTO actor;
  IF actor IS NULL THEN RETURN false; END IF;
  IF p_signup IS NOT NULL THEN INSERT INTO public.billing_verified_accounts(user_id,email) VALUES(actor,p_email); END IF;
  PERFORM public.identity_sign_out(p_previous);
  INSERT INTO public.sessions(user_id,token_hash,expires_at) VALUES(actor,p_session,least(p_expiry,now()+interval '7 days'));
  RETURN true;
END;
$$;

CREATE FUNCTION public.identity_sign_in(p_user uuid,p_hash text,p_session text,p_expiry timestamptz,p_previous text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
  PERFORM 1 FROM public.users WHERE id=p_user AND password_hash=p_hash FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  PERFORM public.identity_sign_out(p_previous);
  INSERT INTO public.sessions(user_id,token_hash,expires_at) VALUES(p_user,p_session,least(p_expiry,now()+interval '7 days'));
  IF EXISTS (SELECT 1 FROM public.platform_roles WHERE user_id=p_user)
  THEN PERFORM public.platform_log(p_user,p_user,'platform_password_login'); END IF;
  RETURN true;
END;
$$;

CREATE FUNCTION public.identity_issue(p_purpose public.identity_purpose,p_email text,p_session text,p_hash text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE actor uuid; verified boolean;
BEGIN
  SELECT id INTO actor FROM public.users WHERE email=p_email;
  IF p_purpose='signup' AND actor IS NOT NULL THEN RETURN false;
  ELSIF p_purpose='verify' THEN
    IF actor IS NULL OR actor IS DISTINCT FROM public.identity_actor(p_session) THEN RETURN false; END IF;
    SELECT EXISTS (SELECT 1 FROM public.billing_verified_accounts WHERE user_id=actor AND email=p_email) INTO verified;
    IF verified THEN RETURN false; END IF;
  ELSIF p_purpose='reset' THEN
    IF actor IS NULL THEN RETURN false; END IF;
  ELSIF p_purpose<>'signup' THEN RETURN false;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_email,67));
  DELETE FROM public.identity_tokens WHERE email=p_email AND purpose=p_purpose;
  INSERT INTO public.identity_tokens(hash,purpose,email,user_id,expires_at)
    VALUES(p_hash,p_purpose,p_email,actor,now()+CASE WHEN p_purpose='verify' THEN interval '24 hours' ELSE interval '20 minutes' END);
  RETURN true;
END;
$$;

CREATE FUNCTION public.identity_token_email(p_token text,p_purpose public.identity_purpose) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
  SELECT email FROM public.identity_tokens WHERE length(p_token)=43 AND hash=public.platform_hash(p_token) AND purpose=p_purpose AND expires_at>now();
$$;

CREATE FUNCTION public.identity_use(p_token text,p_purpose public.identity_purpose,p_hash text DEFAULT NULL) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE token public.identity_tokens; change public.identity_changes; account public.users;
BEGIN
  IF length(p_token) IS DISTINCT FROM 43 OR p_purpose='signup' THEN RETURN 'invalid'; END IF;
  SELECT * INTO token FROM public.identity_tokens WHERE hash=public.platform_hash(p_token) AND purpose=p_purpose AND expires_at>now();
  IF NOT FOUND OR token.user_id IS NULL THEN RETURN 'invalid'; END IF;
  SELECT * INTO account FROM public.users WHERE id=token.user_id FOR UPDATE;
  IF NOT FOUND THEN RETURN 'invalid'; END IF;
  DELETE FROM public.identity_tokens WHERE hash=token.hash AND expires_at>now();
  IF NOT FOUND THEN RETURN 'invalid'; END IF;
  IF p_purpose='verify' AND account.email=token.email THEN
    INSERT INTO public.billing_verified_accounts(user_id,email) VALUES(account.id,account.email)
      ON CONFLICT(user_id) DO UPDATE SET email=excluded.email,verified_at=now();
    PERFORM public.platform_log(account.id,account.id,'email_verified');
  ELSIF p_purpose='reset' AND account.email=token.email AND p_hash LIKE 'scrypt-v1$%' THEN
    UPDATE public.users SET password_hash=p_hash WHERE id=account.id;
    DELETE FROM public.sessions WHERE user_id=account.id;
    DELETE FROM public.identity_changes WHERE user_id=account.id;
    DELETE FROM public.identity_tokens WHERE user_id=account.id;
    PERFORM public.platform_log(account.id,account.id,'password_reset');
  ELSIF p_purpose IN ('change_old','change_new') THEN
    UPDATE public.identity_changes SET old_confirmed=old_confirmed OR p_purpose='change_old',new_confirmed=new_confirmed OR p_purpose='change_new'
      WHERE id=token.change_id AND user_id=account.id AND old_email=account.email AND expires_at>now() RETURNING * INTO change;
    IF NOT FOUND THEN RETURN 'invalid'; END IF;
    IF NOT(change.old_confirmed AND change.new_confirmed) THEN RETURN 'pending'; END IF;
    BEGIN
      UPDATE public.users SET email=change.new_email WHERE id=account.id;
      INSERT INTO public.billing_verified_accounts(user_id,email) VALUES(account.id,change.new_email)
        ON CONFLICT(user_id) DO UPDATE SET email=excluded.email,verified_at=now();
    EXCEPTION WHEN unique_violation THEN RETURN 'invalid';
    END;
    DELETE FROM public.sessions WHERE user_id=account.id;
    DELETE FROM public.identity_changes WHERE user_id=account.id;
    DELETE FROM public.identity_tokens WHERE user_id=account.id;
    PERFORM public.platform_log(account.id,account.id,'email_changed');
  ELSE RETURN 'invalid'; END IF;
  RETURN 'ok';
END;
$$;

CREATE FUNCTION public.platform_subject(p_token text) RETURNS uuid
LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $$
  SELECT u.id FROM public.users u JOIN public.billing_verified_accounts v ON v.user_id=u.id AND v.email=u.email
  WHERE u.id=public.identity_actor(p_token) AND EXISTS (SELECT 1 FROM public.platform_roles r WHERE r.user_id=u.id);
$$;

CREATE FUNCTION public.platform_actor(p_token text,p_role public.platform_role,p_fresh boolean) RETURNS uuid
LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $$
  SELECT r.user_id FROM public.platform_roles r JOIN public.platform_elevations e ON e.session_hash=public.platform_hash(p_token)
  WHERE r.user_id=public.platform_subject(p_token) AND r.role=p_role
    AND e.verified_at > now()-CASE WHEN p_fresh THEN interval '5 minutes' ELSE interval '8 hours' END;
$$;

CREATE FUNCTION public.identity_change(p_token text,p_password text,p_new text,p_old_hash text,p_new_hash text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE account public.users; change_id uuid;
BEGIN
  SELECT * INTO account FROM public.users WHERE id=public.identity_actor(p_token) AND password_hash=p_password FOR UPDATE;
  IF NOT FOUND OR account.email=p_new OR EXISTS (SELECT 1 FROM public.users WHERE email=p_new) THEN RETURN NULL; END IF;
  IF EXISTS (SELECT 1 FROM public.platform_roles WHERE user_id=account.id)
    AND NOT EXISTS (SELECT 1 FROM public.platform_elevations WHERE session_hash=public.platform_hash(p_token) AND verified_at>now()-interval '5 minutes')
  THEN RETURN NULL; END IF;
  DELETE FROM public.identity_changes WHERE user_id=account.id;
  INSERT INTO public.identity_changes(user_id,old_email,new_email,expires_at) VALUES(account.id,account.email,p_new,now()+interval '20 minutes') RETURNING id INTO change_id;
  INSERT INTO public.identity_tokens(hash,purpose,email,user_id,change_id,expires_at) VALUES
    (p_old_hash,'change_old',account.email,account.id,change_id,now()+interval '20 minutes'),
    (p_new_hash,'change_new',p_new,account.id,change_id,now()+interval '20 minutes');
  PERFORM public.platform_log(account.id,account.id,'email_change_requested');
  RETURN account.email;
END;
$$;

CREATE FUNCTION public.platform_access(p_token text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
  SELECT jsonb_build_object('roles',jsonb_agg(r.role),'enrolled',coalesce(m.enabled,false),
    'elevated',coalesce(e.verified_at > now()-interval '8 hours',false),
    'fresh',coalesce(e.verified_at > now()-interval '5 minutes',false))
  FROM public.platform_roles r LEFT JOIN public.platform_mfa m ON m.user_id=r.user_id
  LEFT JOIN public.platform_elevations e ON e.session_hash=public.platform_hash(p_token)
  WHERE r.user_id=public.platform_subject(p_token) GROUP BY m.enabled,e.verified_at;
$$;

CREATE FUNCTION public.platform_mfa_limit(p_actor uuid) RETURNS boolean
LANGUAGE sql SET search_path=pg_catalog,pg_temp AS $$
  UPDATE public.platform_mfa SET
    attempts=CASE WHEN attempt_start<=now()-interval '15 minutes' THEN 1 ELSE attempts+1 END,
    attempt_start=CASE WHEN attempt_start<=now()-interval '15 minutes' THEN now() ELSE attempt_start END
  WHERE user_id=p_actor AND (attempts<8 OR attempt_start<=now()-interval '15 minutes') RETURNING true;
$$;

CREATE FUNCTION public.platform_mfa_begin(p_token text,p_code text,p_key text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE actor uuid := public.platform_subject(p_token); seed bytea;
BEGIN
  IF actor IS NULL OR length(p_key) IS DISTINCT FROM 64 OR NOT coalesce(public.platform_mfa_limit(actor),false) THEN RETURN NULL; END IF;
  seed := public.gen_random_bytes(20);
  UPDATE public.platform_mfa SET secret=public.pgp_sym_encrypt_bytea(seed,p_key,'cipher-algo=aes256,compress-algo=0'),
    enrollment_session=public.platform_hash(p_token),enrollment_hash=NULL,enrollment_expiry=now()+interval '10 minutes',last_counter=-1
    WHERE user_id=actor AND NOT enabled AND enrollment_hash=public.platform_hash(p_code) AND enrollment_expiry>now();
  IF NOT FOUND THEN PERFORM public.platform_log(actor,actor,'mfa_failed'); RETURN NULL; END IF;
  PERFORM public.platform_log(actor,actor,'mfa_enrollment_started');
  RETURN encode(seed,'hex');
END;
$$;

CREATE FUNCTION public.platform_otp(p_secret bytea,p_counter integer) RETURNS text
LANGUAGE plpgsql IMMUTABLE STRICT SET search_path=pg_catalog,pg_temp AS $$
DECLARE mac bytea := public.hmac(int8send(p_counter::bigint),p_secret,'sha1'); off integer := get_byte(mac,19)&15;
BEGIN
  RETURN lpad((((get_byte(mac,off)&127)<<24) + (get_byte(mac,off+1)<<16) + (get_byte(mac,off+2)<<8) + get_byte(mac,off+3)) % 1000000::integer || '',6,'0');
END;
$$;

CREATE FUNCTION public.platform_mfa_verify(p_token text,p_code text,p_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE actor uuid := public.platform_subject(p_token); m public.platform_mfa; seed bytea;
  base integer := floor(extract(epoch FROM clock_timestamp())/30); matched integer; codes text[]; code text;
BEGIN
  IF actor IS NULL OR p_code !~ '^[0-9]{6}$' OR length(p_key) IS DISTINCT FROM 64
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
  INSERT INTO public.platform_elevations(session_hash,verified_at) VALUES(public.platform_hash(p_token),now())
    ON CONFLICT(session_hash) DO UPDATE SET verified_at=excluded.verified_at;
  PERFORM public.platform_log(actor,actor,CASE WHEN m.enabled THEN 'mfa_verified' ELSE 'mfa_enrolled' END);
  RETURN jsonb_build_object('ok',true,'recovery',codes);
END;
$$;

CREATE FUNCTION public.platform_mfa_recover(p_token text,p_code text,p_key text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE actor uuid := public.platform_subject(p_token); seed bytea;
BEGIN
  IF actor IS NULL OR p_code !~ '^[a-f0-9]{32}$' OR length(p_key) IS DISTINCT FROM 64
    OR NOT coalesce(public.platform_mfa_limit(actor),false) THEN RETURN NULL; END IF;
  DELETE FROM public.platform_recovery WHERE user_id=actor AND hash=public.platform_hash(p_code);
  IF NOT FOUND THEN PERFORM public.platform_log(actor,actor,'mfa_failed'); RETURN NULL; END IF;
  DELETE FROM public.platform_recovery WHERE user_id=actor;
  DELETE FROM public.platform_elevations WHERE session_hash IN (SELECT token_hash FROM public.sessions WHERE user_id=actor);
  DELETE FROM public.sessions WHERE user_id=actor AND token_hash<>public.platform_hash(p_token);
  seed := public.gen_random_bytes(20);
  UPDATE public.platform_mfa SET enabled=false,secret=public.pgp_sym_encrypt_bytea(seed,p_key,'cipher-algo=aes256,compress-algo=0'),last_counter=-1,
    enrollment_session=public.platform_hash(p_token),enrollment_expiry=now()+interval '10 minutes',enrollment_hash=NULL,attempts=0
    WHERE user_id=actor;
  PERFORM public.platform_log(actor,actor,'mfa_recovery_used');
  RETURN encode(seed,'hex');
END;
$$;

DO $$
DECLARE fn regprocedure;
BEGIN
  FOR fn IN SELECT p.oid::regprocedure FROM pg_proc p WHERE p.pronamespace='public'::regnamespace
    AND (p.proname LIKE 'identity_%' OR p.proname LIKE 'platform_%')
  LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',fn); END LOOP;
END;
$$;
GRANT EXECUTE ON FUNCTION public.identity_profile(text),public.identity_sign_out(text),public.platform_access(text),
  public.platform_mfa_begin(text,text,text),public.platform_mfa_verify(text,text,text),public.platform_mfa_recover(text,text,text) TO storefront_app;
GRANT EXECUTE ON FUNCTION public.identity_password(text),public.identity_create(text,text,text,text,timestamptz,text,text),
  public.identity_sign_in(uuid,text,text,timestamptz,text),public.identity_issue(public.identity_purpose,text,text,text),
  public.identity_token_email(text,public.identity_purpose),public.identity_use(text,public.identity_purpose,text),
  public.identity_change(text,text,text,text,text) TO storefront_identity;
