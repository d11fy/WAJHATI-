"use client";

import { Copy, Share2 } from "lucide-react";
import { useState } from "react";
import type { Locale } from "@/lib/i18n";

export function StorefrontLink({ path, locale, published }: { path: string; locale: Locale; published: boolean }) {
  const ar = locale === "ar";
  const [message, setMessage] = useState("");
  async function copyOrShare(share: boolean) {
    const url = new URL(path, window.location.origin).href;
    setMessage("");
    try {
      if (share && navigator.share) {
        await navigator.share({ url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setMessage(ar ? "تم نسخ الرابط" : "Link copied");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setMessage(ar ? "تعذر إكمال العملية. افتح الرابط وانسخه من شريط العنوان." : "Could not complete the action. Open the link and copy it from the address bar.");
    }
  }
  return <div className="wajhati-store-link">
    {published
      ? <a href={path} className="wajhati-store-url" dir="ltr" title={path}>{path}</a>
      : <bdi className="wajhati-store-url" dir="ltr" title={path}>{path}</bdi>}
    {published && <div className="wajhati-store-link-actions">
      <button type="button" className="button button-secondary" onClick={() => void copyOrShare(false)}><Copy size={16} aria-hidden="true" />{ar ? "نسخ الرابط" : "Copy link"}</button>
      <button type="button" className="button button-secondary" onClick={() => void copyOrShare(true)}><Share2 size={16} aria-hidden="true" />{ar ? "مشاركة" : "Share"}</button>
    </div>}
    {published && <p role="status" className="text-sm text-muted">{message}</p>}
  </div>;
}
