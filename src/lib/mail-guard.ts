/**
 * Recipient guard for non-production mail. A deployed staging environment must never reach real merchants, so it may
 * only send to an explicit allow-list (`MAIL_ALLOWED_RECIPIENTS`: full addresses or `@domain`, comma separated).
 * `scripts/ops/validate-env.mjs` requires the list in staging and forbids it in production. Production is unaffected.
 */
export function parseAllowlist(value: string | undefined) {
  return (value ?? "").split(",").map((entry) => entry.trim().toLowerCase()).filter(Boolean);
}

export function recipientAllowed(address: string, provider: string, env: Record<string, string | undefined> = process.env) {
  if (env.DAR_ENV === "production") return true;
  // The local file sink never leaves the machine.
  if (provider === "local") return true;
  const list = parseAllowlist(env.MAIL_ALLOWED_RECIPIENTS);
  if (!list.length) return env.DAR_ENV !== "staging";
  const target = address.trim().toLowerCase();
  return list.some((entry) => entry.includes("@") && !entry.startsWith("@") ? entry === target : target.endsWith(entry.startsWith("@") ? entry : `@${entry}`));
}
