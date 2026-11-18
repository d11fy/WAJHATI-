import type { Locale } from "./i18n";

/**
 * DRAFT legal content for owner and counsel review. It describes only behaviour that exists in this
 * codebase. Every legal fact that cannot be verified from code is an owner-review placeholder
 * `{{ID}}` that renders visibly and is listed in docs/legal/LEGAL_OWNER_REVIEW.md. Nothing here is
 * legal advice, and nothing is approved until `LEGAL_APPROVED=true` is set deliberately.
 */
export const legalVersion = "draft-1";
export const legalUpdated = "2026-11-18";
export const supportEmail = "support@wajhati.store";

export type LegalKind = "privacy" | "terms";
export const legalKinds = ["privacy", "terms"] as const;
export const legalPaths = ["/privacy", "/terms"] as const;

/**
 * Approval needs BOTH the deliberate flag and an unmistakably finished text. While any owner-review placeholder is still in
 * the Arabic or English Terms or Privacy Policy, the pages stay marked as drafts, stay `noindex` and stay out of the sitemap,
 * even if LEGAL_APPROVED is set by mistake. `unresolved` is injectable only so tests can model a finished text.
 */
export function legalApproved(env: Record<string, string | undefined> = process.env, unresolved: number = unresolvedGapCount()) {
  return env.LEGAL_APPROVED === "true" && unresolved === 0;
}

/** Distinct owner-review items still present in any of the four legal documents. */
export function unresolvedGapCount() {
  return new Set(legalKinds.flatMap((kind) => (["ar", "en"] as const).flatMap((locale) => gapsUsed(legalDocs[kind][locale])))).size;
}

type Inline = string;
export type Block = { p: Inline } | { ul: Inline[] } | { table: { head: Inline[]; rows: Inline[][] } };
export type Section = { id: string; heading: string; blocks: Block[] };
export type LegalDoc = { title: string; summary: string; sections: Section[] };

/** Facts the owner must supply. The rendered text shows `ar` / `en` in place of the token. */
export const ownerGaps = {
  "OP-IDENTITY": { topic: "Registered legal name of the operator", ar: "[بانتظار المالك: الاسم القانوني المسجّل للجهة المشغّلة]", en: "[OWNER REVIEW: registered legal name of the operator]" },
  "OP-ADDRESS": { topic: "Registered address and registration number", ar: "[بانتظار المالك: العنوان القانوني ورقم التسجيل]", en: "[OWNER REVIEW: registered address and registration number]" },
  "GOV-LAW": { topic: "Governing law and competent courts", ar: "[بانتظار المالك والمستشار القانوني: القانون الواجب التطبيق والجهة القضائية المختصة]", en: "[OWNER/LEGAL REVIEW: governing law and competent courts]" },
  REFUND: { topic: "Refund and cancellation-of-paid-period policy", ar: "[بانتظار المالك: سياسة الاسترداد وإلغاء الفترة المدفوعة. لا توجد وظيفة استرداد في المنصة حاليًا]", en: "[OWNER REVIEW: refund and paid-period cancellation policy. The platform has no refund function today]" },
  LIABILITY: { topic: "Warranty disclaimer and liability limits", ar: "[بانتظار المستشار القانوني: صياغة إخلاء الضمانات وحدود المسؤولية وفق القانون المعمول به]", en: "[LEGAL REVIEW: warranty disclaimer and liability limits under applicable law]" },
  "AGE-LIMIT": { topic: "Minimum age / eligibility conditions", ar: "[بانتظار المالك: الحد الأدنى للعمر وشروط الأهلية]", en: "[OWNER REVIEW: minimum age and eligibility conditions]" },
  ROLES: { topic: "Legal characterisation of WAJHATI and merchants under data protection law", ar: "[بانتظار المستشار القانوني: التوصيف القانوني لدور واجهتي والتاجر بموجب قوانين حماية البيانات]", en: "[LEGAL REVIEW: legal characterisation of WAJHATI and merchants under data protection law]" },
  "HOSTING-REGION": { topic: "Hosting provider and data location", ar: "[بانتظار المالك: مزوّد الاستضافة وموقع معالجة البيانات. الاستضافة لم تُحدَّد بعد]", en: "[OWNER REVIEW: hosting provider and data location. Hosting is not yet decided]" },
  "STORAGE-PROVIDER": { topic: "Object storage and backup storage providers", ar: "[بانتظار المالك: مزوّد تخزين الملفات والنسخ الاحتياطية]", en: "[OWNER REVIEW: object storage and backup storage providers]" },
  "SMTP-PROVIDER": { topic: "Outbound email relay provider", ar: "[بانتظار المالك: مزوّد إرسال البريد]", en: "[OWNER REVIEW: outbound email relay provider]" },
  "RETENTION-ACCOUNT": { topic: "Account and store deletion on request", ar: "[بانتظار المالك: إجراء ومدة حذف الحساب والمتجر عند الطلب. لا يوجد حذف ذاتي في المنتج حاليًا]", en: "[OWNER REVIEW: procedure and timing for deleting an account or store on request. The product has no self-service deletion today]" },
  "RETENTION-AUDIT": { topic: "Retention period for billing and audit records", ar: "[بانتظار المالك: مدة الاحتفاظ بسجلات الفوترة والتدقيق. لا توجد مدة حذف تلقائية حاليًا]", en: "[OWNER REVIEW: retention period for billing and audit records. No automatic deletion period exists today]" },
  "RETENTION-BACKUP": { topic: "Backup retention period", ar: "[بانتظار المالك: مدة الاحتفاظ بالنسخ الاحتياطية خارج الخادم]", en: "[OWNER REVIEW: off-server backup retention period]" },
  "RESPONSE-TIME": { topic: "Response time for privacy requests", ar: "[بانتظار المالك: مدة الرد على طلبات الخصوصية]", en: "[OWNER REVIEW: response time for privacy requests]" },
  "EXPIRY-VISIBILITY": { topic: "Public availability of a store after expiry", ar: "[بانتظار المالك: أثر انتهاء الاشتراك على ظهور المتجر للعامة]", en: "[OWNER REVIEW: effect of expiry on a store's public availability]" },
  "PAYMENT-METHODS": { topic: "Accepted payment methods and currencies for subscriptions", ar: "[بانتظار المالك: وسائل الدفع والعملات المقبولة للاشتراكات]", en: "[OWNER REVIEW: accepted payment methods and currencies for subscriptions]" },
  "SUPPORT-HOURS": { topic: "Support hours and response targets", ar: "[بانتظار المالك: ساعات الدعم ومدة الاستجابة]", en: "[OWNER REVIEW: support hours and response targets]" },
  UPTIME: { topic: "Availability commitment (if any)", ar: "[بانتظار المالك: أي التزام بالإتاحة]", en: "[OWNER REVIEW: any availability commitment]" },
  TAX: { topic: "Taxes and VAT treatment of subscription prices", ar: "[بانتظار المالك: المعالجة الضريبية لأسعار الاشتراكات]", en: "[OWNER REVIEW: tax and VAT treatment of subscription prices]" },
  "ACCESS-LOGS": { topic: "Web server and proxy access logs kept by the hosting stack", ar: "[بانتظار المالك: سجلات الوصول لدى الاستضافة ومدة حفظها]", en: "[OWNER REVIEW: access logs kept by the hosting stack and how long]" },
} as const satisfies Record<string, { topic: string; ar: string; en: string }>;
export type GapId = keyof typeof ownerGaps;

/** Replace `{{VALUE}}` tokens. Known values are substituted, owner gaps are returned as marked parts. */
export type Part = string | { gap: GapId; label: string } | { value: string; text: string };
export function parts(text: string, locale: Locale, values: Record<string, string>): Part[] {
  return text.split(/(\{\{[A-Z0-9-]+\}\})/).filter(Boolean).map((piece) => {
    const match = /^\{\{([A-Z0-9-]+)\}\}$/.exec(piece);
    if (!match) return piece;
    const key = match[1];
    if (key in values) return { value: key, text: values[key] };
    if (key in ownerGaps) return { gap: key as GapId, label: ownerGaps[key as GapId][locale] };
    throw new Error(`Unknown legal token ${key}`);
  });
}

function collect(doc: LegalDoc) {
  const texts: string[] = [doc.summary];
  for (const section of doc.sections) {
    texts.push(section.heading);
    for (const block of section.blocks) {
      if ("p" in block) texts.push(block.p);
      else if ("ul" in block) texts.push(...block.ul);
      else texts.push(...block.table.head, ...block.table.rows.flat());
    }
  }
  return texts;
}

export function gapsUsed(doc: LegalDoc) {
  return [...new Set(collect(doc).flatMap((text) => [...text.matchAll(/\{\{([A-Z0-9-]+)\}\}/g)].map((match) => match[1]).filter((key) => key in ownerGaps)))] as GapId[];
}

const p = (text: string): Block => ({ p: text });
const ul = (...items: string[]): Block => ({ ul: items });
const table = (head: string[], ...rows: string[][]): Block => ({ table: { head, rows } });

const privacyAr: LegalDoc = {
  title: "سياسة الخصوصية",
  summary: "توضّح هذه السياسة المعلومات التي تعالجها منصة واجهتي (wajhati.store)، ولماذا، ومن يصل إليها، ومدة بقائها، وكيف تتواصل معنا بشأنها.",
  sections: [
    { id: "operator", heading: "١. من نحن", blocks: [
      p("واجهتي | WAJHATI منصة لإنشاء المتاجر الإلكترونية تشغّلها {{OP-IDENTITY}}، {{OP-ADDRESS}}."),
      p("للتواصل بشأن الخصوصية: {{EMAIL}} أو واتساب الرسمي {{WHATSAPP}}."),
    ] },
    { id: "roles", heading: "٢. أدوارنا وأدوار التجّار", blocks: [
      p("تقدّم واجهتي الأداة التي يبني بها التاجر متجره. يدير كل تاجر متجره بنفسه: يقرّر منتجاته وأسعاره وقنوات التواصل التي يعرضها، ويتواصل مع عملائه مباشرة عبر واتساب أو إنستغرام."),
      p("نحن نعالج بيانات الحساب والمتجر لتشغيل المنصة. أما ما يتبادله العميل مع التاجر في محادثة واتساب أو إنستغرام فيجري خارج واجهتي، وللتاجر مسؤولية التعامل معه وفق القوانين المعمول بها في سوقه."),
      p("التوصيف القانوني لدور كل طرف بموجب قوانين حماية البيانات: {{ROLES}}."),
    ] },
    { id: "collect", heading: "٣. المعلومات التي نجمعها", blocks: [
      table(["الفئة", "ما يُحفظ فعليًا", "لماذا"],
        ["حساب التاجر", "الاسم، البريد الإلكتروني، كلمة المرور على هيئة بصمة أحادية الاتجاه (لا تُحفظ كلمة المرور نفسها)، تاريخ الإنشاء، حالة توثيق البريد", "إنشاء الحساب وتسجيل الدخول والتواصل الضروري"],
        ["الجلسات والأمان", "بصمة رمز الجلسة وتاريخ انتهائها، عدّادات تقييد المحاولات مبنية على بصمة البريد أو عنوان IP (عند ضبط ترويسة موثوقة)، رموز التوثيق واستعادة كلمة المرور، سجل تغيير البريد، وللمشغّلين: بذرة المصادقة الثنائية مشفّرة", "حماية الحسابات ومنع إساءة الاستخدام"],
        ["المتجر والمحتوى", "اسم المتجر والرابط والبلد والعملة، عضوية المتجر، المنتجات والتصنيفات والأسعار والخيارات، صور المنتجات، تصميم المتجر وشعاره وأيقونته وبنره، ورقم واتساب أو حساب إنستغرام الخاص بنشاط المتجر الذي يعرضه التاجر للزوّار", "تشغيل المتجر وعرضه للعامة"],
        ["نوايا الطلب", "رقم مرجعي، القناة (واتساب أو إنستغرام)، الحالة، العملة والإجمالي واللغة، ونسخة من بنود السلة (اسم المنتج والخيارات والكمية وسعر الوحدة). لا نطلب ولا نحفظ اسم العميل أو هاتفه أو عنوانه أو بيانات دفعه في سجل الطلب", "تمكين التاجر من متابعة طلبات المحادثة وتأكيدها يدويًا"],
        ["الاشتراكات والفوترة", "الخطة وفترات التجربة والاشتراك، وسجلات التفعيل اليدوي (المتجر والخطة والمدة والمبلغ والمرجع والملاحظة التي يدخلها المشرف ومن اعتمدها)، وسجلات التدقيق. وإن استُخدم مسار رفع إثبات الدفع القديم فتُحفظ ملفات الإثبات مشفّرة", "إدارة الاشتراكات وحماية السجل المالي"],
        ["البريد والإشعارات", "عنوان المستلم ونوع الرسالة وأوقات الإرسال والمحاولات، دون حفظ كلمات المرور", "رسائل التوثيق والاستعادة والتجربة والاشتراك"],
        ["سجلات الإدارة", "من نفّذ إجراءً حساسًا ومتى وعلى أي سجل، في سلسلة تدقيق مترابطة", "الأمان والمساءلة"],
        ["سجلات تقنية", "رموز أحداث تشغيلية مهيكلة دون كلمات مرور أو مفاتيح. وسجلات الوصول لدى طبقة الاستضافة: {{ACCESS-LOGS}}", "التشغيل واكتشاف الأعطال"],
      ),
    ] },
    { id: "visitors", heading: "٤. زوّار المتاجر وعملاؤها", blocks: [
      p("لا يحتاج زائر المتجر إلى حساب. تُحفظ سلة التسوق في متصفحه على جهازه، ولا تصل إلينا إلا عند طلب تجهيز الطلب، فيُعاد حساب الأسعار على الخادم ويُسجَّل سجل نية الطلب الموضّح أعلاه."),
      p("نضع في متصفح الزائر ملف تعريف عشوائيًا (انظر ملفات تعريف الارتباط) لحماية طلبات السلة من التكرار والإساءة. لا نستخدمه للإعلانات."),
    ] },
    { id: "handoff", heading: "٥. التحويل إلى واتساب وإنستغرام", blocks: [
      p("عند اختيار الزائر واتساب أو إنستغرام، يُفتح التطبيق برسالة جاهزة تلخّص السلة. من تلك اللحظة تجري المحادثة داخل تلك الخدمة وتخضع لشروطها وسياساتها، ويستلمها التاجر مباشرة. لا تصلنا هذه المحادثة ولا رقم الزائر أو حسابه."),
      p("فتح الرابط لا يعني دفعًا ولا بيعًا. يؤكد التاجر الطلب يدويًا بنفسه، ولا تتحصّل واجهتي مدفوعات عملاء المتاجر."),
    ] },
    { id: "use", heading: "٦. كيف نستخدم المعلومات", blocks: [
      ul("تشغيل الحسابات والمتاجر وعرضها وإدارة الاشتراكات.", "حماية المنصة: تقييد المحاولات والتحقق الثنائي للمشغّلين وسجلات التدقيق.", "إرسال رسائل ضرورية: توثيق البريد واستعادة كلمة المرور وبدء التجربة وتفعيل الاشتراك وانتهائه.", "الدعم الفني والرد على طلباتك.", "الالتزام بالواجبات القانونية عند وجودها."),
      p("لا تتضمن المنصة أدوات إعلانية أو تتبعًا من أطراف ثالثة، ولا ميزة لبيع المعلومات الشخصية."),
    ] },
    { id: "cookies", heading: "٧. ملفات تعريف الارتباط والتخزين المحلي", blocks: [
      table(["الاسم", "الغرض", "المدة"],
        ["dar_session (يسبقه __Host- في الإنتاج)", "إبقاء التاجر مسجّلًا للدخول. HttpOnly وSameSite=Lax وSecure عبر HTTPS", "حتى 7 أيام أو تسجيل الخروج"],
        ["dar_visitor (يسبقه __Host- في الإنتاج)", "ملف عشوائي لحماية طلبات السلة من التكرار والإساءة", "7 أيام"],
        ["تخزين المتصفح المحلي للسلة", "حفظ سلة الزائر على جهازه", "حتى يمسحها الزائر أو تتم المعالجة"],
        ["تخزين الجلسة لمعرّف الطلب", "منع تكرار نية الطلب من الجهاز نفسه", "حتى إغلاق التبويب"],
      ),
      p("لا نستخدم ملفات تعريف ارتباط للتحليلات أو الإعلانات. الخطوط تُقدَّم من خوادمنا لا من خدمات خارجية."),
    ] },
    { id: "recipients", heading: "٨. من يستلم المعلومات وأين تُعالج", blocks: [
      ul("مزوّد الاستضافة وقاعدة البيانات: {{HOSTING-REGION}}.", "مزوّد تخزين الملفات والنسخ الاحتياطية المشفّرة: {{STORAGE-PROVIDER}}.", "مزوّد إرسال البريد: {{SMTP-PROVIDER}}.", "موظفو المنصة المخوّلون بأدوار محدّدة، مع التحقق الثنائي للإجراءات الحساسة.", "واتساب وإنستغرام عندما يختار الزائر أو التاجر استخدامهما، بحسب شروطهما.", "جهات رسمية عند وجود إلزام قانوني."),
      p("قد تتضمن المعالجة نقل البيانات عبر الحدود بحسب مواقع هذه الجهات. لا نَعِد بإقامة البيانات في بلد بعينه ما لم يُذكر ذلك صراحةً هنا."),
    ] },
    { id: "security", heading: "٩. حماية المعلومات", blocks: [
      ul("عزل بيانات كل متجر عن الآخر في قاعدة البيانات بسياسات أمان على مستوى الصفوف وأدوار محدودة الصلاحيات.", "كلمات المرور تُحفظ بصمات أحادية الاتجاه، ورموز الجلسات تُحفظ بصمات لا رموزًا.", "بيانات اعتماد البريد وبذور المصادقة الثنائية وأصول إثباتات الدفع تُحفظ مشفّرة.", "تقييد المحاولات على الدخول والتسجيل وطلبات السلة.", "التحقق الثنائي لحسابات المشغّلين وسجل تدقيق للإجراءات الحساسة.", "نسخ احتياطية مشفّرة بـAES-256-GCM.", "الاتصال عبر HTTPS في بيئة الإنتاج."),
      p("لا توجد وسيلة حماية مطلقة، ونعمل على تحسين هذه الإجراءات باستمرار."),
    ] },
    { id: "retention", heading: "١٠. مدة الاحتفاظ والحذف", blocks: [
      p("نذكر هنا ما تنفّذه المنصة فعليًا، ولا نَعِد بحذف فوري ودائم لكل شيء."),
      table(["البيانات", "ما يحدث"],
        ["جلسات الدخول", "تنتهي بعد 7 أيام أو عند الخروج. وتُلغى كل الجلسات عند إعادة تعيين كلمة المرور أو إتمام تغيير البريد"],
        ["عدّادات تقييد المحاولات", "15 دقيقة، وتُحفظ بصمات"],
        ["روابط التوثيق والاستعادة", "24 ساعة لتوثيق البريد، و20 دقيقة للاستعادة والتسجيل وتأكيد تغيير البريد"],
        ["نوايا الطلب", "تُحذف غير المؤكدة بعد 90 يومًا والمؤكدة من التاجر بعد 365 يومًا، بمهمة يومية"],
        ["سجلات البريد التشغيلي", "تُحذف بعد 90 يومًا من الإرسال أو الفشل"],
        ["إثباتات الدفع القديمة", "تُحذف بعد 180 يومًا من المراجعة"],
        ["الصور المحذوفة", "يُلغى الوصول إليها فورًا ويُحذف الملف بمهمة تنظيف في الخلفية"],
        ["بيانات الحساب والمتجر", "تبقى ما دام الحساب أو المتجر قائمًا. لا يحذف انتهاء الاشتراك بيانات المتجر تلقائيًا. الحذف عند الطلب يتم يدويًا: {{RETENTION-ACCOUNT}}"],
        ["سجلات الفوترة والتدقيق", "تُحفظ للحفاظ على السجل المالي والأمني ولا توجد مدة حذف تلقائية: {{RETENTION-AUDIT}}"],
        ["النسخ الاحتياطية", "مشفّرة. نسخ الخادم المحلية تُحفظ 7 أيام، والاحتفاظ خارج الخادم: {{RETENTION-BACKUP}}. قد تبقى البيانات المحذوفة في نسخ قديمة إلى أن تنتهي صلاحيتها"],
      ),
    ] },
    { id: "rights", heading: "١١. طلباتك بشأن بياناتك", blocks: [
      p("يمكنك طلب الاطلاع على بياناتك أو تصحيحها أو حذفها أو الاعتراض على معالجتها بمراسلتنا على {{EMAIL}}. قد نطلب التحقق من هويتك من البريد المسجّل. لا توفّر المنصة حاليًا حذفًا ذاتيًا للحساب ولا تصديرًا ذاتيًا للبيانات، وتُعالج الطلبات يدويًا. مدة الرد: {{RESPONSE-TIME}}."),
      p("إن كنت عميلًا لمتجر، فتواصل أولًا مع التاجر بشأن محادثاتك معه. ويمكنك مراسلتنا بشأن ما تعالجه المنصة."),
    ] },
    { id: "age", heading: "١٢. الفئة العمرية", blocks: [p("المنصة موجّهة للتجّار البالغين. الحد الأدنى للعمر: {{AGE-LIMIT}}.")] },
    { id: "changes", heading: "١٣. تحديث السياسة", blocks: [p("قد نحدّث هذه السياسة، وسيظهر تاريخ آخر تحديث أعلى الصفحة. نخطر أصحاب الحسابات بالتغييرات الجوهرية عبر المنصة أو البريد.")] },
    { id: "contact", heading: "١٤. التواصل", blocks: [p("البريد: {{EMAIL}} · واتساب الرسمي: {{WHATSAPP}} · الموقع: wajhati.store")] },
  ],
};

const privacyEn: LegalDoc = {
  title: "Privacy Policy",
  summary: "This policy explains what information the WAJHATI platform (wajhati.store) processes, why, who can access it, how long it is kept, and how to contact us about it.",
  sections: [
    { id: "operator", heading: "1. Who we are", blocks: [
      p("WAJHATI | واجهتي is a platform for creating online stores, operated by {{OP-IDENTITY}}, {{OP-ADDRESS}}."),
      p("Privacy contact: {{EMAIL}} or the official WhatsApp {{WHATSAPP}}."),
    ] },
    { id: "roles", heading: "2. Our role and merchants' roles", blocks: [
      p("WAJHATI provides the tool a merchant uses to build a store. Each merchant runs their own store: they decide their products, prices and the contact channels they show, and they talk to their customers directly on WhatsApp or Instagram."),
      p("We process account and store data to run the platform. What a customer and a merchant exchange in a WhatsApp or Instagram conversation happens outside WAJHATI, and the merchant is responsible for handling it under the laws that apply in their market."),
      p("The legal characterisation of each party's role under data protection law: {{ROLES}}."),
    ] },
    { id: "collect", heading: "3. Information we collect", blocks: [
      table(["Category", "What is actually stored", "Why"],
        ["Merchant account", "Name, email address, password as a one-way hash (the password itself is never stored), creation date, email verification status", "Creating the account, signing in, necessary communication"],
        ["Sessions and security", "Digest of the session token and its expiry, attempt counters keyed by a digest of the email or IP address (the IP only when a trusted proxy header is configured), verification and password-reset tokens, email-change records, and for operators an encrypted authenticator seed", "Protecting accounts and preventing abuse"],
        ["Store and content", "Store name, link, country and currency, store membership, products, categories, prices, options, product images, the store design with logo, icon and banner, and the business WhatsApp number or Instagram handle the merchant chooses to show visitors", "Running and publicly showing the store"],
        ["Order intents", "A reference number, channel (WhatsApp or Instagram), status, currency, total, language, and a copy of the cart lines (product name, options, quantity, unit price). We do not ask for or store the customer's name, phone, address or payment details in the order record", "Letting the merchant follow and manually confirm chat orders"],
        ["Subscriptions and billing", "Plan, trial and subscription periods, manual activation records (store, plan, duration, amount, reference and note entered by an administrator, and who approved it), and audit records. If the older payment-proof upload path was used, proof files are stored encrypted", "Managing subscriptions and protecting the financial record"],
        ["Email and notifications", "Recipient address, message type, send times and attempts. Passwords are never stored", "Verification, recovery, trial and subscription messages"],
        ["Administrative records", "Who performed a sensitive action, when, and on which record, in a hash-chained audit trail", "Security and accountability"],
        ["Technical logs", "Structured operational event codes without passwords or keys. Access logs kept by the hosting layer: {{ACCESS-LOGS}}", "Operating the service and detecting faults"],
      ),
    ] },
    { id: "visitors", heading: "4. Store visitors and customers", blocks: [
      p("A store visitor does not need an account. The shopping cart is kept in their browser on their device, and reaches us only when they ask to prepare an order, at which point prices are recomputed on the server and the order-intent record described above is created."),
      p("We place a random identifier in the visitor's browser (see Cookies) to protect cart requests from repetition and abuse. We do not use it for advertising."),
    ] },
    { id: "handoff", heading: "5. Handoff to WhatsApp and Instagram", blocks: [
      p("When a visitor chooses WhatsApp or Instagram, that app opens with a prepared message summarising the cart. From then on the conversation takes place inside that service, under its terms and policies, and is received by the merchant directly. We do not receive the conversation, or the visitor's number or account."),
      p("Opening the link is not a payment and not a sale. The merchant confirms the order manually, and WAJHATI does not collect payments from store customers."),
    ] },
    { id: "use", heading: "6. How we use information", blocks: [
      ul("Operating accounts and stores, displaying them, and managing subscriptions.", "Protecting the platform: attempt limits, two-factor verification for operators and audit trails.", "Sending necessary messages: email verification, password recovery, trial start, subscription activation and expiry.", "Support and replying to your requests.", "Meeting legal obligations where they exist."),
      p("The platform contains no advertising or third-party tracking integrations and no feature that sells personal information."),
    ] },
    { id: "cookies", heading: "7. Cookies and local storage", blocks: [
      table(["Name", "Purpose", "Duration"],
        ["dar_session (prefixed __Host- in production)", "Keeps the merchant signed in. HttpOnly, SameSite=Lax and Secure over HTTPS", "Up to 7 days or until sign-out"],
        ["dar_visitor (prefixed __Host- in production)", "Random identifier protecting cart requests from repetition and abuse", "7 days"],
        ["Browser local storage for the cart", "Keeps the visitor's cart on their device", "Until the visitor clears it or the order is handled"],
        ["Session storage for the order identifier", "Prevents duplicate order intents from the same device", "Until the tab is closed"],
      ),
      p("We do not use cookies for analytics or advertising. Fonts are served from our own servers, not external services."),
    ] },
    { id: "recipients", heading: "8. Who receives information and where it is processed", blocks: [
      ul("Hosting and database provider: {{HOSTING-REGION}}.", "Object storage and encrypted backup storage provider: {{STORAGE-PROVIDER}}.", "Email relay provider: {{SMTP-PROVIDER}}.", "Authorised platform staff with defined roles, with two-factor verification for sensitive actions.", "WhatsApp and Instagram when a visitor or merchant chooses to use them, under their own terms.", "Public authorities when legally required."),
      p("Processing may involve transfers across borders depending on where these providers operate. We do not promise that data stays in any particular country unless this page says so explicitly."),
    ] },
    { id: "security", heading: "9. How we protect information", blocks: [
      ul("Each store's data is separated from other stores in the database through row-level security policies and limited-privilege roles.", "Passwords are stored as one-way hashes, and session tokens are stored as digests rather than tokens.", "Email credentials, authenticator seeds and payment-proof originals are stored encrypted.", "Attempt limits on sign-in, registration and cart requests.", "Two-factor verification for operator accounts and an audit trail for sensitive actions.", "Backups encrypted with AES-256-GCM.", "HTTPS for connections in the production environment."),
      p("No protection is absolute, and we keep improving these measures."),
    ] },
    { id: "retention", heading: "10. Retention and deletion", blocks: [
      p("This lists what the platform actually does. We do not promise immediate permanent deletion of everything."),
      table(["Data", "What happens"],
        ["Sign-in sessions", "End after 7 days or on sign-out. All sessions are revoked on password reset or completed email change"],
        ["Attempt counters", "15 minutes, stored as digests"],
        ["Verification and recovery links", "24 hours for email verification, 20 minutes for recovery, sign-up and email-change confirmation"],
        ["Order intents", "Unconfirmed ones are deleted after 90 days and merchant-confirmed ones after 365 days, by a daily job"],
        ["Operational email records", "Deleted 90 days after being sent or failing"],
        ["Older payment proofs", "Deleted 180 days after review"],
        ["Removed images", "Access is revoked immediately and the file is deleted by a background cleanup job"],
        ["Account and store data", "Kept while the account or store exists. Subscription expiry does not delete store data automatically. Deletion on request is handled manually: {{RETENTION-ACCOUNT}}"],
        ["Billing and audit records", "Kept to preserve the financial and security record, with no automatic deletion period: {{RETENTION-AUDIT}}"],
        ["Backups", "Encrypted. Local server copies are kept 7 days and off-server retention is {{RETENTION-BACKUP}}. Deleted data may remain in older backups until they expire"],
      ),
    ] },
    { id: "rights", heading: "11. Your requests about your data", blocks: [
      p("You can ask to see, correct or delete your data, or object to its processing, by writing to {{EMAIL}}. We may ask you to verify your identity from the registered email. The platform does not currently offer self-service account deletion or data export, so requests are handled manually. Response time: {{RESPONSE-TIME}}."),
      p("If you are a store's customer, contact the merchant first about your conversations with them. You can write to us about what the platform processes."),
    ] },
    { id: "age", heading: "12. Age", blocks: [p("The platform is intended for adult merchants. Minimum age: {{AGE-LIMIT}}.")] },
    { id: "changes", heading: "13. Changes to this policy", blocks: [p("We may update this policy, and the last-updated date at the top of the page will change. We will notify account holders of material changes through the platform or by email.")] },
    { id: "contact", heading: "14. Contact", blocks: [p("Email: {{EMAIL}} · Official WhatsApp: {{WHATSAPP}} · Website: wajhati.store")] },
  ],
};

const termsAr: LegalDoc = {
  title: "شروط الخدمة",
  summary: "تحكم هذه الشروط استخدامك لمنصة واجهتي لإنشاء المتاجر الإلكترونية. باستخدامك المنصة أو إنشاء حساب فيها فإنك تقرّ بقراءتها.",
  sections: [
    { id: "service", heading: "١. وصف الخدمة", blocks: [
      p("واجهتي | WAJHATI خدمة برمجية تتيح للتاجر إنشاء متجر إلكتروني وإدارة منتجاته وتصميمه ونشره. يستقبل العملاء طلباتهم عبر واتساب أو إنستغرام الخاصين بالتاجر."),
      p("تشغّل المنصة {{OP-IDENTITY}}، {{OP-ADDRESS}}."),
    ] },
    { id: "accounts", heading: "٢. الأهلية والحساب", blocks: [
      ul("يجب أن تكون مؤهلًا قانونيًا للتعاقد. الحد الأدنى للعمر وشروط الأهلية: {{AGE-LIMIT}}.", "تقدّم معلومات صحيحة ومحدّثة، وتوثّق بريدك الإلكتروني.", "قد تكون خدمة التسجيل العام مغلقة في وقت معيّن، ولا نضمن توفر التسجيل."),
    ] },
    { id: "security", heading: "٣. أمان الحساب", blocks: [
      p("أنت مسؤول عن سرية كلمة المرور (12 حرفًا على الأقل) وعن النشاط الذي يجري عبر حسابك. أخطرنا فورًا عند الاشتباه باستخدام غير مصرّح به عبر {{EMAIL}}.")] },
    { id: "merchant", heading: "٤. مسؤوليات التاجر", blocks: [
      ul("أنت وحدك مسؤول عن محتوى متجرك ومنتجاته وأسعارك وأوصافك وصورك ومشروعية ما تبيعه في السوق الذي تعمل فيه.", "تلتزم بالقوانين المعمول بها، ومنها حماية المستهلك والتراخيص والضرائب، وبحقوق الملكية الفكرية للغير.", "تتعامل مع عملائك وتنفّذ الطلبات وتتسلّم المدفوعات وتصدر الفواتير بنفسك خارج واجهتي.", "تتولى مسؤولية ما تجمعه من عملائك في محادثاتك معهم."),
    ] },
    { id: "orders", heading: "٥. طلبات عملاء المتجر", blocks: [
      p("لا تتضمن واجهتي بوابة دفع لعملاء المتاجر. يختار العميل واتساب أو إنستغرام فيُفتح التطبيق برسالة تلخّص السلة ويُسجَّل سجل نية طلب. فتح الرابط ليس دليل دفع ولا بيعًا ولا إتمام طلب. يؤكّد التاجر الطلب يدويًا ويتحمّل مسؤولية الاتفاق مع العميل. واجهتي ليست طرفًا في البيع بين التاجر وعميله."),
    ] },
    { id: "use", heading: "٦. الاستخدام المقبول", blocks: [
      p("يُمنع استخدام المنصة في:"),
      ul("بيع سلع أو خدمات غير مشروعة أو محتوى ينتهك حقوق الآخرين.", "الاحتيال أو انتحال الهوية أو التضليل.", "محاولة اختراق المنصة أو تجاوز حدود الصلاحيات أو عزل المتاجر أو الأعباء المفرطة على الخدمة.", "رفع ملفات ضارة أو محتوى مسيء.", "إعادة بيع الخدمة أو استخدامها لبناء خدمة منافسة دون إذن."),
    ] },
    { id: "ip", heading: "٧. الملكية الفكرية وحقوق الاستخدام", blocks: [
      p("تبقى ملكية محتواك لك. تمنحنا ترخيصًا محدودًا لاستضافته وعرضه وتخزينه ومعالجته لغرض تشغيل متجرك فقط."),
      p("تبقى المنصة والثيمات وتصاميمها وعلامة واجهتي ملكًا لأصحابها. نمنحك حق استخدام الثيمات المتاحة لك داخل متجرك طوال استحقاقك لها، دون حق إعادة توزيعها أو بيعها أو نسخها خارج المنصة."),
    ] },
    { id: "plans", heading: "٨. الخطط", blocks: [
      p("تُعرض خطتان علنًا: Starter وPro، بدورتين علنيتين: شهري وسنوي. تظهر المزايا والحدود (مثل عدد المنتجات ومساحة التخزين وأنواع الثيمات) والأسعار حسب السوق والعملة في صفحة الباقات، وقد تتغير. {{TAX}}."),
    ] },
    { id: "trial", heading: "٩. الفترة التجريبية", blocks: [
      p("تحصل الحسابات المؤهلة على تجربة مجانية مدتها 72 ساعة (3 أيام) واحدة لكل حساب، وتُربط بأول متجر مؤهل في الحساب. إنشاء متاجر إضافية لا يعيد التجربة ولا يمدّدها. لا تمنح التجربة أكثر مما يظهر لمتجرك في صفحة الفوترة."),
    ] },
    { id: "activation", heading: "١٠. الاشتراك والتفعيل اليدوي", blocks: [
      ul("للاشتراك أو التجديد، تتواصل مع واجهتي عبر واتساب الرسمي {{WHATSAPP}} وتحدد المتجر والخطة والمدة.", "الدفع للاشتراك يجري خارج المنصة بالوسائل التي نتفق عليها: {{PAYMENT-METHODS}}.", "بعد تأكيد الدفعة يفعّل مشرف مخوّل الاشتراك لمتجر واحد تحدده، لمدة 1 أو 3 أو 6 أو 12 شهرًا. لا يفعّل الضغط على رابط واتساب أي اشتراك.", "يغطي الاشتراك الواحد متجرًا واحدًا فقط. المتاجر الأخرى تحتاج اشتراكاتها.", "التجديد يدوي ولا يوجد تجديد تلقائي ولا خصم تلقائي. يبدأ التجديد بعد انتهاء الفترة الحالية أو يُضاف إلى نهايتها إن كانت سارية.", "تُحتسب التواريخ بالتوقيت العالمي المنسّق UTC وبالأشهر التقويمية."),
    ] },
    { id: "fees", heading: "١١. الرسوم والاسترداد والإلغاء", blocks: [
      p("{{REFUND}}"),
      p("لا يوجد تجديد تلقائي، ويمكنك التوقف عن التجديد في أي وقت. لا تحذف المنصة بيانات متجرك تلقائيًا بانتهاء الاشتراك."),
    ] },
    { id: "expiry", heading: "١٢. الانتهاء والتعليق والإنهاء", blocks: [
      ul("عند انتهاء التجربة أو الفترة المدفوعة تتغير صلاحيات المتجر بحسب حالة الفوترة المعروضة في لوحة الفوترة، وقد تُتاح مهلة تجديد إن ظهرت هناك. أثر ذلك على ظهور المتجر للعامة: {{EXPIRY-VISIBILITY}}.", "يجوز لنا تعليق متجر أو حساب أو إنهاؤه عند مخالفة هذه الشروط أو لأسباب أمنية أو قانونية. يزيل التعليق ظهور المتجر للعامة ويوقف النشر والطلبات، ولا يغيّر محتواه ولا سجلاته المالية.", "يمكنك طلب إغلاق حسابك عبر الدعم. تُعالج بياناتك وفق سياسة الخصوصية."),
    ] },
    { id: "availability", heading: "١٣. الإتاحة والدعم", blocks: [
      p("نبذل جهدًا معقولًا لإبقاء الخدمة متاحة لكن قد تتوقف لأعمال صيانة أو أعطال. التزام الإتاحة: {{UPTIME}}. الدعم عبر {{EMAIL}} وواتساب الرسمي {{WHATSAPP}}. ساعات الدعم: {{SUPPORT-HOURS}}."),
    ] },
    { id: "data", heading: "١٤. البيانات والخصوصية", blocks: [p("تُوضّح سياسة الخصوصية كيف نعالج البيانات. ولا تُغني هذه الشروط عنها.")] },
    { id: "third", heading: "١٥. خدمات الأطراف الثالثة", blocks: [p("تعتمد بعض الميزات على خدمات خارجية مثل واتساب وإنستغرام وخدمة البريد. تخضع هذه الخدمات لشروط مزوّديها ولا نتحكم في توفرها.")] },
    { id: "liability", heading: "١٦. إخلاء الضمانات والمسؤولية", blocks: [
      p("تُقدَّم الخدمة بحالتها المتاحة. {{LIABILITY}}"),
    ] },
    { id: "law", heading: "١٧. القانون الواجب التطبيق وتسوية النزاعات", blocks: [p("{{GOV-LAW}}")] },
    { id: "changes", heading: "١٨. تعديل الشروط", blocks: [p("قد نعدّل هذه الشروط، وسيظهر تاريخ آخر تحديث أعلى الصفحة. نخطر أصحاب الحسابات بالتغييرات الجوهرية. استمرارك في الاستخدام بعد سريان التعديل قبولٌ له.")] },
    { id: "contact", heading: "١٩. التواصل", blocks: [p("البريد: {{EMAIL}} · واتساب الرسمي: {{WHATSAPP}} · الموقع: wajhati.store")] },
  ],
};

const termsEn: LegalDoc = {
  title: "Terms of Service",
  summary: "These terms govern your use of the WAJHATI platform for creating online stores. By using the platform or creating an account you confirm that you have read them.",
  sections: [
    { id: "service", heading: "1. The service", blocks: [
      p("WAJHATI | واجهتي is a software service that lets a merchant create an online store and manage its products, design and publication. Customers send their orders through the merchant's own WhatsApp or Instagram."),
      p("The platform is operated by {{OP-IDENTITY}}, {{OP-ADDRESS}}."),
    ] },
    { id: "accounts", heading: "2. Eligibility and accounts", blocks: [
      ul("You must be legally able to enter a contract. Minimum age and eligibility conditions: {{AGE-LIMIT}}.", "You provide accurate, current information and verify your email address.", "Public registration may be closed at any time and we do not guarantee that registration is available."),
    ] },
    { id: "security", heading: "3. Account security", blocks: [
      p("You are responsible for keeping your password confidential (at least 12 characters) and for activity under your account. Tell us immediately at {{EMAIL}} if you suspect unauthorised use.")] },
    { id: "merchant", heading: "4. Merchant responsibilities", blocks: [
      ul("You alone are responsible for your store's content, products, prices, descriptions, images and the legality of what you sell in your market.", "You comply with applicable laws, including consumer protection, licensing and tax, and with others' intellectual property rights.", "You deal with your customers, fulfil orders, collect payments and issue invoices yourself, outside WAJHATI.", "You are responsible for what you collect from customers in your conversations with them."),
    ] },
    { id: "orders", heading: "5. Orders from store customers", blocks: [
      p("WAJHATI has no payment gateway for store customers. The customer chooses WhatsApp or Instagram, the app opens with a message summarising the cart, and an order-intent record is created. Opening the link is not proof of payment, a sale, or a completed order. The merchant confirms the order manually and is responsible for the arrangement with the customer. WAJHATI is not a party to the sale between a merchant and their customer."),
    ] },
    { id: "use", heading: "6. Acceptable use", blocks: [
      p("You must not use the platform to:"),
      ul("Sell unlawful goods or services, or post content that infringes others' rights.", "Commit fraud, impersonate others, or mislead.", "Attempt to breach the platform, exceed permission boundaries, bypass store isolation, or place excessive load on the service.", "Upload harmful files or abusive content.", "Resell the service or use it to build a competing service without permission."),
    ] },
    { id: "ip", heading: "7. Intellectual property and usage rights", blocks: [
      p("Your content remains yours. You grant us a limited licence to host, display, store and process it solely to run your store."),
      p("The platform, themes, their designs and the WAJHATI mark remain the property of their owners. We grant you the right to use the themes available to you inside your store for as long as you are entitled to them, without the right to redistribute, sell or copy them outside the platform."),
    ] },
    { id: "plans", heading: "8. Plans", blocks: [
      p("Two plans are shown publicly: Starter and Pro, with two public billing intervals: Monthly and Yearly. Features and limits (such as product count, storage and theme types) and prices by market and currency appear on the pricing page and may change. {{TAX}}."),
    ] },
    { id: "trial", heading: "9. Free trial", blocks: [
      p("Eligible accounts receive one free 72-hour (3-day) trial per account, attached to the account's first eligible store. Creating additional stores does not reset or extend it. The trial grants no entitlements beyond those shown for your store on the billing page."),
    ] },
    { id: "activation", heading: "10. Subscription and manual activation", blocks: [
      ul("To subscribe or renew, you contact WAJHATI on the official WhatsApp {{WHATSAPP}} and tell us the store, plan and duration.", "Payment for a subscription is made outside the platform by the methods we agree: {{PAYMENT-METHODS}}.", "After payment is confirmed, an authorised administrator activates the subscription for the one store you select, for 1, 3, 6 or 12 months. Tapping the WhatsApp link activates nothing.", "One subscription covers one store only. Other stores need their own subscriptions.", "Renewal is manual. There is no automatic renewal and no automatic charge. A renewal begins after the current period ends, or is added to the end of it if it is still running.", "Dates are calculated in UTC using calendar months."),
    ] },
    { id: "fees", heading: "11. Fees, refunds and cancellation", blocks: [
      p("{{REFUND}}"),
      p("There is no automatic renewal, and you may stop renewing at any time. The platform does not delete your store data automatically when a subscription expires."),
    ] },
    { id: "expiry", heading: "12. Expiry, suspension and termination", blocks: [
      ul("When a trial or paid period ends, the store's entitlements change according to the billing status shown in the billing area, and a renewal grace period may be available if it is shown there. Effect on public availability of the store: {{EXPIRY-VISIBILITY}}.", "We may suspend or terminate a store or account for breach of these terms or for security or legal reasons. Suspension removes the store from public view and stops publishing and ordering, without changing its content or financial records.", "You can ask support to close your account. Your data is handled under the Privacy Policy."),
    ] },
    { id: "availability", heading: "13. Availability and support", blocks: [
      p("We make reasonable efforts to keep the service available, but it may stop for maintenance or faults. Availability commitment: {{UPTIME}}. Support is by {{EMAIL}} and the official WhatsApp {{WHATSAPP}}. Support hours: {{SUPPORT-HOURS}}."),
    ] },
    { id: "data", heading: "14. Data and privacy", blocks: [p("The Privacy Policy explains how we process data. These terms do not replace it.")] },
    { id: "third", heading: "15. Third-party services", blocks: [p("Some features depend on external services such as WhatsApp, Instagram and email delivery. Those services are governed by their providers' terms and we do not control their availability.")] },
    { id: "liability", heading: "16. Disclaimers and liability", blocks: [
      p("The service is provided as available. {{LIABILITY}}"),
    ] },
    { id: "law", heading: "17. Governing law and disputes", blocks: [p("{{GOV-LAW}}")] },
    { id: "changes", heading: "18. Changes to these terms", blocks: [p("We may change these terms, and the last-updated date at the top of the page will change. We will notify account holders of material changes. Continuing to use the service after a change takes effect means you accept it.")] },
    { id: "contact", heading: "19. Contact", blocks: [p("Email: {{EMAIL}} · Official WhatsApp: {{WHATSAPP}} · Website: wajhati.store")] },
  ],
};

export const legalDocs: Record<LegalKind, Record<Locale, LegalDoc>> = {
  privacy: { ar: privacyAr, en: privacyEn },
  terms: { ar: termsAr, en: termsEn },
};

export const legalUi = {
  ar: {
    privacy: "سياسة الخصوصية", terms: "شروط الخدمة", subscriptionTerms: "شروط الاشتراك والتفعيل", legal: "الوثائق القانونية", updated: "آخر تحديث", version: "النسخة",
    draftTitle: "مسودة بانتظار اعتماد المالك والمراجعة القانونية",
    draftBody: "هذا النص مسودة أُعدّت من واقع تنفيذ المنصة وليس نصًا معتمدًا قانونيًا. تظهر العبارات المظلّلة معلومات لم يوفّرها المالك بعد.",
    contents: "المحتويات", acknowledge: "بإنشاء حساب فإنك تقرّ بقراءة", and: "و", end: ".", footerLegal: "الشروط والخصوصية",
  },
  en: {
    privacy: "Privacy Policy", terms: "Terms of Service", subscriptionTerms: "Subscription and activation terms", legal: "Legal documents", updated: "Last updated", version: "Version",
    draftTitle: "Draft pending owner approval and legal review",
    draftBody: "This text is a draft written from what the platform actually does. It is not legally approved text. Highlighted phrases mark facts the owner has not supplied yet.",
    contents: "Contents", acknowledge: "By creating an account you confirm you have read the", and: "and", end: ".", footerLegal: "Terms and privacy",
  },
} as const;
