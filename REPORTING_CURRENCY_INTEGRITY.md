# REPORTING_CURRENCY_INTEGRITY

تاريخ التدقيق: 2026-02-09

## طبقات التقارير والتجميع

- enterprise_gl_lines:
  - يعرض debit/credit والسالب/الموجب بالأساسية، مع إظهار currency_code/foreign_amount/fx_rate للمراجعة: [financial_reporting_engine](file:///D:/AhmedZ/supabase/migrations/20260207161000_financial_reporting_engine.sql#L49-L92), [fallback النسخة](file:///D:/AhmedZ/supabase/migrations/20260209025000_reporting_fx_rate_fallback.sql#L3-L104).

- trial_balance:
  - التجميع عبر base_amount فقط؛ مع حقل balance_foreign للمراجعة و revalued_balance_base عند اختيار currency_view='revalued': [enterprise_trial_balance](file:///D:/AhmedZ/supabase/migrations/20260207161000_financial_reporting_engine.sql#L94-L190), [trial_balance البسيطة](file:///D:/AhmedZ/supabase/migrations/20260209025000_reporting_fx_rate_fallback.sql#L107-L177).

- profit_and_loss:
  - مُخرجات amount_base فقط: [enterprise_profit_and_loss](file:///D:/AhmedZ/supabase/migrations/20260207161000_financial_reporting_engine.sql#L261-L321).

- cash_flow:
  - يعتمد على حسابات النقد ويُعيد القيم بالأساسية: [cash_flow_statement](file:///D:/AhmedZ/supabase/migrations/20260209025000_reporting_fx_rate_fallback.sql#L180-L233), [enterprise_cash_flow_direct](file:///D:/AhmedZ/supabase/migrations/20260207161000_financial_reporting_engine.sql#L387-L446).

- party_ledger_statement:
  - يُظهر base_amount و foreign_amount؛ التجميع في Aging/Open Items مبني على open_base_amount: [party_ledger_statement_v2](file:///D:/AhmedZ/supabase/migrations/20260207150300_settlement_aging_and_statement.sql#L57-L170), [party_ar_aging_summary](file:///D:/AhmedZ/supabase/migrations/20260207150300_settlement_aging_and_statement.sql#L3-L28), [party_ap_aging_summary](file:///D:/AhmedZ/supabase/migrations/20260207150300_settlement_aging_and_statement.sql#L30-L55).

## النتيجة

- التجميع في التقارير الأساسية يتم عبر base_amount فقط (✔).
- عرض foreign/revalued متاح لأغراض التدقيق وإعادة التقييم دون تغيير أساس التجميع (✔).

