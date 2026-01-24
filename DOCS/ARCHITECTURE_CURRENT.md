Version: 2026-01-24
Last validated against migrations up to: 20260124143000_approvals_lock_and_self_approval.sql

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
  المعرّفة في المهاجرة: [20260123252000_product_master_sot_lock_receiving_sellable_audit.sql](file:///d:/JOMLA/AhmedZ/supabase/migrations/20260123252000_product_master_sot_lock_receiving_sellable_audit.sql#L630-L714)  
  نقاط تنفيذ:
  - تعتمد price tiers وcustomer special prices مع تحقق زمني: valid_from/valid_to.
  - تُرجع سعر الوحدة “الفعّال” حسب الكمية/نوع العميل، بدون تعديل السعر الحقيقي المخزّن في menu_items.
- دالة السعر الأساسية للfallback: get_item_price(text p_item_id, numeric p_quantity, uuid p_customer_id)  
  الأحدث ضمن نفس المهاجرة أعلاه، تُعيد price من menu_items عند عدم وجود سعر خاص/شريحة.
 
### إنشاء الطلب عبر الويب (Online Orders)
- الدالة المفعّلة الآن: create_order_secure(jsonb p_items, uuid p_delivery_zone_id, text p_payment_method, text p_notes, text p_address, jsonb p_location, text p_customer_name, text p_phone_number, boolean p_is_scheduled, timestamptz p_scheduled_at, text p_coupon_code, numeric p_points_redeemed_value)  
  أحدث نسخة: [20260123130000_safe_batch_core_refactor.sql](file:///d:/JOMLA/AhmedZ/supabase/migrations/20260123130000_safe_batch_core_refactor.sql#L1107-L1443)  
  نقاط تنفيذ:
  - يحتسب Subtotal وفق وزن/كمية، ويضيف تكلفة الإضافات (Addons).
  - يتحقق من الكوبون زمنياً وحد الاستخدام والحد الأدنى، ويرفض المنتهي.
  - يحدّد warehouse_id الافتراضي ويستدعي Reserve FEFO.
  - يحفظ snapshot في orders.data ويتضمن warehouseId.
 
### المخزون والحجز/الخصم (Inventory FEFO)
- الحجز: reserve_stock_for_order(jsonb p_items, uuid p_order_id, uuid p_warehouse_id)  
  الأحدث: [20260123231000_phase7_hardening_release_blockers.sql](file:///d:/JOMLA/AhmedZ/supabase/migrations/20260123231000_phase7_hardening_release_blockers.sql#L778-L835) ونسخ التوحيد/الإصلاح ذات التوقيع نفسه [20260123220000_fix_reserve_release_final.sql](file:///d:/JOMLA/AhmedZ/supabase/migrations/20260123220000_fix_reserve_release_final.sql)  
  نقاط تنفيذ:
  - يتطلب warehouse_id إلزامًا.
  - حجز دُفعات وفق FEFO (مع قفل صفّي) ويمنع الحجز منتهِي الصلاحية.
  - يحدّث stock_management وbatch_reservations بشكل ذري.
- الخصم عند التسليم: deduct_stock_on_delivery_v2(uuid p_order_id, jsonb p_items, uuid p_warehouse_id)  
  الأحدث: [20260121195000_enforce_warehouse_stock_rpc.sql](file:///d:/JOMLA/AhmedZ/supabase/migrations/20260121195000_enforce_warehouse_stock_rpc.sql#L431-L835)  
  نقاط تنفيذ:
  - يلزم warehouse_id ويتحقق من الكميات المحجوزة.
  - يخصم وفق FEFO مع منع الدُفعات المنتهية.
  - يُولّد COGS عبر inventory_movements وorder_item_cogs.
- تأكيد التسليم: confirm_order_delivery(uuid p_order_id, jsonb p_items, jsonb p_updated_data, uuid p_warehouse_id)  
  الأحدث: نفس المهاجرة أعلاه؛ يستدعي الخصم ويُحدّث حالة الطلب “delivered”.
 
### العرض العام للبيع (View)
- v_sellable_products (create or replace view)  
  الأحدث: [20260123252000_product_master_sot_lock_receiving_sellable_audit.sql](file:///d:/JOMLA/AhmedZ/supabase/migrations/20260123252000_product_master_sot_lock_receiving_sellable_audit.sql#L472-L506)  
  يُرجع: id, name, barcode, price, base_unit, is_food, expiry_required, sellable, status, available_quantity, category, is_featured, freshness_level, data.  
  ملاحظة: العمود المعتمد هو base_unit وليس unit_type.
 
### نظام الموافقات (Approvals)
- سياسات الموافقات وإنشاء/خطوات/منع التلاعب:  
  الأحدث: [20260124100000_enterprise_gaps_hardening.sql](file:///d:/JOMLA/AhmedZ/supabase/migrations/20260124100000_enterprise_gaps_hardening.sql) + [20260124143000_approvals_lock_and_self_approval.sql](file:///d:/JOMLA/AhmedZ/supabase/migrations/20260124143000_approvals_lock_and_self_approval.sql#L1-L76)  
  نقاط تنفيذ:
  - approve_approval_step يمنع self_approval صراحةً (requested_by = approver → خطأ).
  - trg_lock_approval_requests يفرض عدم قابلية التعديل والحذف خارج حالات معتمدة.
  - approval_required(request_type, amount) يُحدّد وجوب الموافقة قبل التنفيذ.
  - حقول orders: discount_requires_approval, discount_approval_status, discount_approval_request_id موجودة للتكامل.
 
## توثيق النسخ (Superseded Logic)
- المخزون/الحجز:
  - النسخ القديمة لـ reserve_stock_for_order بدون warehouse_id تم حذفها/إسقاطها في [20260121195000_enforce_warehouse_stock_rpc.sql](file:///d:/JOMLA/AhmedZ/supabase/migrations/20260121195000_enforce_warehouse_stock_rpc.sql)؛ النسخة المعتمدة تتطلب warehouse_id وتنفّذ FEFO مع قفل صفّي.
- الخصم/التسليم:
  - deduct_stock_on_delivery_v2 نسخ أقدم بدون تحقق محجوز/warehouse تم استبدالها بالنسخة الحالية في نفس المهاجرة أعلاه مع تحقق محجوز FEFO ومنع expired.
- إنشاء الطلب:
  - create_order_secure المبكّرة (20260110060000) تم تجاوزها بواسطة نسخة ناسخة أحدث [20260123130000_safe_batch_core_refactor.sql](file:///d:/JOMLA/AhmedZ/supabase/migrations/20260123130000_safe_batch_core_refactor.sql#L1107-L1443) التي تضيف warehouse_id الافتراضي وحجز FEFO لوزني/عددي.
- العرض View:
  - أي استخدام لعمود unit_type في v_sellable_products غير صحيح؛ تم اعتماده على base_unit في النسخة الأحدث [20260123252000].
- الموافقات:
  - منطق الموافقة بدون منع صريح لـ self-approval تم تجاوزه؛ المنع مفروض الآن عبر approve_approval_step في [20260124143000].
 
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
 
## ما لم يعد مستخدمًا رغم وجوده
- توقيعات reserve_stock_for_order بدون warehouse_id.
- نسخ قديمة لـ confirm_order_delivery والدوال المرافقة بدون تحقق FEFO/محجوز.
- الاعتماد على unit_type من v_sellable_products؛ النسخة المعتمدة تُرجع base_unit.
 
---
هذا المستند هو المرجع الوحيد للحالة الحالية. أي تحليل أو تنفيذ لاحق يجب أن يلتزم هنا بالمنطق الأحدث الناسخ، وأي استنتاج من ملفات قديمة يُعتبر باطلًا.
