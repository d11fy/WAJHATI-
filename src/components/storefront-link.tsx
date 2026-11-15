"use client";

import { Copy, Download, MessageCircle, QrCode, Share2 } from "lucide-react";
import { useMemo, useState } from "react";
import type { Locale } from "@/lib/i18n";
import { createQrMatrix } from "@/lib/qr";

export function StorefrontLink({ path, locale, published, storeName }: { path: string; locale: Locale; published: boolean; storeName?: string }) {
  const ar = locale === "ar";
  const [message, setMessage] = useState("");
  const [showQr, setShowQr] = useState(false);

  const fullUrl = typeof window !== "undefined" ? new URL(path, window.location.origin).href : path;
  const qrMatrix = useMemo(() => {
    try {
      return createQrMatrix(fullUrl);
    } catch {
      return null;
    }
  }, [fullUrl]);

  async function copyOrShare(share: boolean) {
    const url = new URL(path, window.location.origin).href;
    setMessage("");
    try {
      if (share && navigator.share) {
        await navigator.share({ title: storeName, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setMessage(ar ? "تم نسخ الرابط" : "Link copied");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setMessage(ar ? "تعذر إكمال العملية. افتح الرابط وانسخه من شريط العنوان." : "Could not complete the action. Open the link and copy it from the address bar.");
    }
  }

  function shareOnWhatsapp() {
    const url = new URL(path, window.location.origin).href;
    const text = ar
      ? `${storeName ? `تصفّح متجر ${storeName} واطلب مباشرة عبر الرابط:\n` : ""}${url}`
      : `${storeName ? `Browse ${storeName} and order directly:\n` : ""}${url}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer");
  }

  function downloadQrSvg() {
    if (!qrMatrix) return;
    const margin = 4;
    const size = qrMatrix.length + margin * 2;
    const cells: string[] = [];
    qrMatrix.forEach((row, r) => {
      row.forEach((dark, c) => {
        if (dark) cells.push(`M${c + margin},${r + margin}h1v1h-1z`);
      });
    });
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="512" height="512" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#ffffff"/><path d="${cells.join("")}" fill="#0b1f33"/></svg>`;
    const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = `wajhati-qr-${path.split("/").pop() || "store"}.svg`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(objectUrl);
  }

  return <div className="wajhati-store-link">
    {published
      ? <a href={path} className="wajhati-store-url" dir="ltr" title={path}>{path}</a>
      : <bdi className="wajhati-store-url" dir="ltr" title={path}>{path}</bdi>}
    {published && <div className="wajhati-store-link-actions flex-wrap">
      <button type="button" className="button button-secondary" onClick={() => void copyOrShare(false)}><Copy size={16} aria-hidden="true" />{ar ? "نسخ الرابط" : "Copy link"}</button>
      <button type="button" className="button button-secondary" onClick={() => void copyOrShare(true)}><Share2 size={16} aria-hidden="true" />{ar ? "مشاركة" : "Share"}</button>
      <button type="button" className="button button-secondary" onClick={shareOnWhatsapp}><MessageCircle size={16} aria-hidden="true" />{ar ? "مشاركة واتساب" : "WhatsApp share"}</button>
      {qrMatrix && <button type="button" className="button button-secondary" aria-expanded={showQr} onClick={() => setShowQr((value) => !value)}><QrCode size={16} aria-hidden="true" />{ar ? "رمز QR للمتجر" : "Store QR code"}</button>}
    </div>}
    {published && showQr && qrMatrix && (
      <div className="mt-3 flex flex-wrap items-center gap-4 rounded-xl border border-line bg-canvas p-4">
        <svg viewBox={`0 0 ${qrMatrix.length + 8} ${qrMatrix.length + 8}`} className="size-32 shrink-0 rounded-lg border border-line bg-white p-1" role="img" aria-label={ar ? "رمز الاستجابة السريعة للمتجر" : "Store QR Code"} shapeRendering="crispEdges">
          <rect width="100%" height="100%" fill="#ffffff" />
          <path d={qrMatrix.flatMap((row, r) => row.map((dark, c) => dark ? `M${c + 4},${r + 4}h1v1h-1z` : "")).join("")} fill="#0b1f33" />
        </svg>
        <div className="grid min-w-0 flex-1 gap-2">
          <p className="font-bold">{ar ? "رمز QR جاهز للطباعة والمشاركة" : "Print-ready Store QR Code"}</p>
          <p className="text-sm text-muted">{ar ? "اطبعه على أكياس التغليف أو الكروت أو شاركه على قصص إنستغرام ليصل العملاء إلى متجرك مباشرة." : "Print on packaging, business cards, or share on Instagram Stories so customers open your store directly."}</p>
          <button type="button" className="button button-secondary justify-self-start" onClick={downloadQrSvg}><Download size={16} aria-hidden="true" />{ar ? "تحميل رمز QR (SVG)" : "Download QR (SVG)"}</button>
        </div>
      </div>
    )}
    {published && <p role="status" className="text-sm text-muted">{message}</p>}
  </div>;
}
