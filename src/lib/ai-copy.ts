import type { AssistFailure } from "./ai/schemas";
import type { AiCommand, AiTone, ThemeTextField } from "./ai/fields";

type Errors = Record<AssistFailure, string>;
type Copy = {
  brand: string; open: string; title: string; close: string; command: string; tone: string; cost: string; costUnit: (value: number) => string; balance: string; generate: string; generating: string;
  retry: string; use: string; cancel: string; preview: string; chargeNote: string; current: string; translateNeedsSource: string; nothingToWork: string;
  commands: Record<AiCommand, string>; tones: Record<AiTone, string>; errors: Errors; outOfCredits: string; billingLink: string; contactLink: string; reviewNote: string;
  meter: { title: string; of: string; left: string; renews: string; trial: string; trialEnds: string; extra: (value: number) => string; none: string; unavailable: string; usage: string };
  builder: {
    open: string; title: string; intro: string; idea: string; ideaHint: string; business: string; audience: string; tone: string; language: string; both: string; arabic: string; english: string;
    useStore: string; generate: string; costFill: string; costIdea: string; review: string; field: string; old: string; new: string; empty: string; unchanged: string;
    applyAll: string; applySelected: string; applySave: string; discard: string; applied: string; draftOnly: string; fields: (count: number) => string; selectAll: string; nothing: string;
  };
  fieldLabels: (field: ThemeTextField) => string;
};

export const aiCopy: Record<"ar" | "en", Copy> = {
  ar: {
    brand: "WAJHATI AI", open: "اكتب بالذكاء الاصطناعي", title: "WAJHATI AI — مساعد الكتابة الذكي", close: "إغلاق", command: "ماذا تريد؟", tone: "النبرة", cost: "التكلفة",
    costUnit: (value) => `${value} ${value === 1 ? "رصيد" : value === 2 ? "رصيدان" : value <= 10 ? "أرصدة" : "رصيدًا"}`, balance: "رصيدك",
    generate: "ولّد الاقتراح", generating: "جارٍ الكتابة…", retry: "إعادة المحاولة", use: "استخدم هذا النص", cancel: "إلغاء", preview: "معاينة الاقتراح", current: "النص الحالي",
    chargeNote: "يُخصم الرصيد فقط عند نجاح التوليد.", translateNeedsSource: "اكتب النص في الحقل الآخر أولًا لترجمته.", nothingToWork: "اكتب نصًا في الحقل أولًا، أو اختر «اكتب».",
    reviewNote: "راجع النص قبل الحفظ: لا يعرف المساعد سوى ما كتبته أنت، تأكد من صحة التفاصيل.",
    commands: { write: "اكتب", improve: "حسّن", shorten: "اختصر", expand: "وسّع", tone: "غيّر النبرة", alternatives: "٣ بدائل", translate: "ترجم من الحقل الآخر" },
    tones: { professional: "احترافية", friendly: "ودّية", luxury: "فاخرة", simple: "بسيطة", persuasive: "مقنعة" },
    errors: {
      denied: "لا تملك صلاحية استخدام الذكاء الاصطناعي لهذا المتجر.", disabled: "المساعد متوقف مؤقتًا من إدارة المنصة.", suspended: "أوقفت إدارة المنصة المساعد لهذا المتجر.",
      rate_limited: "طلبات كثيرة في وقت قصير. انتظر قليلًا ثم حاول.", no_plan: "المساعد متاح خلال التجربة أو مع اشتراك فعّال.", insufficient: "رصيدك لا يكفي لهذه العملية.",
      invalid: "تعذّر قبول الطلب. راجع النص المدخل.", duplicate: "تمت معالجة هذا الطلب سابقًا.", unavailable: "تعذّر الاتصال بالمساعد. لم يُخصم أي رصيد، حاول مجددًا.",
      bad_output: "لم يخرج المساعد بنص مناسب. لم يُخصم أي رصيد، حاول مجددًا.", not_configured: "المساعد غير مُهيّأ بعد على المنصة.",
    },
    outOfCredits: "انتهى رصيد الذكاء الاصطناعي. يتجدد الرصيد مع دورة اشتراكك القادمة.", billingLink: "الاشتراك والفوترة", contactLink: "تواصل مع الدعم",
    meter: {
      title: "رصيد الذكاء الاصطناعي", of: "من", left: "متبقٍ", renews: "يتجدد في", trial: "رصيد التجربة المجانية", trialEnds: "ينتهي مع التجربة في", usage: "نسبة الاستهلاك",
      extra: (value) => `+ ${value} رصيد إضافي بلا انتهاء`, none: "لا يوجد رصيد حاليًا. فعّل اشتراكك لتحصل على رصيد شهري.", unavailable: "المساعد غير متاح حاليًا.",
    },
    builder: {
      open: "جهّز محتوى متجرك بالذكاء الاصطناعي", title: "جهّز محتوى متجرك", intro: "يكتب المساعد نصوص الثيم المحدد فقط. لا يغيّر الصور أو الألوان أو الخطوط أو ترتيب الأقسام، ولا ينشر شيئًا.",
      idea: "فكرة المتجر", ideaHint: "اختياري. اكتب ما تبيعه وما يميّزك فعلًا. بدون فكرة يعتمد المساعد على بيانات متجرك.", business: "نوع النشاط", audience: "الجمهور المستهدف",
      tone: "النبرة", language: "اللغة", both: "العربية والإنجليزية", arabic: "العربية فقط", english: "الإنجليزية فقط", useStore: "استخدم بيانات متجري (الاسم والتصنيفات والمنتجات)",
      generate: "ولّد المحتوى", costFill: "تجهيز نصوص الثيم الأساسية", costIdea: "بناء محتوى المتجر من فكرتك", review: "قارن ثم اختر ما تريد تطبيقه", field: "الحقل", old: "الحالي", new: "المقترح",
      empty: "(فارغ)", unchanged: "بدون تغيير", applyAll: "طبّق الكل", applySelected: "طبّق المحدد", applySave: "طبّق واحفظ كمسودة", discard: "تجاهل", applied: "طُبّق المحتوى على المسودة. احفظ المسودة لترى المعاينة، ولن ينشر شيء تلقائيًا.",
      draftOnly: "يُطبَّق المحتوى على المسودة فقط ولا يُنشر قبل أن تنشره أنت.", fields: (count) => `${count} حقول نصية في هذا الثيم`, selectAll: "تحديد الكل", nothing: "لم تحدد أي حقل.",
    },
    fieldLabels: (field) => field.label.ar,
  },
  en: {
    brand: "WAJHATI AI", open: "Write with AI", title: "WAJHATI AI — Smart writing assistant", close: "Close", command: "What would you like?", tone: "Tone", cost: "Cost",
    costUnit: (value) => `${value} ${value === 1 ? "credit" : "credits"}`, balance: "Your balance", generate: "Generate suggestion", generating: "Writing…", retry: "Try again", use: "Use this text",
    cancel: "Cancel", preview: "Suggestion preview", current: "Current text", chargeNote: "Credits are charged only when generation succeeds.", translateNeedsSource: "Write the text in the other language field first to translate it.",
    nothingToWork: "Write some text in the field first, or choose “Write”.", reviewNote: "Review the text before saving: the assistant only knows what you provided, so check every detail.",
    commands: { write: "Write", improve: "Improve", shorten: "Shorten", expand: "Expand", tone: "Change tone", alternatives: "3 alternatives", translate: "Translate from other field" },
    tones: { professional: "Professional", friendly: "Friendly", luxury: "Luxury", simple: "Simple", persuasive: "Persuasive" },
    errors: {
      denied: "You cannot use AI for this store.", disabled: "The assistant is temporarily switched off by the platform.", suspended: "The platform has paused the assistant for this store.",
      rate_limited: "Too many requests in a short time. Wait a moment and try again.", no_plan: "The assistant is available during the trial or with an active subscription.", insufficient: "Your balance does not cover this operation.",
      invalid: "The request could not be accepted. Check the text you entered.", duplicate: "This request was already processed.", unavailable: "Could not reach the assistant. No credits were charged, please try again.",
      bad_output: "The assistant did not return usable text. No credits were charged, please try again.", not_configured: "The assistant is not set up on the platform yet.",
    },
    outOfCredits: "Your AI credits are used up. They renew with your next subscription cycle.", billingLink: "Subscription and billing", contactLink: "Contact support",
    meter: {
      title: "AI credits", of: "of", left: "left", renews: "Renews on", trial: "Free trial credits", trialEnds: "Ends with the trial on", usage: "Usage",
      extra: (value) => `+ ${value} extra credits, no expiry`, none: "No credits right now. Activate your subscription to receive monthly credits.", unavailable: "The assistant is not available right now.",
    },
    builder: {
      open: "Prepare your store content with AI", title: "Prepare your store content", intro: "The assistant writes only the text of the selected theme. It never changes images, colors, fonts or section layout, and it publishes nothing.",
      idea: "Store idea", ideaHint: "Optional. Say what you sell and what really sets you apart. Without an idea the assistant uses your store data.", business: "Business type", audience: "Target audience",
      tone: "Tone", language: "Language", both: "Arabic and English", arabic: "Arabic only", english: "English only", useStore: "Use my store data (name, categories, products)",
      generate: "Generate content", costFill: "Fill the core theme text", costIdea: "Build store content from your idea", review: "Compare, then choose what to apply", field: "Field", old: "Current", new: "Suggested",
      empty: "(empty)", unchanged: "No change", applyAll: "Apply all", applySelected: "Apply selected", applySave: "Apply and save as draft", discard: "Discard", applied: "Content applied to the draft. Save the draft to see the preview. Nothing is published automatically.",
      draftOnly: "Content goes to the draft only and is not published until you publish it.", fields: (count) => `${count} text fields in this theme`, selectAll: "Select all", nothing: "No field selected.",
    },
    fieldLabels: (field) => field.label.en,
  },
};
