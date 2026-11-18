// Dry run of the Dokploy staging bring-up without Docker: a throwaway PostgreSQL cluster, the real bootstrap SQL
// (infra/dokploy/bootstrap-staging.sql), every migration as the owner login, then proof of what each login can and
// cannot do. Nothing leaves the machine and the cluster is deleted afterwards. Run by `npm run local:verify`.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import pg from "pg";

const win = process.platform === "win32";
const bin = (name) => {
  const directory = process.env.DAR_PG_BIN || (win && "C:/Program Files/PostgreSQL/18/bin");
  const file = `${name}${win ? ".exe" : ""}`;
  return directory && existsSync(join(directory, file)) ? join(directory, file) : file;
};
const hex = (bytes = 24) => randomBytes(bytes).toString("hex");
const passwords = { admin: hex(), DAR_OWNER_PASSWORD: hex(), DAR_RUNTIME_PASSWORD: hex(), DAR_IDENTITY_PASSWORD: hex(), DAR_WORKER_PASSWORD: hex(),
  DAR_MAILER_PASSWORD: hex(), DAR_BACKUP_PASSWORD: hex() };
const directory = resolve(".dar-local", "ops-rehearsals", `staging-bootstrap-${hex(6)}`);
const data = join(directory, "data");

function free() {
  return new Promise((done, fail) => {
    const server = createServer();
    server.once("error", fail);
    server.listen(0, "127.0.0.1", () => { const { port } = server.address(); server.close(() => done(port)); });
  });
}

function sync(name, args, env = {}, detached = false) {
  // `pg_ctl start` leaves the database server holding its standard streams. With piped output spawnSync would then wait
  // for the server to exit and hang forever on Windows, so the server-starting call gets no pipes at all.
  const result = spawnSync(bin(name), args, { env: { ...process.env, ...env }, encoding: "utf8", windowsHide: true, stdio: detached ? "ignore" : "pipe" });
  return { status: result.status, output: `${result.stdout ?? ""}${result.stderr ?? ""}` };
}

function node(args, env) {
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, args, { env: { ...process.env, ...env }, stdio: "inherit", windowsHide: true });
    child.once("error", fail);
    child.once("exit", (code) => code === 0 ? done() : fail(new Error("Migration command failed.")));
  });
}

const expectedMigrations = JSON.parse(await readFile(resolve("drizzle/meta/_journal.json"), "utf8")).entries.length;
const port = await free();
let started = false;
try {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const pwfile = join(directory, "pw");
  await writeFile(pwfile, `${passwords.admin}\n`, { mode: 0o600 });
  assert.equal(sync("initdb", ["-D", data, "-U", "dar_admin", "--auth=scram-sha-256", "--encoding=UTF8", "--no-locale", `--pwfile=${pwfile}`]).status, 0, "initdb");
  await rm(pwfile);
  assert.equal(sync("pg_ctl", ["-D", data, "-l", join(directory, "log"), "-o", `-h 127.0.0.1 -p ${port}`, "-w", "-t", "90", "start"], {}, true).status, 0, "pg_ctl start");
  started = true;
  const url = (user, password, database = "dar_staging") => `postgresql://${user}:${password}@127.0.0.1:${port}/${database}`;
  const admin = new pg.Client({ connectionString: url("dar_admin", passwords.admin, "postgres") });
  await admin.connect();
  await admin.query("create database dar_staging");
  await admin.end();

  const psql = (overrides = {}) => sync("psql", ["-v", "ON_ERROR_STOP=1", "-f", resolve("infra/dokploy/bootstrap-staging.sql")], {
    PGHOST: "127.0.0.1", PGPORT: String(port), PGUSER: "dar_admin", PGDATABASE: "dar_staging", PGPASSWORD: passwords.admin,
    ...Object.fromEntries(Object.entries(passwords).filter(([name]) => name.startsWith("DAR_"))), ...overrides,
  });
  const roleCount = async () => {
    const client = new pg.Client({ connectionString: url("dar_admin", passwords.admin) });
    await client.connect();
    try { return (await client.query("select count(*)::int as n from pg_roles where rolname like 'dar\\_%' escape '\\' and rolname <> 'dar_admin' or rolname like 'storefront\\_%' escape '\\'")).rows[0].n; }
    finally { await client.end(); }
  };

  // An unset or short password must create nothing at all.
  for (const override of [{ DAR_MAILER_PASSWORD: "" }, { DAR_OWNER_PASSWORD: "short" }]) {
    const refused = psql(override);
    assert.notEqual(refused.status, 0, "bootstrap must refuse a missing or short password");
    assert.equal(await roleCount(), 0, "a refused bootstrap must leave no role behind");
  }
  const created = psql();
  assert.equal(created.status, 0, created.output);
  assert.notEqual(psql().status, 0, "a second bootstrap must refuse to run");
  await node(["node_modules/drizzle-kit/bin.cjs", "migrate"], { MIGRATION_DATABASE_URL: url("dar_owner", passwords.DAR_OWNER_PASSWORD) });

  const as = async (user, password, sql) => {
    const client = new pg.Client({ connectionString: url(user, password) });
    await client.connect();
    try { return await client.query(sql); } finally { await client.end(); }
  };
  const denied = (user, password, sql) => assert.rejects(as(user, password, sql), { code: "42501" }, `${user}: ${sql}`);
  const { DAR_OWNER_PASSWORD: ownerPw, DAR_RUNTIME_PASSWORD: runtimePw, DAR_IDENTITY_PASSWORD: identityPw, DAR_WORKER_PASSWORD: workerPw,
    DAR_MAILER_PASSWORD: mailerPw, DAR_BACKUP_PASSWORD: backupPw } = passwords;

  assert.equal((await as("dar_owner", ownerPw, "select count(*)::int as n from drizzle.__drizzle_migrations")).rows[0].n, expectedMigrations);
  // The mail delivery login: the secret function and queue only. No tables, no other function families.
  assert.equal((await as("dar_mailer", mailerPw, "select count(*)::int as n from ops_mail_secret()")).rows[0].n, 0);
  for (const sql of ["select 1 from platform_mail", "select 1 from users", "select * from platform_mail_secret()", "select platform_job_start('media')", "select billing_expire(1)"]) {
    await denied("dar_mailer", mailerPw, sql);
  }
  // No other login reads the secret through the new function, and the worker no longer runs the queue.
  for (const [user, password] of [["dar_runtime", runtimePw], ["dar_identity", identityPw], ["dar_worker", workerPw], ["dar_backup", backupPw]]) {
    await denied(user, password, "select * from ops_mail_secret()");
  }
  await denied("dar_worker", workerPw, "select * from ops_claim_mail(0)");
  await as("dar_worker", workerPw, "select * from ops_missed_jobs()");
  await as("dar_identity", identityPw, "select * from platform_mail_secret()");
  await denied("dar_runtime", runtimePw, "select * from platform_mail_secret()");
  // The backup login can read everything and write nothing.
  assert.ok((await as("dar_backup", backupPw, "select count(*)::int as n from stores")).rows[0].n >= 0);
  await assert.rejects(as("dar_backup", backupPw, "create table backup_must_not_write(x int)"), { code: "25006" });
  // Only the schema owner may change the schema.
  await denied("dar_runtime", runtimePw, "create table runtime_must_not_create(x int)");
  console.log(JSON.stringify({ event: "staging_bootstrap_rehearsal_passed", migrations: expectedMigrations, roles: ["dar_owner", "dar_runtime", "dar_identity", "dar_worker", "dar_mailer", "dar_backup"],
    emptyPasswordRefused: true, secondRunRefused: true, scope: "throwaway local cluster, not a deployment" }));
} finally {
  if (started) sync("pg_ctl", ["-D", data, "-m", "immediate", "-w", "stop"]);
  await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
