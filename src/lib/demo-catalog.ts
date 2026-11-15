import { defaultDesign, familyThemeIds, themeRegistry, type FamilyThemeId } from "./theme-config";
import { pageSize, type CatalogFilters } from "./catalog";
import type { Locale } from "./i18n";
import type { ProductDetail } from "@/server/catalog/public";

// Public demonstration content only. Never persisted as merchant data or orders.
type DemoDefinition = {
  title: [string, string]; intro: [string, string]; editorial: [string, string]; banner: string;
  categories: [string, string][]; items: [string, string, string, number, number][];
};
const definitions: Record<FamilyThemeId, DemoDefinition> = {
  "maison-wear": {
    title: ["أناقة لا تحتاج إلى مناسبة.", "Everyday, beautifully dressed."],
    intro: ["درجات هادئة، قصّات مريحة وتفاصيل تصنع الفرق. اكتشفي مجموعتنا للموسم الجديد.", "Quiet tones, effortless silhouettes and considered details. Discover a new season of style."],
    editorial: ["أقل، وأجمل. قطع يمكنك تنسيقها بطريقتك، يومًا بعد يوم.", "Fewer, better pieces. An edit to make your own, season after season."], banner: "coat",
    categories: [["ملابس الموسم", "Seasonal clothing"], ["أساسيات يومية", "Everyday essentials"]],
    items: [["معطف المدينة", "City trench coat", "coat", 28900, 0], ["كنزة ناعمة", "Soft knit sweater", "sweater", 14500, 0], ["تيشيرت يومي", "Everyday tee", "shirt", 7900, 1], ["تنسيق الموسم", "Seasonal ensemble", "coat", 34900, 1]],
  },
  "aura-beauty": {
    title: ["مساحة صغيرة للعناية بكِ.", "A little ritual, just for you."],
    intro: ["اكتشفي عالم العناية اليومية. تفاصيل بسيطة، ملمس لطيف، وروتين يشبهك.", "Discover a thoughtful daily ritual. Simple details, beautiful textures, a moment of your own."],
    editorial: ["ابدئي بروتين بسيط. اختاري منتجاتك، ثم استمتعي بلحظة هدوء في يومك.", "Start with a simple routine. Choose your essentials and make space for a calmer moment."], banner: "beauty",
    categories: [["العناية اليومية", "Daily care"], ["مجموعات العناية", "Care sets"]],
    items: [["سيروم العناية", "Face serum", "serum", 8900, 0], ["مجموعة الروتين", "Daily routine set", "skincare", 16900, 1], ["أساسيات الجمال", "Beauty essentials", "beauty", 12900, 1], ["سيروم يومي", "Daily serum", "serum", 7500, 0]],
  },
  "electro-x": {
    title: ["تقنية تواكب إيقاعك.", "Upgrade your everyday."],
    intro: ["للعمل، للإبداع وللموسيقى. اكتشف مجموعتنا المختارة من الأجهزة والإكسسوارات.", "For work, creativity and your favorite music. Explore a curated collection of tech essentials."],
    editorial: ["مساحة عمل مرتبة تبدأ بأدوات تحب استخدامها. اكتشف اختيارنا للمكتب العصري.", "A better workspace begins with tools you enjoy using. Discover our modern desk edit."], banner: "headphones",
    categories: [["الصوتيات", "Audio"], ["المكتب والأجهزة", "Desk and devices"]],
    items: [["سماعات لاسلكية", "Wireless headphones", "headphones", 24900, 0], ["لوحة مفاتيح", "Desktop keyboard", "keyboard", 18900, 1], ["عدة التصوير", "Photography kit", "camera", 79900, 1], ["إكسسوارات المكتب", "Desk accessories", "desk", 15900, 1]],
  },
  "luma-gifts": {
    title: ["لأن التفاصيل تقول الكثير.", "Little things. Big feelings."],
    intro: ["هدية لفرحة، لذكرى، أو دون مناسبة. اختيارات لطيفة تحمل معنى أجمل.", "For a celebration, a memory, or just because. Thoughtful gifts for moments that matter."],
    editorial: ["هدايا تُختار بمحبة. اجمعي الورود والشموع والتفاصيل التي تجعل المناسبة خاصة.", "Chosen with care. Flowers, candles and thoughtful details to make the occasion yours."], banner: "basket",
    categories: [["صناديق الهدايا", "Gift boxes"], ["ورد وشموع", "Flowers and candles"]],
    items: [["سلة لحظات هادئة", "Quiet moments basket", "basket", 15900, 0], ["صندوق المحبة", "With love gift box", "gift", 11900, 0], ["شمعة لطيفة", "Thoughtful candle", "candle", 6500, 1], ["باقة ورد", "Soft floral bouquet", "flowers", 9900, 1]],
  },
  "digital-hub": {
    title: ["أفكارك تستحق أدوات أفضل.", "Make room for your next idea."],
    intro: ["قوالب وموارد رقمية تساعدك على تنظيم مشروعك وتقديمه بثقة.", "Digital templates and resources to organize your next project and present it with confidence."],
    editorial: ["ابدأ من أساس مرتب. اختر أدوات تناسب أسلوب عملك، وركّز على ما تريد إنجازه.", "Begin with a clear foundation. Choose resources that match how you work and focus on what matters."], banner: "workspace",
    categories: [["قوالب العمل", "Work templates"], ["موارد التصميم", "Design resources"]],
    items: [["قالب تنظيم المشاريع", "Project planner template", "planner", 5900, 0], ["حزمة الإبداع", "Creative resource bundle", "desk", 9900, 1], ["مخطط أسبوعي", "Weekly planner", "notebook", 2900, 0], ["قالب مساحة العمل", "Workspace template", "workspace", 7900, 1]],
  },
  learnpro: {
    title: ["خطوتك القادمة تبدأ بالتعلّم.", "Your next chapter starts here."],
    intro: ["تصفّح دورات نموذجية في التصميم والإنتاجية. اختر المسار الذي يلهمك.", "Explore sample courses in design and productivity. Find a direction that inspires you."],
    editorial: ["التعلّم على طريقتك. صفحة واضحة لكل دورة، مع وصف وخيارات تسهّل الاختيار.", "Learning, on your terms. Clear course pages with descriptions and options to help you choose."], banner: "study",
    categories: [["التصميم", "Design"], ["الإنتاجية", "Productivity"]],
    items: [["أساسيات تصميم الواجهات", "Interface design foundations", "desk", 19900, 0], ["تنظيم الوقت والمشاريع", "Time and project planning", "notebook", 9900, 1], ["مساحة العمل الرقمية", "Your digital workspace", "workspace", 14900, 1], ["التفكير الإبداعي", "Creative thinking", "study", 12900, 0]],
  },
};

export type DemoProduct = ProductDetail & { imageId: null; imageSrc: string; category: string };
export function isDemoTheme(value: string): value is FamilyThemeId { return familyThemeIds.some((id) => id === value); }
export function demoCatalog(theme: FamilyThemeId, locale: Locale) {
  const definition = definitions[theme];
  const design = defaultDesign(theme);
  design.hero = { titleAr: definition.title[0], titleEn: definition.title[1], descriptionAr: definition.intro[0], descriptionEn: definition.intro[1] };
  design.familyContent = { [theme]: { kickerAr: "مجموعة مختارة بعناية", kickerEn: "THE CONSIDERED COLLECTION", headingAr: "تفاصيل تُحدث فرقًا", headingEn: "A considered way of living", bodyAr: definition.editorial[0], bodyEn: definition.editorial[1] } };
  const name = themeRegistry[theme].title;
  const products: DemoProduct[] = definition.items.map(([nameAr, nameEn, image, priceMinor, category], index) => ({
    slug: `item-${index + 1}`, nameAr, nameEn, priceMinor, compareAtMinor: index < 3 ? priceMinor + 3000 : null,
    featured: index < 3, available: index !== 3, imageId: null, imageSrc: `/demo-assets/${image}.jpg`,
    images: [`/demo-assets/${image}.jpg`], category: `collection-${category + 1}`, storeName: name, country: "PS", currency: "ILS",
    descriptionAr: `${nameAr} من المجموعة التوضيحية لمتجر ${name}. هذا المنتج وأسعاره للمعاينة فقط، وليس معروضًا للبيع. جرّب الخيارات وإضافته إلى السلة لتتعرف على تجربة متجرك.`,
    descriptionEn: `${nameEn} from the ${name} demonstration collection. This product and its price are illustrative, not for sale. Explore the options and demo cart to experience your future store.`,
    options: [{ name: locale === "ar" ? (theme === "maison-wear" ? "المقاس" : "الخيار") : (theme === "maison-wear" ? "Size" : "Option"), values: theme === "maison-wear" ? ["S", "M", "L"] : locale === "ar" ? ["أساسي", "مجموعة"] : ["Standard", "Set"] }],
  }));
  const categories = definition.categories.map(([nameAr, nameEn], index) => ({ slug: `collection-${index + 1}`, nameAr, nameEn, imageId: null, imageSrc: products.find((p) => p.category === `collection-${index + 1}`)!.imageSrc }));
  return { store: { slug: theme, name, country: "PS", currency: "ILS" as const }, design, products, categories,
    highlights: { products: products.filter((p) => p.featured), categories }, demo: { theme, banner: `/demo-assets/${definition.banner}.jpg` } };
}

export function filterDemoProducts(products: DemoProduct[], filters: CatalogFilters) {
  const query = filters.q.trim().toLocaleLowerCase();
  const matches = products.filter((p) => (!query || `${p.nameAr} ${p.nameEn}`.toLocaleLowerCase().includes(query)) && (!filters.category || p.category === filters.category) && (!filters.availableOnly || p.available));
  if (filters.sort === "price-asc") matches.sort((a, b) => a.priceMinor - b.priceMinor);
  else if (filters.sort === "price-desc") matches.sort((a, b) => b.priceMinor - a.priceMinor);
  else if (filters.sort === "newest") matches.reverse();
  const start = (filters.page - 1) * pageSize;
  return { products: matches.slice(start, start + pageSize), hasNext: matches.length > start + pageSize };
}
