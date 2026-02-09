# HISTORICAL_CURRENCY_ANOMALY_REPORT (Read‑Only)

تاريخ التنفيذ: 2026-02-09

مصدر الفحص (SQL): [historical_currency_anomaly_readonly.sql](file:///D:/AhmedZ/supabase/smoke/historical_currency_anomaly_readonly.sql)

## ملخص

- Base Currency الحالي حسب الدالة: SAR
- تم تنفيذ الفحص على قاعدة البيانات المحلية فقط وبوضع قراءة دون أي UPDATE/DELETE/INSERT

## نتائج الشذوذات (Counts)

| الكود | الفحص | العدد |
|---|---|---:|
| ANOM01 | Base lines مع foreign_amount/fx_rate | 0 |
| ANOM02 | Non‑base lines ناقصة FX snapshot | 0 |
| ANOM03 | foreign_amount × fx_rate ≠ debit/credit | 0 |
| ANOM04 | Journal Entries غير متزنة (مجموع السطور) | 0 |
| ANOM05 | Open Items لا تتطابق مع التسويات (base) | 0 |
| ANOM06 | YER high‑inflation rate غير مُطبّع (rate ≥ 1) | 2 |
| ANOM07 | مؤشرات تضخيم محتمل على base lines (≥ 1,000,000) | 0 |

## ملاحظات تشخيصية (بدون اقتراح حلول)

- ANOM06 = 2 يشير إلى وجود صفّين في fx_rates لعملة YER (مع is_high_inflation=true) بمعدل >= 1 تحت Base=SAR، وهو نمط غير متسق مع سياسة الاتجاه المتوقعة (Base per 1 Foreign) عند التعامل مع عملة تضخم مرتفع.
