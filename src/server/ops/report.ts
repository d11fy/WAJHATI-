import "server-only";

type Event = "request_error" | "worker_failed" | "identity_mail_failed" | "storage_failed" | "database_failed" |
  "auth_rate_limited" | "payment_review_failed" | "subscription_failed" | "backup_failed" | "worker_missed" | "pdf_failed";
const sent = new Map<Event, number>();
const state = globalThis as typeof globalThis & { darOperationalCounts?: Map<Event, number> };
const counts = state.darOperationalCounts ??= new Map<Event, number>();

export function operationalMetrics() {
  return ["# TYPE dar_operational_events_total counter", ...[...counts].map(([event, total]) =>
    `dar_operational_events_total{event="${event}"} ${total}`)].join("\n") + "\n";
}

export async function reportOperationalError(event: Event, category: string) {
  const tag = /^[a-z_]{1,32}$/.test(category) ? category : "unknown";
  const record = { level: "error", event, category: tag, at: new Date().toISOString() };
  counts.set(event, (counts.get(event) ?? 0) + 1);
  console.error(JSON.stringify(record));
  const configured = process.env.DAR_ALERT_WEBHOOK;
  if (!configured || Date.now() - (sent.get(event) ?? 0) < 300_000) return;
  try {
    const url = new URL(configured);
    if (url.protocol !== "https:" || url.username || url.password || url.hash) return;
    sent.set(event, Date.now());
    const result = await fetch(url, { method: "POST", redirect: "error", signal: AbortSignal.timeout(3_000),
      headers: { "Content-Type": "application/json", ...(process.env.DAR_ALERT_KEY ? { Authorization: `Bearer ${process.env.DAR_ALERT_KEY}` } : {}) },
      body: JSON.stringify(record) });
    await result.body?.cancel();
    if (!result.ok) throw new Error("Alert destination rejected the event.");
  } catch {
    console.error(JSON.stringify({ level: "error", event: "alert_delivery_failed" }));
  }
}
