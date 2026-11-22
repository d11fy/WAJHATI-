import "server-only";
import { aiFeatureEnabled, aiProvider } from "./provider";
import { getWallet, type Wallet } from "./wallet";

export type WalletView = {
  available: boolean; configured: boolean; reason: "ok" | "disabled" | "suspended" | "no_plan" | "not_configured";
  balance: number; extra: number; allocation: number; kind: Wallet["kind"]; cycleEnd: string | null; costs: Record<string, number>;
};

function configured() {
  return aiProvider().name === "mock" || Boolean(process.env.DEEPSEEK_API_KEY?.trim());
}

/** The merchant-facing wallet summary. Null when the feature is off or the user is not a member of the store. */
export async function readAiWallet(userId: string, slug: string): Promise<WalletView | null> {
  if (!aiFeatureEnabled()) return null;
  const found = await getWallet(userId, slug).catch(() => null);
  if (!found?.wallet) return null;
  const { wallet } = found;
  const ready = configured();
  const hasCredit = wallet.kind !== null || wallet.extra > 0;
  const reason = !wallet.enabled ? "disabled" : wallet.suspended ? "suspended" : !ready ? "not_configured" : !hasCredit ? "no_plan" : "ok";
  return {
    available: reason === "ok", configured: ready, reason, balance: wallet.balance, extra: wallet.extra, allocation: wallet.allocation,
    kind: wallet.kind, cycleEnd: wallet.cycleEnd, costs: wallet.costs,
  };
}
