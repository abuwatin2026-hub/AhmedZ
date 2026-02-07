# MULTI_CURRENCY_ARCHITECTURE (Phase 5)

## المبادئ الثابتة

- العملة الأساسية (Base Currency) هي عملة الدفاتر (GL) والتقارير المالية.
- جميع `journal_lines.debit/credit` تُخزّن بالعملة الأساسية فقط.
- أي عملية بعملة أجنبية تُثبّت وقتها عبر:
  - `orders.currency / orders.fx_rate / orders.base_total`
  - `payments.currency / payments.fx_rate / payments.base_amount`
- قيود GL Append‑Only: لا يتم تعديل/حذف قيود نظامية موجودة، وأي تصحيح يتم بقيود جديدة أو قيود عكس.

## تعريف اتجاه سعر الصرف (FX Policy)

يُعرّف السعر كما يلي:

- `fx_rate = Base per 1 Foreign Currency`
- أمثلة:
  - إذا كانت العملة الأساسية SAR والدفع USD: `fx_rate = 3.75` يعني `1 USD = 3.75 SAR`
  - إذا كانت العملة الأساسية SAR والعملة عالية التضخم YER: `fx_rate` المتوقع يكون أقل من 1 (مثال `0.0025` يعني `1 YER = 0.0025 SAR`)

ملاحظات:
- يتم تخزين الأسعار في `fx_rates.rate` بنفس الاتجاه أعلاه.
- يتم تطبيع إدخالات العملات عالية التضخم عند الإدخال (Normalization) لمنع التخزين بالعكس.

## تقسية إدخال FX (FX Input Hardening)

قواعد قاعدة البيانات لإدخال أسعار الصرف:

- اتجاه التخزين دائمًا: `Base per 1 Foreign Currency`.
- السماح بإدخال السعر بالعكس من المستخدم في حالات شائعة، ثم تطبيعه تلقائيًا قبل التخزين:
  - إذا كانت العملة الأساسية غير عالية التضخم، والعملة الأجنبية عالية التضخم: إدخال `Foreign per 1 Base` سيتم عكسه تلقائيًا ليصبح `< 1`.
  - إذا كانت العملة الأساسية عالية التضخم، والعملة الأجنبية غير عالية التضخم: إدخال `Base per 1 Foreign` المتوقع يكون `> 1`، وأي إدخال `< 1` سيتم عكسه تلقائيًا.
- بعد التطبيع، يتم رفض الإدخال إذا بقيت دلالة الاتجاه غير صحيحة وفق علم التضخم:
  - Base غير عالي التضخم + Foreign عالي التضخم ⟶ يجب أن يكون `rate < 1`.
  - Base عالي التضخم + Foreign غير عالي التضخم ⟶ يجب أن يكون `rate > 1`.

أثر ذلك:
- يقل احتمال إدخال سعر باتجاه خاطئ مع الحفاظ على سلوك التطبيع الحالي للعملات عالية التضخم.

## المكوّنات (Database Model)

### العملات

- `public.currencies`
  - `code` (PK)
  - `is_base`
  - `is_high_inflation`

### أسعار الصرف

- `public.fx_rates`
  - `currency_code`
  - `rate` (Base per 1 Foreign)
  - `rate_date`
  - `rate_type`: `operational | accounting`

### تثبيت FX على المستندات

- `public.orders`
  - `currency`, `fx_rate`, `base_total`, `fx_locked`
- `public.payments`
  - `currency`, `fx_rate`, `base_amount`, `fx_locked`

### FX Snapshot داخل القيود

لتعزيز التدقيق دون تغيير توازن القيود:

- `public.journal_entries`
  - `currency_code`, `fx_rate`, `foreign_amount` (اختيارية)
- `public.journal_lines`
  - `currency_code`, `fx_rate`, `foreign_amount` (اختيارية)

## تدفق البيانات (Posting Flows)

### 1) Order Posting (Sales / Invoice)

أهداف الترحيل:
- عدم الاعتماد على `order.data.total` في القيد الدفتري.
- الاعتماد على `orders.base_total` حصراً كمبلغ أساس للـ GL.

نقاط التنفيذ:
- `post_order_delivery(order_id)`:
  - يتحقق من وجود `orders.base_total`.
  - يحسب بنود الفاتورة بالعملة الأساسية عبر `orders.fx_rate`.
  - يجمع الدفعات المسبقة باستخدام `payments.base_amount` فقط.
- `post_invoice_issued(order_id, issued_at)`:
  - نفس المبدأ: `base_total` + تحويل `invoiceSnapshot` إلى Base.

### 2) Payment Posting + Realized FX

- `post_payment(payment_id)` يعتمد على `payments.base_amount` المخزن (ولا يعيد حساب FX من جدول الأسعار).
- عند تسوية ذمة (AR/AP) بالكامل:
  - `difference = payment.base_amount - outstanding_base_amount`
  - للـ AR:
    - `difference > 0` ⟶ Credit `6200` (FX Gain Realized)
    - `difference < 0` ⟶ Debit `6201` (FX Loss Realized)
  - للـ AP:
    - `difference > 0` ⟶ Debit `6201` (Loss)
    - `difference < 0` ⟶ Credit `6200` (Gain)

## إعادة تقييم العملات (Unrealized Revaluation)

### AR/AP

- `run_fx_revaluation(period_end)`:
  - AR: يعتمد على `ar_open_items.open_balance` كرصيد أساس، ويقدّر المتبقي الأجنبي كنسبة من الفاتورة.
  - AP: يعتمد على `purchase_orders.base_total` والمتبقي من الدفعات.
  - يستخدم `rate_type = 'accounting'`.
  - يُنشئ قيد عكس تلقائي في اليوم التالي.

### النقد والبنوك (Monetary Accounts)

- يتم اشتقاق “الرصيد الأجنبي” من `journal_lines.foreign_amount` المرفق على أسطر النقد/البنك.
- يتم إنشاء قيود Unrealized لنفس الحساب النقدي مقابل `6250/6251` مع قيد عكس تلقائي.

## الرواتب متعددة العملات (Payroll)

عند إنشاء مسير الرواتب:

- إذا كانت عملة الموظف ≠ Base:
  - `fx_rate` يُجلب لآخر يوم في الشهر (`accounting` ثم fallback `operational`)
  - `gross_base = foreign_amount * fx_rate`
- يتم تخزين:
  - `payroll_run_lines.foreign_amount`
  - `payroll_run_lines.fx_rate`
  - `payroll_run_lines.currency_code`
- وتبقى قيود الاستحقاق (`record_payroll_run_accrual_v2`) بالعملة الأساسية فقط.

## اختبارات الدخان

- `supabase/smoke/smoke_multi_currency_full.sql`
  - Order بعملة أجنبية + ترحيل بيع
  - Payment لاحق بسعر مختلف + تحقق Realized FX
  - Revaluation للـ Monetary عبر foreign snapshot على cash/bank
  - Payroll multi‑currency + تحقق التحويل والتخزين

## قواعد عدم القابلية للتعديل (Immutability Rules)

- GL Append‑Only:
  - لا يتم تعديل أو حذف `journal_entries/journal_lines` بعد الترحيل، وأي تصحيح يتم بقيود عكس أو قيود جديدة.
  - `journal_lines` بالعملة الأساسية فقط، وتُرفض أي محاولة لإنشاء سطر Debit+Credit أو سطر صفري.
- FX Locking على المستندات:
  - `orders.fx_locked` و `payments.fx_locked` تمنع تغيير العملة/FX بعد وجود أثر محاسبي.
- مخزون Append‑Only عند الترحيل:
  - أي `inventory_movements` لديها قيد محاسبي مرتبط تعتبر مُرحّلة، وتُمنع UPDATE/DELETE، ويجب إنشاء حركة عكس (Reversal) بدلًا من التعديل.

## قواعد العكس (Reversal Rules)

- Reverse Journal:
  - يتم إنشاء قيد جديد بعكس القيود الأصلية (Debit/Credit swap) مع ربط `source_table/source_id`، دون حذف القيود الأصلية.
- Revaluation:
  - قيود إعادة التقييم غير المحققة تُنشئ قيد عكس تلقائي في اليوم التالي للحفاظ على النظافة المحاسبية لكل فترة.

## تغطية التدقيق (Audit Coverage)

الأحداث التالية يتم تسجيلها في `system_audit_logs`:

- تغييرات أسعار FX (INSERT/UPDATE/DELETE على `fx_rates`).
- تشغيل Revaluation (سجل تشغيل للفترة).
- إغلاق فترة مالية (تغيير حالة الفترة إلى `closed`).
- تنفيذ Reverse Journal (إدراج قيد بعلامة reversal).
- تعديل إعدادات الحسابات الافتراضية (`app_settings.accounting_accounts`).
