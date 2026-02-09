# HIGH_INFLATION_APPLICATION_REPORT

تاريخ التدقيق: 2026-02-09

## أين يُستخدم علم التضخم العالي

- currencies.is_high_inflation:
  - تفعيل العلم على YER: [fx_enterprise_phase](file:///D:/AhmedZ/supabase/migrations/20260203130000_fx_enterprise_phase.sql#L1-L22).
- get_fx_rate:
  - منطق خاص لتحديد اتجاه السعر عند اختلاف حالة التضخم بين الأساس والعملة الأجنبية، مع انعكاس/تطبيع حسب الحالة: [fix_get_fx_rate_inversion_high_inflation](file:///D:/AhmedZ/supabase/migrations/20260205170000_fix_get_fx_rate_inversion_high_inflation.sql#L1-L93).
- تطبيع إدخالات fx_rates:
  - Trigger للتطبيع قبل الإدراج/التحديث لمنع معدلات غير منطقية على عملة تضخم مرتفع: [normalize trigger](file:///D:/AhmedZ/supabase/migrations/20260208311000_fx_rates_normalize_high_inflation_trigger_v1.sql#L1-L62).
- إعادة التقييم (Revaluation):
  - دالة إعادة تقييم أرصدة عملات نقدية (AR/AP) فقط مع إنشاء قيود Adjustment مستقلة (Append‑Only): [run_fx_revaluation](file:///D:/AhmedZ/supabase/migrations/20260203186000_fx_revaluation_append_only_and_high_inflation.sql#L84-L170), [AP loop](file:///D:/AhmedZ/supabase/migrations/20260203186000_fx_revaluation_append_only_and_high_inflation.sql#L205-L249).

## هل تُعدّل القيود الأصلية؟

- لا. يتم إنشاء قيود Adjustment مستقلة (جورنال جديد) دون تعديل قيود أصلية قائمة (Append‑Only).
  - مؤشر الحسابات المستخدمة (Gain/Loss Unrealized): [fx accounts](file:///D:/AhmedZ/supabase/migrations/20260203130000_fx_enterprise_phase.sql#L55-L66).

## مجال التطبيق

- ❌ Revenue / Expenses / Inventory: لا يُطبق التضخم العالي مباشرة على هذه الفئات ضمن التقارير أو GL؛ تُحفظ بالأساسية.
- ✔ Monetary Balances فقط (AR/AP/Open Items):
  - إعادة تقييم حسب العملة وسعر الصرف المحاسبي عند نهاية الفترة.
  - مرجع العرض Revalued في الميزانية عبر [enterprise_trial_balance](file:///D:/AhmedZ/supabase/migrations/20260207161000_financial_reporting_engine.sql#L182-L189).

