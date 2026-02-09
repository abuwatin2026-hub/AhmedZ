# CURRENCY_FLOW_GL_PARTY_LEDGER

تاريخ التدقيق: 2026-02-09

## تدفق القيم بين GL و Party Ledger

- journal_lines:
  - التخزين الأساسي لـ debit/credit يكون بالعملة الأساسية للنظام.
  - عند وجود currency_code/foreign_amount/fx_rate، يتم اشتقاق قيم الأساس عند العرض عبر GL view.
  - مرجع: [enterprise_gl_lines](file:///D:/AhmedZ/supabase/migrations/20260209025000_reporting_fx_rate_fallback.sql#L3-L104), [enterprise_gl_lines (نسخة أخرى)](file:///D:/AhmedZ/supabase/migrations/20260207161000_financial_reporting_engine.sql#L49-L92).

- اشتقاق base_amount:
  - يُعاد اشتقاقه داخل View/Report باستخدام foreign_amount × fx_rate للفروق، وليس حقلاً ثابتاً مستقلاً.
  - مرجع: حقول signed_base_amount/signed_foreign_amount في GL view: [financial_reporting_engine](file:///D:/AhmedZ/supabase/migrations/20260207161000_financial_reporting_engine.sql#L70-L86).

- Party Ledger:
  - إدخالات party_ledger_entries تحمل base_amount و foreign_amount و currency_code و fx_rate مأخوذة من Snapshot السطر وقت الإدراج.
  - كشف الطرف يعرض running_balance بالأساسية مع إظهار foreign/base المفتوحة: [party_ledger_statement_v2](file:///D:/AhmedZ/supabase/migrations/20260207150300_settlement_aging_and_statement.sql#L57-L170).
  - إنشاء Open Items مشتق من إدخالات الطرف مع نقل القيم الأساسية والأجنبية: [upsert_party_open_item_from_party_ledger_entry](file:///D:/AhmedZ/supabase/migrations/20260207150100_settlement_open_items_derivation.sql#L105-L146).

## أثر High Inflation على P&L وCash

- لا يوجد تطبيق تضخم عالي مباشرة على سطور الإيراد/المصروف أو مخزون/COGS في التقارير؛ إعادة التقييم تقتصر على أرصدة نقدية/عملات (AR/AP/Open Items).
  - مرجع: [run_fx_revaluation](file:///D:/AhmedZ/supabase/migrations/20260203186000_fx_revaluation_append_only_and_high_inflation.sql#L84-L170) و[المسار AP](file:///D:/AhmedZ/supabase/migrations/20260203186000_fx_revaluation_append_only_and_high_inflation.sql#L205-L249).
  - Cash Flow يُحسب من حركات حسابات النقد بالأساسية: [cash_flow_statement](file:///D:/AhmedZ/supabase/migrations/20260209025000_reporting_fx_rate_fallback.sql#L180-L233).

## تتبع سيناريوهات (Trace) بدون تعديل بيانات

لكل سيناريو، نفّذ الاستعلامات التالية لاستخراج القيم الفعلية (قراءة فقط):

- بيع بـ SAR:
  - اختيار طلب: 
    - select id, data->>'currency' as currency, coalesce((data->>'fxRate')::numeric, 1) as fx_rate, coalesce((data->>'total')::numeric, 0) as total from public.orders where upper(data->>'currency') = 'SAR' order by created_at desc limit 1;
  - سطور القيد:
    - select l.currency_code, l.foreign_amount, l.fx_rate, l.debit, l.credit from public.enterprise_gl_lines l where l.source_table = 'orders' and l.source_id = <order_id>::text;
  - Party Ledger:
    - select foreign_amount, base_amount, currency_code, fx_rate, running_balance from public.party_ledger_statement_v2(<party_id>, null, null, null, null) where source_table='orders' and source_id = <order_id>::text;
  - Open Items/Settlement:
    - select open_foreign_amount, open_base_amount, status from public.party_open_items where source_table='orders' and source_id = <order_id>::text;
  - تقارير نهائية:
    - select * from public.enterprise_trial_balance(null, current_date, null, null, null, null, null, 'base', 'account') where group_key in ('4010','5010'); 

- شراء بـ SAR:
  - purchase_orders: 
    - select id, currency, fx_rate, total_amount, base_total from public.purchase_orders where upper(currency)='SAR' order by created_at desc limit 1;
  - GL/PL/Open Items مشابه للسيناريو أعلاه باستخدام source_table='purchase_orders'.

- مصروف بـ SAR:
  - import_expenses:
    - select id, currency, exchange_rate, amount, base_amount from public.import_expenses where upper(currency)='SAR' order by created_at desc limit 5;
  - GL: قيد الدفع/القيد المرتبط بالمصروف عبر journal_lines حسب المصدر.

- مرتجع بيع:
  - sales_returns:
    - select id, order_id, total_refund_amount from public.sales_returns order by return_date desc limit 1;
  - Payments (عملة المرتجع):
    - select direction, method, amount, currency from public.payments where reference_table='sales_returns' and reference_id=<return_id>::text;
  - GL/Party/Open Items مرتبطة بالمرتجع.

- مرتجع شراء:
  - purchase_returns عبر inventory_movements وقيود المخزون بالأساسية: راجع حركات return_out على المخزون المرتبط بالشراء.

- بيع بـ USD:
  - orders بعملة USD والاستعلامات المماثلة.

- عملية بـ YER (High Inflation):
  - التحقق من سعر الصرف المحاسبي والاتجاه: 
    - select rate_date, rate_type, rate from public.fx_rates where currency_code='YER' order by rate_date desc limit 5;
  - أثر على GL view والـ revalued balance عند العرض.

جدول المقارنة (نموذج أعمدة):

| المرحلة | currency_code | foreign_amount | fx_rate | base_amount/الأساس |
| المصدر/الإدخال | — | — | — | — |
| journal_lines/GL | — | — | — | — |
| Party Ledger | — | — | — | running_balance |
| Open Items/Settlement | — | open_foreign_amount | — | open_base_amount |
| التقارير النهائية | currency_code (base/foreign/revalued) | balance_foreign | fx_rate (عند revalued) | balance_base/revalued_balance_base |

