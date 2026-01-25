Version: 2026-01-25
Last validated against migrations up to: 20260125130000_remediation_hardening.sql

Analysis Contract (Enforcement)
- أي تحليل أو تصميم أو اقتراح تنفيذ لا يبدأ صراحةً من هذا الملف ARCHITECTURE_CURRENT يعتبر غير صالح.
- أي اعتماد على مهاجرات أو دوال أو Views أقدم تم تجاوزها يُعد خطأ تحليليًا حتى لو كانت الملفات موجودة في المستودع.
- لا يُسمح بالاستنتاج من أسماء الملفات أو الترتيب الزمني فقط؛ النسخة الناسخة الأخيرة (create or replace) هي المرجع الملزم.

# ARCHITECTURE_CURRENT
 
هذا الملف هو مصدر الحقيقة الوحيد للحالة التشغيلية الحالية للنظام (ERP/POS) كما هي “مطبّقة فعليًا الآن”. يعتمد النظام مبدأ “مهاجرات تراكمية”؛ أي أن أحدث الملفات الناسخة (create or replace) هي المرجع النهائي، وأي منطق أقدم تم تجاوزه يُعتبر غير فعّال مهما بقي في المستودع.
 
## قاعدة تحليل إلزامية
- التحليل يجب أن ينطلق دائمًا من آخر نسخة ناسخة للدوال والإجراءات والواجهات (migrations/views/RPC/triggers).
- أي منطق قديم أو توقيعات سابقة تعتبر “Superseded” إن وُجد لها بديل أحدث في ملفات المهاجرات.
 
## الحالة النهائية الفعلية (Source of Truth)
 
### التسعير (Pricing)
- دالة السعر الزمنية المفعّلة الآن: get_item_price_with_discount(text p_item_id, uuid p_customer_id, numeric p_quantity)  
  المعرّفة في المهاجرة: [20260123252000_product_master_sot_lock_receiving_sellable_audit.sql](file:///d:/AhmedZ/supabase/migrations/20260123252000_product_master_sot_lock_receiving_sellable_audit.sql#L630-L714)  
  نقاط تنفيذ:
  - تعتمد price tiers وcustomer special prices مع تحقق زمني: valid_from/valid_to.
  - تُرجع سعر الوحدة “الفعّال” حسب الكمية/نوع العميل، بدون تعديل السعر الحقيقي المخزّن في menu_items.
- دالة السعر الأساسية للfallback: get_item_price(text p_item_id, numeric p_quantity, uuid p_customer_id)  
  الأحدث ضمن نفس المهاجرة أعلاه، تُعيد price من menu_items عند عدم وجود سعر خاص/شريحة.
 
### إنشاء الطلب عبر الويب (Online Orders)
- الدالة المفعّلة الآن: create_order_secure(jsonb p_items, uuid p_delivery_zone_id, text p_payment_method, text p_notes, text p_address, jsonb p_location, text p_customer_name, text p_phone_number, boolean p_is_scheduled, timestamptz p_scheduled_at, text p_coupon_code, numeric p_points_redeemed_value)  
  أحدث نسخة: [20260123130000_safe_batch_core_refactor.sql](file:///d:/AhmedZ/supabase/migrations/20260123130000_safe_batch_core_refactor.sql#L1107-L1443)  
  نقاط تنفيذ:
  - يحتسب Subtotal وفق وزن/كمية، ويضيف تكلفة الإضافات (Addons).
  - يتحقق من الكوبون زمنياً وحد الاستخدام والحد الأدنى، ويرفض المنتهي.
  - يحدّد warehouse_id الافتراضي ويستدعي Reserve FEFO.
  - يحفظ snapshot في orders.data ويتضمن warehouseId.
 
### المخزون والحجز/الخصم (Inventory FEFO)
- الحجز: reserve_stock_for_order(jsonb p_items, uuid p_order_id, uuid p_warehouse_id)  
  الأحدث: [20260123231000_phase7_hardening_release_blockers.sql](file:///d:/AhmedZ/supabase/migrations/20260123231000_phase7_hardening_release_blockers.sql#L778-L835) ونسخ التوحيد/الإصلاح ذات التوقيع نفسه [20260123220000_fix_reserve_release_final.sql](file:///d:/AhmedZ/supabase/migrations/20260123220000_fix_reserve_release_final.sql)  
  نقاط تنفيذ:
  - يتطلب warehouse_id إلزامًا.
  - حجز دُفعات وفق FEFO (مع قفل صفّي) ويمنع الحجز منتهِي الصلاحية.
  - يحدّث stock_management وbatch_reservations بشكل ذري.
- الخصم عند التسليم: deduct_stock_on_delivery_v2(uuid p_order_id, jsonb p_items, uuid p_warehouse_id)  
  الأحدث: [20260121195000_enforce_warehouse_stock_rpc.sql](file:///d:/AhmedZ/supabase/migrations/20260121195000_enforce_warehouse_stock_rpc.sql#L431-L835)  
  نقاط تنفيذ:
  - يلزم warehouse_id ويتحقق من الكميات المحجوزة.
  - يخصم وفق FEFO مع منع الدُفعات المنتهية.
  - يُولّد COGS عبر inventory_movements وorder_item_cogs.
- تأكيد التسليم: confirm_order_delivery(uuid p_order_id, jsonb p_items, jsonb p_updated_data, uuid p_warehouse_id)  
  الأحدث: نفس المهاجرة أعلاه؛ يستدعي الخصم ويُحدّث حالة الطلب “delivered”.
 
### محرك العروض (Promotions)
- المخطط (Schema):
  - الجدول الرئيسي: promotions  
    يحتوي على name, start_at, end_at, is_active, discount_mode ('fixed_total' | 'percent_off'), fixed_total, percent_off, display_original_total, max_uses, exclusive_with_coupon, requires_approval, approval_status, approval_request_id، مع قيود زمنية ومنع حالات غير صالحة.  
    [20260124160000_promotion_engine_schema.sql](file:///d:/JOMLA/AhmedZ/supabase/migrations/20260124160000_promotion_engine_schema.sql#L4-L55)
  - أصناف العرض: promotion_items  
    ربط فريد (promotion_id, item_id) وكميات وفرز، مع RLS للإدارة.  
    [promotion_items](file:///d:/JOMLA/AhmedZ/supabase/migrations/20260124160000_promotion_engine_schema.sql#L60-L80)
  - تتبع الاستهلاك: promotion_usage  
    يسجل promotion_line_id لكل طلب/قناة/مستودع مع سنابشوت كامل.  
    [promotion_usage](file:///d:/JOMLA/AhmedZ/supabase/migrations/20260124160000_promotion_engine_schema.sql#L84-L109)
- تراTriggers إنفاذ:
  - منع تعديل/حذف العرض بعد أول استخدام، ومنع إعادة التفعيل بعد الاستخدام:  
    [trg_promotions_lock_after_usage](file:///d:/JOMLA/AhmedZ/supabase/migrations/20260124160000_promotion_engine_schema.sql#L110-L158)
    [trg_promotion_items_lock_after_usage](file:///d:/JOMLA/AhmedZ/supabase/migrations/20260124160000_promotion_engine_schema.sql#L159-L183)
  - تفعيل العرض يتطلب موافقة وزمن صالح:  
    [trg_promotions_enforce_active_window_and_approval](file:///d:/JOMLA/AhmedZ/supabase/migrations/20260124161700_promotions_enforce_activation_fix.sql#L1-L20)
  - صحة تسجيل الاستهلاك: نشاط، زمن، موافقة، وحد استخدام:  
    [trg_promotion_usage_enforce_valid](file:///d:/JOMLA/AhmedZ/supabase/migrations/20260124160000_promotion_engine_schema.sql#L210-L255)
- واجهات RPC:
  - apply_promotion_to_cart(jsonb p_cart_payload, uuid p_promotion_id):  
    يتحقق من الموافقة والزمن وتعارض الكوبون، ويؤكد توافر المخزون/FEFO، ويعيد سنابشوت نهائي مع توزيع الإيراد وقيمة المصروف.  
    [promotion_engine_rpc.sql](file:///d:/JOMLA/AhmedZ/supabase/migrations/20260124161000_promotion_engine_rpc.sql#L43-L249)
  - _compute_promotion_snapshot(...)‎: نسخة معيارية داخلية للحساب.  
    [promotion_engine_internal.sql](file:///d:/JOMLA/AhmedZ/supabase/migrations/20260124161500_promotion_engine_internal.sql#L1-L205)
  - get_active_promotions(uuid p_customer_id, uuid p_warehouse_id): قوائم العروض الفعالة مع أسعارها الحالية.  
    [promotion_public_rpcs.sql](file:///d:/JOMLA/AhmedZ/supabase/migrations/20260124162500_promotion_public_rpcs.sql#L100-L140)
- تكامل الطلبات:
  - إدراج سطر العرض في create_order_secure مع منع الدمج مع الكوبون/النقاط، وتجميع أصناف المخزون لحجز FEFO:  
    [order_promotions_integration.sql](file:///d:/JOMLA/AhmedZ/supabase/migrations/20260124164000_order_promotions_integration.sql#L133-L177)
  - تأكيد التسليم يعيد حساب سنابشوت العرض ضمن نطاق المستودع ويسجل الاستهلاك ويدمج الأصناف للخصم:  
    [confirm_order_delivery_promo_snapshot_fix.sql](file:///d:/JOMLA/AhmedZ/supabase/migrations/20260124164500_confirm_order_delivery_promo_snapshot_fix.sql#L54-L101)
  - حواجز على مستوى الطلب لمنع خصم مزدوج (كوبون/نقاط) عند وجود عروض:  
    [orders_promotion_guards.sql](file:///d:/JOMLA/AhmedZ/supabase/migrations/20260124165500_orders_promotion_guards.sql#L1-L35)
- الـPOS أوفلاين:
  - منع مزامنة فواتير تحتوي عروض في وضع الأوفلاين:  
    [pos_offline_promotions_guard.sql](file:///d:/JOMLA/AhmedZ/supabase/migrations/20260125110000_pos_offline_promotions_guard.sql#L46-L60)

### العرض العام للبيع (View)
- v_sellable_products (create or replace view)  
  الأحدث: [20260123252000_product_master_sot_lock_receiving_sellable_audit.sql](file:///d:/AhmedZ/supabase/migrations/20260123252000_product_master_sot_lock_receiving_sellable_audit.sql#L472-L506)  
  يُرجع: id, name, barcode, price, base_unit, is_food, expiry_required, sellable, status, available_quantity, category, is_featured, freshness_level, data.  
  ملاحظة: العمود المعتمد هو base_unit وليس unit_type.
 
### نظام الموافقات (Approvals)
- سياسات الموافقات وإنشاء/خطوات/منع التلاعب:  
  الأحدث: [20260124100000_enterprise_gaps_hardening.sql](file:///d:/AhmedZ/supabase/migrations/20260124100000_enterprise_gaps_hardening.sql) + [20260124143000_approvals_lock_and_self_approval.sql](file:///d:/AhmedZ/supabase/migrations/20260124143000_approvals_lock_and_self_approval.sql#L1-L76)  
  نقاط تنفيذ:
  - approve_approval_step يمنع self_approval صراحةً (requested_by = approver → خطأ).
  - trg_lock_approval_requests يفرض عدم قابلية التعديل والحذف خارج حالات معتمدة.
  - approval_required(request_type, amount) يُحدّد وجوب الموافقة قبل التنفيذ.
  - حقول orders: discount_requires_approval, discount_approval_status, discount_approval_request_id موجودة للتكامل.

### Phase 13 – RBAC Hardening & Privilege Seal (Enterprise Security Gate)
- إغلاق مسارات النشر المحاسبي (Posting Seal):
  - post_payment(uuid), post_inventory_movement(uuid), post_order_delivery(uuid) محصورة EXECUTE على service_role فقط، والتحقق الداخلي يفرض: service_role أو has_admin_permission('accounting.manage').  
    المرجع: [20260123123500_lockdown_accounting_posting_functions.sql](file:///d:/AhmedZ/supabase/migrations/20260123123500_lockdown_accounting_posting_functions.sql) + [20260125120000_phase13_rbac_hardening_privilege_seal.sql](file:///d:/AhmedZ/supabase/migrations/20260125120000_phase13_rbac_hardening_privilege_seal.sql)
- Seal على أي DML محاسبي ناسخ عبر SECURITY DEFINER:
  - reverse_journal_entry(uuid, text) لا يعمل إلا بـ service_role أو accounting.manage (لم يعد staff-only).  
    المرجع: [20260125120000_phase13_rbac_hardening_privilege_seal.sql](file:///d:/AhmedZ/supabase/migrations/20260125120000_phase13_rbac_hardening_privilege_seal.sql)
- FORCE ROW LEVEL SECURITY:
  - مفعّل على: journal_entries, journal_lines, accounting_periods, accounting_period_snapshots, system_audit_logs, ledger_audit_log.  
    المرجع: [20260125120000_phase13_rbac_hardening_privilege_seal.sql](file:///d:/AhmedZ/supabase/migrations/20260125120000_phase13_rbac_hardening_privilege_seal.sql)
- ختم تقارير القوائم المالية عبر Permission Guard (SECURITY DEFINER):
  - balances_as_of / profit_and_loss_by_range / cogs_reconciliation_by_range / assert_balance_sheet / assert_trial_balance_by_range: تتطلب service_role أو has_admin_permission('accounting.view').  
    المرجع: [20260125120000_phase13_rbac_hardening_privilege_seal.sql](file:///d:/AhmedZ/supabase/migrations/20260125120000_phase13_rbac_hardening_privilege_seal.sql) + [20260123290000_phase11_financial_statements_integrity.sql](file:///d:/AhmedZ/supabase/migrations/20260123290000_phase11_financial_statements_integrity.sql)
- RLS Compatibility للتدقيق بعد FORCE RLS:
  - ledger_audit_log: سياسة INSERT داخلية مضافة لضمان استمرار تريجرات التدقيق عند FORCE RLS.  
    المرجع: [20260125120000_phase13_rbac_hardening_privilege_seal.sql](file:///d:/AhmedZ/supabase/migrations/20260125120000_phase13_rbac_hardening_privilege_seal.sql) + [20260123280000_phase10_ledger_immutability_period_lock.sql](file:///d:/AhmedZ/supabase/migrations/20260123280000_phase10_ledger_immutability_period_lock.sql)
 
## توثيق النسخ (Superseded Logic)
- المخزون/الحجز:
  - النسخ القديمة لـ reserve_stock_for_order بدون warehouse_id تم حذفها/إسقاطها في [20260121195000_enforce_warehouse_stock_rpc.sql](file:///d:/AhmedZ/supabase/migrations/20260121195000_enforce_warehouse_stock_rpc.sql)؛ النسخة المعتمدة تتطلب warehouse_id وتنفّذ FEFO مع قفل صفّي.
- الخصم/التسليم:
  - deduct_stock_on_delivery_v2 نسخ أقدم بدون تحقق محجوز/warehouse تم استبدالها بالنسخة الحالية في نفس المهاجرة أعلاه مع تحقق محجوز FEFO ومنع expired.
- إنشاء الطلب:
  - create_order_secure المبكّرة (20260110060000) تم تجاوزها بواسطة نسخة ناسخة أحدث [20260123130000_safe_batch_core_refactor.sql](file:///d:/AhmedZ/supabase/migrations/20260123130000_safe_batch_core_refactor.sql#L1107-L1443) التي تضيف warehouse_id الافتراضي وحجز FEFO لوزني/عددي.
- العرض View:
  - أي استخدام لعمود unit_type في v_sellable_products غير صحيح؛ تم اعتماده على base_unit في النسخة الأحدث [20260123252000].
- الموافقات:
  - منطق الموافقة بدون منع صريح لـ self-approval تم تجاوزه؛ المنع مفروض الآن عبر approve_approval_step في [20260124143000].
- صلاحيات النشر المحاسبي:
  - أي GRANT EXECUTE على post_payment/post_inventory_movement/post_order_delivery للـ anon/authenticated تم تجاوزه؛ المرجع النهائي هو Seal Phase 13.  
    المرجع: [20260123123500_lockdown_accounting_posting_functions.sql](file:///d:/AhmedZ/supabase/migrations/20260123123500_lockdown_accounting_posting_functions.sql) + [20260125120000_phase13_rbac_hardening_privilege_seal.sql](file:///d:/AhmedZ/supabase/migrations/20260125120000_phase13_rbac_hardening_privilege_seal.sql)
- عكس القيود:
  - reverse_journal_entry بحماية staff-only تم تجاوزه؛ النسخة الفعلية تتطلب service_role أو accounting.manage.  
    المرجع: [20260125120000_phase13_rbac_hardening_privilege_seal.sql](file:///d:/AhmedZ/supabase/migrations/20260125120000_phase13_rbac_hardening_privilege_seal.sql)
 
## نقاط النظام الحرجة (Enforcement Summary)
- التسعير فعليًا:
  - كل تسعير يُستخرج في الخادم عبر get_item_price_with_discount مع تحقق زمني للشريحة/السعر الخاص؛ لا تعديل للسعر الحقيقي في الأصناف.
  - الكوبونات تُفحص في create_order_secure: انتهاء، حد استخدام، حد أدنى، ويُمنع المنتهي.
- عدم وجود نجاح تفاؤلي:
  - Online: إنشاء الطلب وإجمالي الدفع يعتمد رد RPC؛ لا اعتماد قبل رد الخادم.
  - POS: التسليم/الفاتورة عبر confirm_order_delivery/deduct_stock_on_delivery_v2؛ عند انقطاع الاتصال يُسجّل حالة “CREATED_OFFLINE” وتتم المزامنة لاحقًا، لكن التسعير/الخصم النهائي لا يتم محليًا.
- نطاق الجلسة/المستودع:
  - create_order_secure يحل warehouse_id الافتراضي (مثل MAIN)، وجميع عمليات الحجز/الخصم تتطلب warehouse_id صراحةً.
- منع self-approval:
  - approve_approval_step يرفض موافقة الطالب لنفسه (self_approval_forbidden)، وtrg_lock_approval_requests يمنع تعديل/حذف طلب الموافقة خارج المسار الصحيح.
 - العروض:
   - كل تسعير عرض عبر RPC فقط مع سنابشوت معتمد؛ يمنع الدمج مع الكوبونات/النقاط؛ مزامنة POS أوفلاين تمنع العروض.
 - ختم صلاحيات المحاسبة (RBAC Seal):
   - لا تنفيذ لأي DML محاسبي مباشر (journal_entries/journal_lines عبر SECURITY DEFINER) إلا عبر service_role أو has_admin_permission('accounting.manage').
   - تقارير القوائم المالية عبر SECURITY DEFINER لا تُنفّذ إلا لمن يملك has_admin_permission('accounting.view') أو service_role.
   - FORCE RLS مفعّل على الجداول المحاسبية/التدقيقية لضمان عدم وجود مسارات التفاف.
 
## ما لم يعد مستخدمًا رغم وجوده
- توقيعات reserve_stock_for_order بدون warehouse_id.
- نسخ قديمة لـ confirm_order_delivery والدوال المرافقة بدون تحقق FEFO/محجوز.
- الاعتماد على unit_type من v_sellable_products؛ النسخة المعتمدة تُرجع base_unit.
 
### شفافية الفاتورة (Invoice → Promotion → Approval → Journal)
- الواجهة: get_invoice_audit(uuid p_order_id) تعيد مسار التدقيق الكامل للفاتورة.
- ترابط البيانات: رقم الفاتورة، نوع الخصم (عرض/خصم يدوي)، تفاصيل العرض/الاستهلاك/طلب الموافقة، ورقم قيد اليومية المرتبط بالتسليم.
- المرجع: [20260125130000_remediation_hardening.sql#L1-L103](file:///d:/JOMLA/AhmedZ/supabase/migrations/20260125130000_remediation_hardening.sql#L1-L103)

### Drill-down المالي (P&L → GL → Journal)
- مصروف العروض 6150: get_promotion_expense_drilldown(start,end,min) يعرض قيود اليومية المرتبطة بالمصروف مع ربط الطلب/الفاتورة/الاستهلاك.
- استخدام العرض: get_promotion_usage_drilldown(promotion_id,start,end) يعرض كل حالات الاستهلاك مع ربط قيد اليومية عند التسليم.
- المراجع:
  - [get_promotion_expense_drilldown](file:///d:/JOMLA/AhmedZ/supabase/migrations/20260125130000_remediation_hardening.sql#L104-L176)
  - [get_promotion_usage_drilldown](file:///d:/JOMLA/AhmedZ/supabase/migrations/20260125130000_remediation_hardening.sql#L177-L233)

### لوحة تسوية POS أوفلاين
- مخطط التسوية: أعمدة reconciliation_status/approval_request_id/reconciled_by/reconciled_at/Note على pos_offline_sales مع قيد تحقق للحالات.
- طلب تسوية: request_offline_reconciliation(offline_id,reason) ينشئ طلب موافقة ‘offline_reconciliation’ ويُحدّث حالة التسوية إلى PENDING.
- مزامنة أوفلاين: sync_offline_pos_sale(...) يمنع العروض في الأوفلاين، ويعيد CONFLICT/FAILED عند نقص الحجز/انتهاء الدُفعات، ويتطلب موافقة قبل إعادة محاولة.
- لوحة عرض: get_pos_offline_sales_dashboard(state?,limit?) لعرض الحالات وحالة التسوية.
- المراجع:
  - [قيد النوع وإعداد السياسة](file:///d:/JOMLA/AhmedZ/supabase/migrations/20260125130000_remediation_hardening.sql#L235-L261)
  - [أعمدة التسوية والقيود](file:///d:/JOMLA/AhmedZ/supabase/migrations/20260125130000_remediation_hardening.sql#L264-L281)
  - [مزامنة حالة الموافقة Trigger](file:///d:/JOMLA/AhmedZ/supabase/migrations/20260125130000_remediation_hardening.sql#L282-L320)
  - [request_offline_reconciliation](file:///d:/JOMLA/AhmedZ/supabase/migrations/20260125130000_remediation_hardening.sql#L371-L449)
  - [get_pos_offline_sales_dashboard](file:///d:/JOMLA/AhmedZ/supabase/migrations/20260125130000_remediation_hardening.sql#L451-L506)
  - [sync_offline_pos_sale](file:///d:/JOMLA/AhmedZ/supabase/migrations/20260125130000_remediation_hardening.sql#L507-L684)

### توحيد فلاتر التواريخ
- توحيد startDate/endDate/asOfDate عبر تقارير المبيعات/العملاء/المنتجات/المالية لضمان نتائج متسقة في جميع الشاشات.
- يعتمد على واجهات التقارير الأحدث التي تُعيد النتائج حسب وقت إصدار الفاتورة وتسليم الطلب.

### سياسة مصروف العروض (Promotion Expense)
- تسجيل أثر العرض كمصروف تشغيل (6150) مرتبط بقيود التسليم، مع فصل صريح بين إجمالي الخصم ومصروف العرض.
- رؤوس التقارير تعرض زر “تفاصيل” للـ Drill-down إلى القيود/الاستهلاك/الفواتير.
- المراجع: [get_promotion_expense_drilldown](file:///d:/JOMLA/AhmedZ/supabase/migrations/20260125130000_remediation_hardening.sql#L104-L176)

### خطة التراجع (Rollback Plan)
- قبل أي تراجع: خذ نسخة احتياطية (Snapshot) من قاعدة البيانات.
  - Windows PowerShell:
    - إنشاء مجلد النسخ: New-Item -ItemType Directory -Path .\backups -Force
    - تعيين متغير الاتصال: $env:DATABASE_URL = "postgres://USER:PASS@HOST:5432/DB"
    - تنفيذ النسخ: pg_dump --format=custom --file ("backups\\db_" + (Get-Date -Format 'yyyy-MM-dd') + ".dump") "$env:DATABASE_URL"
- إيقاف مزامنة POS أوفلاين مؤقتًا وإبلاغ العمليات قبل التنفيذ.
- خطوات التراجع لهذه الهجرة 20260125130000_remediation_hardening.sql:
  - تنفيذ داخل معاملة:
    - begin;
    - drop function if exists public.get_invoice_audit(uuid);
    - drop function if exists public.get_promotion_expense_drilldown(timestamptz, timestamptz, numeric);
    - drop function if exists public.get_promotion_usage_drilldown(uuid, timestamptz, timestamptz);
    - drop function if exists public.register_pos_offline_sale_created(text, uuid, timestamptz, uuid);
    - drop function if exists public.request_offline_reconciliation(text, text);
    - drop function if exists public.get_pos_offline_sales_dashboard(text, int);
    - drop function if exists public.sync_offline_pos_sale(text, uuid, jsonb, jsonb, uuid, jsonb);
    - drop trigger if exists trg_sync_offline_reconciliation_approval on public.approval_requests;
    - alter table public.pos_offline_sales drop column if exists reconciliation_status;
    - alter table public.pos_offline_sales drop column if exists reconciliation_approval_request_id;
    - alter table public.pos_offline_sales drop column if exists reconciled_by;
    - alter table public.pos_offline_sales drop column if exists reconciled_at;
    - alter table public.pos_offline_sales drop column if exists reconciliation_note;
    - alter table public.approval_requests drop constraint if exists approval_requests_request_type_check;
    - alter table public.approval_requests add constraint approval_requests_request_type_check check (request_type in ('po','receipt','discount','transfer','writeoff'));
    - commit;
- تحقق بعد التراجع:
  - تأكد من غياب الدوال المذكورة عبر الاستعلام pg_proc.
  - تأكد من اختفاء الأعمدة الإضافية من pos_offline_sales وأن القيود تعمل.
  - اختبر شاشات التقارير والـPOS.
- استعادة عند الحاجة:
  - pg_restore --clean --if-exists -d "$env:DATABASE_URL" "backups\\db_YYYY-MM-DD.dump"
  - غيّر التاريخ لملف النسخة المطلوب استعادته.

---
هذا المستند هو المرجع الوحيد للحالة الحالية. أي تحليل أو تنفيذ لاحق يجب أن يلتزم هنا بالمنطق الأحدث الناسخ، وأي استنتاج من ملفات قديمة يُعتبر باطلًا.
