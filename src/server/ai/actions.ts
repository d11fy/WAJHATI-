"use server";

import { notFound } from "next/navigation";
import { isLocale } from "@/lib/i18n";
import type { AssistSuccess, Failure, FillSuccess } from "@/lib/ai/schemas";
import { requireUser } from "@/server/auth/session";
import { runAssist, runThemeFill } from "./service";
import { readAiWallet } from "./wallet-view";

async function actor(locale: string) {
  if (!isLocale(locale)) notFound();
  return requireUser(locale);
}

export async function aiWalletStatus(locale: string, slug: string) {
  const user = await actor(locale);
  return readAiWallet(user.id, slug);
}

export async function aiAssist(locale: string, slug: string, payload: unknown): Promise<AssistSuccess | Failure> {
  const user = await actor(locale);
  return runAssist(user.id, slug, payload).catch(() => ({ ok: false, error: "unavailable" }) as Failure);
}

export async function aiFill(locale: string, slug: string, payload: unknown): Promise<FillSuccess | Failure> {
  const user = await actor(locale);
  return runThemeFill(user.id, slug, payload).catch(() => ({ ok: false, error: "unavailable" }) as Failure);
}
