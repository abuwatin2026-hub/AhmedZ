# CURRENT_STATE_PARTY_LEDGER

تاريخ التدقيق: 2026-02-07

## ملخص سريع

النظام الحالي لا يحتوي على طبقة Party Ledger موحدة تغطي كل الأطراف (Customer/Supplier/Employee/Custodian/Generic) بشكل Enterprise‑Grade. توجد بعض Subledgers المتخصصة (مثل AR Open Items للطلبات وDriver Ledger لنقد COD) لكنها جزئية ومربوطة بسياقات محددة وليست توحيداً عاماً للأطراف.

## الجداول التي تمثل أطرافاً مالية حالياً

- العملاء: [customers](file:///d:/AhmedZ/supabase/migrations/20251227000000_init.sql)
  - المفتاح: `auth_user_id` (يرتبط بـ `auth.users`)
  - حقول مالية/شبه مالية: `total_spent`, `payment_terms` (أضيفت لاحقاً), `preferred_currency` (أضيفت لاحقاً)
  - لا يوجد معرف Party موحد ولا ربط مباشر بقيد/سطر قيد.

- الموردون: [suppliers](file:///d:/AhmedZ/supabase/migrations/20260107020000_suppliers_purchasing.sql)
  - المفتاح: `id` (UUID)
  - حقول: الاسم/بيانات تواصل/ضريبي، و`preferred_currency` (أضيفت لاحقاً)
  - لا يوجد Party موحد.

- الموظفون (Payroll): [payroll_employees](file:///d:/AhmedZ/supabase/migrations/20260206090000_payroll_engine_light.sql)
  - المفتاح: `id`
  - حقول مالية: `monthly_salary`, `currency`
  - لا يوجد Party موحد ولا Subledger للأرصدة الشخصية (سلفة/عهدة) على مستوى GL.

- مندوبو التوصيل (drivers): لا يوجد جدول Parties موحد، لكن يوجد Driver Ledger خاص بـ COD يعتمد على `auth.users(driver_id)`.
  - Driver Ledger: [driver_ledger](file:///d:/AhmedZ/supabase/migrations/20260127093000_cod_cash_in_transit_ledger.sql)

## Subledgers الحالية (الربط الجزئي)

- AR Open Items (للعملاء عبر الطلبات فقط):
  - [ar_open_items](file:///d:/AhmedZ/supabase/migrations/20260127121000_ar_open_item_core.sql)
  - يرتبط بـ `orders` و`journal_entries` لكنه لا يمثل Party عام؛ العميل يُستدل عليه ضمنياً من `orders.customer_auth_user_id`.
  - لا يدعم الموردين/الموظفين/الأطراف العامة.

- COD Driver Ledger (مخصص لـ COD فقط):
  - [ledger_entries/ledger_lines/driver_ledger](file:///d:/AhmedZ/supabase/migrations/20260127093000_cod_cash_in_transit_ledger.sql)
  - Ledger مستقل عن GL (ليس `journal_entries/journal_lines`) ويخدم سيناريو COD Cash‑in‑Transit تحديداً.

## GL الحالي وكيف يتعامل مع الأطراف

- دفتر الأستاذ العام: `journal_entries` و`journal_lines` (مع FX snapshot على مستوى القيد/السطر).
  - Schema: [coa_journal.sql](file:///d:/AhmedZ/supabase/migrations/20260107120000_coa_journal.sql)
  - `journal_entries` يحتوي `source_table/source_id/source_event` وهي مفيدة لتتبع المصدر لكنها ليست Party abstraction.
  - `journal_lines` لا يحتوي `party_id` أو أي ربط مباشر لطرف مالي.
  - تم إضافة أعمدة FX snapshot على السطور: `currency_code`, `fx_rate`, `foreign_amount` (ومثلها على `journal_entries`).

## أين تظهر الأطراف ضمن العمليات التشغيلية الحالية

- Sales/Orders:
  - `orders.customer_auth_user_id` يمثل العميل.
  - التحصيل يتم عبر `payments(reference_table='orders')`.
  - هناك AR Open Items للأوامر (غير موحد).

- Procurement/Purchase Orders:
  - `purchase_orders.supplier_id` يمثل المورد.
  - الدفع عبر `payments(reference_table='purchase_orders')`.
  - لا يوجد AP Open Items/Subledger مماثل لـ AR Open Items.

- Expenses/Payroll:
  - `expenses` موجود مع `data` و`cost_center_id`.
  - الدفع عبر `payments(reference_table='expenses')`.
  - الرواتب ترتبط بـ `payroll_runs.expense_id` ثم يتم الدفع كـ payment على expense.
  - لا يوجد Party موحد للموظف ولا Subledger يربط قيود الرواتب/المدفوعات بالموظفين كأطراف مالية.

## نقاط القوة الحالية

- GL + Append‑Only/Immutability متقدم نسبياً: قيود/حركات مخزون/مدفوعات بعد الترحيل يتم منع تعديلها أو حذفها في عدة مسارات.
- Multi‑Currency موجود على `orders/payments/purchase_orders` مع تثبيت FX وأرشفة FX snapshot في القيود.
- Period Lock موجود لمنع ترحيل/تعديل ضمن فترة مقفلة.

## الفجوات بالنسبة لـ Unified Financial Parties / Party Ledger

- لا يوجد جدول موحد للأطراف المالية ولا Mapping موحد عبر Customer/Supplier/Employee/… إلخ.
- لا يوجد Party Subledger Append‑Only يربط `journal_lines` بالأطراف على شكل كشف حساب موحد.
- ربط GL بالأطراف يتم بشكل ضمني داخل كل مسار (orders/suppliers/payroll) وليس عبر Abstraction واحدة.
- Revaluation للأطراف غير موجود كطبقة صريحة (الموجود حالياً يركز على حسابات/مستندات مع FX).

## الاستنتاج

الحالة الحالية هي نظام GL قوي مع Subledgers متخصصة جزئياً، لكنه لا يحقق الهدف المطلوب: تسجيل ومتابعة أرصدة أي طرف مالي موحد عبر كل العمليات مع دعم FX وAppend‑Only وPeriod Lock وRLS على مستوى Subledger موحد.

