# CHANGELOG

## 2026-01-25 — Remediation & Hardening
- اعتماد شفافية الفاتورة (Invoice → Promotion → Approval → Journal) عبر واجهة: get_invoice_audit  
  المرجع: [20260125130000_remediation_hardening.sql#L1-L103](file:///d:/JOMLA/AhmedZ/supabase/migrations/20260125130000_remediation_hardening.sql#L1-L103)
- إضافة Drill-down مالي لمصروف العروض 6150 ولفرص الاستخدام:
  - get_promotion_expense_drilldown (الفترة + الحد الأدنى) → ربط الطلب/الفاتورة/الاستهلاك/قيد اليومية  
    المرجع: [#L104-L176](file:///d:/JOMLA/AhmedZ/supabase/migrations/20260125130000_remediation_hardening.sql#L104-L176)
  - get_promotion_usage_drilldown (promotion_id + الفترة) → ربط الفاتورة/الاستهلاك/قيد اليومية  
    المرجع: [#L177-L233](file:///d:/JOMLA/AhmedZ/supabase/migrations/20260125130000_remediation_hardening.sql#L177-L233)
- تحسين لوحة تسوية POS أوفلاين:
  - أعمدة حالة التسوية والقيود المفروضة على pos_offline_sales  
    المرجع: [#L264-L281](file:///d:/JOMLA/AhmedZ/supabase/migrations/20260125130000_remediation_hardening.sql#L264-L281)
  - Trigger مزامنة حالة طلب الموافقة مع التسوية  
    المرجع: [#L282-L320](file:///d:/JOMLA/AhmedZ/supabase/migrations/20260125130000_remediation_hardening.sql#L282-L320)
  - request_offline_reconciliation → إنشاء طلب موافقة وتسوية PENDING  
    المرجع: [#L371-L449](file:///d:/JOMLA/AhmedZ/supabase/migrations/20260125130000_remediation_hardening.sql#L371-L449)
  - get_pos_offline_sales_dashboard → عرض شامل لحالات الأوفلاين والتسوية  
    المرجع: [#L451-L506](file:///d:/JOMLA/AhmedZ/supabase/migrations/20260125130000_remediation_hardening.sql#L451-L506)
  - sync_offline_pos_sale → منع العروض في الأوفلاين وتوليد CONFLICT/FAILED مع مسار موافقة  
    المرجع: [#L507-L684](file:///d:/JOMLA/AhmedZ/supabase/migrations/20260125130000_remediation_hardening.sql#L507-L684)
- توحيد فلاتر التواريخ عبر تقارير المبيعات/العملاء/المنتجات/المالية لضمان الاتساق.
- توثيق سياسة Promotion Expense وربطها بقيود اليومية (6150) مع أزرار Drill-down في الواجهة.

مهاجرة معتمدة: 20260125130000_remediation_hardening.sql
