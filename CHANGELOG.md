# CHANGELOG

## 2026-01-26 — تحسينات UX للفترات المحاسبية
- توضيح أن فتح/بدء الفترة تعريف زمني للتقارير فقط ولا يقيّد التشغيل؛ تعديل نص زر “بدء فترة محاسبية” وإضافة Tooltip وشرح داخل نافذة إنشاء الفترة.
- إضافة نافذة تأكيد قبل إقفال الفترة بصياغة تشغيلية واضحة وتحذير نهائي غير قابل للتراجع.
- تحديث شارات الحالة للفترات إلى “مفتوحة (تعريفية فقط)” و“مقفلة (منع تشغيلي)” مع Tooltips توضيحية للأثر.
- تحسين رسائل الأخطاء عند رفض العمليات داخل فترات مقفلة عبر localizeSupabaseError لذكر السبب صراحةً.
- لا تغييرات على المنطق المحاسبي، التريجرات، أو سياسات RLS؛ تعديل واجهة فقط.
- المراجع: [FinancialReports.tsx](file:///d:/AhmedZ/screens/admin/reports/FinancialReports.tsx)، [errorUtils.ts](file:///d:/AhmedZ/utils/errorUtils.ts)
- Critical Fix: Payment Proof Persistence
- Security Fix: Coupon Usage Atomic Enforcement

## 2026-01-25 — Remediation & Hardening
- اعتماد شفافية الفاتورة (Invoice → Promotion → Approval → Journal) عبر واجهة: get_invoice_audit  
  المرجع: [20260125130000_remediation_hardening.sql#L1-L103](file:///d:/AhmedZ/supabase/migrations/20260125130000_remediation_hardening.sql#L1-L103)
- إضافة Drill-down مالي لمصروف العروض 6150 ولفرص الاستخدام:
  - get_promotion_expense_drilldown (الفترة + الحد الأدنى) → ربط الطلب/الفاتورة/الاستهلاك/قيد اليومية  
    المرجع: [#L104-L176](file:///d:/AhmedZ/supabase/migrations/20260125130000_remediation_hardening.sql#L104-L176)
  - get_promotion_usage_drilldown (promotion_id + الفترة) → ربط الفاتورة/الاستهلاك/قيد اليومية  
    المرجع: [#L177-L233](file:///d:/AhmedZ/supabase/migrations/20260125130000_remediation_hardening.sql#L177-L233)
- تحسين لوحة تسوية POS أوفلاين:
  - أعمدة حالة التسوية والقيود المفروضة على pos_offline_sales  
    المرجع: [#L264-L281](file:///d:/AhmedZ/supabase/migrations/20260125130000_remediation_hardening.sql#L264-L281)
  - Trigger مزامنة حالة طلب الموافقة مع التسوية  
    المرجع: [#L282-L320](file:///d:/AhmedZ/supabase/migrations/20260125130000_remediation_hardening.sql#L282-L320)
  - request_offline_reconciliation → إنشاء طلب موافقة وتسوية PENDING  
    المرجع: [#L371-L449](file:///d:/AhmedZ/supabase/migrations/20260125130000_remediation_hardening.sql#L371-L449)
  - get_pos_offline_sales_dashboard → عرض شامل لحالات الأوفلاين والتسوية  
    المرجع: [#L451-L506](file:///d:/AhmedZ/supabase/migrations/20260125130000_remediation_hardening.sql#L451-L506)
  - sync_offline_pos_sale → منع العروض في الأوفلاين وتوليد CONFLICT/FAILED مع مسار موافقة  
    المرجع: [#L507-L684](file:///d:/AhmedZ/supabase/migrations/20260125130000_remediation_hardening.sql#L507-L684)
- توحيد فلاتر التواريخ عبر تقارير المبيعات/العملاء/المنتجات/المالية لضمان الاتساق.
- توثيق سياسة Promotion Expense وربطها بقيود اليومية (6150) مع أزرار Drill-down في الواجهة.

مهاجرة معتمدة: 20260125130000_remediation_hardening.sql
