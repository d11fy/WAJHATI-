"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";
import { cartInput, type CartLine } from "@/lib/checkout";

const fallback = new Map<string, string>();
const eventName = "dar-cart-change";
const serverSnapshot = () => "[]";

export function cartStorageKey(storeId: string) { return `dar-cart:v1:${storeId}`; }

function read(key: string) {
  if (fallback.has(key)) return fallback.get(key)!;
  try { return window.localStorage.getItem(key) ?? "[]"; }
  catch { return fallback.get(key) ?? "[]"; }
}

function parse(value: string): CartLine[] {
  try { return cartInput.safeParse(JSON.parse(value)).data ?? []; }
  catch { return []; }
}

export function updateCart(storeId: string, edit: (lines: CartLine[]) => CartLine[] | null) {
  const key = cartStorageKey(storeId);
  const next = edit(parse(read(key)));
  if (!next) return false;
  const value = JSON.stringify(next);
  try { window.localStorage.setItem(key, value); fallback.delete(key); }
  catch { fallback.set(key, value); }
  window.dispatchEvent(new CustomEvent(eventName, { detail: key }));
  return true;
}

export function useCart(storeId: string) {
  const key = cartStorageKey(storeId);
  const subscribe = useCallback((notify: () => void) => {
    const local = (event: Event) => { if ((event as CustomEvent).detail === key) notify(); };
    const remote = (event: StorageEvent) => { if (event.key === key || event.key === null) notify(); };
    window.addEventListener(eventName, local);
    window.addEventListener("storage", remote);
    return () => { window.removeEventListener(eventName, local); window.removeEventListener("storage", remote); };
  }, [key]);
  const snapshot = useSyncExternalStore(subscribe, () => read(key), serverSnapshot);
  return useMemo(() => parse(snapshot), [snapshot]);
}
