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
const text = read("infra/dokploy/compose.production.yaml");
const compose = yaml.load(text) as Compose;

// Fixture values for every variable the file reads. None is a real secret.
const values: Record<string, string> = {
  DAR_DB_ADMIN_PASSWORD: password(), DAR_OWNER_PASSWORD: password(), DAR_RUNTIME_PASSWORD: password(),
  DAR_IDENTITY_PASSWORD: password(), DAR_WORKER_PASSWORD: password(), DAR_MAILER_PASSWORD: password(), DAR_BACKUP_PASSWORD: password(),
  PLATFORM_MFA_KEY: key(), PAYMENT_PROOF_ACTIVE_KEY: "prod_v1", PAYMENT_PROOF_KEYRING: JSON.stringify({ prod_v1: key() }), OPS_METRICS_TOKEN: key(), SMTP_CONFIG_KEY: key(),
  S3_BUCKET: "dar-production-media-fixture", S3_REGION: "auto", S3_ENDPOINT: "https://storage.example.test",
  S3_APP_ACCESS_KEY_ID: "app-id", S3_APP_SECRET_ACCESS_KEY: "app-secret", S3_WORKER_ACCESS_KEY_ID: "worker-id", S3_WORKER_SECRET_ACCESS_KEY: "worker-secret",
  S3_BACKUP_READ_ACCESS_KEY_ID: "read-id", S3_BACKUP_READ_SECRET_ACCESS_KEY: "read-secret",
  BACKUP_KEY_ID: "prod_v1", BACKUP_KEY: key(), BACKUP_BUCKET: "dar-production-backup-fixture", BACKUP_S3_ENDPOINT: "https://storage.example.test",
  BACKUP_AWS_ACCESS_KEY_ID: "backup-id", BACKUP_AWS_SECRET_ACCESS_KEY: "backup-secret",
};

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

test("production services start under the application's own validation once the owner approves the legal pages", () => {
  const approved = { ...values, LEGAL_APPROVED: "true" };
  assert.deepEqual(validateEnv(environment("app", approved), "app"), []);
  assert.deepEqual(validateEnv(environment("worker", approved), "worker"), []);
  assert.deepEqual(validateEnv(environment("mailer", approved), "mailer"), []);
  assert.deepEqual(validateEnv(environment("backup", approved), "backup"), []);
  for (const service of ["app", "worker", "mailer", "backup"]) assert.equal(environment(service, approved).DAR_ENV, "production", service);
});

test("without the owner's explicit LEGAL_APPROVED=true the production application refuses to start", () => {
  assert.equal(environment("app").LEGAL_APPROVED, "false");
  assert.ok(validateEnv(environment("app"), "app").includes("LEGAL_APPROVED"));
});

test("production is separate from staging and mail is not restricted", () => {
  assert.equal(compose.name, "wajhati-production");
  assert.ok(!/staging/i.test(text.replace(/^#.*$/gm, "")), "no staging reference outside comments");
  for (const service of ["app", "mailer"]) assert.ok(!("MAIL_ALLOWED_RECIPIENTS" in compose.services[service].environment), service);
  const app = environment("app");
  for (const url of [app.DATABASE_URL, app.IDENTITY_DATABASE_URL]) assert.equal(new URL(url).pathname, "/dar_production");
  assert.equal(app.PUBLIC_SIGNUP_ENABLED, "false");
});

test("only the app is routable, on the production host over HTTPS, with no edge login or noindex", () => {
  const services = compose.services;
  for (const [name, service] of Object.entries(services)) {
    assert.ok(!("ports" in service), `${name} must not publish a host port`);
    if (name !== "app") assert.ok(!service.labels, `${name} must not carry routing labels`);
    if (name !== "app") assert.ok(!(service.networks ?? []).includes("dokploy-network"), `${name} must not join the shared Traefik network`);
  }
  assert.deepEqual(services.app.networks, ["data", "egress", "dokploy-network"]);
  assert.equal(services.pdf.network_mode, "none");
  assert.equal(compose.networks.data.internal, true);
  const labels = interpolate((services.app.labels ?? []).join("\n")).split("\n");
  const label = (name: string) => labels.find((line) => line.startsWith(`${name}=`))?.slice(name.length + 1);
  assert.equal(label("traefik.http.routers.wajhati-production.rule"), "Host(`wajhati.store`)");
  assert.equal(label("traefik.http.routers.wajhati-production.entrypoints"), "websecure");
  assert.equal(label("traefik.http.routers.wajhati-production.tls.certresolver"), "letsencrypt");
  assert.equal(label("traefik.http.routers.wajhati-production.middlewares"), undefined);
  assert.ok(!labels.some((line) => /basicauth|noindex/i.test(line)));
  assert.equal(label("traefik.http.routers.wajhati-production-http.middlewares"), "wajhati-production-https");
});

test("hardening is uniform, no secret is in the file, and the role bootstrap targets the production database", () => {
  for (const name of ["app", "pdf", "worker", "mailer", "operator", "owner", "mfa", "backup", "backup-runner", "drill", "backup-check"]) {
    const service = compose.services[name];
    assert.equal(service.read_only, true, name);
    assert.deepEqual(service.cap_drop, ["ALL"], name);
    assert.deepEqual(service.security_opt, ["no-new-privileges:true"], name);
    assert.ok(service.mem_limit && service.pids_limit, `${name} has resource limits`);
  }
  assert.ok(!/\b[a-f0-9]{64}\b/.test(text), "no 64-hex key literal");
  for (const url of [...text.matchAll(/(postgresql:\/\/[^\r\n]+)/g)].map((match) => match[1])) assert.match(url, /:\$\{[A-Z_]+(?::[-?][^}]*)?\}@/, url);
  const sql = read("infra/dokploy/bootstrap-production.sql");
  assert.match(sql, /current_database\(\) <> 'dar_production'/);
  assert.match(sql, /GRANT CONNECT ON DATABASE dar_production TO dar_runtime, dar_identity, dar_worker, dar_mailer, dar_backup;/);
  assert.ok(!/dar_staging/.test(sql));
  assert.ok(!/PASSWORD '/.test(sql), "no literal password");
});
