# MULTI_CURRENCY_BREAKPOINTS

تاريخ التدقيق: 2026-02-09

## نقاط الكسر (Breakpoints)

- كسر: Base Currency لا تساوي التكوين المقصود (SAR)
  - النوع: Symbol/Configuration
  - الشدة: Critical
  - الواقع: الأساس الحالي YER عبر الحوكمة الصارمة: [base_currency_governance_strict](file:///D:/AhmedZ/supabase/migrations/20260203180000_base_currency_governance_strict.sql#L1-L66), [seed_base_currency_YER](file:///D:/AhmedZ/supabase/migrations/20260203125000_base_currency_seed.sql#L1-L24).

- كسر: اختلاف نوع سعر الصرف المستخدم بين طبقات (operational vs accounting)
  - النوع: FX
  - الشدة: High
  - الواقع: GL view يستخدم معدل محاسبي افتراضي عند غياب fx_rate على السطر، بينما تقارير المبيعات تستخدم coalesce(o.fx_rate,1) (تشغيلي): [enterprise_gl_lines](file:///D:/AhmedZ/supabase/migrations/20260209025000_reporting_fx_rate_fallback.sql#L24-L41), [sales_reports_base](file:///D:/AhmedZ/supabase/migrations/20260205210000_reports_use_base_currency.sql#L260-L287).

- كسر: معدلات تضخم عالي غير مُطبّعة (اتجاه/حجم غير منطقي)
  - النوع: Inflation/FX
  - الشدة: High
  - الواقع: ضرورة وجود trigger التطبيع؛ بدونه قد تُسجّل قيم > 10 وتحتاج انقلاب الاتجاه: [normalize trigger](file:///D:/AhmedZ/supabase/migrations/20260208311000_fx_rates_normalize_high_inflation_trigger_v1.sql#L1-L62), [get_fx_rate inversion fix](file:///D:/AhmedZ/supabase/migrations/20260205170000_fix_get_fx_rate_inversion_high_inflation.sql#L1-L93).

- كسر: إعادة اشتقاق base_amount داخل Views بدل الاعتماد على حقول مُجمّعة ثابتة
  - النوع: Aggregation
  - الشدة: Medium
  - الواقع: signed_base_amount يُحسب في العرض من foreign×fx عند الحاجة؛ قد يؤدي اختلاف المصادر إلى تباينات طفيفة: [financial_reporting_engine GL view](file:///D:/AhmedZ/supabase/migrations/20260207161000_financial_reporting_engine.sql#L70-L86).

- كسر: mismatch بين base vs foreign عند قيود بـ currency_code = base مع foreign_amount غير فارغ
  - النوع: Symbol/FX
  - الشدة: Medium
  - الواقع: وجود foreign_amount على سطر عملته أساس قد يدل على إدخال غير سليم؛ يلزم فحص: [enterprise_gl_lines foreign handling](file:///D:/AhmedZ/supabase/migrations/20260207161000_financial_reporting_engine.sql#L76-L86).

## ملاحظات

- لا تُقترح حلول في هذه المرحلة؛ فقط تحديد مواضع الخلط والأنواع والشدة وفق الكود والوظائف الحالية.

