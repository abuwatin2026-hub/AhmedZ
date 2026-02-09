# MULTI_CURRENCY_CURRENT_STATE

تاريخ التدقيق: 2026-02-09

## ملخص الواقع الحالي (Ground Truth)

- Base Currency (GL): YER
  - تُحدّد عبر الدالة [get_base_currency](file:///D:/AhmedZ/supabase/migrations/20260203180000_base_currency_governance_strict.sql#L68-L117) مع حوكمة صارمة للتوافق بين app_settings و currencies.
  - تهئية أولية تضبط العملة الأساسية إلى YER: [20260203125000_base_currency_seed.sql](file:///D:/AhmedZ/supabase/migrations/20260203125000_base_currency_seed.sql#L1-L24).
- Operational Currencies: SAR / USD / YER
  - إضافة العملات التشغيلية القياسية: [seed_currencies](file:///D:/AhmedZ/supabase/migrations/20260204200000_seed_currencies.sql#L1-L28).
- High Inflation: مفعّل على YER
  - تفعيل العلامة: [fx_enterprise_phase](file:///D:/AhmedZ/supabase/migrations/20260203130000_fx_enterprise_phase.sql#L1-L22).
  - تطبيع أسعار الصرف للعملات ذات التضخم العالي: [normalize trigger](file:///D:/AhmedZ/supabase/migrations/20260208311000_fx_rates_normalize_high_inflation_trigger_v1.sql#L1-L62).

## Transaction Currency لكل مسار

- Sales (Orders):
  - تُحمل عملة المعاملة وسعر الصرف في Snapshot الطلب: [online_checkout_transaction_currency](file:///D:/AhmedZ/supabase/migrations/20260205183000_online_checkout_transaction_currency.sql#L382-L420).
- Purchases:
  - الحقول currency/fx_rate/base_total على purchase_orders: [fx_enterprise_phase](file:///D:/AhmedZ/supabase/migrations/20260203130000_fx_enterprise_phase.sql#L76-L120).
- Expenses:
  - مصاريف الشحنة تحمل currency و exchange_rate مع عمود base_amount محسوب: [import_system](file:///D:/AhmedZ/supabase/migrations/20260120030000_import_system.sql#L34-L57), [import_expenses_base_amount](file:///D:/AhmedZ/supabase/migrations/20260203190000_import_expenses_base_amount.sql#L1-L13).
  - جدول expenses العام بلا حقل عملة؛ يُفترض الأساسيات بالعملة الأساسية.
- Inventory:
  - تقييم المخزون وحركاته بالأساسية فقط (unit_cost/total_cost): [warehouses_system](file:///D:/AhmedZ/supabase/migrations/20260120000000_warehouses_system.sql#L276-L304), [inventory_batches](file:///D:/AhmedZ/supabase/migrations/20260115140000_inventory_batches.sql#L45-L86).
- Returns:
  - مرتجع البيع يُسجّل مدفوعات باستعادة عملة الطلب: [process_sales_return](file:///D:/AhmedZ/supabase/migrations/20260113153000_sales_return_discount_fix.sql#L178-L206).
  - مرتجع الشراء يحدّث المخزون والقيود بالأساسية: [purchase_accounting_controls](file:///D:/AhmedZ/supabase/migrations/20260109006000_purchase_accounting_controls.sql#L371-L407).

## Reporting Currency

- Trial Balance:
  - تجميع بالعملة الأساسية مع عرض اختياري للـ foreign/revalued: [enterprise_trial_balance](file:///D:/AhmedZ/supabase/migrations/20260207161000_financial_reporting_engine.sql#L94-L190).
  - نسخة بسيطة: [trial_balance](file:///D:/AhmedZ/supabase/migrations/20260209025000_reporting_fx_rate_fallback.sql#L107-L177).
- P&L:
  - مخرجات amount_base فقط: [enterprise_profit_and_loss](file:///D:/AhmedZ/supabase/migrations/20260207161000_financial_reporting_engine.sql#L261-L321).
- Cash Flow:
  - يعتمد على تجميع حركات حسابات النقد بالأساسية: [cash_flow_statement](file:///D:/AhmedZ/supabase/migrations/20260209025000_reporting_fx_rate_fallback.sql#L180-L233), ونسخة Enterprise: [enterprise_cash_flow_direct](file:///D:/AhmedZ/supabase/migrations/20260207161000_financial_reporting_engine.sql#L387-L446).
- Party Ledger:
  - كشف طرف يعرض base_amount و foreign_amount ويشتق الرصيد الجاري بالأساسية: [party_ledger_statement_v2](file:///D:/AhmedZ/supabase/migrations/20260207150300_settlement_aging_and_statement.sql#L57-L170).

## تعدد قاعدة (Multiple Base) في التجميع

- مرفوض وفق الحوكمة الصارمة؛ يتم التحقق الصارم من تطابق مصدرَي الإعداد: [base_currency_governance_strict](file:///D:/AhmedZ/supabase/migrations/20260203180000_base_currency_governance_strict.sql#L1-L66).

