import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createConnection } from "node:net";
import { once } from "node:events";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DeleteObjectCommand, HeadBucketCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import pg from "pg";

const root = fileURLToPath(new URL("../", import.meta.url));
const mode = process.argv[2];
const staging = mode === "staging" || mode === "staging-smoke";
const local = join(root, ".dar-local", staging ? "staging" : "");
const data = join(local, "postgres");
const tools = join(root, ".dar-local", "tools");
const host = "127.0.0.1";
let dbPort = Number(process.env.DAR_LOCAL_PG_PORT ?? (staging ? 55443 : 55432));
let s3Port = Number(process.env.DAR_LOCAL_S3_PORT ?? (staging ? 4579 : 4569));
const appPort = mode === "dev" ? Number(process.env.DAR_LOCAL_APP_PORT ?? 3000) : staging ? 3220 : 3210;
const origin = `http://localhost:${appPort}`;
const dbName = staging ? "dar_staging" : mode === "dev" || mode === "check" ? "dar_local" : "dar_local_verify_billing";
const bucket = staging ? "dar-staging-media-native" : dbName === "dar_local" ? "dar-market-local" : "dar-market-verify";
const names = ["postgres", "dar_owner", "dar_runtime", "dar_media", "dar_test_unsafe"];
const fixtureAccess = "S3RVER";
const win = process.platform === "win32";
const nextCli = join(root, "node_modules/next/dist/bin/next");
const npmCli = process.env.npm_execpath;
let app;
let pdf;
let stopping = false;

function native(name) {
  const executable = win ? `${name}.exe` : name;
  const directory = process.env.DAR_PG_BIN || (win && "C:/Program Files/PostgreSQL/18/bin");
  return directory && (process.env.DAR_PG_BIN || existsSync(join(directory, executable))) ? join(directory, executable) : executable;
}

function pgCommand(name, args, quiet = false) {
  const result = spawnSync(native(name), args, { cwd: root, stdio: quiet ? "ignore" : "inherit", windowsHide: true });
  if (result.error) throw new Error(`${name} unavailable. Install PostgreSQL or set DAR_PG_BIN.`);
  return result.status;
}

function node(args, env) {
  return spawn(process.execPath, args, { cwd: root, env, stdio: "inherit", windowsHide: true });
}

function complete(child) {
  return new Promise((done, fail) => {
    child.once("error", fail);
    child.once("exit", (code) => code === 0 || stopping ? done() : fail(new Error(`Local command exited with ${code}.`)));
  });
}

async function npm(args, env) {
  if (!npmCli) throw new Error("Start the local environment through an npm script.");
  await complete(node([npmCli, ...args], env));
}

function portOpen(port, address = host) {
  return new Promise((done) => {
    const socket = createConnection({ host: address, port });
    socket.setTimeout(750);
    socket.once("connect", () => { socket.destroy(); done(true); });
    socket.once("error", () => done(false));
    socket.once("timeout", () => { socket.destroy(); done(false); });
  });
}

function passwords() {
  for (const path of [local, data, tools, join(local, "s3")]) {
    if (existsSync(path) && lstatSync(path).isSymbolicLink()) throw new Error("Local service directories cannot be symbolic links.");
  }
  mkdirSync(local, { recursive: true, mode: 0o700 });
  const path = join(local, "postgres-fixture.json");
  const initialized = existsSync(join(data, "PG_VERSION"));
  if (initialized && !existsSync(path)) throw new Error("Found PostgreSQL data without its local fixture configuration. Preserve both and inspect .dar-local.");
  if (!existsSync(path)) writeFileSync(path, JSON.stringify(Object.fromEntries(names.map((name) => [name, randomBytes(24).toString("hex")]))), { flag: "wx", mode: 0o600 });
  const result = JSON.parse(readFileSync(path, "utf8"));
  if (names.some((name) => typeof result[name] !== "string" || !/^[a-f0-9]{48}$/.test(result[name]))) throw new Error("Invalid local PostgreSQL fixture configuration.");
  if (!result.dar_identity || !result.dar_mailer || !result.smtpKey) {
    result.dar_identity ??= randomBytes(24).toString("hex");
    result.dar_mailer ??= randomBytes(24).toString("hex");
    result.mfaKey ??= randomBytes(32).toString("hex");
    result.proofKey ??= randomBytes(32).toString("hex");
    result.smtpKey ??= randomBytes(32).toString("hex");
    const next = path + ".new";
    writeFileSync(next, JSON.stringify(result), { flag: "wx", mode: 0o600 });
    renameSync(next, path);
  }
  if (!/^[a-f0-9]{48}$/.test(result.dar_identity) || !/^[a-f0-9]{48}$/.test(result.dar_mailer) || !/^[a-f0-9]{64}$/.test(result.mfaKey) || !/^[a-f0-9]{64}$/.test(result.proofKey) || !/^[a-f0-9]{64}$/.test(result.smtpKey)) throw new Error("Invalid local identity configuration.");
  if (!initialized) {
    const pwFile = join(local, `init-${randomUUID()}`);
    writeFileSync(pwFile, `${result.postgres}\n`, { flag: "wx", mode: 0o600 });
    try {
      if (pgCommand("initdb", ["-D", data, "-U", "postgres", "--auth=scram-sha-256", "--encoding=UTF8", "--no-locale", `--pwfile=${pwFile}`])) throw new Error("Local PostgreSQL initialization failed. Existing files were preserved.");
    } finally { unlinkSync(pwFile); }
  }
  return result;
}

function connection(password, role, database = dbName) {
  return `postgresql://${role}:${password[role]}@${host}:${dbPort}/${database}`;
}

async function provision(password) {
  const admin = new pg.Client({ connectionString: connection(password, "postgres", "postgres"), connectionTimeoutMillis: 5_000 });
  await admin.connect();
  try {
    const { rows: [cluster] } = await admin.query("show data_directory");
    assert.equal(realpathSync(cluster.data_directory), realpathSync(data), "Refusing to provision a different PostgreSQL cluster.");
    const existing = new Set((await admin.query("select rolname from pg_roles")).rows.map(({ rolname }) => rolname));
    const roles = {
      storefront_app: "NOLOGIN NOSUPERUSER NOBYPASSRLS", storefront_media_worker: "NOLOGIN NOSUPERUSER NOBYPASSRLS",
      storefront_identity: "NOLOGIN NOSUPERUSER NOBYPASSRLS", storefront_mailer: "NOLOGIN NOSUPERUSER NOBYPASSRLS",
      dar_owner: "LOGIN NOSUPERUSER NOBYPASSRLS", dar_runtime: "LOGIN INHERIT NOSUPERUSER NOBYPASSRLS IN ROLE storefront_app",
      dar_media: "LOGIN INHERIT NOSUPERUSER NOBYPASSRLS IN ROLE storefront_media_worker",
      dar_identity: "LOGIN INHERIT NOSUPERUSER NOBYPASSRLS IN ROLE storefront_identity",
      dar_mailer: "LOGIN INHERIT NOSUPERUSER NOBYPASSRLS IN ROLE storefront_mailer",
      ...(dbName === "dar_local_verify_billing" ? {
        dar_test_bypass: "NOLOGIN BYPASSRLS", dar_test_unsafe: "LOGIN IN ROLE storefront_app, dar_test_bypass",
      } : {}),
    };
    for (const [role, privileges] of Object.entries(roles)) {
      if (existing.has(role)) continue;
      // Fixed identifiers and generated hex passwords. Put PASSWORD before IN ROLE for PostgreSQL role syntax.
      const options = password[role] ? `PASSWORD '${password[role]}' ${privileges}` : privileges;
      await admin.query(`create role ${role} ${options}`);
    }
    if (!(await admin.query("select 1 from pg_database where datname = $1", [dbName])).rowCount) {
      await admin.query(`create database ${dbName} owner dar_owner`);
    }
  } finally { await admin.end(); }
}

// The verification database persists between runs and its fixture accounts never receive real mail. Unsent
// notifications from earlier runs age past the 20-hour abandonment window, which makes the maintenance
// worker (correctly) exit 1 and aborts the rest of the pipeline. Retire them before the run starts so the
// maintenance check at the end judges only this run's own notifications.
async function retireStaleFixtureNotifications(password) {
  assert.equal(dbName, "dar_local_verify_billing", "Fixture reset only applies to the disposable verification database.");
  const client = new pg.Client({ connectionString: connection(password, "dar_owner"), connectionTimeoutMillis: 5_000 });
  await client.connect();
  try {
    const { rowCount } = await client.query("update public.ops_notifications set failed_at = now(), lease = null where sent_at is null and failed_at is null");
    console.log(`Verification fixture reset: ${rowCount} unsent notification(s) from earlier runs retired.`);
  } finally { await client.end(); }
}

// The mail delivery login must be able to run and record the notifications job end to end (queue, provider, job log).
async function assertNotificationJobRan(password) {
  const client = new pg.Client({ connectionString: connection(password, "dar_owner"), connectionTimeoutMillis: 5_000 });
  await client.connect();
  try {
    const { rows: [recent] } = await client.query("select count(*)::int as runs from public.platform_jobs where job = 'notifications' and success and finished_at > now() - interval '10 minutes'");
    assert.ok(recent.runs >= 1, "The notifications job did not record a successful run as the mail delivery login.");
  } finally { await client.end(); }
}

async function checkConnections(password, s3) {
  const runtime = new pg.Client({ connectionString: connection(password, "dar_runtime") });
  await runtime.connect();
  try {
    const { rows: [result] } = await runtime.query(`select current_user as role, current_database() as db,
      row_security_active('public.stores') as stores, row_security_active('public.catalog_products') as products`);
    assert.deepEqual(result, { role: "dar_runtime", db: dbName, stores: true, products: true });
  } finally { await runtime.end(); }
  await s3.send(new HeadBucketCommand({ Bucket: bucket }));
  const unsupported = await fetch(`http://${host}:${s3Port}/${bucket}`, { method: "POST" });
  assert.equal(unsupported.status, 405);
  await unsupported.body?.cancel();
  console.log(`Local connection check: PostgreSQL ${dbPort} (${dbName}, restricted role), S3 ${s3Port} (${bucket}).`);
}

async function cleanupCheck(password, s3, env) {
  const id = randomUUID();
  const key = `${id}/catalog/${randomUUID()}.webp`;
  const target = { Bucket: bucket, Key: key };
  const owner = new pg.Client({ connectionString: connection(password, "dar_owner") });
  await owner.connect();
  try {
    await s3.send(new PutObjectCommand({ ...target, Body: "Dar Market local cleanup fixture" }));
    await owner.query("insert into public.catalog_media_gc values ($1,$2,now())", [key, id]);
    await npm(["run", "media:cleanup"], { ...env, MEDIA_WORKER_DATABASE_URL: connection(password, "dar_media") });
    await assert.rejects(s3.send(new HeadObjectCommand(target)), (error) => error.$metadata?.httpStatusCode === 404);
    assert.equal((await owner.query("select 1 from public.catalog_media_gc where object_key = $1", [key])).rowCount, 0);
    console.log("Local cleanup check: fixture deleted from S3 and acknowledged in PostgreSQL.");
  } finally {
    await s3.send(new DeleteObjectCommand(target)).catch(() => {});
    await owner.query("delete from public.catalog_media_gc where object_key = $1", [key]).catch(() => {});
    await owner.end();
  }
}

async function ready() {
  for (let attempt = 0; attempt < 80; attempt++) {
    if (stopping || app.exitCode !== null) throw new Error("Local application stopped during startup.");
    const response = await fetch(`${origin}/ar`, { signal: AbortSignal.timeout(2_000) }).catch(() => null);
    if (response?.ok) { await response.body?.cancel(); return; }
    await new Promise((done) => setTimeout(done, 750));
  }
  throw new Error("Local application did not become ready.");
}

async function main() {
  if (!["dev", "check", "verify", "cleanup-check"].includes(mode) && !staging) throw new Error("Unknown local environment command.");
  if (!Number.isInteger(appPort) || appPort < 1024 || appPort > 65535 || appPort === s3Port) {
    throw new Error("DAR_LOCAL_APP_PORT must be a valid alternate port.");
  }
  if (!Number.isInteger(dbPort) || dbPort < 1024 || dbPort > 65535 || dbPort === 5432 || dbPort === s3Port || dbPort === appPort) {
    throw new Error("DAR_LOCAL_PG_PORT must be a valid, unused alternate port.");
  }
  const pidPath = join(data, "postmaster.pid");
  const pidLines = existsSync(pidPath) ? readFileSync(pidPath, "utf8").split(/\r?\n/) : [];
  const runningPort = Number(pidLines[3]);
  const reusingPg = !staging && Number.isInteger(runningPort) && runningPort >= 1024 && (await portOpen(runningPort));
  if (reusingPg && !process.env.DAR_LOCAL_PG_PORT) dbPort = runningPort;
  if (!staging && !process.env.DAR_LOCAL_S3_PORT && (await portOpen(s3Port))) {
    s3Port = 4568;
  }
  for (const port of [...(reusingPg ? [] : [dbPort]), s3Port, ...(staging || ["dev", "verify"].includes(mode) ? [appPort] : [])]) {
    if (await portOpen(port) || (port === appPort && await portOpen(port, "::1"))) throw new Error(`Port ${port} is occupied. Stop the owning local session before retrying.`);
  }
  const password = passwords();
  let emulator;
  let storage;
  let started = false;
  try {
    if (!reusingPg) {
      started = pgCommand("pg_ctl", ["-D", data, "-l", join(local, "postgres.log"), "-o", `-h ${host} -p ${dbPort}`, "-w", "-t", "90", "start"]) === 0;
      if (!started) throw new Error("Local PostgreSQL startup failed. Inspect .dar-local/postgres.log.");
    }
    await provision(password);
    const emulatorPackage = join(tools, "node_modules/s3rver/package.json");
    if (!existsSync(emulatorPackage)) {
      mkdirSync(tools, { recursive: true });
      await npm(["install", "--prefix", tools, "--save-exact", "--no-audit", "--no-fund", "s3rver@3.7.1"], process.env);
    }
    const S3rver = createRequire(emulatorPackage)("s3rver");
    const objectDirectory = join(local, "s3");
    mkdirSync(objectDirectory, { recursive: true });
    emulator = new S3rver({ address: host, port: s3Port, directory: objectDirectory, silent: true, vhostBuckets: false, configureBuckets: [{ name: bucket }] });
    // The local emulator only needs signed object I/O and a bucket health check.
    // Keep its multipart and XML bucket configuration parsers outside this surface.
    const bucketPath = `/${bucket}`;
    const objectPath = new RegExp(`^${bucketPath}/[a-f0-9-]{36}/(?:catalog|theme)/[a-f0-9-]{36}\\.webp$`);
    emulator.middleware.unshift(async (ctx, next) => {
      const objectMethod = ["GET", "HEAD", "PUT", "DELETE"].includes(ctx.method) &&
        (objectPath.test(ctx.path) || staging && ctx.path === `${bucketPath}/ops/readiness`);
      const bucketCheck = ctx.method === "HEAD" && (ctx.path === bucketPath || ctx.path === `${bucketPath}/`);
      if (ctx.get("origin") || !(objectMethod || bucketCheck) || Object.keys(ctx.query).some((key) => key !== "x-id")) {
        ctx.status = 405;
        return;
      }
      await next();
    });
    await emulator.run();
    const endpoint = `http://${host}:${s3Port}`;
    storage = new S3Client({ endpoint, region: "us-east-1", forcePathStyle: true, credentials: { accessKeyId: fixtureAccess, secretAccessKey: fixtureAccess } });
    const socket = win ? "\\\\.\\pipe\\dar-pdf-" + randomUUID() : "/tmp/dar-pdf-" + randomUUID() + ".sock";
    const env = {
      ...process.env, DATABASE_URL: connection(password, "dar_runtime"), MIGRATION_DATABASE_URL: "", MEDIA_WORKER_DATABASE_URL: "",
      APP_ORIGIN: origin, S3_ENDPOINT: endpoint, S3_BUCKET: bucket, S3_REGION: "us-east-1", S3_FORCE_PATH_STYLE: "true",
      AWS_PROFILE: "", AWS_SESSION_TOKEN: "", AWS_ACCESS_KEY_ID: fixtureAccess, AWS_SECRET_ACCESS_KEY: fixtureAccess,
      TRUSTED_CLIENT_IP_HEADER: "", NEXT_TELEMETRY_DISABLED: "1", DAR_LOCAL_SIGNUP: "true", DAR_LOCAL_BUILD: "true",
      ...(mode === "verify" || staging ? { NEXT_DIST_DIR: staging ? ".dar-local/next-staging" : ".dar-local/next-verify" } : {}),
      IDENTITY_DATABASE_URL: connection(password, "dar_identity"), PLATFORM_MFA_KEY: password.mfaKey, PAYMENT_PROOF_KEY: password.proofKey,
      SMTP_CONFIG_KEY: password.smtpKey, MAIL_PROVIDER: "local", DAR_MAIL_DIR: join(local, "mail", dbName), DAR_LOCAL_PDF: "true",
      PUBLIC_SIGNUP_ENABLED: "false", DAR_ENV: staging ? "staging" : "development", PAYMENT_RENDERER_SOCKET: "",
      ...(staging ? { DAR_STAGING_LOCAL: "true", DAR_LOCAL_SIGNUP: "false", S3_READY_KEY: "ops/readiness",
        PAYMENT_RENDERER_SOCKET: socket, PAYMENT_PROOF_ACTIVE_KEY: "native_v1", PAYMENT_PROOF_KEYRING: JSON.stringify({ native_v1: password.proofKey }),
        OPS_METRICS_TOKEN: randomBytes(32).toString("hex") } : {}),
    };
    await npm(["run", "db:migrate"], { ...env, MIGRATION_DATABASE_URL: connection(password, "dar_owner") });
    await checkConnections(password, storage);
    if (mode === "check") return;
    if (mode === "cleanup-check") return await cleanupCheck(password, storage, env);
    if (mode === "dev") {
      app = node([nextCli, "dev", "--hostname", "localhost", "--port", String(appPort)], env);
      return await complete(app);
    }
    if (staging) {
      await storage.send(new PutObjectCommand({ Bucket:bucket,Key:"ops/readiness",Body:"local staging fixture" }));
      pdf = node(["scripts/ops/pdf-worker.mjs"], { ...env, PLATFORM_MFA_KEY: "", PAYMENT_PROOF_KEY: "", PAYMENT_PROOF_KEYRING: "", SMTP_CONFIG_KEY: "",
        DATABASE_URL: "", IDENTITY_DATABASE_URL: "", AWS_ACCESS_KEY_ID: "", AWS_SECRET_ACCESS_KEY: "" });
      await npm(["run", "build"], env);
      app = node([nextCli, "start", "--hostname", "localhost", "--port", String(appPort)], env);
      if (mode === "staging-smoke") {
        await ready();
        const status = async (path) => {
          const response = await fetch(`${origin}${path}`, { redirect: "error", signal: AbortSignal.timeout(5000) });
          await response.body?.cancel();
          return response.status;
        };
        assert.equal(await status("/api/ready"), 200);
        assert.equal(await status("/en/sign-up"), 404);
        assert.equal(await status("/api/metrics"), 404);
        const stopped = once(pdf, "exit");
        pdf.kill();
        await stopped;
        assert.equal(await status("/api/ready"), 503);
        assert.equal(await status("/api/health"), 200);
        const metrics = await fetch(`${origin}/api/metrics`, { headers: { Authorization: `Bearer ${env.OPS_METRICS_TOKEN}` }, signal: AbortSignal.timeout(5000) });
        assert.equal(metrics.status, 200);
        assert.match(await metrics.text(), /dar_operational_events_total\{event="pdf_failed"\} 1/);
        console.log(JSON.stringify({ event: "native_staging_smoke_passed", signup: 404, anonymousMetrics: 404, authorizedMetrics: 200,
          readinessAfterRendererStop: 503, health: 200 }));
        return;
      }
      return await complete(app);
    }
    if (mode === "verify") await retireStaleFixtureNotifications(password);
    const mkdirRetryFile = join(local, "mkdir-retry.cjs").replace(/\\/g, "/");
    if (win) {
      writeFileSync(mkdirRetryFile, `const fs=require("node:fs"),fsp=require("node:fs/promises"),s=fs.mkdirSync.bind(fs),p=fsp.mkdir.bind(fsp);
fs.mkdirSync=function(t,o){for(let i=0;i<8;i++){try{return s(t,o);}catch(e){if(e&&(e.code==="EPERM"||e.code==="EACCES"||e.code==="EEXIST")){try{if(fs.statSync(t).isDirectory())return;}catch{}if(i<7){Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,20*(i+1));continue;}}throw e;}}};
fsp.mkdir=async function(t,o){for(let i=0;i<8;i++){try{return await p(t,o);}catch(e){if(e&&(e.code==="EPERM"||e.code==="EACCES"||e.code==="EEXIST")){try{if((await fsp.stat(t)).isDirectory())return;}catch{}if(i<7){await new Promise(r=>setTimeout(r,20*(i+1)));continue;}}throw e;}}};
fs.mkdir=function(t,o,c){const cb=typeof o==="function"?o:c,op=typeof o==="function"?undefined:o;fsp.mkdir(t,op).then(r=>cb&&cb(null,r),e=>cb&&cb(e));};fs.promises.mkdir=fsp.mkdir;\n`);
    }
    for (const script of ["lint", "typecheck", "test", "build"]) {
      const scriptEnv = (script === "build" || script === "typecheck") && win
        ? { ...env, NODE_OPTIONS: [env.NODE_OPTIONS, `--require "${mkdirRetryFile}"`].filter(Boolean).join(" ") }
        : env;
      await npm(["run", script], scriptEnv);
    }
    await npm(["run", "test:db"], {
      ...env, TEST_DATABASE_URL: env.DATABASE_URL, TEST_MIGRATION_DATABASE_URL: connection(password, "dar_owner"),
      TEST_MEDIA_DATABASE_URL: connection(password, "dar_media"), TEST_MAILER_DATABASE_URL: connection(password, "dar_mailer"),
      TEST_BYPASS_DATABASE_URL: connection(password, "dar_test_unsafe"),
    });
    app = node([nextCli, "start", "--hostname", "localhost", "--port", String(appPort)], env);
    await ready();
    await npm(["run", "test:e2e"], {
      ...env, TEST_BASE_URL: origin, TEST_MIGRATION_DATABASE_URL: connection(password, "dar_owner"), DAR_SCREENSHOTS_DIR: join(local, "screenshots"),
    });
    await cleanupCheck(password, storage, env);
    await npm(["run", "orders:cleanup"], { ...env, MEDIA_WORKER_DATABASE_URL: connection(password, "dar_media") });
    // The notification queue runs as the dedicated mail delivery login with every other database credential removed.
    await npm(["run", "ops:notifications"], { ...env, DATABASE_URL: "", IDENTITY_DATABASE_URL: "", MEDIA_WORKER_DATABASE_URL: "", MAIL_WORKER_DATABASE_URL: connection(password, "dar_mailer") });
    await assertNotificationJobRan(password);
    await npm(["run", "ops:maintenance"], { ...env, MEDIA_WORKER_DATABASE_URL: connection(password, "dar_media") });
    await npm(["run", "billing:expire"], { ...env, MEDIA_WORKER_DATABASE_URL: connection(password, "dar_media") });
    await complete(node(["scripts/ops/load.mjs"], { ...env, TEST_BASE_URL: origin, TEST_MIGRATION_DATABASE_URL: connection(password,"dar_owner") }));
    await complete(node(["scripts/ops/rehearse-backup.mjs"], {
      ...env, TEST_CLUSTER_ADMIN_URL: connection(password,"postgres","postgres"), TEST_CLUSTER_DATA_DIR: data,
      TEST_MIGRATION_DATABASE_URL: connection(password,"dar_owner"), TEST_S3RVER_PACKAGE: emulatorPackage,
      DAR_PG_BIN: process.env.DAR_PG_BIN || dirname(native("pg_dump")),
    }));
    // Dry run of the Dokploy staging bring-up on a throwaway cluster: bootstrap SQL, all migrations, each login's capabilities.
    await complete(node(["scripts/ops/rehearse-staging-bootstrap.mjs"], { ...env, DAR_PG_BIN: process.env.DAR_PG_BIN || dirname(native("pg_dump")) }));
  } finally {
    if (app && app.exitCode === null) app.kill();
    if (pdf && pdf.exitCode === null) pdf.kill();
    storage?.destroy();
    try { await emulator?.close(); } finally {
      if (started && pgCommand("pg_ctl", ["-D", data, "-w", "stop", "-m", "fast"])) process.exitCode = 1;
    }
  }
}

for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => { stopping = true; app?.kill(); });
main().catch((error) => { if (!stopping) { console.error(error.message); process.exitCode = 1; } });
