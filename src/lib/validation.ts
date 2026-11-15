import { z } from "zod";

export const countries = [
  "PS", "SA", "AE", "EG", "JO", "KW", "QA", "BH", "OM", "LB", "IQ", "SY", "YE",
  "MA", "DZ", "TN", "LY", "SD", "MR", "SO", "DJ", "KM",
] as const;
export const currencies = [
  "USD", "EUR", "ILS", "SAR", "AED", "EGP", "JOD", "KWD", "QAR", "BHD", "OMR",
  "LBP", "IQD", "SYP", "YER", "MAD", "DZD", "TND", "LYD", "SDG", "MRU", "SOS", "DJF", "KMF",
] as const;

const email = z.string().trim().toLowerCase().max(254).pipe(z.email());
const password = z.string().min(12).max(128);
const displayName = z.string().trim().max(80).refine((value) => Array.from(value).length >= 2 && !/[\p{Cc}\p{Cs}]/u.test(value));
export const signInInput = z.object({ email, password });
export const signUpInput = signInInput.extend({ name: displayName });
export const authInput = z.discriminatedUnion("mode", [
  signInInput.extend({ mode: z.literal("sign-in") }),
  signUpInput.extend({ mode: z.literal("sign-up") }),
]);

export const storeSlug = z.string().min(3).max(48).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
export const storeInput = z.object({
  name: displayName,
  slug: z.string().trim().toLowerCase().pipe(storeSlug),
  country: z.enum(countries),
  currency: z.enum(currencies),
});

export type StoreInput = z.infer<typeof storeInput>;
