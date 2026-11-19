import { pathToFileURL } from "node:url";

const hex = (value) => /^[a-f0-9]{64}$/.test(value ?? "");
const keyId = (value) => /^[a-z0-9][a-z0-9_-]{0,23}$/.test(value ?? "");
const parsed = (value) => { try { return new URL(value); } catch { return null; } };
const loopback = (host) => ["localhost", "127.0.0.1", "[::1]"].includes(host);

export function validateEnv(env, scope = "app") {
  const errors = [];
  const environment = env.DAR_ENV;
  if (!["development", "staging", "production"].includes(environment)) return ["DAR_ENV"];
  const stagingLocal = environment === "staging" && env.DAR_STAGING_LOCAL === "true";
  const deployed = environment !== "development";
  const isProduction = environment === "production";
  const expectedDb = `dar_${environment}`;
  const database = (key) => {
    const url = parsed(env[key]);
    if (!url || !["postgres:", "postgresql:"].includes(url.protocol) || !url.username || !url.password || /REPLACE_ME|CHANGE_ME/i.test(url.password) ||
      (deployed && url.pathname !== `/${expectedDb}`) ||
      (isProduction && url.hostname !== "db" && url.searchParams.get("sslmode") !== "verify-full")) errors.push(key);
    return url;
  };
  const required = (key) => { if (!env[key] || /REPLACE_ME|CHANGE_ME/i.test(env[key])) errors.push(key); };
  // Public sign-up is closed everywhere except the production application, and only once the owner has approved the legal pages.
  // Staging, the workers, the mailer and the backup jobs never open it. The application also needs a verified mail provider
  // and a trusted client IP header before it shows a sign-up form (publicSignupEnabled()).
  const publicSignupAllowed = env.PUBLIC_SIGNUP_ENABLED === "true" && scope === "app" && isProduction && env.LEGAL_APPROVED === "true";
  if (deployed && ((env.PUBLIC_SIGNUP_ENABLED !== "false" && !publicSignupAllowed) || env.DAR_LOCAL_SIGNUP === "true" || env.DAR_LOCAL_PDF === "true")) errors.push("PUBLIC_SIGNUP_ENABLED");
  if (isProduction && env.DAR_STAGING_LOCAL === "true") errors.push("DAR_STAGING_LOCAL");
  if (scope === "app") {
    // The Terms and Privacy Policy ship as drafts. Production must not boot until the owner has had them
    // reviewed and deliberately sets LEGAL_APPROVED=true (see docs/legal/LEGAL_OWNER_REVIEW.md).
    if (isProduction && env.LEGAL_APPROVED !== "true") errors.push("LEGAL_APPROVED");
    const runtime = database("DATABASE_URL");
    const identity = database("IDENTITY_DATABASE_URL");
    if (runtime && identity && (runtime.host !== identity.host || runtime.pathname !== identity.pathname ||
      runtime.username === identity.username || runtime.password === identity.password)) errors.push("DATABASE_ROLE_ISOLATION");
    for (const key of ["MIGRATION_DATABASE_URL", "MEDIA_WORKER_DATABASE_URL", "MAIL_WORKER_DATABASE_URL", "BACKUP_DATABASE_URL"]) if (env[key]) errors.push(key);
    if (!hex(env.PLATFORM_MFA_KEY)) errors.push("PLATFORM_MFA_KEY");
    if (env.SMTP_CONFIG_KEY && env.SMTP_CONFIG_KEY === env.PLATFORM_MFA_KEY) errors.push("SMTP_CONFIG_KEY");
    if (deployed) {
      if (!hex(env.OPS_METRICS_TOKEN)) errors.push("OPS_METRICS_TOKEN");
      let ring;
      try { ring = JSON.parse(env.PAYMENT_PROOF_KEYRING ?? "null"); } catch { ring = null; }
      if (!ring || typeof ring !== "object" || Array.isArray(ring) || !keyId(env.PAYMENT_PROOF_ACTIVE_KEY) ||
        !Object.hasOwn(ring, env.PAYMENT_PROOF_ACTIVE_KEY) || !Object.entries(ring).every(([id, value]) => keyId(id) && hex(value)) ||
        Object.values(ring).includes(env.PLATFORM_MFA_KEY)) errors.push("PAYMENT_PROOF_KEYRING");
      if (env.PAYMENT_PROOF_KEY && (!hex(env.PAYMENT_PROOF_KEY) || env.PAYMENT_PROOF_KEY === env.PLATFORM_MFA_KEY)) errors.push("PAYMENT_PROOF_KEY");
      if (env.PAYMENT_RENDERER_SOCKET !== "/run/dar-pdf/worker.sock") errors.push("PAYMENT_RENDERER_SOCKET");
    }
  } else if (scope === "worker") {
    database("MEDIA_WORKER_DATABASE_URL");
    // The worker never holds mail secrets or the mail delivery login: those belong to the mailer process only.
    for (const key of ["DATABASE_URL","IDENTITY_DATABASE_URL","MIGRATION_DATABASE_URL","BACKUP_DATABASE_URL","MAIL_WORKER_DATABASE_URL","SMTP_CONFIG_KEY","RESEND_API_KEY","PLATFORM_MFA_KEY","PAYMENT_PROOF_KEYRING"]) if (env[key]) errors.push(key);
  } else if (scope === "mailer") {
    // The mail delivery process: its own narrow database login and the mail secrets, and no storage or other database access.
    database("MAIL_WORKER_DATABASE_URL");
    for (const key of ["DATABASE_URL","IDENTITY_DATABASE_URL","MEDIA_WORKER_DATABASE_URL","MIGRATION_DATABASE_URL","BACKUP_DATABASE_URL","PLATFORM_MFA_KEY","PAYMENT_PROOF_KEYRING","PAYMENT_PROOF_KEY","AWS_ACCESS_KEY_ID","AWS_SECRET_ACCESS_KEY","BACKUP_KEY"]) if (env[key]) errors.push(key);
    if (env.SMTP_CONFIG_KEY && !hex(env.SMTP_CONFIG_KEY)) errors.push("SMTP_CONFIG_KEY");
  } else if (scope === "backup") {
    database("BACKUP_DATABASE_URL");
    if (!hex(env.BACKUP_KEY) || !keyId(env.BACKUP_KEY_ID)) errors.push("BACKUP_KEY");
    for (const key of ["BACKUP_BUCKET","BACKUP_AWS_ACCESS_KEY_ID","BACKUP_AWS_SECRET_ACCESS_KEY","BACKUP_DIR"]) required(key);
    if (!env.BACKUP_BUCKET?.startsWith(`dar-${environment}-backup-`) || env.BACKUP_BUCKET === env.S3_BUCKET) errors.push("BACKUP_BUCKET");
    for (const key of ["DATABASE_URL","IDENTITY_DATABASE_URL","MEDIA_WORKER_DATABASE_URL","MIGRATION_DATABASE_URL","PLATFORM_MFA_KEY","PAYMENT_PROOF_KEYRING"]) if (env[key]) errors.push(key);
    const endpoint = parsed(env.BACKUP_S3_ENDPOINT);
    if (env.BACKUP_S3_ENDPOINT && endpoint?.protocol !== "https:" && !stagingLocal &&
      !(environment === "development" && endpoint?.protocol === "http:" && loopback(endpoint.hostname))) errors.push("BACKUP_S3_ENDPOINT");
    // Media backup reads the live media bucket with its own read-only credential, never the app's.
    if (env.BACKUP_SOURCE_BUCKET) {
      if (!env.BACKUP_SOURCE_BUCKET.startsWith(`dar-${environment}-media-`) || env.BACKUP_SOURCE_BUCKET === env.BACKUP_BUCKET) errors.push("BACKUP_SOURCE_BUCKET");
      required("BACKUP_SOURCE_AWS_ACCESS_KEY_ID"); required("BACKUP_SOURCE_AWS_SECRET_ACCESS_KEY");
      const origin = parsed(env.BACKUP_SOURCE_S3_ENDPOINT);
      if (env.BACKUP_SOURCE_S3_ENDPOINT && origin?.protocol !== "https:" && !stagingLocal &&
        !(environment === "development" && origin?.protocol === "http:" && loopback(origin.hostname))) errors.push("BACKUP_SOURCE_S3_ENDPOINT");
    }
    if (env.DAR_HEARTBEAT_URL) {
      const beat = parsed(env.DAR_HEARTBEAT_URL);
      if (beat?.protocol !== "https:" || beat.username || beat.password) errors.push("DAR_HEARTBEAT_URL");
    }
    if (env.BACKUP_MAX_AGE_HOURS !== undefined && !(Number(env.BACKUP_MAX_AGE_HOURS) > 0 && Number(env.BACKUP_MAX_AGE_HOURS) <= 168)) errors.push("BACKUP_MAX_AGE_HOURS");
  } else return ["scope"];
  if (scope !== "backup") {
    const origin = parsed(env.APP_ORIGIN);
    if (!origin || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash ||
      (deployed && origin.protocol !== "https:") || (isProduction && loopback(origin.hostname))) errors.push("APP_ORIGIN");
    if (deployed && env.TRUSTED_CLIENT_IP_HEADER !== "x-real-ip" && scope === "app") errors.push("TRUSTED_CLIENT_IP_HEADER");
    if (scope !== "mailer") {
      if (deployed && !env.S3_BUCKET?.startsWith(`dar-${environment}-media-`)) errors.push("S3_BUCKET");
      if (deployed) required("S3_BUCKET");
      if (isProduction && env.S3_ENDPOINT) {
        required("AWS_ACCESS_KEY_ID"); required("AWS_SECRET_ACCESS_KEY"); required("S3_REGION");
      }
      if (env.S3_ENDPOINT && parsed(env.S3_ENDPOINT)?.protocol !== "https:" && !stagingLocal && deployed) errors.push("S3_ENDPOINT");
      if (deployed && scope === "app" && !env.S3_READY_KEY) errors.push("S3_READY_KEY");
    }
    if (scope === "app" || scope === "mailer") {
      if (stagingLocal) {
        if (env.MAIL_PROVIDER !== "local" || !env.DAR_MAIL_DIR || !loopback(origin?.hostname)) errors.push("MAIL_PROVIDER");
      } else if (deployed) {
        // Mail needs at least one provider: the owner-managed SMTP (SMTP_CONFIG_KEY, configured in the platform panel) or
        // Resend. Resend is optional. When Resend is chosen its key and sender must be complete.
        const smtp = hex(env.SMTP_CONFIG_KEY);
        const resend = env.MAIL_PROVIDER === "resend";
        if (env.SMTP_CONFIG_KEY && !smtp) errors.push("SMTP_CONFIG_KEY");
        if (env.MAIL_PROVIDER && !resend) errors.push("MAIL_PROVIDER");
        if (resend) { required("RESEND_API_KEY"); required("MAIL_FROM"); }
        if (!smtp && !resend) errors.push("MAIL_PROVIDER");
        // A deployed staging environment may only mail explicitly allowed recipients, so it can never reach real merchants.
        const allowed = (env.MAIL_ALLOWED_RECIPIENTS ?? "").split(",").map((entry) => entry.trim().toLowerCase()).filter(Boolean);
        const valid = (entry) => /^(@?[a-z0-9]([a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}|[^@\s,]+@[a-z0-9]([a-z0-9.-]*[a-z0-9])?\.[a-z]{2,})$/.test(entry);
        if (environment === "staging" && (!allowed.length || allowed.length > 20 || !allowed.every(valid))) errors.push("MAIL_ALLOWED_RECIPIENTS");
        if (isProduction && env.MAIL_ALLOWED_RECIPIENTS) errors.push("MAIL_ALLOWED_RECIPIENTS");
      }
    }
  }
  return [...new Set(errors)];
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const failures = validateEnv(process.env, process.argv[2]);
  if (failures.length) {
    console.error(JSON.stringify({ event: "invalid_environment", fields: failures }));
    process.exitCode = 1;
  }
}
