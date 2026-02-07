# PARTY_LEDGER_ARCHITECTURE

تاريخ التنفيذ: 2026-02-07

## الهدف

توحيد تمثيل الأطراف المالية (Customers / Suppliers / Employees / Custodians / Partners / Generic) وربطها بـ GL بطريقة Append‑Only مع دعم FX snapshot وPeriod Lock وRLS، بدون كسر مسارات AR/AP/Payroll/Expenses/Payments/Inventory الحالية.

## مكونات الطبقة

### 1) Financial Parties

- جدول: [financial_parties](file:///d:/AhmedZ/supabase/migrations/20260207010000_party_ledger_core.sql)
  - يمثل الطرف المالي الموحد.
  - يحتوي `party_type` كتصنيف أساسي، وحقول ربط اختيارية `linked_entity_type/linked_entity_id` كربط “أساسي”.
  - `currency_preference` اختيارية (FK إلى `currencies` إن وجدت).
  - `is_active` بدل الحذف.

- جدول: [financial_party_links](file:///d:/AhmedZ/supabase/migrations/20260207010000_party_ledger_core.sql)
  - يسمح بربط طرف واحد بعدة أدوار/كيانات (Party يعمل كعميل ومورد معاً).
  - Unique على `(linked_entity_type, linked_entity_id, role)`.

### 2) Party Subledger Accounts

- جدول: [party_subledger_accounts](file:///d:/AhmedZ/supabase/migrations/20260207010000_party_ledger_core.sql)
  - يحدد أي حسابات GL يتم بناء Party Subledger عليها.
  - تم تفعيل افتراضياً على حسابات: AR (1200) / AP (2010) / Deposits (2050) / Advances (1350) / Custodian Cash (1035) / Other AR (1210) / Other AP (2110).
  - يمكن توسيعها لاحقاً بدون تعديل الكود.

### 3) Party Ledger Entries (Append‑Only)

- جدول: [party_ledger_entries](file:///d:/AhmedZ/supabase/migrations/20260207010200_party_ledger_entries.sql)
  - Append‑Only: تحديث/حذف ممنوع.
  - كل سطر يرتبط بـ `journal_line_id` (Unique) لتحقيق Subledger Integrity.
  - `running_balance` محسوب عند الإدراج وفق normal balance للحساب.
  - `currency_code/fx_rate/foreign_amount` تُحمل من journal line snapshot عند توفرها.

## التكامل مع GL (بدون كسر المسارات الحالية)

### party_id على journal_lines

- تمت إضافة `journal_lines.party_id` (اختياري) في:
  - [20260207010100_party_ledger_gl_integration.sql](file:///d:/AhmedZ/supabase/migrations/20260207010100_party_ledger_gl_integration.sql)

### استخراج Party تلقائياً

- Trigger قبل إدراج journal line:
  - يملأ `party_id` تلقائياً عندما يمكن استنتاجه من `journal_entries.source_table/source_id`:
    - orders → customer_auth_user_id → party(customer)
    - purchase_orders → supplier_id → party(supplier)
    - payments → reference_table/reference_id → party
    - expenses → data.partyId أو data.employeeId → party

### بناء Party Ledger عند الترحيل

- آلية إدراج party_ledger_entries:
  - عند إدراج journal line والـ journal_entry.status = posted: يتم إدراج subledger rows.
  - عند اعتماد قيد يدوي (draft → posted): Trigger على journal_entries يقوم بعمل backfill لسطور القيد.
  - هذه الآلية لا تتطلب تعديل مسارات posting الحالية.

## دعم FX و IAS 21 (على مستوى الطرف)

- وظيفة: [run_party_fx_revaluation](file:///d:/AhmedZ/supabase/migrations/20260207010400_party_fx_revaluation.sql)
  - تقوم بحساب فرق إعادة تقييم FX للأرصدة غير الأساسية لكل Party/Account/Currency داخل Party Subledger.
  - تنتج Journal Entry واحد كـ source_table='party_fx_revaluation' مع سطور على حساب الطرف (مع party_id) وعلى حسابات unrealized gain/loss.
  - لا تحذف أي بيانات، وتلتزم بـ Append‑Only.

## واجهات الاستعلام (Reporting)

- كشف حساب Party موحد:
  - RPC: [party_ledger_statement](file:///d:/AhmedZ/supabase/migrations/20260207010200_party_ledger_entries.sql)

- أعمار الديون على مستوى Party:
  - Views: `party_ar_aging_summary` و`party_ap_aging_summary` تربط نتائج الـ Aging الحالية بـ party_id عبر financial_party_links.

## التوافق الخلفي

هذه الطبقة تُضاف كامتداد:
- لا تعدل قيود/دفعات/مخزون موجودة.
- تضيف `party_id` كحقل اختياري على journal_lines.
- تبني Subledger مستقل Append‑Only دون تغيير معاني debit/credit الحالية.

## متطلبات الأمان

- RLS:
  - financial_parties / financial_party_links / party_subledger_accounts / party_ledger_entries محكومة بصلاحيات `accounting.view` للقراءة و`accounting.manage` للكتابة.
  - party_ledger_entries يمنع update/delete عبر policy + trigger.

## Smoke Tests

- Party Ledger Smoke:
  - SQL: [smoke_party_ledger_full.sql](file:///d:/AhmedZ/supabase/smoke/smoke_party_ledger_full.sql)
  - Script: `npm run smoke:party`

