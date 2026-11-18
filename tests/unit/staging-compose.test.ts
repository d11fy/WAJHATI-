import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { validateEnv } from "../../scripts/ops/validate-env.mjs";

type Service = {
  environment: Record<string, string | number | boolean>; labels?: string[]; networks?: string[]; network_mode?: string; ports?: unknown; read_only?: boolean;
  cap_drop?: string[]; security_opt?: string[]; mem_limit?: string; pids_limit?: number;
};
type Compose = { name: string; services: Record<string, Service>; networks: Record<string, { internal?: boolean; external?: boolean }> };
const yaml = createRequire(import.meta.url)("js-yaml") as { load(text: string): unknown };
const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const key = () => randomBytes(32).toString("hex");
const password = () => randomBytes(24).toString("hex");
const text = read("infra/dokploy/compose.staging.yaml");
const compose = yaml.load(text) as Compose;

// Fixture values for every variable the file reads. None is a real secret.
const values: Record<string, string> = {
  STAGING_BASIC_AUTH: "qa:$apr1$fixture$fixturefixturefixturefixtu", DAR_DB_ADMIN_PASSWORD: password(), DAR_OWNER_PASSWORD: password(), DAR_RUNTIME_PASSWORD: password(),
  DAR_IDENTITY_PASSWORD: password(), DAR_WORKER_PASSWORD: password(), DAR_MAILER_PASSWORD: password(), DAR_BACKUP_PASSWORD: password(),
  PLATFORM_MFA_KEY: key(), PAYMENT_PROOF_ACTIVE_KEY: "stage_v1", PAYMENT_PROOF_KEYRING: JSON.stringify({ stage_v1: key() }), OPS_METRICS_TOKEN: key(), SMTP_CONFIG_KEY: key(),
  S3_BUCKET: "dar-staging-media-fixture", S3_REGION: "us-east-1", S3_ENDPOINT: "https://storage.example.test",
  S3_APP_ACCESS_KEY_ID: "app-id", S3_APP_SECRET_ACCESS_KEY: "app-secret", S3_WORKER_ACCESS_KEY_ID: "worker-id", S3_WORKER_SECRET_ACCESS_KEY: "worker-secret",
  S3_BACKUP_READ_ACCESS_KEY_ID: "read-id", S3_BACKUP_READ_SECRET_ACCESS_KEY: "read-secret", MAIL_ALLOWED_RECIPIENTS: "qa@example.test, @example.org",
  BACKUP_KEY_ID: "stage_v1", BACKUP_KEY: key(), BACKUP_BUCKET: "dar-staging-backup-fixture", BACKUP_S3_ENDPOINT: "https://storage.example.test",
  BACKUP_AWS_ACCESS_KEY_ID: "backup-id", BACKUP_AWS_SECRET_ACCESS_KEY: "backup-secret",
};

/** Docker Compose interpolation: ${NAME}, ${NAME:-default}, ${NAME:?message}. */
function interpolate(input: string, variables = values) {
  return input.replace(/\$\{([A-Z0-9_]+)(?::([?-])([^}]*))?\}/g, (_match, name: string, operator: string | undefined, rest: string | undefined) => {
    const value = variables[name];
    if (value) return value;
    if (operator === "?") throw new Error(`Missing required variable ${name}: ${rest}`);
    return operator === "-" ? rest ?? "" : "";
  });
}
const environment = (service: string, variables = values): Record<string, string> =>
  Object.fromEntries(Object.entries(compose.services[service].environment).map(([name, value]) => [name, interpolate(String(value), variables)]));

test("each deployed staging service starts under the same validation the application enforces", () => {
  assert.deepEqual(validateEnv(environment("app"), "app"), []);
  assert.deepEqual(validateEnv(environment("worker"), "worker"), []);
  assert.deepEqual(validateEnv(environment("mailer"), "mailer"), []);
  assert.deepEqual(validateEnv(environment("backup"), "backup"), []);
  for (const service of ["app", "worker", "mailer", "backup"]) assert.equal(environment(service).DAR_ENV, "staging", service);
});

test("a missing secret stops the deployment instead of starting with a blank value", () => {
  for (const name of ["DAR_RUNTIME_PASSWORD", "DAR_MAILER_PASSWORD", "SMTP_CONFIG_KEY", "STAGING_BASIC_AUTH", "MAIL_ALLOWED_RECIPIENTS", "S3_BUCKET"]) {
    const rest = Object.fromEntries(Object.entries(values).filter(([key]) => key !== name));
    assert.throws(() => { for (const service of ["app", "worker", "mailer"]) environment(service, rest); interpolate((compose.services.app.labels ?? []).join("\n"), rest); }, new RegExp(name), name);
  }
});

test("every process holds only the credentials it needs", () => {
  const app = environment("app"), worker = environment("worker"), mailer = environment("mailer");
  for (const name of ["MAIL_WORKER_DATABASE_URL", "MEDIA_WORKER_DATABASE_URL", "BACKUP_KEY", "BACKUP_DATABASE_URL", "RESEND_API_KEY"]) assert.ok(!(name in app), `app must not hold ${name}`);
  for (const name of ["SMTP_CONFIG_KEY", "RESEND_API_KEY", "MAIL_WORKER_DATABASE_URL", "IDENTITY_DATABASE_URL", "DATABASE_URL", "PLATFORM_MFA_KEY", "MAIL_ALLOWED_RECIPIENTS"]) assert.ok(!(name in worker), `worker must not hold ${name}`);
  for (const name of ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "S3_BUCKET", "DATABASE_URL", "IDENTITY_DATABASE_URL", "MEDIA_WORKER_DATABASE_URL", "PLATFORM_MFA_KEY", "PAYMENT_PROOF_KEYRING"]) assert.ok(!(name in mailer), `mailer must not hold ${name}`);
  // Each database login is a different role and password.
  const logins = [app.DATABASE_URL, app.IDENTITY_DATABASE_URL, worker.MEDIA_WORKER_DATABASE_URL, mailer.MAIL_WORKER_DATABASE_URL, environment("backup").BACKUP_DATABASE_URL].map((url) => new URL(url));
  assert.equal(new Set(logins.map((url) => url.username)).size, logins.length);
  assert.equal(new Set(logins.map((url) => url.password)).size, logins.length);
  for (const url of logins) assert.equal(url.pathname, "/dar_staging");
  // The app and worker use different storage credentials.
  assert.notEqual(app.AWS_ACCESS_KEY_ID, worker.AWS_ACCESS_KEY_ID);
  // Staging can never claim legal approval and never opens sign-up.
  assert.equal(app.LEGAL_APPROVED, "false");
  assert.equal(app.PUBLIC_SIGNUP_ENABLED, "false");
});

test("only the app is routable, behind basic auth, a noindex header, HTTPS and the staging host", () => {
  const services = compose.services;
  for (const [name, service] of Object.entries(services)) {
    assert.ok(!("ports" in service), `${name} must not publish a host port`);
    if (name !== "app") assert.ok(!service.labels, `${name} must not carry routing labels`);
    if (name !== "app") assert.ok(!(service.networks ?? []).includes("dokploy-network"), `${name} must not join the shared Traefik network`);
  }
  assert.deepEqual(services.app.networks, ["data", "egress", "dokploy-network"]);
  assert.equal(services.pdf.network_mode, "none");
  assert.equal(compose.networks.data.internal, true);
  assert.equal(compose.networks["dokploy-network"].external, true);
  assert.equal(compose.name, "wajhati-staging");
  const labels = interpolate((services.app.labels ?? []).join("\n")).split("\n");
  const label = (name: string) => labels.find((line) => line.startsWith(`${name}=`))?.slice(name.length + 1);
  assert.equal(label("traefik.http.routers.wajhati-staging.rule"), "Host(`staging.wajhati.store`)");
  assert.equal(label("traefik.http.routers.wajhati-staging.entrypoints"), "websecure");
  assert.equal(label("traefik.http.routers.wajhati-staging.tls.certresolver"), "letsencrypt");
  assert.deepEqual(label("traefik.http.routers.wajhati-staging.middlewares")?.split(","), ["wajhati-staging-auth", "wajhati-staging-noindex"]);
  assert.equal(label("traefik.http.middlewares.wajhati-staging-auth.basicauth.users"), values.STAGING_BASIC_AUTH);
  assert.match(label("traefik.http.middlewares.wajhati-staging-noindex.headers.customresponseheaders.X-Robots-Tag") ?? "", /noindex/);
  assert.equal(label("traefik.http.routers.wajhati-staging-http.middlewares"), "wajhati-staging-https");
  assert.equal(label("traefik.http.middlewares.wajhati-staging-https.redirectscheme.scheme"), "https");
  // The host rule never names the production domain.
  assert.ok(!/Host\(`(?:www\.)?wajhati\.store`\)/.test(text));
});

test("hardening is uniform and no secret is written into the file", () => {
  for (const name of ["app", "pdf", "worker", "mailer", "operator", "backup", "backup-check"]) {
    const service = compose.services[name];
    assert.equal(service.read_only, true, name);
    assert.deepEqual(service.cap_drop, ["ALL"], name);
    assert.deepEqual(service.security_opt, ["no-new-privileges:true"], name);
    assert.ok(service.mem_limit && service.pids_limit, `${name} has resource limits`);
  }
  assert.ok(!/\b[a-f0-9]{64}\b/.test(text), "no 64-hex key literal");
  // Every database URL takes its password from a variable.
  const urls = [...text.matchAll(/(postgresql:\/\/[^\r\n]+)/g)].map((match) => match[1]);
  assert.ok(urls.length >= 6, "database URLs were found");
  for (const url of urls) assert.match(url, /:\$\{[A-Z_]+(?::[-?][^}]*)?\}@/, url);
  assert.ok(!/REPLACE_ME/.test(text));
});

test("the role bootstrap is guarded, takes passwords from the environment and creates the mail delivery role", () => {
  const sql = read("infra/dokploy/bootstrap-staging.sql");
  for (const role of ["storefront_app", "storefront_identity", "storefront_media_worker", "storefront_mailer", "dar_owner", "dar_runtime", "dar_identity", "dar_worker", "dar_mailer", "dar_backup"]) assert.match(sql, new RegExp(`CREATE ROLE ${role}\\b`));
  assert.match(sql, /Expected an uninitialized staging database/);
  assert.match(sql, /current_database\(\) <> 'dar_staging'/);
  assert.ok(!/PASSWORD '/.test(sql), "no literal password");
  assert.equal(sql.match(/printenv DAR_[A-Z]+_PASSWORD/g)?.length, 6);
  assert.match(sql, /length\(:'owner_pw'\) >= 24/);
  assert.ok(!/SUPERUSER(?<!NOSUPERUSER)/.test(sql.replaceAll("NOSUPERUSER", "")), "no role is a superuser");
  assert.equal((sql.match(/\bBYPASSRLS\b/g) ?? []).length, 1, "only the read-only backup login bypasses row security");
  assert.match(sql, /GRANT CONNECT ON DATABASE dar_staging TO dar_runtime, dar_identity, dar_worker, dar_mailer, dar_backup;/);
});
