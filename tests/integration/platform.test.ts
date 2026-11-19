import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";
import sharp from "sharp";
import { productInput } from "../../src/lib/catalog";
import { authenticate, getSessionUser, register } from "../../src/server/auth/repository";
import { issueEmailChange, issueIdentity, tokenEmail, consumeIdentity } from "../../src/server/auth/identity";
import { createPaymentRequest, downloadOriginal, downloadProof, merchantBilling, reviewRequest, submitProof } from "../../src/server/billing/repository";
import { sealProof } from "../../src/server/billing/proof-archive";
import { saveProduct, setStorePublication } from "../../src/server/catalog/merchant";
import { closeDatabase } from "../../src/server/db/client";
import { changeRole, configurePlatform, mfaSeed, mfaVerify, platformAccess, platformRows, supportOperation } from "../../src/server/platform/repository";
import { confirmManualSubscription, contactSettings, grantManualSubscription, mailSecret, mailView, recordMailTest, saveContact, saveMail } from "../../src/server/platform/contact";
import { mailProvider } from "../../src/server/auth/mail";
import { openSmtpPassword, sealSmtpPassword } from "../../src/server/auth/smtp";
import { createStore, getMemberStore, getPausedStore, getPublicStore } from "../../src/server/stores/repository";
import { markLegacy } from "../fixtures/legacy.mjs";
import { hash, makeEnrollment, markPlatform, otp } from "../fixtures/platform.mjs";

test("Phase 6A identity and operations on PostgreSQL", async (t) => {
  const runtimeUrl=process.env.TEST_DATABASE_URL;
  const ownerUrl=process.env.TEST_MIGRATION_DATABASE_URL;
  const workerUrl=process.env.TEST_MEDIA_DATABASE_URL;
  assert.ok(runtimeUrl&&ownerUrl&&workerUrl&&process.env.IDENTITY_DATABASE_URL);
  assert.equal(new URL(runtimeUrl).pathname,new URL(ownerUrl).pathname);
  assert.equal(new URL(runtimeUrl).pathname,new URL(process.env.IDENTITY_DATABASE_URL).pathname);
  process.env.DATABASE_URL=runtimeUrl;
  const owner=new Pool({connectionString:ownerUrl});
  const raw=new Pool({connectionString:runtimeUrl});
  const worker=new Pool({connectionString:workerUrl});
  const slug=`sec-${randomUUID()}`;
  const emails=["shop","owner","manager","reviewa","reviewb","new"].map((kind)=>`${slug}-${kind}@example.test`);
  const ids:string[]=[];
  let tenant="";
  let savedPolicy: Record<string, unknown> | undefined;
  t.after(async()=>{
    try {
      await owner.query("select set_config('dar.cleanup', 'on', false)");
      if (savedPolicy) await owner.query("update public.platform_policy set dual_thresholds=$1,admin_may_suspend=$2 where id=1",
        [JSON.stringify(savedPolicy.dual_thresholds), savedPolicy.admin_may_suspend]);
      if (tenant) {
        await owner.query("delete from public.platform_payment_checks where request_id in(select id from billing_requests where store_id=$1)",[tenant]);
        for(const table of ["platform_manual_terms","billing_audit","billing_setup_requests","billing_reviews","billing_proofs","billing_periods","billing_requests","billing_trials","billing_subscriptions"])
          await owner.query(`delete from public.${table} where store_id=$1`,[tenant]);
        await owner.query("delete from public.stores where id=$1",[tenant]);
      }
      await owner.query("delete from public.ops_notifications where recipient=any($1)",[ids]);
      await owner.query("delete from public.billing_verified_accounts where user_id=any($1)",[ids]);
      await owner.query("delete from public.users where id=any($1)",[ids]);
    } finally { await Promise.all([owner.end(),raw.end(),worker.end(),closeDatabase()]); }
  });
  const password="phase six local account password";
  const [merchant, platformOwner, manager, first, second] = await Promise.all(emails.slice(0,5).map(async (email)=>{
    const session=await register("Phase six fixture",email,password);
    assert.ok(session);
    const user=await getSessionUser(session.token);
    assert.ok(user);
    ids.push(user.id);
    return {...user,token:session.token};
  }));
  await t.test("the application login cannot read credentials, issue sessions, alter roles or read proof tables",async()=>{
    await assert.rejects(raw.query("select password_hash from public.users"),{code:"42501"});
    await assert.rejects(raw.query("select token_hash from public.sessions"),{code:"42501"});
    await assert.rejects(raw.query("insert into public.sessions(user_id,token_hash,expires_at) values($1,$2,now())",[merchant.id,"x".repeat(64)]),{code:"42501"});
    await assert.rejects(raw.query("select * from public.identity_password($1)",[merchant.email]),{code:"42501"});
    await assert.rejects(raw.query("select * from public.platform_mfa"),{code:"42501"});
    assert.equal(await platformAccess(merchant.token),null);
    assert.deepEqual(await platformRows(merchant.token,"overview"),[]);
    assert.equal(await changeRole(merchant.token,merchant.id,"owner",true),"denied");
  });
  await t.test("email tokens are single-use, expire, and reset and change revoke every session",async()=>{
    const stale=await issueIdentity("verify",merchant.email,merchant.token);
    assert.ok(stale);
    await owner.query("update public.identity_tokens set expires_at=now()-interval '1 second' where hash=$1",[hash(stale)]);
    assert.equal(await consumeIdentity(stale,"verify"),"invalid");
    const token=await issueIdentity("verify",merchant.email,merchant.token);
    assert.ok(token);
    assert.equal(await tokenEmail(token,"verify"),merchant.email);
    assert.equal(await consumeIdentity(token,"verify"),"ok");
    assert.equal(await consumeIdentity(token,"verify"),"invalid");
    const secondSession=await authenticate(merchant.email,password);
    assert.ok(secondSession);
    assert.equal(await issueIdentity("reset",`missing-${slug}@example.test`),null);
    const reset=await issueIdentity("reset",merchant.email);
    assert.ok(reset);
    const newPassword="a different local phase six password";
    assert.equal(await consumeIdentity(reset,"reset",newPassword),"ok");
    assert.equal(await getSessionUser(merchant.token),null);
    assert.equal(await getSessionUser(secondSession.token),null);
    assert.equal(await authenticate(merchant.email,password),null);
    const fresh=await authenticate(merchant.email,newPassword);
    assert.ok(fresh);
    const target=emails[5];
    const change=await issueEmailChange(fresh.token,merchant.email,newPassword,target);
    assert.ok(change);
    assert.equal(await consumeIdentity(change.after,"change_new"),"pending");
    assert.equal((await getSessionUser(fresh.token))?.email,merchant.email);
    assert.equal(await consumeIdentity(change.before,"change_old"),"ok");
    assert.equal(await getSessionUser(fresh.token),null);
    const switched=await authenticate(target,newPassword);
    assert.ok(switched);
    merchant.token=switched.token;
    merchant.email=target;
  });

  await t.test("enrollment needs an offline key, rotates sessions, rejects replay and recovers once",async()=>{
    for(const [user,role] of [[platformOwner,"owner"],[manager,"administrator"],[first,"reviewer"],[second,"reviewer"]] as const){
      const enrollment=makeEnrollment();
      await markPlatform(owner,user.id,role,enrollment);
      assert.equal((await platformAccess(user.token))?.elevated,false);
      assert.equal(await mfaSeed(user.token,makeEnrollment(),false),null);
      const seed=await mfaSeed(user.token,enrollment,false);
      assert.ok(seed);
      const counter=Math.floor(Date.now()/30000);
      const bytes=Buffer.from(seed,"hex");
      const possible=[otp(bytes,counter-1),otp(bytes,counter),otp(bytes,counter+1)];
      const wrong=["000000","000001","000002","000003"].find((code)=>!possible.includes(code));
      assert.ok(wrong);
      assert.equal(await mfaVerify(user.token,wrong),null);
      const elevation=await mfaVerify(user.token,possible[1]);
      assert.ok(elevation?.recovery?.length===8);
      assert.equal(await getSessionUser(user.token),null);
      user.token=elevation.token;
      assert.equal((await platformAccess(user.token))?.fresh,true);
      assert.equal(await mfaVerify(user.token,possible[1]),null);
      if(user===manager){
        const recovered=await mfaSeed(user.token,elevation.recovery[0],true);
        assert.ok(recovered);
        assert.equal((await platformAccess(user.token))?.fresh,false);
        assert.equal(await mfaSeed(user.token,elevation.recovery[0],true),null);
        const verified=await mfaVerify(user.token,otp(Buffer.from(recovered,"hex")));
        assert.ok(verified);
        user.token=verified.token;
      }
    }
    assert.equal(await changeRole(manager.token,merchant.id,"owner",true),"denied");
    assert.deepEqual(await platformRows(first.token,"merchants"),[]);
    assert.equal(await configurePlatform(first.token,"rules",{}),"denied");
    assert.ok((await platformRows(manager.token,"overview")).length);
  });

  await t.test("suspension and time-limited legacy access preserve the catalog and publication state",async()=>{
    assert.ok(await createStore(merchant.id,{slug,name:"Phase 6 Store",country:"KW",currency:"KWD"}));
    const store=await getMemberStore(merchant.id,slug);
    assert.ok(store);
    tenant=store.id;
    await markLegacy(owner,slug);
    const product=productInput.parse({ slug:"coffee",nameAr:"قهوة",nameEn:"Coffee",position:"0",descriptionAr:"",descriptionEn:"",price:"3.125",
      compareAt:"",sku:"",state:"published",featured:false,available:true,categoryIds:[],options:"" });
    assert.ok("id" in (await saveProduct(merchant.id,slug,null,product)??{}));
    assert.ok("id" in (await setStorePublication(merchant.id,slug,true)??{}));
    assert.ok(await getPublicStore(slug));
    assert.equal(await supportOperation(first.token,tenant,"suspend","support"),"denied");
    assert.equal(await supportOperation(manager.token,tenant,"suspend","abuse"),"ok");
    assert.equal(await getPublicStore(slug),null);
    assert.equal(await getPausedStore(slug),null,"a store suspended by the platform shows no paused notice");
    assert.equal((await getMemberStore(merchant.id,slug))?.published,true);
    assert.equal(await supportOperation(manager.token,tenant,"restore","support"),"ok");
    assert.ok(await getPublicStore(slug));
    assert.equal((await merchantBilling(merchant.id,slug,1))?.state.legacy,true);
    assert.equal(await supportOperation(manager.token,tenant,"end_legacy","billing"),"ok");
    assert.equal((await merchantBilling(merchant.id,slug,1))?.state.legacy,false);
    assert.equal((await merchantBilling(merchant.id,slug,1))?.usage.products,1);
    // With no trial, subscription or legacy access left the public page disappears, while the catalog and the publication state stay.
    assert.equal(await getPublicStore(slug),null);
    assert.equal((await getPausedStore(slug))?.name,"Phase 6 Store");
    assert.equal((await getMemberStore(merchant.id,slug))?.published,true);
    assert.deepEqual(await saveProduct(merchant.id,slug,null,{...product,slug:"other"}),{error:"billingPublication"});
  });

  await t.test("fresh MFA and two different reviewers are required for a configured high-risk payment",async()=>{
    savedPolicy=(await owner.query("select dual_thresholds,admin_may_suspend from public.platform_policy where id=1")).rows[0];
    const {rows:[config]}=await owner.query("select * from public.billing_config where id=1");
    assert.equal(await configurePlatform(platformOwner.token,"rules",{trialDays:config.trial_days,trialProducts:config.trial_products,graceDays:config.grace_days,
      allowTrials:true,luxury:true,adminMaySuspend:false,dual:{KWD:1000}}),"ok");
    assert.equal(await supportOperation(manager.token,tenant,"suspend","security"),"denied");
    assert.equal(await supportOperation(platformOwner.token,tenant,"suspend","security"),"ok");
    assert.equal(await supportOperation(platformOwner.token,tenant,"restore","security"),"ok");
    const price="ff200000-6166-4e00-8500-000000000001", method="ff200000-6166-4e00-8500-000000000002";
    await owner.query("insert into public.billing_prices(id,plan_id,country,currency,interval,amount) select $1,id,'KW','KWD','monthly',11000 from billing_plans where code='pro' and version=1 on conflict do nothing",[price]);
    await owner.query("insert into public.billing_methods values($1,'KW','KWD','Dual fixture','Independent fixture records',true) on conflict do nothing",[method]);
    const request=await createPaymentRequest(merchant.id,slug,{key:randomUUID(),price,method,expected:11000,setup:null,notes:""});
    assert.ok(request&&"id" in request);
    const { rows: [payment] } = await owner.query<{ reference: string }>("select reference from public.billing_requests where id=$1", [request.id]);
    for (const [session, mayReview] of [[manager.token, false], [first.token, true]] as const) {
      const [listed] = await platformRows<{ id: string; canReview: boolean }>(session, "payments", payment.reference);
      assert.equal(listed?.id, request.id);
      assert.equal(listed.canReview, mayReview);
      assert.deepEqual(await platformRows(session, "setup", payment.reference), []);
    }
    assert.deepEqual(await platformRows(merchant.token, "payments", payment.reference), []);
    const body=await sharp({create:{width:20,height:20,channels:3,background:"#5439f2"}}).webp().toBuffer();
    const transfer=`TX-${randomUUID()}`;
    const source=sealProof(request.id,body,"image/webp");
    assert.equal(await submitProof(merchant.id,slug,request.id,transfer,body,createHash("sha256").update(body).digest("hex"),source),"ok");
    assert.equal(await downloadOriginal(merchant.token,request.id),null);
    assert.deepEqual((await downloadOriginal(first.token,request.id))?.content,body);
    assert.equal((await merchantBilling(merchant.id,slug,1))?.state.plan,null);
    const evidence={action:"approve" as const,amount:11000,currency:"KWD" as const,transfer,independent:`BANK-${transfer}`};
    assert.equal(await reviewRequest(platformOwner.token,request.id,evidence),"denied");
    await owner.query("update public.platform_elevations set verified_at=now()-interval '6 minutes' where session_hash=$1",[hash(second.token)]);
    assert.equal(await reviewRequest(second.token,request.id,evidence),"denied");
    assert.equal(await downloadProof(second.token,request.id),null);
    assert.equal(await reviewRequest(first.token,request.id,evidence),"secondReview");
    assert.equal((await merchantBilling(merchant.id,slug,1))?.state.plan,null);
    assert.equal(await reviewRequest(first.token,request.id,evidence),"independent");
    await owner.query("update public.platform_elevations set verified_at=now() where session_hash=$1",[hash(second.token)]);
    assert.equal(await reviewRequest(second.token,request.id,{...evidence,independent:"Mismatch"}),"invalid");
    const result=await Promise.all([reviewRequest(second.token,request.id,evidence),reviewRequest(second.token,request.id,evidence)]);
    assert.deepEqual(result.sort(),["closed","ok"]);
    assert.equal((await merchantBilling(merchant.id,slug,1))?.state.plan,"pro");
    assert.equal((await owner.query("select count(*)::int n from billing_periods where store_id=$1",[tenant])).rows[0].n,1);
  });

  await t.test("audit links and restricted background job failure and retry status are persisted",async()=>{
    const {rows:[chain]}=await owner.query(`select count(*) filter(where previous<>coalesce(prev,repeat('0',64)) or hash<>expected)::int as invalid from (
      select previous,hash,lag(hash) over(order by id) as prev, public.platform_hash(jsonb_build_array(id,actor,subject,action,detail,extract(epoch from created_at),previous)::text) as expected
      from public.platform_events) linked`);
    assert.equal(chain.invalid,0);
    assert.ok((await platformRows(manager.token,"audit","payment_")).length);
    await assert.rejects(raw.query("select public.platform_job_start('billing')"),{code:"42501"});
    const failed=(await worker.query("select public.platform_job_start('billing') as id")).rows[0].id;
    await worker.query("select public.platform_job_finish($1,false,$2)",[failed,JSON.stringify({retry:1})]);
    const recovered=(await worker.query("select public.platform_job_start('billing') as id")).rows[0].id;
    await worker.query("select public.platform_job_finish($1,true,$2)",[recovered,JSON.stringify({retry:0})]);
    const runs=await platformRows<{id:string;success:boolean}>(manager.token,"jobs","billing");
    assert.ok(runs.some((job)=>job.id===failed&&!job.success));
    assert.ok(runs.some((job)=>job.id===recovered&&job.success));
  });

  await t.test("owner-only WhatsApp contact and central SMTP settings encrypt secrets at rest and enforce dual-admin manual subscription confirmation", async () => {
    const prevSmtpKey = process.env.SMTP_CONFIG_KEY;
    if (!process.env.SMTP_CONFIG_KEY) process.env.SMTP_CONFIG_KEY = "b".repeat(64);
    try {
      assert.equal(await saveContact(manager.token, "+972567508786", true), "denied");
      assert.equal(await saveContact(first.token, "+972567508786", true), "denied");
      assert.equal(await saveContact(platformOwner.token, "+972567508786", true), "ok");
      const contact = await contactSettings();
      assert.equal(contact?.whatsapp, "972567508786");
      assert.equal(contact?.enabled, true);

      const smtpConfig = {
        host: "smtp.wajhati.example",
        port: 587 as const,
        user: "mailer@wajhati.example",
        from: "no-reply@wajhati.example",
        name: "واجهتي | WAJHATI",
        replyTo: "support@wajhati.example",
      };
      const cipher = sealSmtpPassword("super-secret-smtp-password-2026");
      assert.equal(await saveMail(manager.token, smtpConfig, cipher, true), "denied");
      assert.equal(await mailView(manager.token), null);
      assert.equal(await saveMail(platformOwner.token, smtpConfig, cipher, true), "ok");
      const view = await mailView(platformOwner.token);
      assert.ok(view);
      assert.equal(view.enabled, true);
      assert.equal(view.hasPassword, true);
      assert.equal(view.config.host, "smtp.wajhati.example");
      assert.ok(!("password" in view) && !("cipher" in view) && !JSON.stringify(view).includes("super-secret-smtp-password-2026"));

      // The mail delivery login reads the same secret through its own narrow function. It stays AES-256-GCM encrypted.
      const mailerLogin = new Pool({ connectionString: process.env.TEST_MAILER_DATABASE_URL });
      try {
        const { rows: [pending] } = await mailerLogin.query("select * from ops_mail_secret()");
        assert.equal(pending.enabled, true);
        assert.equal(pending.verified_at, null);
        assert.equal(pending.config.host, "smtp.wajhati.example");
        assert.ok(Buffer.isBuffer(pending.cipher) && !pending.cipher.includes(Buffer.from("super-secret-smtp-password-2026")));
        // Enabled but unverified: delivery stays closed, exactly as for the app.
        process.env.MAIL_WORKER_DATABASE_URL = process.env.TEST_MAILER_DATABASE_URL;
        try { assert.equal(await mailProvider(), null); } finally { delete process.env.MAIL_WORKER_DATABASE_URL; }

        assert.equal(await recordMailTest(platformOwner.token, view.revision, true), "ok");
        const verifiedView = await mailView(platformOwner.token);
        assert.ok(verifiedView?.verifiedAt);

        const secret = await mailSecret();
        assert.ok(secret);
        assert.equal(openSmtpPassword(secret.cipher), "super-secret-smtp-password-2026");

        // Verified: the mail delivery process now selects the owner-managed SMTP for queued notifications.
        process.env.MAIL_WORKER_DATABASE_URL = process.env.TEST_MAILER_DATABASE_URL;
        try {
          assert.equal(await mailProvider(), "smtp");
          const viaMailer = await mailSecret();
          assert.equal(openSmtpPassword(viaMailer!.cipher), "super-secret-smtp-password-2026");
        } finally { delete process.env.MAIL_WORKER_DATABASE_URL; }

        // Disabled by the owner: the mail delivery login receives nothing, while the identity path still sees the row.
        assert.equal(await saveMail(platformOwner.token, smtpConfig, null, false), "ok");
        assert.equal((await mailerLogin.query("select * from ops_mail_secret()")).rowCount, 0);
        assert.ok(await mailSecret());
      } finally { await mailerLogin.end(); }

      // Dual-admin confirmation for high-value manual subscription when threshold is exceeded
      const dualTermId = randomUUID();
      assert.equal(await grantManualSubscription(platformOwner.token, {
        id: dualTermId,
        user: merchant.id,
        store: tenant,
        plan: "pro",
        months: 12,
        amountMinor: 50000,
        currency: "KWD",
        reference: "WA-DUAL-KWD-50000",
        note: "High-value annual enterprise subscription",
      }), "ok");
      const { rows: [pendingTerm] } = await owner.query<{ ends_at: Date | null }>(
        "select ends_at from public.platform_manual_terms where id = $1",
        [dualTermId],
      );
      assert.equal(pendingTerm.ends_at, null);
      assert.equal(await confirmManualSubscription(platformOwner.token, dualTermId), "denied");
      assert.equal(await confirmManualSubscription(manager.token, dualTermId), "ok");
      const { rows: [activatedTerm] } = await owner.query<{ ends_at: Date | null; approved_by: string | null }>(
        "select ends_at, approved_by from public.platform_manual_terms where id = $1",
        [dualTermId],
      );
      assert.ok(activatedTerm.ends_at);
      assert.equal(activatedTerm.approved_by, manager.id);
    } finally {
      if (!prevSmtpKey) delete process.env.SMTP_CONFIG_KEY;
    }
  });

  await t.test("a queued role change loses authorization when its actor is revoked first", async () => {
    const users = [];
    for (const kind of ["left", "right"]) {
      const session = await register("Concurrent role fixture", `${slug}-${kind}@example.test`, password);
      assert.ok(session);
      const user = await getSessionUser(session.token);
      assert.ok(user);
      ids.push(user.id);
      const enrollment = makeEnrollment();
      await markPlatform(owner, user.id, "owner", enrollment);
      const seed = await mfaSeed(session.token, enrollment, false);
      assert.ok(seed);
      const elevation = await mfaVerify(session.token, otp(Buffer.from(seed, "hex")));
      assert.ok(elevation);
      users.push({ id: user.id, token: elevation.token });
    }
    const [left, right] = users;
    const gate = await owner.connect();
    let result: Promise<string[]> | undefined;
    try {
      await gate.query("begin");
      await gate.query("select pg_advisory_xact_lock(781690423)");
      result = Promise.all([changeRole(left.token, right.id, "owner", false), changeRole(right.token, left.id, "owner", false)]);
      for (let attempt = 0; attempt < 100; attempt++) {
        const { rows: [row] } = await gate.query("select count(*)::int as count from pg_locks where locktype='advisory' and objid=781690423 and not granted");
        if (row.count === 2) break;
        assert.ok(attempt < 99, "Both mutations should wait on the role lock.");
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    } finally {
      await gate.query("rollback");
      gate.release();
    }
    assert.deepEqual((await result)?.sort(), ["denied", "ok"]);
  });
});

