import "server-only";

/**
 * Text-generation providers. The service layer only sees `AiProvider`, so the real DeepSeek client can be replaced by the mock
 * in tests and in local verification. The API key is read here, from the server environment only, and is never logged, stored or returned.
 */
export type ProviderRequest = {
  system: string; user: string; maxTokens: number;
  /** Not sent upstream. Lets the mock produce output of the right shape. */
  meta: { kind: "assist" | "theme_fill"; count: number; fields?: { path: string; max: number; language: "ar" | "en" }[]; max?: number; language?: "ar" | "en" };
};
export type ProviderResult = { text: string; inputTokens: number; outputTokens: number; model: string };
export type ProviderErrorCode = "not_configured" | "timeout" | "rate_limited" | "upstream" | "bad_response";

export class ProviderError extends Error {
  constructor(readonly code: ProviderErrorCode, readonly retryable = false) { super(code); this.name = "ProviderError"; }
}
export interface AiProvider { readonly name: string; complete(request: ProviderRequest): Promise<ProviderResult> }

export type DeepSeekOptions = {
  apiKey: string | undefined; model: string; baseUrl: string; thinking: boolean; timeoutMs: number; attempts: number; fetcher?: typeof fetch; pause?: (ms: number) => Promise<void>;
};

const retryStatus = new Set([408, 425, 429, 500, 502, 503, 504]);

export function deepSeekProvider(options: DeepSeekOptions): AiProvider {
  const fetcher = options.fetcher ?? fetch;
  const pause = options.pause ?? ((ms: number) => new Promise<void>((done) => setTimeout(done, ms)));
  return {
    name: "deepseek",
    async complete(request) {
      if (!options.apiKey) throw new ProviderError("not_configured");
      let failure = new ProviderError("upstream");
      for (let attempt = 1; attempt <= options.attempts; attempt++) {
        try {
          const response = await fetcher(`${options.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${options.apiKey}` },
            body: JSON.stringify({
              model: options.model, stream: false, temperature: 0.7, max_tokens: request.maxTokens,
              response_format: { type: "json_object" },
              ...(options.thinking ? {} : { thinking: { type: "disabled" } }),
              messages: [{ role: "system", content: request.system }, { role: "user", content: request.user }],
            }),
            signal: AbortSignal.timeout(options.timeoutMs),
            cache: "no-store",
          });
          if (!response.ok) {
            await response.body?.cancel().catch(() => undefined);
            failure = new ProviderError(response.status === 429 ? "rate_limited" : "upstream", retryStatus.has(response.status));
            console.error(`AI provider returned HTTP ${response.status}.`);
          } else {
            const body = await response.json().catch(() => null) as {
              choices?: { message?: { content?: unknown }; finish_reason?: string }[]; usage?: { prompt_tokens?: unknown; completion_tokens?: unknown }; model?: unknown;
            } | null;
            const choice = body?.choices?.[0];
            const content = choice?.message?.content;
            if (typeof content !== "string" || !content.trim() || choice?.finish_reason === "length") throw new ProviderError("bad_response");
            const tokens = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.min(Math.round(value), 1_000_000) : 0;
            return { text: content, inputTokens: tokens(body?.usage?.prompt_tokens), outputTokens: tokens(body?.usage?.completion_tokens), model: typeof body?.model === "string" ? body.model.slice(0, 80) : options.model };
          }
        } catch (error) {
          if (error instanceof ProviderError) throw error;
          const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
          failure = new ProviderError(timedOut ? "timeout" : "upstream", true);
          console.error(timedOut ? "AI provider request timed out." : "AI provider request failed.");
        }
        if (!failure.retryable || attempt === options.attempts) break;
        await pause(500 * attempt);
      }
      throw failure;
    },
  };
}

/** Deterministic provider for tests and local verification: no network, plausible output of the requested shape. */
export function mockProvider(handler?: (request: ProviderRequest) => string | Promise<string>): AiProvider {
  return {
    name: "mock",
    async complete(request) {
      const text = handler ? await handler(request) : defaultMock(request);
      return { text, inputTokens: Math.ceil((request.system.length + request.user.length) / 4), outputTokens: Math.ceil(text.length / 4), model: "mock" };
    },
  };
}

function defaultMock(request: ProviderRequest) {
  const { meta } = request;
  if (meta.kind === "theme_fill") {
    return JSON.stringify(Object.fromEntries((meta.fields ?? []).map((field) => [field.path,
      (field.language === "ar" ? "نص تجريبي لمتجرك" : "Sample copy for your store").slice(0, field.max)])));
  }
  const text = meta.language === "en" ? "A clear, honest line about your product" : "وصف واضح وصادق لمنتجك";
  return JSON.stringify({ options: Array.from({ length: meta.count }, (_, index) => `${text} ${index + 1}`.slice(0, meta.max ?? 100)) });
}

let override: AiProvider | undefined;
/** Test hook. Passing undefined restores the configured provider. */
export function setAiProviderForTests(provider: AiProvider | undefined) { override = provider; }

export function aiFeatureEnabled() {
  return (process.env.AI_ASSISTANT_ENABLED ?? "true").toLowerCase() !== "false";
}

export function aiProvider(): AiProvider {
  if (override) return override;
  const environment = process.env.DAR_ENV;
  if (process.env.AI_PROVIDER === "mock" && (environment === "development" || environment === "test")) return mockProvider();
  return deepSeekProvider({
    apiKey: process.env.DEEPSEEK_API_KEY?.trim() || undefined,
    model: process.env.DEEPSEEK_MODEL?.trim() || "deepseek-flash",
    baseUrl: process.env.DEEPSEEK_BASE_URL?.trim() || "https://api.deepseek.com",
    thinking: (process.env.DEEPSEEK_THINKING ?? "false").toLowerCase() === "true",
    timeoutMs: 40_000, attempts: 2,
  });
}
