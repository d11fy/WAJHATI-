import Image from "next/image";
import arabicPreview from "@/assets/wajhati/catalog-preview-ar.png";
import englishPreview from "@/assets/wajhati/catalog-preview-en.png";
import type { Locale } from "@/lib/i18n";

export function ProductPreview({ locale, priority = false }: { locale: Locale; priority?: boolean }) {
  const ar = locale === "ar";
  return <figure className="wajhati-product-preview">
    <figcaption>
      <span className="wajhati-preview-dots" aria-hidden="true"><i /><i /><i /></span>
      <span>{ar ? "من داخل لوحة المنتجات" : "Inside the product dashboard"}</span>
    </figcaption>
    <Image src={ar ? arabicPreview : englishPreview} alt={ar ? "لقطة فعلية لصفحة المنتجات والبحث والأسعار في واجهتي" : "An actual WAJHATI product list with search and prices"}
      sizes="(max-width: 767px) 94vw, (max-width: 1023px) 50vw, 630px" preload={priority} />
    <p>{ar ? "لقطة من واجهتي بمنتج تجريبي" : "WAJHATI captured with a sample product"}</p>
  </figure>;
}
