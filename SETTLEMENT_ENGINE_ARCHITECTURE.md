# Settlement / Allocation Engine (Enterprise AR/AP) — Architecture

## المبادئ غير القابلة للتفاوض

- لا تعديل لأي قيد GL منشور.
- Append‑Only للتسويات: لا حذف ولا تعديل، الإلغاء يكون عبر Reversal Settlement.
- Multi‑Currency: دعم Partial Allocation + Snapshot Rates + Realized FX.
- Settlement يعمل عبر طبقة الطرف: `party_ledger_entries` → `party_open_items`.
- Period Lock: منع إنشاء Settlement داخل فترة محاسبية مغلقة.
- RLS + Audit: القراءة `accounting.view` والكتابة `accounting.manage` والتدقيق إلزامي.

---

## 1) طبقة Open Items (party_open_items)

### الهدف
تحويل حركة الطرف من “دفتر أستاذ” إلى “ذمم قابلة للتسوية” بشكل رسمي:
- كل سطر طرف على حسابات Subledger المحددة يصبح Open Item.
- يتم تحديث open amounts عند التسوية بدون لمس الـ GL الأصلي.

### المصدر
يتم توليد Open Items تلقائياً من `party_ledger_entries` عند الإدراج (posting).

### أهم الأعمدة
- `party_id`, `journal_entry_id`, `journal_line_id`, `account_id`
- `direction` (debit/credit)
- `currency_code`, `foreign_amount`, `base_amount`
- `open_foreign_amount`, `open_base_amount`, `status`
- `item_role` (ar/ap/deposits/… من `party_subledger_accounts`)
- `item_type` (invoice/receipt/payment/advance/credit_note/debit_note/…)
- `source_table/source_id/source_event` للمرجعية

### مبدأ “Open Items ≠ GL”
- Open Items طبقة تشغيلية Subledger.
- الـ GL يبقى Append‑Only كما هو.
- نتيجة التسويات تظهر في:
  - الأرصدة المفتوحة
  - الأعمار (Aging)
  - كشف الحساب (Statement) مع مراجع التسويات

---

## 2) التسويات (Settlement Headers/Lines)

### settlement_headers
يمثل عملية التسوية نفسها:
- `party_id`
- `settlement_date`
- `currency_code` (عملة التسوية)
- `settlement_type`: normal أو reversal
- `reverses_settlement_id` عند العكس

### settlement_lines
يمثل الربط الفعلي بين عنصرين:
- `from_open_item_id` (Debit side)
- `to_open_item_id` (Credit side)
- `allocated_foreign_amount` (للعملات الأجنبية)
- `allocated_base_amount` (القيمة المطبقة على debit item)
- `allocated_counter_base_amount` (القيمة المطبقة على credit item)
- `realized_fx_amount` = counter_base - base

### قاعدة الاتجاه
التخصيصات تُسجل دائمًا:
- From = Debit Open Item
- To = Credit Open Item

هذا يجعل التحقق والـ FIFO أبسط ويمنع الانعكاسات غير المقصودة.

---

## 3) Realized FX (قيد تلقائي بدون تعديل أي قيد أصلي)

### المشكلة
في عملة أجنبية:
- Invoice تم تسجيله بسعر صرف (Snapshot) مختلف عن Receipt/Payment.
- عند التسوية، الفرق لا يمكن “تصحيحه” بتعديل القيود الأصلية.

### الحل
عند وجود فرق FX مُحقق:
- ينشئ النظام Journal Entry جديد:
  - `source_table = 'settlements'`
  - `source_id = settlement_id`
  - `source_event = 'realized_fx'`
- القيد يصفّر فرق حساب الطرف (AR/AP) ويُسجل Gain/Loss على حسابات:
  - `6200` FX Gain Realized
  - `6201` FX Loss Realized

### منع توليد Open Items من FX JE
قيد Realized FX ليس “ذمة قابلة للتسوية”، لذلك لا يتم توليد Open Item له.

---

## 4) Reversal Settlement

### الهدف
إلغاء التسوية بدون تعديل/حذف السجلات:
- إنشاء `settlement_headers` جديد من نوع `reversal`
- إدراج `settlement_lines` عكسية (realized_fx_amount بسالب)
- إعادة فتح open amounts بإرجاع الدلتا
- عكس قيود FX فقط عبر `reverse_journal_entry`

---

## 5) Auto Matching (FIFO)

### الدالة
`auto_settle_party_items(party_id)`

### السلوك
- مطابقة debit items مع credit items لنفس الطرف والعملة
- FIFO حسب `due_date` ثم `occurred_at`
- ينتج Settlement واحد بالـ allocations المكتشفة

---

## 6) Aging Integration

تم تحديث:
- `party_ar_aging_summary`
- `party_ap_aging_summary`

لتعتمد على `party_open_items` (المتبقي) بدل الاعتماد المباشر على ledger.

---

## 7) Statement Integration

دالة جديدة:
- `party_ledger_statement_v2(...)`

ترجع:
- حركات الطرف من `party_ledger_entries`
- + الحقول: `open_base_amount/open_foreign_amount/open_status`
- + `allocations` كـ JSONB يحوي مراجع التسويات لكل سطر

---

## 8) Security (RLS) + Audit

- RLS:
  - القراءة: `accounting.view`
  - الكتابة: `accounting.manage`
- Audit:
  - `settlements.create`
  - `settlements.reverse`
  - `settlements.auto_run`

---

## 9) Smoke Tests

ملف الاختبار:
- `supabase/smoke/smoke_settlement_engine.sql`

يغطي:
- Full settlement
- Partial settlement
- Multi‑currency + realized FX
- Advance application
- Reversal settlement
- Auto settlement (FIFO)
- Aging correctness
- Period lock enforcement

