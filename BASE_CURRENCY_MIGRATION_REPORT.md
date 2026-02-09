# BASE_CURRENCY_MIGRATION_REPORT

تاريخ التنفيذ: 2026-02-09

## الهدف

- تثبيت العملة الأساسية (Base Currency) على SAR بشكل نهائي.
- الحفاظ على Append‑Only Ledger وعدم تعديل القيود الأصلية مباشرة.
- ضمان أن التقارير (GL/TB/P&L/Cash Flow/Party Ledger) تعتمد SAR كأساس وحيد.

## لماذا SAR

- SAR هي العملة المرجعية التشغيلية المستهدفة للمؤسسة، وتُستخدم كأساس للتجميع والتقارير.

## ما الذي تغيّر (Configuration + Governance)

- get_base_currency() أصبحت تُعيد SAR فقط وتتحقق من حالة الإعدادات والجداول.
  - [base_currency_migration_sar_lock.sql](file:///D:/AhmedZ/supabase/migrations/20260209091000_base_currency_migration_sar_lock.sql#L44-L101)
- تم قفل set_base_currency() لمنع أي تغيير لاحق للأساس.
  - [base_currency_migration_sar_lock.sql](file:///D:/AhmedZ/supabase/migrations/20260209091000_base_currency_migration_sar_lock.sql#L103-L114)
- تم تحديث currencies و app_settings لضمان:
  - SAR is_base = true و is_high_inflation = false
  - YER is_high_inflation = true
  - منع أي محاولة لاحقة لتغيير base currency.
  - [base_currency_migration_sar_lock.sql](file:///D:/AhmedZ/supabase/migrations/20260209091000_base_currency_migration_sar_lock.sql#L3-L42)
  - [trg_lock_base_currency_sar_currencies](file:///D:/AhmedZ/supabase/migrations/20260209091000_base_currency_migration_sar_lock.sql#L116-L156)
  - [trg_lock_base_currency_sar_app_settings](file:///D:/AhmedZ/supabase/migrations/20260209091000_base_currency_migration_sar_lock.sql#L168-L199)

## قفل قواعد الإدخال (Guards)

- منع إدخال سطر أساس يحمل foreign_amount أو fx_rate.
- منع إدخال fx_rate = 1 لعملة ليست الأساس.
  - [trg_journal_lines_sar_base_invariants](file:///D:/AhmedZ/supabase/migrations/20260209091000_base_currency_migration_sar_lock.sql#L201-L220)

## إصلاح التاريخ (Append‑Only Restatement)

- تم إضافة محرك Restatement عبر Adjustment Journal Entries فقط، بدون UPDATE/DELETE على journal_lines أو journal_entries.
  - تتبع: base_currency_migration_entry_map (ربط JE الأصلي بالمُعاد صياغته).
  - تنفيذ دفعات: run_base_currency_historical_restatement(p_batch, p_posting_date).
  - source_table للـ Adjustment: base_currency_restatement مع reference_entry_id = القيد الأصلي.
  - [base_currency_restatement_schema.sql](file:///D:/AhmedZ/supabase/migrations/20260209102000_base_currency_restatement_schema.sql)
  - [base_currency_restatement_batch_rpc.sql](file:///D:/AhmedZ/supabase/migrations/20260209103000_base_currency_restatement_batch_rpc.sql)

## ما الذي لم يُمس

- لم يتم تعديل أي قيد تاريخي داخل journal_entries أو journal_lines.
- لا UPDATE/DELETE على القيود الأصلية؛ أي تصحيح يتم بإضافة قيود Adjustment جديدة فقط.
