import "server-only";
import { and, eq } from "drizzle-orm";
import { aiField } from "@/lib/ai/fields";
import { buildAssistPrompt, buildFillPrompt, repairNote, type BuiltPrompt, type FillStoreData } from "@/lib/ai/prompts";
import {
  assistOutput, assistRequest, cleanText, fillOutputSchema, fillRequest, themeFieldsFor,
  type AssistFailure, type AssistSuccess, type Failure, type FillSuccess,
} from "@/lib/ai/schemas";
import { categories, products } from "@/server/db/catalog-schema";
import type { Transaction } from "@/server/db/actor";
import { withMerchantStore } from "@/server/stores/repository";
import { aiFeatureEnabled, aiProvider, ProviderError, type ProviderRequest, type ProviderResult } from "./provider";
import { commitCredits, estimateCostUsd, readPrices, releaseCredits, reserveCredits, type ReserveResult, type Usage } from "./wallet";

class BadOutput extends Error {}

const failures: Record<Exclude<ReserveResult["status"], "ok">, AssistFailure> = {
  denied: "denied", disabled: "disabled", suspended: "suspended", rate_limited: "rate_limited", no_plan: "no_plan", insufficient: "insufficient", invalid: "invalid", duplicate: "duplicate",
};

function jsonOf(text: string): unknown {
  const body = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try { return JSON.parse(body); } catch { throw new BadOutput(); }
}

/**
 * Calls the provider and validates the answer. A malformed or over-long answer gets exactly one repair attempt; the tokens of both attempts are
 * counted. The caller releases the reserved credits on any thrown error, so a failed generation is never charged.
 */
async function generate<T>(prompt: BuiltPrompt, meta: ProviderRequest["meta"], parse: (raw: unknown) => T) {
  const provider = aiProvider();
  const started = Date.now();
  let inputTokens = 0;
  let outputTokens = 0;
  let model = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    let result: ProviderResult;
    try {
      result = await provider.complete({ system: prompt.system, user: attempt ? `${prompt.user}\n\n${repairNote}` : prompt.user, maxTokens: prompt.maxTokens, meta });
    } catch (error) {
      if (error instanceof ProviderError) throw Object.assign(error, { usage: { inputTokens, outputTokens, provider: provider.name, model, ms: Date.now() - started } });
      throw new ProviderError("upstream");
    }
    inputTokens += result.inputTokens; outputTokens += result.outputTokens; model = result.model;
    try {
      return { value: parse(jsonOf(result.text)), usage: { inputTokens, outputTokens, provider: provider.name, model, ms: Date.now() - started } };
    } catch (error) {
      if (!(error instanceof BadOutput) && !(error instanceof Error && error.name === "ZodError")) throw error;
    }
  }
  throw Object.assign(new BadOutput(), { usage: { inputTokens, outputTokens, provider: provider.name, model, ms: Date.now() - started } });
}

type Run<T> = { ok: true; result: T; usage: Usage; cost: number; balance: number; extra: number } | Failure;

/**
 * The only path to the provider: check and reserve credits atomically in the database, generate outside any transaction, then commit on success
 * or release on every failure. Ownership, subscription state, balance, limits and the kill switches are all decided by the database function.
 */
async function metered<T>(userId: string, slug: string, operation: string, key: string, build: (tx: Transaction, store: { id: string; name: string }) => Promise<(() => ReturnType<typeof generate<T>>) | null>): Promise<Run<T>> {
  if (!aiFeatureEnabled()) return { ok: false, error: "disabled" };
  let prepared: { reserve: ReserveResult; run: (() => ReturnType<typeof generate<T>>) | null; price: { input: number; output: number } } | null;
  try {
    prepared = await withMerchantStore(userId, slug, false, async (tx, store) => {
      const run = await build(tx, store);
      const price = await readPrices(tx);
      if (!run) return { reserve: { status: "invalid" } as ReserveResult, run: null, price };
      return { reserve: (await reserveCredits(tx, store.id, operation, key)) ?? ({ status: "invalid" } as ReserveResult), run, price };
    });
  } catch { return { ok: false, error: "unavailable" }; }
  if (!prepared) return { ok: false, error: "denied" };
  const { reserve, run, price } = prepared;
  if (reserve.status !== "ok" || !run) return { ok: false, error: failures[reserve.status === "ok" ? "invalid" : reserve.status] };

  const settle = async (operation: (tx: Transaction) => Promise<unknown>) => {
    try { await withMerchantStore(userId, slug, false, (tx) => operation(tx)); return true; } catch { console.error("AI credit settlement failed."); return false; }
  };
  try {
    const { value, usage } = await run();
    const full: Usage = { ...usage, costUsd: estimateCostUsd(usage.inputTokens, usage.outputTokens, price) };
    if (!await settle((tx) => commitCredits(tx, reserve.requestId, full))) return { ok: false, error: "unavailable" };
    return { ok: true, result: value, usage: full, cost: reserve.cost, balance: reserve.balance, extra: reserve.extra };
  } catch (error) {
    const usage = (error as { usage?: Partial<Usage> }).usage;
    const code = error instanceof ProviderError ? error.code : error instanceof BadOutput ? "bad_output" : "unexpected";
    const costUsd = usage?.inputTokens != null ? estimateCostUsd(usage.inputTokens, usage.outputTokens ?? 0, price) : undefined;
    await settle((tx) => releaseCredits(tx, reserve.requestId, code, usage ? { ...usage, costUsd } : undefined));
    return { ok: false, error: code === "bad_output" ? "bad_output" : code === "not_configured" ? "not_configured" : "unavailable" };
  }
}

function hasLanguage(text: string, language: "ar" | "en") {
  if (text.length < 20) return true;
  return language === "ar" ? /[؀-ۿ]/.test(text) : /[A-Za-z]/.test(text);
}

export async function runAssist(userId: string, slug: string, raw: unknown): Promise<AssistSuccess | Failure> {
  const parsed = assistRequest.safeParse(raw);
  const field = parsed.success ? aiField(parsed.data.fieldId) : null;
  if (!parsed.success || !field) return { ok: false, error: "invalid" };
  const request = parsed.data;
  const outcome = await metered<string[]>(userId, slug, field.operation, request.key, async (_tx, store) => {
    const prompt = buildAssistPrompt(request, store);
    return () => generate(prompt, { kind: "assist", count: prompt.count, max: field.max, language: field.language }, (value) => {
      const output = assistOutput.parse(value);
      const options = [...new Set(output.options.map(cleanText))].filter(Boolean);
      if (!options.length || options.some((option) => option.length > field.max || !hasLanguage(option, field.language))) throw new BadOutput();
      return options.slice(0, prompt.count);
    });
  });
  return outcome.ok ? { ok: true, options: outcome.result, cost: outcome.cost, balance: outcome.balance, extra: outcome.extra } : outcome;
}

async function storeData(tx: Transaction, store: { id: string; name: string }): Promise<FillStoreData> {
  const [cats, items] = await Promise.all([
    tx.select({ ar: categories.nameAr, en: categories.nameEn }).from(categories).where(and(eq(categories.storeId, store.id), eq(categories.visible, true))).orderBy(categories.position, categories.id).limit(12),
    tx.select({ ar: products.nameAr, en: products.nameEn, da: products.descriptionAr, de: products.descriptionEn }).from(products)
      .where(and(eq(products.storeId, store.id), eq(products.state, "published"))).orderBy(products.position, products.id).limit(12),
  ]);
  const label = (ar: string, en: string | null) => en && en !== ar ? `${ar} / ${en}` : ar;
  return {
    name: store.name, categories: cats.map((row) => label(row.ar, row.en)),
    products: items.map((row) => ({ name: label(row.ar, row.en), description: (row.da || row.de || undefined) })),
  };
}

export async function runThemeFill(userId: string, slug: string, raw: unknown): Promise<FillSuccess | Failure> {
  const parsed = fillRequest.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const request = parsed.data;
  const fields = themeFieldsFor(request);
  if (!fields.length) return { ok: false, error: "invalid" };
  const schema = fillOutputSchema(fields);
  const outcome = await metered<Record<string, string>>(userId, slug, request.idea ? "store_from_idea" : "theme_fill", request.key, async (tx, store) => {
    const data = request.useStoreData ? await storeData(tx, store) : { name: store.name, categories: [], products: [] };
    const prompt = buildFillPrompt(request, fields, data);
    return () => generate(prompt, { kind: "theme_fill", count: fields.length, fields: fields.map(({ path, max, language }) => ({ path, max, language })) }, (value) => {
      const output = schema.parse(value);
      if (fields.some((field) => !hasLanguage(output[field.path], field.language))) throw new BadOutput();
      return output;
    });
  });
  return outcome.ok ? { ok: true, values: outcome.result, cost: outcome.cost, balance: outcome.balance, extra: outcome.extra } : outcome;
}
