import "server-only";
import { publicSignupEnabled } from "@/server/auth/mail";
import { marketingBilling } from "@/server/billing/marketing";
import { contactSettings } from "@/server/platform/contact";

/*
 * The public marketing pages read the same three values for every visitor: published prices, the official WhatsApp contact and
 * whether sign-up is open. Reading them once a minute per server process instead of on every request removes three database
 * round trips from the busiest pages. A failed read never replaces a good value, and is not remembered.
 */
const ttlMs = 60_000;

function remember<T>(load: () => Promise<T | null>) {
  let value: T | null = null;
  let at = 0;
  let pending: Promise<T | null> | null = null;
  return () => {
    if (value !== null && Date.now() - at < ttlMs) return Promise.resolve(value);
    pending ??= load().then((fresh) => {
      if (fresh !== null) { value = fresh; at = Date.now(); }
      return fresh ?? value;
    }).finally(() => { pending = null; });
    return pending;
  };
}

export const cachedMarketingBilling = remember(marketingBilling);
export const cachedContactSettings = remember(contactSettings);
const signup = remember(async () => ({ open: await publicSignupEnabled() }));
export const cachedPublicSignup = async () => (await signup())?.open ?? false;
