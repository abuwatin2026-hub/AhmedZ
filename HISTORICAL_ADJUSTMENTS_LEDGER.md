# HISTORICAL_ADJUSTMENTS_LEDGER

تاريخ الإنشاء: 2026-02-09

## الغرض

- سجل تدقيقي لقيود الـ Adjustment التي يتم إنشاؤها لأغراض Restatement بعد تثبيت SAR كأساس.
- الحفاظ على Traceability عبر ربط كل Adjustment بالقيد الأصلي.

## مكان تسجيل الربط

- جدول الربط:
  - public.base_currency_restatement_entry_map
  - الحقول الأساسية: original_journal_entry_id, restated_journal_entry_id, status, notes, created_at
  - تعريف الجدول: [base_currency_restatement_schema.sql](file:///D:/AhmedZ/supabase/migrations/20260209102000_base_currency_restatement_schema.sql#L31-L62)

## توقيع القيود المُنشأة

- journal_entries:
  - source_table = 'base_currency_restatement'
  - source_event = 'historical_base_currency_restatement'
  - source_id = original_journal_entry_id::text (للربط النصي)
  - reference_entry_id = original_journal_entry_id (للربط البنيوي)
  - memo يحتوي على معرف القيد الأصلي ونوع التحويل (YER→SAR)
  - إنشاء القيد داخل الدالة: [run_base_currency_historical_restatement](file:///D:/AhmedZ/supabase/migrations/20260209103000_base_currency_restatement_batch_rpc.sql#L69-L158)

## نمط القيود داخل Adjustment JE

- لكل سطر أصلي:
  - سطر عكس (Reversal) بقيم debit/credit معكوسة وبنفس Snapshot (إن وُجد).
  - سطر مُعاد صياغته (Restated) بقيم أساس SAR:
    - إذا كان السطر يحمل foreign_amount و currency_code غير SAR: يتم إعادة حساب fx_rate إلى SAR ثم base_amount = foreign×fx.
    - إذا لم توجد Snapshot: يُعتبر السطر مُسجّلًا بعملة الأساس القديمة (YER) ويتم تحويله إلى SAR عبر get_fx_rate('YER', entry_date, 'accounting').

## التسويات (Settlement) الخاصة بالـ AR/AP/Open Items

- في حال وجود Open Item للسطر الأصلي وسطر العكس، يتم إنشاء Settlement تلقائيًا لإغلاقهما (Append‑Only).
  - آلية التسوية ضمن الدالة نفسها: [run_base_currency_historical_restatement](file:///D:/AhmedZ/supabase/migrations/20260209103000_base_currency_restatement_batch_rpc.sql#L257-L324)
