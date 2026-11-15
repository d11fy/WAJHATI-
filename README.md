# واجهتي · WAJHATI

منصة إنشاء المتاجر الإلكترونية للتجار في السوق العربي. تتضمن إدارة الكتالوج ومحرك التصميم والسلة والطلبات المبدئية عبر التواصل. يبدأ التطبيق بالعربية RTL، ويمكن تبديل اللغة إلى الإنجليزية LTR من الترويسة. راجع [خريطة تنفيذ هوية واجهتي](docs/wajhati-implementation.md) لمراحل الواجهة ومراجع Figma.

## التشغيل المحلي

آخر تحسينات الواجهة تشمل ستة متاجر تجريبية تفاعلية وباقة WAJHATI الموحدة. راجع [تقرير الواجهة والديموهات والأسعار](docs/premium-ui-report.md) لرحلة المعاينة ونتائج الاختبارات، و[خطة تحديث الأسعار](docs/premium-pricing-change.md) لتفاصيل الحفاظ على السجلات المالية السابقة.

المتطلبات هي Node.js ‎22.13 أو أحدث، وnpm، وPostgreSQL 15 أو أحدث. في PowerShell يمكن استخدام `npm.cmd` إذا كانت سياسة الجهاز تمنع تشغيل `npm.ps1`.

### بيئة محلية معزولة

```powershell
npm.cmd ci
npm.cmd run local:check
npm.cmd run local:dev
```

يستخدم المشغّل `initdb` و`pg_ctl` من `PATH` أو من `C:\Program Files\PostgreSQL\18\bin` على Windows. استخدم `DAR_PG_BIN` إذا كانت الأدوات في مسار آخر. يشغّل PostgreSQL على `127.0.0.1:55432` بمصادقة SCRAM ومحاكي S3rver على `127.0.0.1:4569`. تبقى خدمة `5432` خارج هذا المسار. بيانات الخدمات وكلمات المرور المحلية المولّدة محفوظة في `.dar-local` المستثنى من Git. إعدادات الاتصال تنتقل إلى العمليات اللازمة، ويستلم التطبيق حساب قاعدة التشغيل فقط. تُوقَف الخدمات التي شغّلها الأمر عند خروجه، وتبقى البيانات لجولة لاحقة.

إذا كان `55432` مستخدمًا، اضبط `$env:DAR_LOCAL_PG_PORT='55442'` في نافذة PowerShell التي ستشغّل الأمر. يتحقق المشغّل من خلو المنفذ ومن أن مجلد بيانات PostgreSQL يخص المشروع.

`local:check` يطبّق الترحيلات ويتحقق من الاتصال بدور التشغيل ومن حاوية S3. `local:verify` يستخدم قاعدة وحاوية اختبار منفصلتين، ويشغّل فحوص الكود وبناء الإنتاج واختبارات PostgreSQL وChrome على `http://localhost:3210`. يمكن تشغيل `local:cleanup-check` وحده لاختبار حذف كائن اصطناعي من حاوية الاختبار وتسوية إدخاله في الطابور. أوقف جلسة `local:dev` قبل بدء إحدى جلسات التحقق لأنها تستخدم منافذ الخدمات نفسها.

محاكي S3rver مثبت داخل `.dar-local/tools` فقط. يقيّد المشغّل طلباته إلى عمليات الكائنات التي يستخدمها التطبيق وفحص الحاوية. استُبعدت طلبات المتصفح متعددة الأجزاء وإعداد الحاويات عبر XML من واجهة المحاكي المحلية. استخدم مخزن S3 مُدارًا لبيانات الإنتاج.

### إعداد PostgreSQL وS3 يدويًا

1. شغّل `npm ci`.
2. اتصل بـ PostgreSQL بدور إداري عبر `psql -U postgres -d postgres` ونفّذ الأوامر التالية مرة واحدة. يطلب `\password` كلمة المرور تفاعليًا. اختر كلمة مختلفة لكل دور.

   ```sql
   CREATE ROLE storefront_app NOLOGIN NOSUPERUSER NOBYPASSRLS;
   CREATE ROLE dar_owner LOGIN NOSUPERUSER NOBYPASSRLS;
   CREATE ROLE dar_runtime LOGIN INHERIT NOSUPERUSER NOBYPASSRLS IN ROLE storefront_app;
   CREATE ROLE storefront_media_worker NOLOGIN NOSUPERUSER NOBYPASSRLS;
   CREATE ROLE dar_media LOGIN INHERIT NOSUPERUSER NOBYPASSRLS IN ROLE storefront_media_worker;
   \password dar_owner
   \password dar_runtime
   \password dar_media
   CREATE DATABASE dar_market OWNER dar_owner;
   ```

3. انسخ `.env.example` إلى `.env.local` واملأ قيم الاتصال المحلية. استخدم دور `dar_runtime` في `DATABASE_URL` ودور `dar_owner` في `MIGRATION_DATABASE_URL`. اضبط `MEDIA_WORKER_DATABASE_URL` لدور `dar_media` في عملية التنظيف. رمّز المحارف الخاصة في بيانات الاتصال بصيغة URL.
4. شغّل `npm run db:migrate` ثم `npm run dev` وافتح `http://localhost:3000`.

إذا كانت لديك قاعدة من مرحلة Foundation، أنشئ دور مجموعة التنظيف وحسابها فقط، ثم خذ نسخة `pg_dump` قبل تشغيل الترحيلات. يزيل `0002` النشر التلقائي السابق ويحوّل المتاجر الموجودة إلى مسودات، ويضيف `0003` جداول الكتالوج، ويضيف `0004` سياسات الوصول. الرجوع الكامل إلى Foundation يعتمد على استعادة النسخة إلى قاعدة منفصلة وإعادة توجيه الاتصال. احتفظ ببيانات الكتالوج في القاعدة الأصلية إذا احتجت الرجوع بعد إضافة منتجات.

### تجربة الكتالوج والصور محليًا

استخدم حاوية S3 خاصة موجودة أو شغّل محاكي S3rver في نافذة PowerShell منفصلة. المسار `.s3-local` مخصص للمحاكي المحلي فقط.

```powershell
New-Item -ItemType Directory -Force .s3-local | Out-Null
npx.cmd --yes s3rver@3.7.1 -d .s3-local -a 127.0.0.1 -p 4569 --configure-bucket dar-market-local
```

أضف هذه القيم إلى `.env.local` عند استخدام المحاكي. قيمة `S3RVER` اعتماد افتراضي خاص بالمحاكي.

```dotenv
APP_ORIGIN=http://localhost:3000
S3_ENDPOINT=http://127.0.0.1:4569
S3_REGION=us-east-1
S3_BUCKET=dar-market-local
S3_FORCE_PATH_STYLE=true
AWS_ACCESS_KEY_ID=S3RVER
AWS_SECRET_ACCESS_KEY=S3RVER
```

1. سجّل الدخول وأنشئ متجرًا بعملة JOD لتجربة الأسعار ذات الثلاث منازل العشرية.
2. من لوحة المتجر افتح **التصنيفات** وأضف تصنيفًا. يمكنك رفع صورة له بعد الحفظ.
3. افتح **المنتجات** ثم **إضافة منتج**. اكتب الاسم والرابط والسعر مثل `12.345` والسعر السابق مثل `14.000`، واختر تصنيفًا. يمكن إدخال سطر خيارات مثل `الحجم: صغير، كبير`.
4. احفظ المنتج كمسودة، ثم ارفع الصور من صفحة التعديل وحدّد الرئيسية. غيّر الحالة إلى **منشور** واحفظ.
5. ارجع إلى لوحة المتجر واضغط **نشر المتجر** وأكّد. افتح **عرض الصفحة العامة** لتجربة البحث والتصنيف وصفحة التفاصيل باللغتين.

### تجربة الثيمات محليًا

1. شغّل `npm run local:dev`، ثم أنشئ متجرًا وأضف إليه منتجًا منشورًا كما سبق.
2. افتح **تصميم المتجر** واختر **Minimal Commerce** أو **Luxury Boutique**. يطبّق الاختيار لوحة الثيم وخطّه الأساسيين ويحتفظ بمحتوى الواجهة والصور وترتيب الأقسام والتحديدات.
3. عدّل الألوان والخط والنصوص، وارفع الشعار والأيقونة والبنر عند الحاجة. رتّب الأقسام باستخدام الأسهم، واختر ما يظهر في الواجهة. يظل قسم المنتجات ظاهرًا للحفاظ على الوصول إلى الكتالوج.
4. اختر **حفظ المسودة**، ثم بدّل عرض المعاينة بين الهاتف والكمبيوتر. تعرض المعاينة آخر مسودة محفوظة وتتطلب عضوية في المتجر.
5. من حساب المالك اختر **نشر التصميم**. افتح الواجهة العامة وصفحة منتج باللغتين. يبقى تفعيل ظهور المتجر خطوة مستقلة. يعيد **استعادة التصميم المنشور** آخر نسخة منشورة إلى المسودة، ويظل المنشور صالحًا عند فشل أي محاولة نشر.

يشغّل `npm run local:verify` رحلة التخصيص ويحفظ لقطات Chrome في `.dar-local/screenshots`. الصور التجريبية التي تظهر فيها يولدها الاختبار محليًا. ثيم Luxury Boutique يستخدم خط أميري العربي المستضاف ضمن حزمة المشروع بترخيص OFL.

### تجربة السلة والطلب

1. سجّل الدخول كمالك متجر منشور. افتح **إعدادات الطلب والتواصل**، فعّل استقبال الطلبات والقنوات المطلوبة، وأدخل رقم واتساب دوليًا مع `+` واسم إنستغرام دون `@`. اختر القناة الافتراضية، واكتب الافتتاحية أو تعليمات الطلب، وراجع معاينة الرسالة ثم احفظ.
2. افتح صفحة منتج منشور ومتوفّر. اختر قيمة لكل خيار وحدّد الكمية، ثم أضف المنتج. افتح **السلة** وعدّل الكميات أو أزل العناصر. تتبع السلة معرّف المتجر في المتصفح، وتعيد القراءة من الكتالوج على الخادم. الحد 12 بندًا مختلفًا و20 وحدة لكل بند.
3. راجع سعر الوحدة والإجماليات وعملة المتجر واختر القناة. اضغط **تجهيز طلب مبدئي** للحصول على المرجع والملخص. إذا تغيّر السعر أو الخيارات، راجع البيانات الجديدة. في واتساب راجع النص وأرسله بنفسك. إذا تجاوز طول الرابط السقف المحلي، يفتح واتساب بالمرجع ويمكنك نسخ الملخص الكامل ولصقه. في إنستغرام انسخ الملخص، افتح ملف البائع واضغط «رسالة» إن كانت متاحة، ثم الصق النص وأرسله.
4. من لوحة التاجر افتح **الطلبات المبدئية**، وابحث بالمرجع أو رشّح بالحالة. `initiated` تعني تجهيز السجل، و`contact_opened` تعني أن المتجر سجّل طلب الانتقال إلى القناة. بعد تواصل المشتري، يستطيع العضو تأكيد الطلب يدويًا أو إلغاء محاولة غير مؤكدة أو أرشفتها. الأرشفة تحفظ الحالة الأصلية.

تتحقق الصيغة الدولية لرقم واتساب عبر بيانات خطط الترقيم، ويُتحقق من صيغة اسم إنستغرام محليًا. تحقق التاجر من ملكية الحساب وإمكانية استقبال الرسائل يتم خارج التطبيق. لا تجمع الرحلة اسم المشتري أو هاتفه أو عنوانه.

| المسار | الوظيفة |
| --- | --- |
| `/ar` و`/en` | الصفحة الرئيسية |
| `/{locale}/sign-up` و`/{locale}/sign-in` | التسجيل والدخول |
| `/{locale}/dashboard` | المتاجر التي يملك الحساب عضوية فيها |
| `/{locale}/dashboard/new` | معالج إنشاء متجر بخطوتين |
| `/{locale}/dashboard/stores/{slug}` | لوحة متجر خاصة بالأعضاء |
| `/{locale}/dashboard/stores/{slug}/products` | بحث وتصفية وإضافة وتعديل المنتجات |
| `/{locale}/dashboard/stores/{slug}/categories` | إدارة التصنيفات وصورها |
| `/{locale}/dashboard/stores/{slug}/design` | مكتبة الثيمات وتخصيص المسودة ونشرها |
| `/{locale}/dashboard/stores/{slug}/design/preview` | معاينة خاصة للأعضاء، قابلة للتضمين من أصل التطبيق نفسه |
| `/{locale}/dashboard/stores/{slug}/contact` | قنوات الطلب وإعدادات التواصل ومعاينة الرسالة |
| `/{locale}/dashboard/stores/{slug}/orders` | الطلبات المبدئية والبحث والتصفية والتأكيد اليدوي |
| `/{locale}/s/{slug}` | الصفحة العامة للمتجر المنشور |
| `/{locale}/s/{slug}/p/{productSlug}` | تفاصيل منتج منشور |
| `/{locale}/s/{slug}/cart` | السلة ومراجعة السعر وتجهيز الطلب المبدئي |

## البنية والبيانات

```text
src/
  app/[locale]/       المسارات والصفحات العربية والإنجليزية
  components/        المكونات المشتركة والنماذج
  lib/               النصوص والتحقق المشترك من المدخلات
  server/auth/       كلمات المرور والجلسات وإجراءات المصادقة
  server/db/         مخططات Drizzle والاتصال وسياق المعاملة
  server/stores/     إجراءات المتاجر واستعلاماتها
  server/catalog/    الكتالوج الخاص والعام، الصور وLimits
  server/themes/     مسودات التصميم والنشر والصور وصلاحيات الثيمات
drizzle/             ترحيلات المخطط وسياسات الوصول ودوال قاعدة البيانات
scripts/             عامل تنظيف ملفات S3
tests/               وحدات وتكامل PostgreSQL ورحلة المتصفح
```

| الجدول | الوظيفة |
| --- | --- |
| `users` | هوية الحساب، بريد موحّد وفريد، وتجزئة كلمة المرور |
| `stores` | بيانات المتجر ورابط فريد على مستوى المنصة وتاريخ نشر |
| `store_memberships` | علاقة متعدد إلى متعدد بين المستخدمين والمتاجر، بمفتاح مركّب ودور `owner` أو `staff` |
| `sessions` | تجزئة رمز الجلسة، معرّف المستخدم، وتاريخ الانتهاء |
| `auth_limits` | عدادات محاولات التسجيل والدخول ضمن نافذة 15 دقيقة |
| `catalog_categories` و`catalog_products` | روابط فريدة لكل متجر، ترتيب وحالات ظهور وأسعار بوحدات صحيحة |
| `catalog_product_categories` و`catalog_product_options` | تصنيفات متعددة وقيم خيارات بسيطة مرتبطة بالمتجر والمنتج |
| `catalog_images` | صور معلقة أو جاهزة، مرتبة مع صورة رئيسية واحدة لكل منتج وصورة واحدة لكل تصنيف |
| `catalog_media_gc` | طابور تنظيف يحتفظ بالمفتاح حتى عند إزالة السجل الأب |
| `store_designs` | إعداد JSON للمسودة والمنشور لكل متجر، مع أرقام المراجعات |
| `store_design_assets` | صور التصميم المعزولة حسب المتجر، مع نوع الأصل وحالة الرفع |
| `order_settings` | قنوات التواصل وإعداداتها لكل متجر |
| `order_intents` و`order_intent_items` | المرجع والقناة والحالة والعملة ولقطة الأسعار والخيارات والكميات |
| `order_intent_events` | حدث انتقال واحد لكل محاولة، مع توقيته |

يُنشأ المتجر كمسودة مع عضوية المالك في معاملة واحدة. يمكن للمالك تفعيل النشر عند وجود منتج منشور واحد على الأقل. عند أرشفة آخر منتج أو إعادته إلى مسودة تختفي الواجهة فورًا، ويظل إعداد النشر مفعّلًا حتى يلغيه المالك. تظهر الواجهة مجددًا عند نشر منتج. روابط المتاجر فريدة عبر المنصة، وروابط التصنيفات والمنتجات فريدة داخل متجرها. يرث المنتج عملة المتجر وتُحفظ الأسعار بوحدات ISO 4217 الصغرى. حالة توفر المنتج يدوية، وخياراته لا تغيّر السعر أو المخزون.

## حدود الأمان

- تستمد إجراءات التاجر هويته من جلسة صالحة في قاعدة البيانات. يضبط مستودع المتاجر هوية المستخدم داخل المعاملة فقط. يتحقق استعلام اللوحة من العضوية، وتقيّد سياسات RLS الصفوف التي يستطيع دور التشغيل قراءتها حتى إذا نُسي شرط العضوية في استعلام جديد.
- تضبط عمليات الكتالوج أيضًا `dar.store_id` بعد التحقق من العضوية. تشترط RLS تطابق سياق المستخدم والمتجر لكل قراءة وكتابة، وتمنع المفاتيح المركبة ربط بيانات متجرين. يدير المالك وأعضاء الفريق الكتالوج، ويقتصر تفعيل نشر المتجر على المالك. دوال العرض العام تعيد إسقاطات محدودة للمتجر والمنتج المنشورين فقط.
- يرفض التطبيق دور قاعدة بيانات يملك الجداول المحمية أو يمكنه الانتقال إلى دور يتجاوز RLS. دور التشغيل لا يكتب جداول المتاجر والعضويات مباشرة. يحتفظ الخادم ببيانات اعتماد دور التشغيل، وهو الطرف الموثوق بتعيين سياق المعاملة.
- يستخدم التطبيق `scrypt` مع ملح عشوائي، وجلسة مدتها سبعة أيام برمز عشوائي، وملف ارتباط `HttpOnly` و`SameSite=Lax` و`Secure` في بناء الإنتاج. يُلغى رمز الجلسة الحالي عند الخروج أو عند تسجيل الدخول بنجاح من الجلسة نفسها. تتحقق Next.js من أصل طلبات إجراءات الخادم.
- يُطبق تقييد المحاولات على البريد دائمًا. لتطبيقه أيضًا على عنوان IP، اضبط `TRUSTED_CLIENT_IP_HEADER` فقط خلف وكيل يحذف أي قيمة واردة من العميل ويضع عنوانًا واحدًا موثوقًا. عند تشغيل بناء الإنتاج خارج `localhost` استخدم HTTPS ومرّر `DATABASE_URL` إلى عملية التطبيق و`MIGRATION_DATABASE_URL` إلى عملية الترحيل وحدها.
- لا يُتحقق من ملكية البريد في هذه المرحلة، واسترداد كلمة المرور والمصادقة متعددة العوامل خارج النطاق. يمكن حذف صفوف الجلسات والعدادات المنتهية دوريًا بدور الصيانة باستخدام `expires_at`.

### تخزين الصور والتنظيف

تُقبل JPEG وPNG وWebP حتى 6 MiB و16 مليون بكسل. يتحقق الخادم من التوقيع ويفك الترميز ويعيد الترميز إلى WebP، ثم يخزن الصورة في حاوية خاصة بمفتاح عشوائي تحت معرّف المتجر. تُقرأ الصورة عبر مسار التطبيق بعد إعادة التحقق من العضوية أو حالة النشر. `APP_ORIGIN` يحدد الأصل المقبول لطلبات تغيير الصور وعناوين Open Graph. ضع حدًا مماثلًا لحجم الطلب في الوكيل إن استُخدم.

ترحيل `0005` يضيف جدولي التصميم والصور، وترحيل `0006` يضيف سياسات RLS والنشر الذري وقراءة الأصول المنشورة، ويوسّع عامل التنظيف ليشمل أصول الثيم. يبدأ المتجر الموجود بتصميم Minimal Commerce الافتراضي إلى أن ينشر تصميمًا، ويحتفظ بكتالوجه وحالة نشره. يمكن للأعضاء حفظ المسودة، ويقتصر النشر على المالك. يمنع رقم المراجعة حفظ نسخة قديمة فوق مسودة أحدث. يخضع الإصداران الحاليان لسجل ثيمات موحد، وتتيح طبقة الصلاحيات ربط الثيمات بالباقات مستقبلًا.

بعد إزالة صورة يُلغى الوصول إليها فورًا ويُضاف مفتاحها لطابور التنظيف. شغّل `npm run media:cleanup` دوريًا في عملية منفصلة بصلاحيات `dar_media` وبيانات اعتماد المخزن. تحتاج عملية التنظيف إلى `npm ci` الكامل لتشغيل TSX. يستعيد العامل الحجوزات المعلقة منذ ساعة أو أكثر، ويحاول حذف دفعة تصل إلى 20 عنصرًا في كل تشغيل. تُعاد محاولة الإخفاقات بعد خمس دقائق. اضبط أذونات مخزن التطبيق على `PutObject` و`GetObject` وأذونات عامل التنظيف على `DeleteObject` للبادئة الخاصة بالتطبيق. إذا كانت الحاوية بإصدارات مفعّلة، فضع سياسة دورة حياة للإصدارات السابقة بحسب سياسة الاحتفاظ لديك.

في الإنتاج اضبط مجدول المنصة لتشغيل العامل كل خمس دقائق، مع تمرير `MEDIA_WORKER_DATABASE_URL` وبيانات مخزن الحذف من مخزن أسرار العملية. راقب رمز الخروج وعدد الإخفاقات المطبوع. لا يحتاج المجدول إلى نشر نقطة HTTP أو مشاركة اعتماد مالك المخطط.

### الاحتفاظ بالطلبات

الترحيل `0007` يضيف جداول الطلبات وإعداداتها ويترك بيانات المتاجر الحالية كما هي. يضيف `0008` سياسات RLS وإجراءات التسجيل والانتقال والتنظيف. استخدم `npm run orders:cleanup` يوميًا بدور الصيانة عبر `MEDIA_WORKER_DATABASE_URL`. يزيل الإجراء المحاولات غير المؤكدة بعد 90 يومًا والمؤكدة بعد 365 يومًا من الإنشاء، مع عناصرها وأحداثها. تحذف الدفعة الواحدة حتى 1000 سجل. راجع سياسة الاحتفاظ قبل اعتماد هذه المدد في الإنتاج.

تتحقق نقطة السلة من الأصل، وتحدّ حجم الطلب ومعدل العمليات بحسب المتجر والمتصفح وبحسب IP عند تهيئة الوكيل الموثوق. مفتاح إعادة المحاولة مشتق من جلسة زائر عشوائية قصيرة العمر ومعرّف محاولة. تحفظ قاعدة البيانات لقطة السعر في المعاملة نفسها، وتعيد التحقق من التوفر والقناة قبل فتح رابط ثابت النطاق.

توفّر خدمة `Limits` حاليًا حدودًا افتراضية هي 2500 منتج و100 تصنيف لكل متجر، وثماني صور لكل منتج وصورة لكل تصنيف. يمكن ربطها بالباقات لاحقًا.

## الفحوصات

```sh
npm run lint
npm run typecheck
npm test
npm run build
```

لاختبارات التكامل، أنشئ قاعدة PostgreSQL محلية منفصلة مؤقتة، وطبّق الترحيلات عليها كما سبق. اضبط `TEST_DATABASE_URL` لدور التشغيل، و`TEST_MIGRATION_DATABASE_URL` لمالك القاعدة نفسها، و`TEST_MEDIA_DATABASE_URL` لدور التنظيف، ثم شغّل `npm run test:db`. يمكن ضبط `TEST_BYPASS_DATABASE_URL` اختياريًا لدور اختبار معزول يمكنه وراثة `BYPASSRLS` للتحقق من رفضه.

لاختبار رحلة المتصفح، شغّل `npm run start` بعد البناء مع `DATABASE_URL` للقاعدة المؤقتة وإعدادات حاوية S3 تجريبية. اضبط `TEST_BASE_URL` على القيمة نفسها التي استخدمتها في `APP_ORIGIN`، ثم شغّل `npm run test:e2e`. يستخدم الاختبار Chrome محليًا، ويمكن ضبط `PLAYWRIGHT_CHROMIUM_EXECUTABLE` لتحديد مسار Chromium آخر. تترك الرحلة بيانات اختبار في القاعدة والحاوية المؤقتتين.

## المراحل التالية

الدفع والاشتراكات ولوحة Super Admin ومزامنة محادثات القنوات وخدمة التجهيز المدفوعة وإدارة أعضاء الفريق والثيمات المتقدمة.

## المرحلة الخامسة — الفوترة والاشتراكات

يحتوي الكتالوج على Starter بإصدار أول وحدّ 30 منتجًا وتصميم أساسي وتحليل إجمالي للطلبات التي أكدها التاجر. يتيح Pro حتى 200 منتج والثيمين وتخصيص الألوان والخط وتحليل الطلبات المؤكدة حسب القناة. الصلاحيات تقرأ من إصدار الخطة المرتبط بالفترة المعتمدة. الحد يحسب المنتجات غير المؤرشفة. يحجز كل ملف كتالوج أو تصميم 6 MiB من حصة المتجر من لحظة حجز الرفع، وتبقى الملفات القديمة محفوظة عند تجاوز الحصة. حصة Starter هي 1536 MiB وحصة Pro هي 12288 MiB. النطاق المخصص محجوز للمستقبل.

### تشغيل الرحلة

1. شغّل `npm.cmd run local:dev`. استخدم منفذ PostgreSQL البديل كما في أول الملف إذا لزم.
2. سجّل حساب تاجر وحساب مراجع منفصلين محليًا. اختر متجرًا من لوحة التاجر وافتح **الفوترة والباقات**. يعطّل التطبيق التسجيل خارج تشغيل loopback المخصص. واجهة تسجيل عامة تحتاج تدفق تحقق بريد واستعادة كلمة مرور قبل الإطلاق.
3. في نافذة مشغّل منفصلة جهّز كتالوج أسعار وطريقة دفع باستخدام `npm run billing:operator -- configure <file>` مع اتصال مالك المخطط. يحتاج JSON إلى معرّفات UUID فريدة. المثال الآتي للتجربة المحلية فقط ويستخدم أرقام اختبار بلا وسيلة تحويل فعلية.

```json
{
  "prices": [
    { "id": "1ec91238-4e09-4926-ad66-19f4c5ea6001", "plan": "starter", "version": 1, "country": "JO", "currency": "JOD", "interval": "monthly", "amount": 12000 },
    { "id": "1ec91238-4e09-4926-ad66-19f4c5ea6002", "plan": "pro", "version": 1, "country": "JO", "currency": "JOD", "interval": "yearly", "amount": 144000 }
  ],
  "methods": [
    { "id": "1ec91238-4e09-4926-ad66-19f4c5ea6011", "country": "JO", "currency": "JOD", "label": "تسوية محلية للاختبار", "instructions": "هذه طريقة اختبار محلية. لا ترسل أموالًا." }
  ],
  "setups": [
    { "id": "1ec91238-4e09-4926-ad66-19f4c5ea6021", "country": "JO", "currency": "JOD", "label": "تجهيز المتجر", "amount": 5000 }
  ]
}
```

عند تشغيل `local:dev` يمكن ضبط الاتصال في نافذة المشغّل الأخرى دون طباعة كلمة المرور. غيّر قيمة المنفذ لتطابق الجلسة، وأبقِ المتغير خارج عملية الويب.

```powershell
$billingFixture = Get-Content -LiteralPath '.dar-local/postgres-fixture.json' -Raw | ConvertFrom-Json
$billingPgPort = 55442
$env:MIGRATION_DATABASE_URL = 'postgresql://dar_owner:' + $billingFixture.dar_owner + "@127.0.0.1:${billingPgPort}/dar_local"
npm.cmd run billing:operator -- configure .dar-local/local-billing.json
npm.cmd run billing:operator -- verify-email reviewer@example.test
# امنح صلاحية المراجع من إدارة المنصة وفق خطوات المرحلة 6A أدناه.
# اختياري لتجربة التفعيل من حساب التاجر المحلي
# npm.cmd run billing:operator -- verify-email merchant@example.test
Remove-Item Env:MIGRATION_DATABASE_URL
```

4. اختر بلد الفوترة والعرض والطريقة وخدمة التجهيز الاختيارية. العملة المعروضة هي عملة العرض، ويمكن أن تختلف عن عملة المتجر. أنشئ الطلب، وانسخ مرجعه، ثم أرفق إيصال اختبار واكتب مرجع التحويل. يبقى الاشتراك الحالي ساريًا وفق مدته وتظهر نتيجة المراجعة في سجل الدفعات.
5. من الحساب المنفصل افتح **مراجعة الدفعات**. نزّل الإثبات. عند توفر سجل دفع مستقل طابق مرجع التحويل والعملة والمبلغ، وأدخل مرجع التسوية المستقل وأكّد وصول الأموال. عند الرفض، اكتب السبب. في البيئة المحلية استخدم بيانات اختبار فقط. الدفعة المعتمدة أول مرة تبدأ فترة فعلية. طلب تغيير خطة أو تجديد معتمد أثناء فترة نشطة يُجدول لنهايتها.
6. إذا دفع التاجر رسوم التجهيز، تتحول الخدمة إلى «مدفوع، بانتظار فريق التجهيز». يسجل المراجع الإنجاز يدويًا بعد أن ينفذه الفريق. تُعرض الرسوم كسطر مستقل داخل طلب الخطة. سجل الاعتماد إيصال داخلي للتسوية ويحتفظ بالمبالغ والعملة، ولا يصدر فاتورة ضريبية.

### دورة الحياة والعزل

| الحالة | الشرط والتصرف |
|---|---|
| التجهيز الخاص / `expired` بدون تجربة سابقة | يمكن تجهيز 10 منتجات غير مؤرشفة وتعديل التصميم الأساسي بشكل خاص. يتطلب النشر تجربة موثّقة أو فترة دفع معتمدة. |
| `trialing` | تبدأ في الخادم بعد تحقق البريد. مدتها الافتراضية سبعة أيام وبحد 10 منتجات. يُتاح النشر بالتصميم الأساسي. يتيح القيد تجربة واحدة لكل حساب ولكل متجر. |
| `pending_payment` | هناك طلب مفتوح ولا توجد صلاحية نشر من فترة فعالة أو تجربة أو وصول سابق. إرسال الإثبات وحده لا يفعّل الخطة. |
| `active` | بدأ أجل مدفوع اعتمدته المراجعة. تحتفظ المتاجر الموجودة قبل الترحيل بوصول منفصل موضح في الواجهة دون إنشاء فترة أو إيصال مدفوع لها. |
| `grace_period` | الفترة المدفوعة انتهت دون إلغاء مجدول. تظل الصلاحيات سارية حتى نهاية المهلة، افتراضيًا سبعة أيام. |
| `suspended` / `canceled` / `expired` بعد التجربة | يتوقف النشر الجديد والطلب عبر التواصل. يبقى الكتالوج المنشور للتصفح. يظهر النمط الأساسي عندما لا تتوفر صلاحية النمط السابق، مع الاحتفاظ بالتصميم والمنتجات والأصول للعودة لاحقًا. |

تحتسب التواريخ في UTC. إضافة شهر أو سنة تستخدم التاريخ التقويمي وتضبط نهاية الشهر أو يوم 29 فبراير عند الحاجة. التجديد اليدوي يبدأ فور اعتماد الدفعة بعد انتهاء الفترة، أو في نهاية الفترة الحالية عند اعتماد طلب للمستقبل. لا يُنشأ أي تجديد آلي. يمنع قيد الاستبعاد تداخل فترتين للمتجر. يسمح النظام بطلب مفتوح واحد وفترة مستقبلية معتمدة واحدة لكل متجر، ويوقف طلب الإلغاء أثناء وجود أي منهما. الإلغاء في نهاية الفترة يتخطى مهلة التجديد.

طلبات الدفع تبدأ `awaiting_payment` وتمنح 72 ساعة لتقديم الإثبات. ينتقل الإثبات إلى `submitted`، والمراجعة إلى `under_review` أو مباشرة إلى `approved` أو `rejected`. انتهاء الوقت قبل إرسال الإثبات ينتج `expired`. تظل الإثباتات المقدمة في قائمة التسوية حتى قرار المراجع. توثّق العمليات الحساسة في سجل تدقيق. لا يمكن إعادة تسعير سجل قائم عبر تعديل عرض. عند تغيير سعر استخدم `availability.prices` لتعطيل المعرّف السابق وأنشئ عرضًا جديدًا في نفس المعاملة. يمكن إضافة إصدار خطة جديد عبر `plans` وتخصيص الإعدادات عبر `policy` بمفاتيح `trialDays` و`trialProducts` و`graceDays`. لا تُعرض الأسعار التي تفتقد طريقة نشطة للبلد والعملة.

تتطلب صفحات التاجر عضوية مالك وسياق متجر مقيّدًا بـRLS. صلاحية المراجع مستقلة عن ملكية المتجر، وتتحقق إجراءات المراجعة والتنزيل من جلسة حية وعضوية مراجعة وبريد موثّق. لا يستطيع المراجع مراجعة دفعة متجر هو عضو فيه أو تنزيل إثباتها. الإثباتات صور WebP منزوعة البيانات الوصفية داخل جدول خاص في PostgreSQL. يُحوّل PDF في عملية فرعية محدودة الزمن إلى صورة حتى ثلاث صفحات، وتُزال الروابط والتعليقات التفاعلية. لا تُرسل الملفات الأصلية إلى المتصفح ولا تُستخدم روابط عامة. تبقى أصول المتجر العامة في S3 الخاص وفق سياسة المرحلة السابقة.

### تشغيل المراجعة والصيانة

- يهيّئ المشغّل حسابًا منفصلًا عبر `billing:operator -- provision-account <email> <name>` عند الحاجة ويزوّد كلمة المرور من مطالبة مخفية أو مدير أسرار عبر stdin. بعد التحقق من البريد، يدير مالك المنصة صلاحية المراجع وتفعيل MFA وفق خطوات المرحلة 6A أدناه. لا تضع اتصال مالك المخطط في عملية التطبيق.
- جدْول `npm run billing:expire` بدور `MEDIA_WORKER_DATABASE_URL`. يحدّث حالة الطلبات المنتهية ويرصد انتقالات الاشتراك ويحذف الإثباتات بعد 180 يومًا من المراجعة. لا يعتمد نفاذ الصلاحيات على الموعد الذي يعمل فيه العامل. لا تحذف مهمة الانتهاء بيانات المتجر أو تاريخ المبالغ والمراجعة.
- طبّق الترحيلات `0009`–`0011` بعد أخذ نسخة PostgreSQL والتأكد من إمكانية استعادتها. تحتاج `btree_gist`. التراجع الآمن إلى إصدار التطبيق السابق يتم بالتنسيق مع نسخة قاعدة بيانات ما قبل الترحيل في بيئة معزولة. لا تُسقط جداول الفوترة بعد بدء تسجيل معاملات دون حفظ السجل وخطة ترحيل عكسية.
- شغّل `npm.cmd run local:verify` للتأكد من البناء واختبارات PostgreSQL وChrome. يستخدم قاعدة الاختبار `dar_local_verify_billing` وحاوية الاختبار المحلية. ملفات الصور التجريبية الناتجة في `.dar-local/screenshots`. لا تعتمد على بيانات الاختبار كإعداد سوق حقيقي.

### قبل الإطلاق

تبقى بيانات الأسعار وطرق التسوية الحقيقية وسياسة الاحتفاظ بالوثائق ومراجعة الالتزامات الضريبية لكل سوق مسؤولية إعداد التشغيل. وفّر عزلاً على مستوى النظام لعملية تحويل PDF في الإنتاج، واختبر استعادة نسخ قاعدة البيانات المشفرة لأنها تتضمن الإثباتات الخاصة. التسجيل العام يحتاج تحقق بريد واستعادة كلمة مرور وحماية إساءة مناسبة، ويُفضّل ربط المراجعين بمصادقة متعددة العوامل. تذكيرات التجديد الحالية داخل التطبيق. لم تُضبط خدمة بريد أو جدولة إنتاجية. من المناسب في المرحلة السادسة إضافة صلاحيات مستقلة للتسوية والتجهيز، ومراجعة ثانية للدفعات ذات المخاطر العالية، وسجل تشغيلي لمتابعة الطلبات التي تأخرت مراجعتها.

## Phase 6A — security and operations

### Local review

```powershell
$env:DAR_LOCAL_PG_PORT='55442'
npm.cmd run local:dev
```

1. Create separate test accounts for the platform owner, administrator, reviewers, and merchants. From **Account security**, request email verification. The local mail adapter writes fixture messages to `.dar-local/mail/dar_local`. Open the link from the appropriate message. Treat that directory as private and use synthetic addresses only.
2. Bootstrap the first platform owner with the schema-owner connection in a separate operator shell. You can reuse the PowerShell connection setup documented in Phase 5. Then issue an enrollment key. The CLI receives it on stdin and stores only its digest. Deliver the key to the intended operator through a separate authenticated channel. For local review, use an authenticator on a test device and enter the displayed setup key manually.

```powershell
npm.cmd run platform:operator -- bootstrap-owner owner@example.test
# Supply a cryptographically random 32-byte base64url enrollment key from a secure prompt or vault on stdin.
# <secure stdin> | npm.cmd run platform:operator -- issue-enrollment owner@example.test
```

3. Sign in again after bootstrap. Open **Platform administration** and enter the password and enrollment key. Confirm a TOTP code and save the one-time recovery codes. Assign roles to independently verified accounts through **Merchants**, then issue each account its own offline enrollment key.
4. Configure catalog versions and market prices under **Plans and pricing**. Configure policy in **Platform settings**. For example, `{"JOD":10000}` makes requests of JOD 10.000 or more require two reviewers. No threshold implies single-review mode for that currency. The first review leaves the request under review. A different reviewer verifies the same independent reconciliation reference before activating the subscription.
5. Use a merchant account to submit proof, then a separate reviewer account to inspect it. The preview is a WebP and the original is a private attachment. A reviewer who is a member of the paying store cannot act on its payment or download evidence. Production original evidence should be opened in an isolated viewer.
6. Use `npm.cmd run local:verify` for lint, TypeScript, unit and PostgreSQL integration tests, the production build, Chrome journeys and cleanup workers. Test screenshots appear in `.dar-local/screenshots`. Launch readiness and detailed operations are documented in [the Phase 6A operations report](docs/phase6a-audit.md).

### Operational decisions

- **Platform owner** controls roles and policy. **Administrator** manages merchant/store operations and can inspect payment summaries. **Payment reviewer** can see the payment and setup queues and, after recent MFA, reconcile payments or download evidence. Reviewers do not automatically get merchant listing or configuration access. Merchant membership never confers platform permissions.
- TOTP is verified with an encrypted seed, a one-step clock tolerance and a monotonic counter per user. Successful verification rotates the session. Elevated reads expire after eight hours and privileged writes and evidence downloads require verification within five minutes. A recovery code revokes other sessions, invalidates all prior recovery codes, and starts a new enrollment. Losing the authenticator and codes requires documented offline recovery by trusted operators using `platform:operator -- offline-recovery <email>`. Independently confirm the operator identity, require a second human authorization, and distribute the new enrollment code out of band. Email reset alone does not remove MFA.
- Email verification links last 24 hours. Password reset, signup and both email-change confirmations last 20 minutes. Reset and completed email change revoke all existing sessions. Email change also requires the current password and both addresses. Privileged accounts need recent MFA to request it. Recovery request responses are neutral and mail delivery runs after the response. Public signup is off by default and is email-first when a verified sender, HTTPS origin and trusted proxy IP header are configured. No account can be opened through that flow until an actual delivery link is used.
- Suspending a store removes its public visibility and disables publication and ordering without modifying its publication record, financial history, or content. A publishing hold leaves browsing available and pauses new publication, trial activation and contact checkout. The legacy transition grants at most 90 days from migration to previously marked stores. It records no payment, can be ended early, and leaves approved periods intact.
- The Phase 5 `billing:operator` provisioning, pricing and email-verification commands remain offline tools. Its old reviewer grants have been superseded by audited platform role assignment. Enable public registration only after completing the operations checklist.

## Phase 6B — infrastructure and recovery

Use `npm run local:staging` for a separate native staging database, object-storage fixture, mail outbox and PDF process. Run `npm run local:staging-smoke` to verify readiness, disabled signup, protected metrics and the renderer-outage response. Use `npm run local:verify` for the regression suites, local load and encrypted backup/restore rehearsal.

The [operations runbook](docs/phase6b-operations.md) covers the HTTPS Compose staging stack, separated production templates, PostgreSQL roles, release and rollback, object storage, key rotation and readiness gates.
