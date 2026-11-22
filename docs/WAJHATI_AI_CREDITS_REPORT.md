# WAJHATI AI — مساعد الكتابة الذكي + AI Credits: delivery report

Branch: `feature/wajhati-ai-credits` (cut from `audit/final-readiness`). Local commit only: nothing pushed, nothing deployed, no production data touched.

## What it does
- **Writing assistant** (`AIWritingAssistant`) on real marketing text fields only: product name and description (AR/EN), theme hero title and description, and the family themes' eyebrow, heading and body text. Commands: write, improve, shorten, expand, change tone, 3 alternatives, translate from the other-language field. The dialog shows the price and the balance before running, then a preview with use / retry / cancel. Nothing reaches the field until "use".
- **One-click store content** ("جهّز محتوى متجرك بالذكاء الاصطناعي") in the theme designer. It takes an idea, business type, audience, tone, language and optionally the store's own name, categories and products. It fills only the text fields that the selected theme's `ThemeConfig` has (4 for Minimal Commerce and Luxury Boutique, 10 for the six family themes), within the Zod length limits. You get an old-vs-new comparison where you can accept everything or pick fields. "Apply" changes the editor draft. "Apply and save as draft" goes through the existing `submitDesign` revision flow. Nothing publishes on its own. Images, colors, fonts and section structure are never touched.
- **Credits wallet per store.** The trial gives 30 credits, once per owner account. An extra store does not get another 30. An active subscription gives 600 per calendar month of the paid term, so 3-, 6- and 12-month terms also get 600 each month, created when that month starts. Unused credits never roll over. Moving from trial to paid expires what is left of the trial and allocates 600. In the grace, expired, suspended or onboarding states no credits are granted. Credits come from `public.billing_state()`, and no billing or financial table is written.
- **Dashboard meter:** "رصيد الذكاء الاصطناعي: 30 / 30" with a usage bar, the renewal or trial-end date, and any extra credit. When credits run out it shows a message with a link to billing.
- **Admin "AI management"** (`/platform/ai`) shows:
  - usage over 30 days: requests, success/fail, input and output tokens, estimated USD cost, credits consumed, allocated, granted and withdrawn
  - top stores and recent failures
  - a global kill switch, per-store per-minute and per-day limits, trial and monthly amounts, and token prices
  - per-operation credit prices
  - per-store suspend and restore
  - manual credit grant or withdraw with a required reason, recorded in the ledger and the hash-chained `platform_events` audit log

  Writes need fresh MFA. Settings and prices are owner-only; suspend and grants are open to owners and administrators.

## Cost table (admin-editable, seeded)
headline / short phrase (also improve, shorten, translate it) 1 · product description 2 · section/collection description 2 · about the store (hero description) 3 · fill core theme texts 15 · build store content from an idea 20.

## Files
New:
- `drizzle/0030_ai_credits.sql`
- `src/server/db/ai-schema.ts`
- `src/lib/ai/fields.ts` (field allow-list, theme text fields)
- `src/lib/ai/schemas.ts`
- `src/lib/ai/prompts.ts` (central prompt builder)
- `src/lib/ai-copy.ts`
- `src/server/ai/provider.ts` (DeepSeek + mock)
- `src/server/ai/wallet.ts`
- `src/server/ai/wallet-view.ts`
- `src/server/ai/service.ts`
- `src/server/ai/actions.ts`
- `src/server/ai/admin.ts`
- `src/server/ai/admin-actions.ts`
- `src/components/ai/writing-assistant.tsx`
- `src/components/ai/store-content-builder.tsx`
- `src/components/ai/credits-meter.tsx`
- `src/components/ai/admin-panel.tsx`
- `tests/unit/ai.test.ts`
- `tests/integration/ai.test.ts`

Changed:
- `src/components/store-theme/designer.tsx`
- `src/components/catalog/editor.tsx`
- the store dashboard, design and product pages
- the platform `[section]` page
- `src/lib/platform-copy.ts`
- `src/components/admin-workspace.tsx`
- `src/server/platform/repository.ts` (area type)
- `drizzle/meta/_journal.json`
- `drizzle.config.ts`
- `.env.example`
- `infra/dokploy/compose.production.yaml` and `infra/dokploy/compose.staging.yaml` (pass-through of the AI env vars)

## Tables (migration 0030, additive only)
`ai_settings`, `ai_operation_costs`, `ai_store_controls`, `ai_wallets` (cycle `balance` + non-expiring `extra` for grants and future paid packs), `ai_allocations` (unique per store and cycle), `ai_trial_claims` (one per owner account), `ai_requests` (metadata only: operation, tokens, estimated USD, provider, model, latency, error code, idempotency key; no prompts or generated text), `ai_ledger` (append-only by trigger).

All tables have RLS. `storefront_app` can only SELECT its own store's rows. Every write goes through SECURITY DEFINER functions:
- `ai_wallet`
- `ai_reserve`: atomic, takes the wallet row lock, and checks idempotency, the kill switch, store suspension, price, per-minute and per-day limits, and balance
- `ai_commit`
- `ai_release`: an expired cycle is forfeited, extra credit returns
- `ai_sync`: lazy cycles and stale-reservation recovery after 5 minutes
- `ai_admin_overview`, `ai_admin_configure`, `ai_admin_adjust`

## Required environment (app service)
- `DEEPSEEK_API_KEY`: required for real generation. Server-only, never logged, stored or returned. Without it the UI shows "not set up" and no credits are charged.
- Optional:
  - `DEEPSEEK_MODEL` (default `deepseek-flash`)
  - `DEEPSEEK_BASE_URL` (default `https://api.deepseek.com`)
  - `DEEPSEEK_THINKING` (default `false`, which sends `thinking: {type: "disabled"}`)
  - `AI_ASSISTANT_ENABLED` (default `true`; `false` hides the feature)
- `AI_PROVIDER=mock` is honoured only when `DAR_ENV` is `development` or `test`.
- **Important:** the Dokploy compose files use an explicit environment list, so a key set in Dokploy reaches the app only through the `DEEPSEEK_*` / `AI_ASSISTANT_ENABLED` lines added in this branch. The production deploy must include migration 0030.

## Safety
- Ownership, subscription and balance are checked server-side, inside the database function.
- Tenant isolation through RLS and `theme_member`.
- Rate limits per store, per minute and per day.
- Input size limits enforced by Zod.
- Prompt-injection protection: merchant data travels only in a JSON data block, never in the system message, and control characters and angle brackets are stripped.
- Outputs are validated with strict Zod schemas, field length limits and a language check, with one repair attempt. A failed or invalid generation is released and never charged.
- Provider: 40 s timeout, 2 attempts on 408/429/5xx and network errors, token usage recorded.
- The prompt forbids invented facts (materials, sizes, discounts, warranties and so on) and unproven superlatives, keeps the store and product names exactly as given, and asks for natural Arabic.

## Tests and results (2026-11-22)
- `npm run lint`: clean.
- `npm run typecheck`: clean.
- `npm test`: 80/80, including 7 new AI unit tests:
  - only allow-listed fields are addressable
  - injection text stays out of the system prompt
  - all 8 themes fill only their real text fields and stay `themeConfig`-valid at the length limits, with unknown or over-long keys refused
  - DeepSeek request shape, retry behaviour, and the key never appears in the body
  - mock provider and cost estimate
- `tests/integration/ai.test.ts` (PostgreSQL with restricted roles): 14 subtests pass. Covered:
  - trial once per account and no second trial via an extra store
  - charge on success
  - insufficient balance never calls the provider
  - provider error, non-JSON and over-long output all released
  - idempotency
  - monthly, 3-month (second window) and annual (one month, not 12×) cycles
  - trial→paid
  - expiry and forfeit
  - 40 concurrent 20-credit requests against 600 → exactly 30 succeed and the ledger nets to the balance
  - stale reservation recovery
  - store isolation and no direct writes by the runtime role
  - append-only ledger
  - kill switch, suspension and rate limit
  - admin grant, withdraw, price change and suspension with audit, and denied for merchants
- `npm run local:verify`: **exit=0** (lint, typecheck, unit, build, test:db 71/71, e2e 20/20).
- Local browser check (dev server, mock provider):
  - dashboard meter shows 30 / 30 with the trial tag
  - designer builder: cost 15 shown, comparison, "apply and save as draft", then `?status=saved`, and the live preview shows the new hero text with nothing published
  - product form: exactly 4 AI buttons (name and description AR/EN), none on price or SKU; "write" cost 2, balance 15 → 13, and "use" fills the field

## Not verified
- **No real DeepSeek call was made**: there is no key in this environment. The model name `deepseek-flash`, the `thinking` parameter and the default token prices (0.14 / 0.28 USD per million) are unconfirmed and should be checked against DeepSeek's current API docs and pricing. The prices are admin-editable.
- The quality of real Arabic output has not been reviewed, because the mock returns placeholder text.
- The admin "AI management" page was not opened in a browser, since it needs a platform MFA session. Its database functions are covered by the integration test, and the page builds and type-checks.
- English locale screens and the family-theme dialog were not walked through in the browser (Minimal Commerce only). The family fields are covered by unit tests.
- Not deployed. Migration 0030 has not been applied to staging or production.
