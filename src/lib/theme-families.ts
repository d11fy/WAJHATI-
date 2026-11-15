import type { Locale } from "./i18n";
import type { FamilyThemeId } from "./theme-config";

type FamilyLabels = {
  description: string; browse: string; categories: string; featured: string; editorial: string; detail: string; cart: string;
};

export const familyLabels = {
  ar: {
    "electro-x": { description: "كتالوج تقني مع عروض وصور جانبية.", browse: "تصفّح الأجهزة", categories: "تسوّق حسب الفئة", featured: "اختيارات المتجر", editorial: "دليل الاختيار", detail: "معلومات المنتج", cart: "سلة التسوق" },
    "maison-wear": { description: "غلاف ممتد ومجموعات بأسلوب تحريري.", browse: "تسوّق المجموعة", categories: "المجموعات", featured: "مختارات الموسم", editorial: "قصص الموسم", detail: "تفاصيل القطعة", cart: "حقيبة التسوق" },
    "aura-beauty": { description: "واجهة مقسّمة ومجموعات للعناية والجمال.", browse: "اكتشف المجموعة", categories: "تصفّح حسب احتياجك", featured: "مختارات للعناية", editorial: "روتين العناية", detail: "عن المنتج", cart: "مختارات العناية" },
    "luma-gifts": { description: "صور فسيفسائية وتصفّح حسب المناسبة.", browse: "ابحث عن هدية", categories: "تصفّح حسب المناسبة", featured: "هدايا مختارة", editorial: "أفكار لكل مناسبة", detail: "تفاصيل الهدية", cart: "سلة الهدايا" },
    "digital-hub": { description: "عروض رقمية ومقارنة المنتجات المنشورة.", browse: "اكتشف المنتجات الرقمية", categories: "التصنيفات الرقمية", featured: "العروض الرقمية", editorial: "عن المنتجات الرقمية", detail: "تفاصيل المنتج الرقمي", cart: "مراجعة الطلب الرقمي" },
    learnpro: { description: "واجهة لاكتشاف الدورات وتصفّح المجالات.", browse: "استكشف الدورات", categories: "ماذا تريد أن تتعلّم؟", featured: "دورات مميزة", editorial: "عن الدورات", detail: "عن هذه الدورة", cart: "مراجعة طلب الدورات" },
  },
  en: {
    "electro-x": { description: "A technology catalog with feature tiles and side promotions.", browse: "Browse electronics", categories: "Shop by category", featured: "Store picks", editorial: "Buying guide", detail: "Product information", cart: "Shopping cart" },
    "maison-wear": { description: "A full-bleed cover and editorial collections.", browse: "Shop the collection", categories: "Collections", featured: "Seasonal picks", editorial: "Season stories", detail: "Item details", cart: "Shopping bag" },
    "aura-beauty": { description: "A split hero and collections for beauty and care.", browse: "Explore the collection", categories: "Browse by concern", featured: "Care picks", editorial: "Care ritual", detail: "About the product", cart: "Your care selections" },
    "luma-gifts": { description: "Mosaic photography and occasion-led discovery.", browse: "Find a gift", categories: "Shop by occasion", featured: "Selected gifts", editorial: "Ideas for every occasion", detail: "Gift details", cart: "Gift basket" },
    "digital-hub": { description: "Digital products with comparisons drawn from the catalog.", browse: "Explore digital products", categories: "Digital categories", featured: "Digital offers", editorial: "About these products", detail: "Digital product details", cart: "Review digital order" },
    learnpro: { description: "Course discovery with topic-led browsing.", browse: "Explore courses", categories: "What do you want to learn?", featured: "Featured courses", editorial: "About the courses", detail: "About this course", cart: "Review course request" },
  },
} as const satisfies Record<Locale, Record<FamilyThemeId, FamilyLabels>>;
