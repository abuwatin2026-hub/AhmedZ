# INVENTORY & UOM Diagnostic Audit (Read‑Only)

> النطاق: تحليل Read‑Only اعتمادًا على الشيفرة والترحيلات (migrations) الحالية في هذا المستودع.  
> القيود: لا يوجد UPDATE/DELETE/RESTATEMENT/تغيير Base UOM.  
> ملاحظة: لا يمكن تأكيد “ازدواجية أصناف فعلية” أو عرض “صفوف حقيقية” بدون قراءة بيانات قاعدة الإنتاج عبر اتصال SQL/REST. لذلك أرفقت “استعلامات تدقيق” Read‑Only جاهزة للتشغيل على الإنتاج لإخراج الأرقام والازدواجيات والعيّنات.

---

## 1) Executive Summary (غير تقني)

- النظام **يمتلك مفهوم Base Unit للصنف** (مثل piece/kg/gram) ويُفترض أن كل كميات المخزون تُدار على هذه الوحدة.
- يوجد “هيكل UOM متقدم” (جداول UOM + Conversions + Item↔UOM) تمت إضافته لاحقًا، لكن **غير مُطبق عمليًا داخل مسارات التشغيل الأساسية** (الشراء/البيع/التقارير) بالقدر الكافي.
- النتيجة: النظام يعمل بشكل آمن **فقط إذا كانت كل الإدخالات تُسجّل دائمًا بوحدة الصنف الأساسية**.  
  أما في سيناريو (حبة/باكت/كرتون) فهناك **خطر مرتفع** لخلط الوحدات → أخطاء كميات، تكلفة، تقارير وربحية.
- التقييم الصريح: **⚠️ قابل للإصلاح (Corrective Refactor)**، وليس “تصميم خاطئ جذريًا”، لكن الإصلاح يجب أن يذهب إلى “إجبار التحويل إلى Base UOM” واستخدام `qty_base` في كل الحركات والتقارير، وإلا سيبقى النظام عرضة لأخطاء وحدة/تكلفة.

---

## 2) Current Design Reality

### Item Master (الحقيقة الحالية)

- جدول الأصناف الأساسي هو `public.menu_items` وكان قديمًا يحتوي `unit_type` داخل schema الابتدائية.  
  ثم أضيف لاحقًا عمود `base_unit` كمرجع “الوحدة الأساسية” للصنف مع تطبيع من البيانات القديمة.
  - المرجع: [20251227000000_init.sql](file:///d:/AhmedZ/supabase/migrations/20251227000000_init.sql#L150-L190)
  - إضافة `base_unit` وتطبيعه: [20260123252000_product_master_sot_lock_receiving_sellable_audit.sql](file:///d:/AhmedZ/supabase/migrations/20260123252000_product_master_sot_lock_receiving_sellable_audit.sql#L1-L88)

### UOM Layer (طبقة UOM)

- تمت إضافة جداول:
  - `public.uom` (وحدات القياس)
  - `public.uom_conversions` (تحويلات numerator/denominator)
  - `public.item_uom` (ربط صنف ↔ Base/Purchase/Sales UOM)
  - المرجع: [enterprise_gaps_hardening.sql](file:///d:/AhmedZ/supabase/migrations/20260124100000_enterprise_gaps_hardening.sql#L941-L1030)
- تم أيضًا إضافة أعمدة `uom_id` و `qty_base` إلى:
  - `purchase_items`, `purchase_receipt_items`, `inventory_movements`, `inventory_transfer_items`
  - المرجع: [enterprise_gaps_hardening.sql](file:///d:/AhmedZ/supabase/migrations/20260124100000_enterprise_gaps_hardening.sql#L1015-L1030)
- توجد Triggers لحساب `qty_base = convert_qty(quantity, uom_id, base_uom_id)` تلقائيًا عند الإدخال/التعديل.
  - المرجع: [enterprise_gaps_hardening.sql](file:///d:/AhmedZ/supabase/migrations/20260124100000_enterprise_gaps_hardening.sql#L1055-L1157)

### حركة المخزون + On‑Hand

- جدول الحركات `public.inventory_movements` يسجل:
  - `quantity`, `unit_cost`, `total_cost`, `movement_type`, `batch_id`, `warehouse_id`…  
  وقد أضيف لاحقًا `uom_id` و `qty_base` (لكن يجب التحقق هل تُستخدم فعليًا).
  - إنشاء الجدول القديم: [inventory_movements_cogs.sql](file:///d:/AhmedZ/supabase/migrations/20260107040000_inventory_movements_cogs.sql#L2-L23)
  - منطق الترحيل المحاسبي للحركة لا يعتمد على UOM: [prod_deploy_bundle.sql](file:///d:/AhmedZ/supabase/migrations/20260210173500_prod_deploy_bundle.sql#L1-L111)
- الكمية المتاحة On‑Hand تُدار في `public.stock_management.available_quantity` + `avg_cost`.
  - هذا التصميم يفترض ضمنًا أن الكمية في “وحدة واحدة ثابتة” (Base Unit للصنف).

---

## 3) Critical Findings by Area

## 3.1 Item Master Audit (ازدواجية الأصناف)

### ما يدعمه التصميم

- التصميم الأساسي **يميل إلى “صنف واحد” مع Base Unit واحدة** (`menu_items.base_unit`) وليس “تكرار الصنف لكل وحدة”.
- لا يوجد في الـ UI الحالي ما يشير إلى وجود “اختيار UOM” عند إدخال الشراء/البيع (الشراء يستخدم quantity مباشرة بدون اختيار وحدة).

### أين يظهر الخطر عمليًا؟

- عندما يحتاج العمل التجاري إلى (حبة/باكت/كرتون)، وفي غياب تطبيق تحويلات UOM داخل مسارات المخزون، غالبًا ما يلجأ المستخدمون إلى:
  - إنشاء **أصناف متعددة بنفس الاسم** مع اختلاف Base Unit أو وصف/باركود (workaround).
  - أو إدخال “عدد كراتين” في quantity رغم أن النظام يتعامل معها كـ “حبات” (خلط وحدات).

### تدقيق Read‑Only مطلوب على الإنتاج

> هذه استعلامات SELECT فقط لتحديد الأصناف المكررة اسمًا/وصفًا أو اختلافها فقط بالوحدة.

```sql
-- A) أصناف مكررة بالاسم (عربي/إنجليزي)
select
  lower(btrim(coalesce(mi.name->>'ar', mi.name->>'en', mi.id))) as norm_name,
  count(*) as cnt,
  array_agg(mi.id order by mi.updated_at desc) as item_ids,
  array_agg(distinct mi.base_unit) as base_units
from public.menu_items mi
where mi.status = 'active'
group by 1
having count(*) > 1
order by cnt desc, norm_name;

-- B) نفس الاسم لكن تختلف فقط بالوحدة (علامة خطر عالية)
select
  lower(btrim(coalesce(mi.name->>'ar', mi.name->>'en', mi.id))) as norm_name,
  count(*) as cnt,
  count(distinct mi.base_unit) as base_unit_variants,
  array_agg(distinct mi.base_unit) as base_units,
  array_agg(mi.id) as item_ids
from public.menu_items mi
where mi.status = 'active'
group by 1
having count(distinct mi.base_unit) > 1
order by base_unit_variants desc, cnt desc;
```

---

## 3.2 UOM Architecture Audit

### ما هو الموجود فعليًا

- ✔️ جدول UOM موجود: `public.uom`
- ✔️ جدول تحويل موجود: `public.uom_conversions` بنموذج numerator/denominator
- ✔️ ربط صنف ↔ Base UOM موجود: `public.item_uom` (base_uom_id)
- ⚠️ لا يوجد “تاريخ صلاحية للتحويلات” (Effective Dating) داخل `uom_conversions`.  
  في Best Practices عادة التحويلات قد تتغير (تعبئة جديدة، وزن صافي، إلخ) ويجب حفظها تاريخيًا.
- ⚠️ لا يوجد “Item↔UOM Conversion” على مستوى الصنف (مثل: هذا الصنف pack=12 قطعة، carton=24 pack).  
  التحويلات الحالية عالمية بين وحدات (UOM↔UOM) وليست “خاصّة بالصنف”؛ وهذا غير كافٍ لوحده لمشكلة pack/carton لأن “pack” تختلف من صنف لآخر.

### منطق Hard‑Coded

- جزء من النظام يعالج وزن (kg/gram) في التقارير والمبيعات بمنطق ثابت.
- هذا جيد كحالة خاصة للأوزان، لكنه لا يغطي pack/carton.

### تدقيق Read‑Only مطلوب

```sql
-- 1) هل item_uom موجود لكل الأصناف؟
select count(*) as missing_item_uom
from public.menu_items mi
left join public.item_uom iu on iu.item_id = mi.id
where iu.id is null and mi.status = 'active';

-- 2) هل توجد تحويلات UOM أصلاً؟
select count(*) as conversions_count from public.uom_conversions;

-- 3) تحويلات ناقصة مطلوبة (إذا تم استخدام purchase_uom_id/sales_uom_id)
select
  iu.item_id,
  bu.code as base_uom,
  pu.code as purchase_uom,
  su.code as sales_uom
from public.item_uom iu
join public.uom bu on bu.id = iu.base_uom_id
left join public.uom pu on pu.id = iu.purchase_uom_id
left join public.uom su on su.id = iu.sales_uom_id
where (iu.purchase_uom_id is not null or iu.sales_uom_id is not null);
```

---

## 3.3 Inventory Movements Audit (الشراء/البيع/المرتجعات/التحويلات/التسويات)

### ما يحدث فعليًا في المسارات الأساسية

- دالة استلام أمر الشراء (receive_purchase_order) تقوم بما يلي:
  - تزيد `stock_management.available_quantity` بـ `purchase_items.quantity`
  - وتكتب حركة `inventory_movements.quantity` بـ `purchase_items.quantity`
  - وتحسب التكلفة والـ avg_cost بناءً على نفس الكمية
  - المرجع: [receive_purchase_order](file:///d:/AhmedZ/supabase/migrations/20260210173500_prod_deploy_bundle.sql#L116-L228)

> هذا يعني عمليًا: إن كانت quantity مُدخلة “كرتون” بينما Base Unit “حبة”، سيتم تضخيم/تصغير المخزون والتكلفة.

### هل يتم التحويل إلى Base UOM قبل التسجيل؟

- يوجد Trigger يحسب `qty_base`، لكن **المنطق التشغيلي الحالي لا يظهر أنه يستخدم `qty_base`** عند تحديث on‑hand أو عند حساب avg_cost (على الأقل في `receive_purchase_order`).
- مؤشر خطر كبير: إضافة `qty_base` بدون استهلاكها في منطق الحركة غالبًا يترك النظام في حالة “نصف تنفيذ”.

### تدقيق Read‑Only مطلوب

```sql
-- هل qty_base موجود ويختلف عن quantity؟ (مؤشر هل التحويل مستخدم فعلاً)
select
  count(*) filter (where qty_base is null) as qty_base_null,
  count(*) filter (where qty_base is not null and qty_base <> quantity) as qty_base_differs
from public.inventory_movements;

-- عيّنات حركات
select
  im.id, im.item_id, im.movement_type, im.quantity, im.qty_base,
  im.unit_cost, im.total_cost, im.occurred_at, im.reference_table, im.reference_id
from public.inventory_movements im
order by im.occurred_at desc
limit 20;

-- هل stock_management.unit يتطابق مع menu_items.base_unit؟
select
  count(*) as mismatches
from public.stock_management sm
join public.menu_items mi on mi.id = sm.item_id
where sm.unit is not null
  and lower(btrim(sm.unit)) <> lower(btrim(mi.base_unit));
```

---

## 3.4 Costing Impact Audit

### الواقع الحالي

- يوجد `avg_cost` في `stock_management`.
- في الاستلام يتم تحديث average cost بأسلوب “Weighted Average” باستخدام الكمية الحالية + الكمية المستلمة.
  - المرجع: [receive_purchase_order](file:///d:/AhmedZ/supabase/migrations/20260210173500_prod_deploy_bundle.sql#L165-L192)
- لا يوجد في schema الحالي ما يدل على FIFO/LIFO على مستوى وحدات بديلة. توجد Batch tables (مثل `batch_balances`) لكن استخدامها يبدو موجّهًا للتتبع/FEFO أكثر من محاسبة FIFO كاملة.

### المخاطر عند تعدد الوحدات

- إذا كانت الكمية تُدخل بوحدة غير Base دون تحويل:
  - avg_cost يصبح غير صحيح (cost per base unit يختلط مع cost per carton/pack).
  - valuation و COGS يصبحان غير قابلة للتدقيق.

---

## 3.5 GL Consistency Audit

### الواقع الحالي

- القيود المحاسبية للمخزون مبنية على `inventory_movements.total_cost` فقط.
  - لا يوجد أي تحقق من الاتساق بين “الوحدة” و “التكلفة لكل وحدة”.
  - المرجع: [post_inventory_movement](file:///d:/AhmedZ/supabase/migrations/20260210173500_prod_deploy_bundle.sql#L50-L110)

### مخاطر تضخيم/تصغير القيم بسبب خلط الوحدات

- إذا تم إدخال حركة كمية “كرتون” بتكلفة “للكرتون” لكن المخزون يُفهم كحبات:
  - قيمة المخزون في GL قد تبدو صحيحة لحركة واحدة (total_cost = quantity*unit_cost)
  - لكن on‑hand بالوحدة الأساسية سيصبح خاطئًا → تقارير الربحية وكمية المخزون لا تتطابق مع الواقع.

---

## 3.6 Reporting Integrity Audit

### الواقع الحالي

- كثير من التقارير تعتمد على:
  - `inventory_movements.quantity`
  - `stock_management.available_quantity`
  - مع استثناءات للأوزان kg/gram في سياقات المبيعات.
- لا يوجد مؤشر قوي أن التقارير تستخدم `qty_base` كمرجع موحّد.

### المخاطر

- تقارير المخزون/الجرد/الربحية قابلة للتشويه إذا خلطت الوحدات.
- قد يظهر “نفس المنتج” أكثر من مرة **إذا تم تمثيله بأكثر من صنف** (workaround) بدل UOM متعدد.

---

## 4) Best Practices مقارنةً بـ SAP/Oracle/Dynamics/Odoo

### ما تتبعه الأنظمة العالمية عادة

- Base UOM واحدة لكل Item.
- كل Document Line يسجل:
  - Transaction UOM (مثلاً carton)
  - Quantity in Transaction UOM
  - Conversion Factor (Item‑specific غالبًا)
  - Quantity in Base UOM (مخزنة/محتسبة)
- On‑hand يُخزن دائمًا في Base UOM.
- التكلفة تُدار دائمًا على Base UOM (مع دعم LIFO/FIFO/Avg حسب السياسة).
- تحويلات UOM:
  - إما ثابتة “عالمية” لبعض الوحدات
  - أو “Item‑specific” للعبوات (pack/carton) وغالبًا مع تاريخ صلاحية.

### تقييم النظام الحالي

- ✔️ لديه Base Unit ومبدأ “توحد on‑hand” (مفترض).
- ✔️ بدأ بإضافة طبقة UOM حديثة (uom/item_uom/qty_base).
- ⚠️ تطبيق التحويل داخل مسارات التشغيل غير مكتمل (الكمية المستخدمة في تحديث المخزون والتكلفة لا يظهر أنها تعتمد `qty_base`).
- **التقييم**: ⚠️ قابل للإصلاح عبر Corrective Refactor.  
  ليس مطابقًا لـ Best Practices حاليًا في سيناريو Multi‑UOM (pack/carton).

---

## 5) Critical Issues (High / Medium / Low)

### High

- عدم استخدام `qty_base` في تحديث on‑hand و avg_cost → خلط وحدات يؤدي لأخطاء مخزون وتكلفة وربحية.
- عدم وجود تحويلات “Item‑specific” للعبوات (pack/carton) → لا يمكن تمثيلها صحيًا عبر uom_conversions العامة وحدها.

### Medium

- `uom_conversions` غير مؤرخة تاريخيًا (غير Suitable للتغييرات المستقبلية في التعبئة/الوزن الصافي).
- وجود `stock_management.unit` كحقل نصي قابل للانحراف عن `menu_items.base_unit`.

### Low

- منطق أوزان kg/gram مبني جزئيًا على استثناءات؛ مقبول لكنه يحتاج توحيد مع طبقة UOM الجديدة لاحقًا.

---

## 6) Financial & Operational Risk

- **Financial (COGS/Valuation): مرتفع** إذا كانت هناك إدخالات بغير Base Unit.
- **Operational (On‑hand/Availability): مرتفع**: قد يظهر توفر غير حقيقي في POS/الشراء/المستودعات.
- **Auditability: متوسط → مرتفع**: يصبح من الصعب تدقيق سبب الفروقات لأن البيانات لا تحمل UOM transaction بشكل صريح/مطبق.

---

## 7) Fixability Assessment

### Can be fixed without data loss?

- غالبًا نعم من ناحية schema لأن `qty_base` و `uom_id` موجودين بالفعل.
- لكن دقة الإصلاح تعتمد على: هل كانت البيانات التاريخية “مختلطة وحدات” أم لا.

### Requires Restatement?

- إذا اكتُشف أن الكميات التاريخية مُدخلة بوحدات مختلفة بدون تحويل، فتصحيح المخزون والتكلفة قد يتطلب Restatement/إعادة تقييم (خارج هذا التقرير لأنه ممنوع ضمن القيود الحالية).

### Requires Structural Redesign?

- لا يتطلب “إعادة تصميم جذري” إذا الهدف فقط دعم عبوات ثابتة لكل صنف.
- لكن لدعم pack/carton بشكل ERP‑Grade، ستحتاج إضافة “Item‑specific UOM conversion” (جدول جديد يربط item_id + from_uom + to_uom + factor).

---

## 8) Three Repair Options

### Option A — Minimal Fix (أقل تغيير)

- فرض قاعدة تشغيلية: **كل الكميات تُدخل دائمًا بـ Base Unit فقط** (حبة أو كجم)، ومنع pack/carton.
- تحديث واجهة المستخدم لتوضيح Base Unit بشكل قوي ومنع أي إدخال “كرتون/باكت”.
- الإيجابيات: سريع جدًا، لا يمس البيانات.
- السلبيات: لا يلبي احتياج تجارة الجملة/العبوات.

### Option B — Corrective Refactor (الموصى به)

- جعل كل المسارات (شراء/استلام/تحويل/بيع/مرتجعات/تسويات/جرد) تستخدم `qty_base` عند تحديث on‑hand وavg_cost.
- جعل كل إدخال يدعم Transaction UOM (uom_id) بشكل صريح، مع حفظ `qty_base`.
- إضافة جدول “Item‑specific packaging conversion” للـ pack/carton (لأنها تختلف حسب الصنف).
- الإيجابيات: يرفع النظام لمستوى Best Practice عمليًا بدون إعادة بناء كاملة.
- السلبيات: يحتاج تنفيذ هندسي مضبوط واختبارات قوية، وقد يكشف بيانات تاريخية مختلطة.

### Option C — Full Best‑Practice Migration

- إعادة تصميم طبقة المخزون بالكامل:
  - Transaction lines مع UOM + base_qty
  - valuation policy واضحة (FIFO/Avg)
  - تقارير مبنية على base_qty
  - workflow للعبوات والباركودات المتعددة
- الإيجابيات: أقرب إلى SAP/Dynamics/Odoo Enterprise.
- السلبيات: أعلى تكلفة ومخاطر، وقد يتطلب Restatement إذا كانت البيانات القديمة مختلطة.

---

## 9) Single Recommendation (واحدة فقط)

**أوصي بـ Option B — Corrective Refactor.**  
السبب: النظام بدأ فعليًا بإضافة UOM layer (`uom_id`/`qty_base` + triggers) لكن لم يتم “إقفال الحلقة” داخل منطق التشغيل. إكمال هذا المسار هو أفضل توازن بين الجودة والتكلفة، ويمنع أخطاء المخزون/التكلفة عند إدخال pack/carton دون إجبار المستخدم على إنشاء أصناف مكررة.

---

## Appendix — Evidence Links (من المستودع)

- menu_items + unit_type (قديم): [20251227000000_init.sql](file:///d:/AhmedZ/supabase/migrations/20251227000000_init.sql#L150-L190)
- إضافة base_unit وتطبيعها: [20260123252000_product_master_sot_lock_receiving_sellable_audit.sql](file:///d:/AhmedZ/supabase/migrations/20260123252000_product_master_sot_lock_receiving_sellable_audit.sql#L1-L88)
- UOM tables + triggers + qty_base: [enterprise_gaps_hardening.sql](file:///d:/AhmedZ/supabase/migrations/20260124100000_enterprise_gaps_hardening.sql#L941-L1157)
- inventory_movements schema الأصلي: [inventory_movements_cogs.sql](file:///d:/AhmedZ/supabase/migrations/20260107040000_inventory_movements_cogs.sql#L2-L23)
- receive_purchase_order (استخدام quantity مباشرة في on‑hand): [prod_deploy_bundle.sql](file:///d:/AhmedZ/supabase/migrations/20260210173500_prod_deploy_bundle.sql#L116-L221)
- post_inventory_movement (GL يعتمد total_cost فقط): [prod_deploy_bundle.sql](file:///d:/AhmedZ/supabase/migrations/20260210173500_prod_deploy_bundle.sql#L1-L111)

## Appendix — Local Schema Verification (Read‑Only)

> تم التحقق على قاعدة Supabase المحلية (Docker) أن الأعمدة والجداول المطلوبة موجودة:

- `inventory_movements` يحتوي: `uom_id`, `qty_base`, `quantity`, `unit_cost`, `total_cost`, `batch_id`, `warehouse_id`
- عدد أعمدة الجداول (للتأكد من وجودها وليس لتقييم البيانات):
  - uom: 3
  - uom_conversions: 5
  - item_uom: 5
  - inventory_movements: 21

- مؤشرات سريعة من قاعدة محلية (قد تختلف عن الإنتاج لأنها ليست بيانات تشغيل فعلية):
  - counts (menu_items, inventory_movements, stock_management, uom, uom_conversions, item_uom) = `4,8,2,2,0,2`
