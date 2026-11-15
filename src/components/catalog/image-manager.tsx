"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { catalogCopy } from "@/lib/catalog-copy";
import type { Locale } from "@/lib/i18n";

export function ImageManager({ locale, path, images, multiple }: {
  locale: Locale; path: string; images: { id: string; primary: boolean }[]; multiple: boolean;
}) {
  const t = catalogCopy[locale];
  const router = useRouter();
  const [refreshing, startTransition] = useTransition();
  const [working, setWorking] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const busy = working || refreshing;

  async function message(response: Response) {
    const { code } = await response.json().catch(() => ({ code: "unavailable" }));
    return typeof code === "string" && Object.hasOwn(t, code) ? t[code as keyof typeof t] : t.unavailable;
  }

  async function upload(files: File[]) {
    if (!files.length || busy) return;
    setWorking(true);
    setErrors([]);
    const failed: string[] = [];
    try {
      for (const file of files.slice(0, multiple ? 8 : 1)) {
        try {
          const response = await fetch(path, { method: "POST", body: file, headers: { "Content-Type": file.type } });
          if (!response.ok) failed.push(`${file.name} · ${await message(response)}`);
        } catch {
          failed.push(`${file.name} · ${t.unavailable}`);
        }
      }
      if (files.length > (multiple ? 8 : 1)) failed.push(t.limit);
    } finally {
      setErrors(failed);
      setWorking(false);
      startTransition(() => router.refresh());
    }
  }

  async function update(id: string, operation: "delete" | "primary" | "up" | "down") {
    setWorking(true);
    setErrors([]);
    try {
      const response = await fetch(`${path}/${id}${operation === "delete" ? "" : `?operation=${operation}`}`, {
        method: operation === "delete" ? "DELETE" : "PATCH",
      });
      if (!response.ok) setErrors([await message(response)]);
      else {
        setConfirmDelete(null);
        startTransition(() => router.refresh());
      }
    } catch {
      setErrors([t.unavailable]);
    } finally {
      setWorking(false);
    }
  }

  return (
    <section className="panel grid gap-4 p-5 sm:p-6" aria-busy={busy}>
      <h2 className="text-xl font-black">{t.images}</h2>
      <label className="field">
        {t.upload}<input className="control file:me-3 file:text-brand" type="file" accept="image/jpeg,image/png,image/webp"
          multiple={multiple} disabled={busy || (!multiple && Boolean(images.length))}
          onChange={(event) => { const files = Array.from(event.target.files ?? []); event.target.value = ""; void upload(files); }} />
      </label>
      <p className="text-xs text-muted" role="status">{busy ? t.uploading : t.uploadHelp}</p>
      {errors.length > 0 && <ul className="error" role="alert">{errors.map((error, index) => <li key={index}>{error}</li>)}</ul>}
      {images.length > 0 && <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {images.map(({ id, primary }, index) => <li key={id} className="overflow-hidden rounded-2xl border border-line">
          <div className="relative aspect-[4/3] bg-leaf">
            <Image src={`${path}/${id}`} alt={`${t.image} ${index + 1}`} fill unoptimized className="object-cover" />
            {primary && <span className="tag absolute start-2 top-2 bg-white">{t.primary}</span>}
          </div>
          <div className="flex flex-wrap gap-1 p-2">
            {multiple && !primary && <button type="button" className="button button-secondary" disabled={busy} onClick={() => void update(id, "primary")}>{t.makePrimary}</button>}
            {multiple && index > 0 && <button type="button" className="button button-secondary" aria-label={t.moveUp} disabled={busy} onClick={() => void update(id, "up")}>↑</button>}
            {multiple && index + 1 < images.length && <button type="button" className="button button-secondary" aria-label={t.moveDown} disabled={busy} onClick={() => void update(id, "down")}>↓</button>}
            {confirmDelete === id ? <>
              <button type="button" className="button button-secondary" disabled={busy} onClick={() => void update(id, "delete")}>{t.confirm}</button>
              <button type="button" className="button button-secondary" disabled={busy} onClick={() => setConfirmDelete(null)}>{t.cancel}</button>
            </> : <button type="button" className="button button-secondary" disabled={busy} onClick={() => setConfirmDelete(id)}>{t.removeImage}</button>}
          </div>
        </li>)}
      </ul>}
    </section>
  );
}
