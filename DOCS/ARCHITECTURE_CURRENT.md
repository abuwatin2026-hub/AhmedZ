Version: 2026-01-29
Last validated against migrations up to: 20260128232000_unify_close_cash_shift_v2_signature.sql

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

### الهوية والتوزيع (AZTA)
- مصدر الحقيقة للهوية: [identity.ts](file:///d:/AhmedZ/config/identity.ts)
- واجهة الإنتاج (URL): https://ahmedzangah.pages.dev/#/
- أصل الويب (Origin) المطلوب للملفات الثابتة والتحديثات: https://ahmedzangah.pages.dev/
- مشروع Cloudflare Pages الإنتاجي: ahmedzangah (ahmedzangah.pages.dev)
- تطبيق Android:
  - applicationId: com.azta.ahmedzenkahtrading
  - ربط الروابط (App Links): /.well-known/assetlinks.json من مجلد public
- التحديث/التوزيع:
  - version.json و service-worker.js و downloads/* مضبوطة على no-store عبر headers
  - صفحة التحميل تتحقق من توفر APK عبر HEAD ثم تفعّل زر التحميل عند توفره
  - ملف التحميل الافتراضي: /downloads/ahmed-zenkah-trading-latest.apk
  - النسخة المنشورة حاليًا: versionName=1.0.1, versionCode=2
  - شرط التحديث على Android: نفس packageName ونفس توقيع الـKeystore عبر كل الإصدارات
  - بناء Release يتطلب تهيئة متغيرات التوقيع AZTA_RELEASE_* ويُفشل البناء عند غيابها لتجنب APK موقّع بـ debug

### التحكم في الصلاحيات والأدوار (Admin RBAC)
- أدوار الإدارة: owner, manager, employee, cashier, delivery, accountant.
- صلاحيات الواجهة الأساسية معرّفة مركزياً: [types.ts](file:///d:/JOMLA/AhmedZ/types.ts) (ADMIN_PERMISSION_DEFS).
- صلاحيات عرض إضافية مدعومة في الواجهة فقط: shipments.view, inventory.view, inventory.movements.view.
- Legacy Super Role: stock.manage يبقى صلاحية فائقة في الواجهة كفالـباك حيثما لزم، دون تعديل RLS.
- قوالب صلاحيات تشغيلية (واجهة فقط): UI_ROLE_PRESET_DEFS + permissionsForPreset لاستخدامها عند إنشاء/تعديل مستخدم.
  - Sales, Cashier, InventoryKeeper, Procurement, Accountant, BranchManager, Viewer.
  - تطبيق القالب في الإدارة: [AdminProfileScreen.tsx](file:///d:/JOMLA/AhmedZ/screens/admin/AdminProfileScreen.tsx#L298-L325) و[AdminProfileScreen.tsx](file:///d:/JOMLA/AhmedZ/screens/admin/AdminProfileScreen.tsx#L613-L622).

### فصل المبيعات عن التحصيل (واجهة فقط) — المرحلة 5.1
- الهدف: Sales ينشئ الطلب فقط؛ التحصيل النقدي Cashier/Accountant حصراً.
- تقييد وسائل الدفع (UI Guard):
  - canUseCash = hasPermission('orders.markPaid') && hasPermission('cashShifts.open').
  - إخفاء خيار "نقدًا" بالكامل من واجهة البيع الحضوري عند عدم تحقق canUseCash.
  - التنفيذ: [ManageOrdersScreen.tsx](file:///d:/JOMLA/AhmedZ/screens/admin/ManageOrdersScreen.tsx#L146-L160) و[ManageOrdersScreen.tsx](file:///d:/JOMLA/AhmedZ/screens/admin/ManageOrdersScreen.tsx#L1980-L1997).
- فصل الإنشاء عن التحصيل:
  - عند عدم امتلاك orders.markPaid لا يتم استدعاء record_order_payment، ويُنشأ الطلب بالحالة pending (بانتظار التحصيل)، ولا يُصدر invoiceSnapshot آنياً.
  - التنفيذ: [OrderContext.tsx](file:///d:/JOMLA/AhmedZ/contexts/OrderContext.tsx#L1243-L1332) مع تسجيل أحداث مشروطة [OrderContext.tsx](file:///d:/JOMLA/AhmedZ/contexts/OrderContext.tsx#L1453-L1480).
- توضيح الحالة (UX):
  - إشعار بعد الحفظ: "تم إنشاء الطلب وبانتظار التحصيل من الكاشير".
  - وسم بصري “بانتظار التحصيل” عند وجود متبقي ولم يتم التسليم.
  - التنفيذ: [ManageOrdersScreen.tsx](file:///d:/JOMLA/AhmedZ/screens/admin/ManageOrdersScreen.tsx#L636-L652) و[ManageOrdersScreen.tsx](file:///d:/JOMLA/AhmedZ/screens/admin/ManageOrdersScreen.tsx#L1037-L1046) و[ManageOrdersScreen.tsx](file:///d:/JOMLA/AhmedZ/screens/admin/ManageOrdersScreen.tsx#L1383-L1396).

### البيع الحضوري (In‑Store) — المرحلة 5.0
- اختيار العميل:
  - Walk‑In Retail (افتراضي): بدون customer_id.
  - Existing Customer: بحث برقم الهاتف من جدول customers واختيار العميل.
  - التنفيذ: [ManageOrdersScreen.tsx](file:///d:/JOMLA/AhmedZ/screens/admin/ManageOrdersScreen.tsx#L1735-L1811).
- تسعير الجملة تلقائيًا:
  - تمرير p_customer_id إلى get_item_price_with_discount عند وجود عميل فعلي.
  - التنفيذ: [OrderContext.tsx](file:///d:/JOMLA/AhmedZ/contexts/OrderContext.tsx#L1075-L1084) و[OrderContext.tsx](file:///d:/JOMLA/AhmedZ/contexts/OrderContext.tsx#L1544-L1551).
- الحقول الموسعة للطلب:
  - Order يحتوي الآن customerId و isDraft (واجهة فقط): [types.ts](file:///d:/JOMLA/AhmedZ/types.ts#L284-L302).
- مسودة/عرض سعر (Draft/Quotation) بلا حجز:
  - خيار “حفظ كمسودة” ينشئ طلب pending مع isDraft=true دون reserve_stock_for_order؛ التحويل لاحقاً عبر مسار التسليم/الدفع المعتاد.
  - التنفيذ: [OrderContext.tsx](file:///d:/JOMLA/AhmedZ/contexts/OrderContext.tsx#L1608-L1675) وزر الواجهة: [ManageOrdersScreen.tsx](file:///d:/JOMLA/AhmedZ/screens/admin/ManageOrdersScreen.tsx#L2262-L2280).
- POS: لم يتغير؛ يبقى Retail افتراضياً ولا يختار عميل من POS.

### إدارة العملاء — المرحلة 5.2 (واجهة فقط)
- تعريف العميل: المصدر الوحيد للعرض هو جدول customers؛ لا ربط ولا جلب من auth.users أو profiles أو admin_users.
- تنظيف القائمة: إخفاء المدير/الكاشير من قائمة العملاء عبر فلترة الواجهة بمطابقة ids على admin_users.
  - التنفيذ: تحميل مستخدمي الإدارة [ManageCustomersScreen.tsx](file:///d:/JOMLA/AhmedZ/screens/admin/ManageCustomersScreen.tsx#L140-L157) وتطبيق الفلتر [ManageCustomersScreen.tsx](file:///d:/JOMLA/AhmedZ/screens/admin/ManageCustomersScreen.tsx#L159-L162).
- توحيد القنوات:
  - عرض الطلبات للعميل عبر customer_auth_user_id (أونلاين) أو data->>customerId (حضوري).
  - التنفيذ: [ManageCustomersScreen.tsx](file:///d:/JOMLA/AhmedZ/screens/admin/ManageCustomersScreen.tsx#L92-L103).
- إنشاء عميل يدوي (واجهة فقط الآن):
  - زر “إضافة عميل” (Retail/Wholesale + حد ائتماني اختياري + ملاحظات).
  - الإدراج الفعلي يتطلب RPC مؤمّن (سيُعالج في المرحلة 6؛ لا تعديل RLS الآن).
  - التنفيذ: [ManageCustomersScreen.tsx](file:///d:/JOMLA/AhmedZ/screens/admin/ManageCustomersScreen.tsx#L172-L182) و[ManageCustomersScreen.tsx](file:///d:/JOMLA/AhmedZ/screens/admin/ManageCustomersScreen.tsx#L344-L411).
‑ الصلاحيات:
  - customers.view للاختيار في البيع.
  - customers.manage للإنشاء/التعديل/الحذف. Sales لديه view فقط؛ Accountant/Manager لديه manage.

### نظام الطباعة (Frontend) — Production/Enterprise Grade
ملاحظة إلزامية: هذا القسم يركّز على الطباعة وتجربة المستخدم في الواجهة. ترقيم/إصدار الفاتورة (invoiceNumber/issuedAt/snapshot) وتتبّع الطباعة له جزء تكاملي موثّق في قسم “الفواتير” أدناه.

- القوالب الأساسية:
  - فاتورة حرارية: [PrintableInvoice.tsx](file:///d:/JOMLA/AhmedZ/components/admin/PrintableInvoice.tsx)
  - فاتورة A4: [Invoice.tsx](file:///d:/JOMLA/AhmedZ/components/Invoice.tsx)
  - سند تسليم (Delivery Note): [PrintableOrder.tsx](file:///d:/JOMLA/AhmedZ/components/admin/PrintableOrder.tsx)
- تشغيل الطباعة/المشاركة:
  - طباعة HTML: [printUtils.ts](file:///d:/JOMLA/AhmedZ/utils/printUtils.ts) (دالة printContent + buildPrintHtml لإعادة الاستخدام)
  - مشاركة/طباعة PDF: [export.ts](file:///d:/JOMLA/AhmedZ/utils/export.ts) (sharePdf + printPdfFromElement)
  - شاشة الفاتورة (Admin/Customer): [InvoiceScreen.tsx](file:///d:/JOMLA/AhmedZ/screens/InvoiceScreen.tsx)
  - POS autoprint (لا تغييرات على المنطق): [POSScreen.tsx](file:///d:/JOMLA/AhmedZ/screens/POSScreen.tsx)

- إعدادات جديدة (Settings → Frontend فقط):
  - عرض الورق الحراري: settings.posFlags.thermalPaperWidth = "58mm" | "80mm"
  - طباعة حرارية تلقائية في POS: settings.posFlags.autoPrintThermalEnabled
  - عدد نسخ الطباعة الحرارية في POS: settings.posFlags.thermalCopies
  - القالب الافتراضي حسب الدور: settings.defaultInvoiceTemplateByRole { pos/admin/merchant → thermal|a4 }
  - هوية الفروع للطباعة (اختياري): settings.branchBranding[warehouseId] = { name,address,contactNumber,logoUrl }
  - النوع: [types.ts](file:///d:/JOMLA/AhmedZ/types.ts)
  - الافتراضات: [SettingsContext.tsx](file:///d:/JOMLA/AhmedZ/contexts/SettingsContext.tsx)
  - إدارة الإعدادات: [SettingsScreen.tsx](file:///d:/JOMLA/AhmedZ/screens/admin/SettingsScreen.tsx)

- قواعد التنفيذ المعتمدة الآن:
  - Thermal width:
    - القالب الحراري لا يحتوي عرض ثابت؛ يعتمد على settings.posFlags.thermalPaperWidth.
  - POS autoprint:
    - الطباعة الحرارية التلقائية بعد البيع تعتمد على settings.posFlags.autoPrintThermalEnabled.
    - عدد النسخ يعتمد على settings.posFlags.thermalCopies.
  - RTL Accounting (Thermal):
    - الأعمدة الرقمية (الكمية/السعر/الإجمالي) تلتزم: text-align:right + direction:ltr + tabular-nums.
  - A4 Official:
    - إضافة تاريخ/توقيع/ختم أسفل فاتورة A4 بدون التأثير على الحراري.
  - A4 @page:
    - توحيد @page داخل HTML المطبوع لضمان إخراج متسق: size A4 + margin 10mm (مع وضع auto للطباعة الحرارية).
  - Delivery Note:
    - تفعيل زر “طباعة سند تسليم” في الإدارة: [ManageOrdersScreen.tsx](file:///d:/JOMLA/AhmedZ/screens/admin/ManageOrdersScreen.tsx)
  - Print Preview (اختياري):
    - معاينة الطباعة متاحة في Admin/InvoiceScreen فقط عبر Modal، وتستخدم نفس HTML/CSS الفعلي للطباعة (بدون إعادة منطق).
    - POS autoprint يبقى بدون معاينة افتراضيًا.
  - ترقيم صفحات A4 (اختياري):
    - زر “A4 (ترقيم صفحات)” يطبع عبر PDF ويضيف "الصفحة X من Y" في التذييل (لا ينطبق على الحراري).
  - Watermark “نسخة”:
    - يظهر عند إعادة الطباعة فقط: A4 كعلامة مائية + الحراري كسطر بسيط.
    - يعتمد على order.invoicePrintCount (يزداد بعد كل طباعة عبر الواجهة).

- ملاحظة تشغيلية (Typecheck/Build):
  - استبعاد types-node من tsconfig لتجنب فحص مخرجات declarations وتخفيف الحمل: [tsconfig.json](file:///d:/JOMLA/AhmedZ/tsconfig.json)

### الفواتير (Invoice Issuance & Print Audit)
- أهلية إصدار الفاتورة في الواجهة (Frontend Gate):
  - تُصدر الفاتورة فقط عند delivered + paidAt (يشمل COD لأن paidAt لا يُضبط إلا بعد Settlement).
  - التنفيذ: [ensureInvoiceIssued](file:///d:/JOMLA/AhmedZ/contexts/OrderContext.tsx#L429-L495)
- ترقيم الفاتورة (Server-assisted):
  - عند توفر الاتصال وصلاحيات الإدارة، يتم إسناد invoiceNumber عبر RPC assign_invoice_number_if_missing ثم يُحفظ داخل order.data.
  - fallback: generateInvoiceNumber في الواجهة عند تعذر RPC.
  - المرجع: [assign_invoice_number_if_missing.sql](file:///d:/JOMLA/AhmedZ/supabase/migrations/20260115160000_assign_invoice_number_if_missing.sql) + [ensureInvoiceIssued](file:///d:/JOMLA/AhmedZ/contexts/OrderContext.tsx#L435-L495)
- Invoice Snapshot (Freeze):
  - عند إصدار الفاتورة لأول مرة يتم إنشاء invoiceSnapshot داخل order.data لتثبيت محتوى الفاتورة (items/amounts/customerInfo) وقت الإصدار.
  - الهدف: منع تغيّر الفاتورة عند تغيير بيانات الطلب لاحقًا (تصحيح/عروض/أسماء).
  - المرجع: [ensureInvoiceIssued](file:///d:/JOMLA/AhmedZ/contexts/OrderContext.tsx#L455-L493)
- تتبّع الطباعة (Audit-friendly):
  - invoicePrintCount و invoiceLastPrintedAt تُحدّث بعد الطباعة لتمييز “نسخة” وللتدقيق.
  - التنفيذ: [InvoiceScreen.tsx](file:///d:/JOMLA/AhmedZ/screens/InvoiceScreen.tsx) + [incrementInvoicePrintCount](file:///d:/JOMLA/AhmedZ/contexts/OrderContext.tsx)
 
### التسعير (Pricing)
- دالة السعر الزمنية المفعّلة الآن: get_item_price_with_discount(text p_item_id, uuid p_customer_id, numeric p_quantity)  
  المعرّفة في المهاجرة: [20260123252000_product_master_sot_lock_receiving_sellable_audit.sql](file:///d:/AhmedZ/supabase/migrations/20260123252000_product_master_sot_lock_receiving_sellable_audit.sql#L630-L714)  
  نقاط تنفيذ:
  - تعتمد price tiers وcustomer special prices مع تحقق زمني: valid_from/valid_to.
  - تُرجع سعر الوحدة “الفعّال” حسب الكمية/نوع العميل، بدون تعديل السعر الحقيقي المخزّن في menu_items.
- دالة السعر الأساسية للfallback: get_item_price(text p_item_id, numeric p_quantity, uuid p_customer_id)  
  الأحدث ضمن نفس المهاجرة أعلاه، تُعيد price من menu_items عند عدم وجود سعر خاص/شريحة.
 
### إنشاء الطلب عبر الويب (Online Orders)
- الدالة المفعّلة الآن (Checkout عبر الويب):  
  create_order_secure_with_payment_proof(jsonb p_items, uuid p_delivery_zone_id, text p_payment_method, text p_notes, text p_address, jsonb p_location, text p_customer_name, text p_phone_number, boolean p_is_scheduled, timestamptz p_scheduled_at, text p_coupon_code, numeric p_points_redeemed_value, text p_payment_proof_type, text p_payment_proof)  
  الأحدث: [20260126100000_critical_payment_proof_and_coupon_atomic.sql](file:///d:/AhmedZ/supabase/migrations/20260126100000_critical_payment_proof_and_coupon_atomic.sql)  
  نقاط تنفيذ:
  - يتحقق server-side من customer_name/phone_number/address بنفس قواعد الواجهة (رفض برسائل واضحة).
  - يسمح بحفظ إثبات الدفع فقط لطرق الدفع غير النقدية (kuraimi/network) ويمنعه للدفع النقدي.
  - يحفظ paymentProofType/paymentProof داخل orders.data عند الدفع غير النقدي.
  - يغلق صف الكوبون FOR UPDATE قبل إنشاء الطلب لمنع سباقات usageCount؛ الزيادة الفعلية تتم داخل create_order_secure أثناء إنشاء الطلب.
  - منطق إنشاء الطلب الأساسي (التسعير/الإضافات/FEFO/warehouseId) يبقى ضمن create_order_secure الأحدث (مرجع التكامل: [order_promotions_integration.sql](file:///d:/AhmedZ/supabase/migrations/20260124164000_order_promotions_integration.sql#L46-L455)).
 
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
Import Shipments Accounting Rule — Setting shipment status to delivered automatically applies landed cost to inventory and updates average cost for remaining stock. Historical COGS are not recalculated.
 
### محرك العروض (Promotions)
- المخطط (Schema):
  - الجدول الرئيسي: promotions  
    يحتوي على name, start_at, end_at, is_active, discount_mode ('fixed_total' | 'percent_off'), fixed_total, percent_off, display_original_total, max_uses, exclusive_with_coupon, requires_approval, approval_status, approval_request_id، مع قيود زمنية ومنع حالات غير صالحة.  
    [20260124160000_promotion_engine_schema.sql](file:///d:/AhmedZ/supabase/migrations/20260124160000_promotion_engine_schema.sql#L4-L55)
  - أصناف العرض: promotion_items  
    ربط فريد (promotion_id, item_id) وكميات وفرز، مع RLS للإدارة.  
    [promotion_items](file:///d:/AhmedZ/supabase/migrations/20260124160000_promotion_engine_schema.sql#L60-L80)
  - تتبع الاستهلاك: promotion_usage  
    يسجل promotion_line_id لكل طلب/قناة/مستودع مع سنابشوت كامل.  
    [promotion_usage](file:///d:/AhmedZ/supabase/migrations/20260124160000_promotion_engine_schema.sql#L84-L109)
- تراTriggers إنفاذ:
  - منع تعديل/حذف العرض بعد أول استخدام، ومنع إعادة التفعيل بعد الاستخدام:  
    [trg_promotions_lock_after_usage](file:///d:/AhmedZ/supabase/migrations/20260124160000_promotion_engine_schema.sql#L110-L158)
    [trg_promotion_items_lock_after_usage](file:///d:/AhmedZ/supabase/migrations/20260124160000_promotion_engine_schema.sql#L159-L183)
  - تفعيل العرض يتطلب موافقة وزمن صالح:  
    [trg_promotions_enforce_active_window_and_approval](file:///d:/AhmedZ/supabase/migrations/20260124161700_promotions_enforce_activation_fix.sql#L1-L20)
  - صحة تسجيل الاستهلاك: نشاط، زمن، موافقة، وحد استخدام:  
    [trg_promotion_usage_enforce_valid](file:///d:/AhmedZ/supabase/migrations/20260124160000_promotion_engine_schema.sql#L210-L255)
- واجهات RPC:
  - apply_promotion_to_cart(jsonb p_cart_payload, uuid p_promotion_id):  
    يتحقق من الموافقة والزمن وتعارض الكوبون، ويؤكد توافر المخزون/FEFO، ويعيد سنابشوت نهائي مع توزيع الإيراد وقيمة المصروف.  
    [promotion_engine_rpc.sql](file:///d:/AhmedZ/supabase/migrations/20260124161000_promotion_engine_rpc.sql#L43-L249)
  - _compute_promotion_snapshot(...)‎: نسخة معيارية داخلية للحساب.  
    [promotion_engine_internal.sql](file:///d:/AhmedZ/supabase/migrations/20260124161500_promotion_engine_internal.sql#L1-L205)
  - get_active_promotions(uuid p_customer_id, uuid p_warehouse_id): قوائم العروض الفعالة مع أسعارها الحالية.  
    [promotion_public_rpcs.sql](file:///d:/AhmedZ/supabase/migrations/20260124162500_promotion_public_rpcs.sql#L100-L140)
- تكامل الطلبات:
  - إدراج سطر العرض في create_order_secure مع منع الدمج مع الكوبون/النقاط، وتجميع أصناف المخزون لحجز FEFO:  
    [order_promotions_integration.sql](file:///d:/AhmedZ/supabase/migrations/20260124164000_order_promotions_integration.sql#L133-L177)
  - تأكيد التسليم يعيد حساب سنابشوت العرض ضمن نطاق المستودع ويسجل الاستهلاك ويدمج الأصناف للخصم:  
    [confirm_order_delivery_promo_snapshot_fix.sql](file:///d:/AhmedZ/supabase/migrations/20260124164500_confirm_order_delivery_promo_snapshot_fix.sql#L54-L101)
  - حواجز على مستوى الطلب لمنع خصم مزدوج (كوبون/نقاط) عند وجود عروض:  
    [orders_promotion_guards.sql](file:///d:/AhmedZ/supabase/migrations/20260124165500_orders_promotion_guards.sql#L1-L35)
- الـPOS أوفلاين:
  - منع مزامنة فواتير تحتوي عروض في وضع الأوفلاين:  
    [pos_offline_promotions_guard.sql](file:///d:/AhmedZ/supabase/migrations/20260125110000_pos_offline_promotions_guard.sql#L46-L60)

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
- واجهات RPC للإدارة (Admin list RPCs) — القراءة عبر SECURITY DEFINER (2026-01-28):
  - list_approval_requests(text p_status default 'pending', int p_limit default 200)  
    يُعيد قائمة الطلبات حسب الحالة (pending/approved/rejected أو all) مع حد أقصى 500، ويطبّق _require_staff.  
    المرجع: [20260128153000_approvals_admin_list_rpcs.sql](file:///d:/JOMLA/AhmedZ/supabase/migrations/20260128153000_approvals_admin_list_rpcs.sql)
  - list_approval_steps(uuid[] p_request_ids)  
    يُعيد جميع خطوات الموافقة لطلبات محددة (order by request_id, step_no) ويطبّق _require_staff.  
    المرجع: [20260128153000_approvals_admin_list_rpcs.sql](file:///d:/JOMLA/AhmedZ/supabase/migrations/20260128153000_approvals_admin_list_rpcs.sql)
- إنشاء طلب موافقة (Server-side):
  - create_approval_request(text target_table, text target_id, text request_type, numeric amount, jsonb payload) → uuid  
    يحسب payload_hash بـ digest(sha256) ويُنشئ approval_requests + approval_steps حسب policy_steps النشطة الأقرب لـ min_amount.  
    النسخة الناسخة (search_path مع extensions): [20260128162000_fix_pgcrypto_digest_search_path.sql](file:///d:/JOMLA/AhmedZ/supabase/migrations/20260128162000_fix_pgcrypto_digest_search_path.sql)
- منع التلاعب (Immutability + Self-approval):
  - approve_approval_step يمنع self_approval_forbidden، ويُقفل الطلب/الخطوة بعد finalization.  
    المرجع: [20260124143000_approvals_lock_and_self_approval.sql](file:///d:/JOMLA/AhmedZ/supabase/migrations/20260124143000_approvals_lock_and_self_approval.sql)

### المشتريات (Purchases) — أوامر الشراء/الاستلام/التكاليف/الدفعات (2026-01-28)
- الاستلام الجزئي (GRN) المعتمد الآن: receive_purchase_order_partial(uuid, jsonb, timestamptz)  
  النسخة الناسخة: [20260128195000_purchase_receipt_item_cost_overrides.sql](file:///d:/JOMLA/AhmedZ/supabase/migrations/20260128195000_purchase_receipt_item_cost_overrides.sql)  
  نقاط تنفيذ:
  - warehouse_id يُستنتج من purchase_orders.warehouse_id ثم fallback إلى default warehouse.
  - تحقق ISO للتواريخ: expiryDate/harvestDate؛ وإلزام expiryDate للأصناف الغذائية.
  - إنشاء batch_balances لكل دفعة وربط inventory_movements بـ batch_id.
  - التكاليف الفعلية في الاستلام يمكن إدخالها per-item:
    - transportCost/supplyTaxCost ضمن items payload تُستخدم بدل menu_items عند توفرها.
    - يتم حفظها داخل purchase_receipt_items (transport_cost/supply_tax_cost).
- تكامل الموافقات مع الاستلام:
  - إذا approval_required('receipt', total_amount) مطلوبة:
    - owner يقوم Auto-Approve عند الاستلام، وإلا يتم الرفض صراحةً برسالة purchase receipt requires approval.
  - مرجع التكامل الأولي: [receipt_approval_integration.sql](file:///d:/JOMLA/AhmedZ/supabase/migrations/20260128131000_receipt_approval_integration.sql)
- أوامر الشراء والموافقات/التزامن:
  - تكاملات “الاستلام/المرتجع/اعتماد أمر الشراء” تمت عبر حزمة هجرات:  
    [20260128150000_purchases_warehouse_returns_po_approval_sync.sql](file:///d:/JOMLA/AhmedZ/supabase/migrations/20260128150000_purchases_warehouse_returns_po_approval_sync.sql) + [20260128160000_purchases_owner_auto_approve_receipt_po.sql](file:///d:/JOMLA/AhmedZ/supabase/migrations/20260128160000_purchases_owner_auto_approve_receipt_po.sql)
- ترحيل حركة المخزون (Posting) أصبح Idempotent:
  - post_inventory_movement(uuid) يتأكد من عدم وجود journal_entries لنفس source_event قبل إنشاء قيد جديد (منع الترحيل المكرر).
  - المرجع: [20260128190000_fix_post_inventory_movement_idempotent.sql](file:///d:/JOMLA/AhmedZ/supabase/migrations/20260128190000_fix_post_inventory_movement_idempotent.sql)
- دفعات المورد (Purchase Order Payments):
  - record_purchase_order_payment(uuid, numeric, text, timestamptz, jsonb) تُسجّل دفعة في payments فقط وتترك تحديث paid_amount للتزامن من payments.
  - تمنع الدفع عند السداد الكامل، وتمنع تجاوز الإجمالي.
  - دفعة نقدية تتطلب وردية مفتوحة عبر shift_id.
  - النسخة الناسخة: [20260128220000_fix_record_purchase_order_payment_use_payments_sync.sql](file:///d:/JOMLA/AhmedZ/supabase/migrations/20260128220000_fix_record_purchase_order_payment_use_payments_sync.sql)
  - مزامنة paid_amount من payments مفروضة عبر trg_payments_sync_purchase_orders:
    [purchases_schema_constraints_narrow.sql](file:///d:/JOMLA/AhmedZ/supabase/migrations/20260121194001_purchases_schema_constraints_narrow.sql)
- توضيح واجهة “الحالة” في قائمة المشتريات:
  - تم فصل شارة الاستلام عن شارة الدفع لتجنب الالتباس: “الاستلام: … / الدفع: …”.
  - التنفيذ: [PurchaseOrderScreen.tsx](file:///d:/JOMLA/AhmedZ/screens/admin/PurchaseOrderScreen.tsx)

### الورديات النقدية (Cash Shifts) — إغلاق الوردية (RPC) (2026-01-28)
- close_cash_shift_v2 هو RPC المعتمد لإغلاق الوردية.
- التوقيع النهائي الموحد (Single Source): close_cash_shift_v2(uuid, numeric, text, text, jsonb, jsonb)  
  - يكتب denomination_counts و tender_counts داخل cash_shifts عند الإغلاق.
  - يمنع الإغلاق عند وجود فرق بدون p_forced_reason.
  - المرجع: [20260128232000_unify_close_cash_shift_v2_signature.sql](file:///d:/JOMLA/AhmedZ/supabase/migrations/20260128232000_unify_close_cash_shift_v2_signature.sql)
- توافق الواجهة:
  - الواجهة تحاول الإغلاق بالتوقيع الكامل، وتعمل fallback تلقائيًا عند تأخر schema cache.
  - التنفيذ: [CashShiftContext.tsx](file:///d:/JOMLA/AhmedZ/contexts/CashShiftContext.tsx) + [ShiftReportsScreen.tsx](file:///d:/JOMLA/AhmedZ/screens/admin/ShiftReportsScreen.tsx)

### العملة (Currency) — عملة واحدة فقط: YER (2026-01-28)
- قاعدة إلزامية: لا توجد أي عملات أخرى ولا يوجد تحويل/صرف عملة.
- get_base_currency() = 'YER' دائمًا، و get_fx_rate(...) = 1 دائمًا.
- تم استبدال تريجرات FX على orders/payments بتريجرات تفرض YER وتثبت fx_rate=1 و base_* = total/amount.
- المرجع: [20260128224000_force_single_currency_yer_no_fx.sql](file:///d:/JOMLA/AhmedZ/supabase/migrations/20260128224000_force_single_currency_yer_no_fx.sql)

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

### تسمية طرق الدفع التشغيلية (Binding)
- cash = نقدي (صندوق)
- network = بطاقات/مدفوعات إلكترونية (card/online)
- kuraimi = بنك/تحويل (bank/bank_transfer)
- تعتمد جميع المسارات الحالية على هذا الربط دون تغيير أي سلوك محاسبي.
    المرجع: [20260125120000_phase13_rbac_hardening_privilege_seal.sql](file:///d:/AhmedZ/supabase/migrations/20260125120000_phase13_rbac_hardening_privilege_seal.sql) + [20260123290000_phase11_financial_statements_integrity.sql](file:///d:/AhmedZ/supabase/migrations/20260123290000_phase11_financial_statements_integrity.sql)
- RLS Compatibility للتدقيق بعد FORCE RLS:
  - ledger_audit_log: سياسة INSERT داخلية مضافة لضمان استمرار تريجرات التدقيق عند FORCE RLS.  
    المرجع: [20260125120000_phase13_rbac_hardening_privilege_seal.sql](file:///d:/AhmedZ/supabase/migrations/20260125120000_phase13_rbac_hardening_privilege_seal.sql) + [20260123280000_phase10_ledger_immutability_period_lock.sql](file:///d:/AhmedZ/supabase/migrations/20260123280000_phase10_ledger_immutability_period_lock.sql)
 - محرك الترحيل المحاسبي (Dynamic Control Accounts):
   - post_* تقرأ حسابات التحكم من app_settings.data→'accounting_accounts' بقيم افتراضية سليمة؛ لا استخدام لحسابات غير مُعرّفة، والفشل صريح عند غياب الحساب في الدليل.
   - تجميد دوال الترحيل عبر حدث trg_freeze_posting_engine: يمنع CREATE/ALTER/DROP لـ post_* إلا عند ضبط app.posting_engine_upgrade='1' أثناء جلسات التحديث.
   - المراجع: [20260123240000_phase8_accounting_hardening.sql](file:///d:/AhmedZ/supabase/migrations/20260123240000_phase8_accounting_hardening.sql#L178-L186) + [phase8_accounting_hardening.sql](file:///d:/AhmedZ/supabase/migrations/20260123240000_phase8_accounting_hardening.sql#L519-L556)

### COD Cash Control (Cash-in-Transit) — Full Accounting Lifecycle
قاعدة إلزامية: التسليم ≠ التحصيل. لا يُضبط paidAt لأي طلب COD إلا بعد قبض فعلي داخل وردية الكاشير وتسجيل Payment نقدي.

- نطاق التطبيق:
  - ينطبق على: COD للتوصيل فقط (paymentMethod='cash' و orderSource<>'in_store' و delivery_zone_id موجود).
- الحسابات المفاهيمية (CoA مبسّط على مستوى Ledger المخصص للـ COD):
  - Sales_Revenue
  - Accounts_Receivable_COD
  - Cash_In_Transit
  - Cash_On_Hand
- جداول Ledger (Immutable):
  - ledger_entries / ledger_lines
  - driver_ledger (ذمة مندوب برصيد تراكمي balance_after)
  - cod_settlements / cod_settlement_orders (تسوية مفردة أو مجمّعة)
  - المرجع: [20260127093000_cod_cash_in_transit_ledger.sql](file:///d:/JOMLA/AhmedZ/supabase/migrations/20260127093000_cod_cash_in_transit_ledger.sql)
- أمان RLS (تقسية):
  - تم تفعيل FORCE ROW LEVEL SECURITY على جداول المحاسبة المذكورة لمنع أي تجاوز للسياسات عبر أدوار عليا أو استدعاءات غير متوقعة.
  - المرجع: [20260127100500_force_rls_accounting.sql](file:///d:/JOMLA/AhmedZ/supabase/migrations/20260127100500_force_rls_accounting.sql)
- دورة القيود (Step-by-Step):
  - عند تسليم الطلب (Delivery):
    - يمنع paidAt المبكر (حتى لو أرسله العميل).
    - قيد الإيراد (Accrual):
      - Dr Accounts_Receivable_COD / Cr Sales_Revenue
    - نقل النقد خارج الصندوق (Cash-in-Transit):
      - Dr Cash_In_Transit / Cr Accounts_Receivable_COD
    - ذمة المندوب:
      - driver_ledger: Debit على المندوب بقيمة الطلب.
    - التنفيذ يتم Server-side داخل confirm_order_delivery عبر cod_post_delivery:
      - [confirm_order_delivery](file:///d:/JOMLA/AhmedZ/supabase/migrations/20260127093000_cod_cash_in_transit_ledger.sql)
      - [cod_post_delivery](file:///d:/JOMLA/AhmedZ/supabase/migrations/20260127093000_cod_cash_in_transit_ledger.sql)
  - عند تسليم المندوب النقد للإدارة (Settlement):
    - شرط: وردية نقدية مفتوحة للكاشير + صلاحية accounting.manage.
    - قيد تسوية CIT:
      - Dr Cash_On_Hand / Cr Cash_In_Transit
    - ذمة المندوب:
      - driver_ledger: Credit على المندوب بمبلغ التسوية.
    - إنشاء Payment نقدي داخل الوردية عبر record_order_payment (لضمان الربط بالوردية وإنشاء قيد يومية وفق Posting Seal).
    - الآن فقط: orders.data.paidAt = occurred_at
    - RPC مفرد: cod_settle_order(order_id)
      - المرجع: [cod_settle_order](file:///d:/JOMLA/AhmedZ/supabase/migrations/20260127093000_cod_cash_in_transit_ledger.sql)
    - RPC مجمّع حسب المندوب: cod_settle_orders(driver_id, order_ids[])
      - المرجع: [20260127095000_cod_batch_settlement.sql](file:///d:/JOMLA/AhmedZ/supabase/migrations/20260127095000_cod_batch_settlement.sql)
- التقارير/المطابقة (إلزامي):
  - رصيد Cash-in-Transit الحالي: v_cash_in_transit_balance
  - ذمم المندوبين: v_driver_ledger_balances
  - مطابقة CIT = Σ أرصدة المندوبين: v_cod_reconciliation_check
  - تدقيق كامل لطلب COD: get_cod_audit(order_id)
  - المرجع: [20260127093000_cod_cash_in_transit_ledger.sql](file:///d:/JOMLA/AhmedZ/supabase/migrations/20260127093000_cod_cash_in_transit_ledger.sql)
- تقارير المبيعات النقدية (منع الاعتراف النقدي المبكر):
  - get_payment_method_stats لا يحتسب COD delivered قبل paidAt.
  - get_sales_report_summary يعزل total_collected عن COD قبل paidAt.
  - المرجع: [20260127094000_cod_cash_basis_filters.sql](file:///d:/JOMLA/AhmedZ/supabase/migrations/20260127094000_cod_cash_basis_filters.sql) + [20260127094500_cod_fix_sales_report_summary_cash.sql](file:///d:/JOMLA/AhmedZ/supabase/migrations/20260127094500_cod_fix_sales_report_summary_cash.sql)
- نقاط الربط في الواجهة (Frontend):
  - منع ضبط paidAt عند delivered لطلبات COD، ومنع record_order_payment عند التسليم (COD فقط): [OrderContext.tsx](file:///d:/JOMLA/AhmedZ/contexts/OrderContext.tsx)
  - غير COD: لا يُضبط paidAt إلا بعد نجاح تسجيل الدفعة عبر record_order_payment؛ في وضع Offline فقط يُسمح بضبط paidAt مع جدولة الدفع بالطابور لضمان عدم فقد بيانات الدفع.
    - المرجع: [OrderContext.updateOrderStatus](file:///d:/JOMLA/AhmedZ/contexts/OrderContext.tsx#L1889-L2056)
  - تسوية COD (واجهة مجمّعة حسب المندوب): /admin/cod-settlements
    - الشاشة: [CODSettlementsScreen.tsx](file:///d:/JOMLA/AhmedZ/screens/admin/CODSettlementsScreen.tsx)
    - الربط بالروترات: [App.tsx](file:///d:/JOMLA/AhmedZ/App.tsx)
    - إظهار الرابط في القائمة: [AdminLayout.tsx](file:///d:/JOMLA/AhmedZ/screens/admin/AdminLayout.tsx)
- تحسينات UX/Audit (اختيارية لكنها مفعّلة الآن):
  - Badge “نقد لدى المندوب” في قائمة الطلبات (قراءة فقط من v_driver_ledger_balances).
  - Modal تأكيد التسوية في شاشة COD (اسم المندوب/عدد الطلبات/المبلغ).
  - زر “عرض سجل COD” يستدعي get_cod_audit(order_id) للعرض فقط.
  - المرجع: [ManageOrdersScreen.tsx](file:///d:/JOMLA/AhmedZ/screens/admin/ManageOrdersScreen.tsx) + [CODSettlementsScreen.tsx](file:///d:/JOMLA/AhmedZ/screens/admin/CODSettlementsScreen.tsx)
 
### الفترات المحاسبية (Accounting Periods) — Enforcement & UX
- Enforcement:
  - إقفال الفترة يفرض منعًا تشغيليًا لأي إدراج/تعديل بقيود محاسبية بتاريخ يقع داخل نطاق الفترة المقفلة (entry_date ضمن [start_date, end_date]).
  - الإنفاذ يتم على مستوى قاعدة البيانات عبر النسخة الأحدث من سياسات/تريجرات القفل، مع FORCE RLS على الجداول المحاسبية ذات الصلة لضمان عدم وجود مسارات التفاف.
  - المراجع: [20260123280000_phase10_ledger_immutability_period_lock.sql](file:///d:/AhmedZ/supabase/migrations/20260123280000_phase10_ledger_immutability_period_lock.sql) + [20260125120000_phase13_rbac_hardening_privilege_seal.sql](file:///d:/AhmedZ/supabase/migrations/20260125120000_phase13_rbac_hardening_privilege_seal.sql)
- UX Clarification (2026-01-26):
  - فتح/بدء فترة محاسبية لا يغيّر سلوك التشغيل ولا يمنع البيع أو الشراء أو القيود؛ الغرض منها تعريف زمني للتقارير فقط.
  - واجهة التقارير تُظهر شارات حالة محدثة: “مفتوحة (تعريفية فقط)” و“مقفلة (منع تشغيلي)” مع Tooltips توضيحية للأثر.
  - زر “بدء فترة محاسبية” أصبح مصحوبًا بـ Tooltip يوضّح أنه لا يقيّد التشغيل؛ وإقفال الفترة يمر عبر نافذة تأكيد تحتوي تحذيرًا نهائيًا غير قابل للتراجع.
  - رسائل الرفض بسبب الفترات المقفلة تُذكر السبب صراحةً عبر طبقة توطين الأخطاء (localizeSupabaseError).
  - لا تغييرات على منطق الإقفال/التريجرات/سياسات RLS؛ التعديلات واجهة فقط.
  - مراجع الواجهة: [FinancialReports.tsx](file:///d:/AhmedZ/screens/admin/reports/FinancialReports.tsx)، [errorUtils.ts](file:///d:/AhmedZ/utils/errorUtils.ts)

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
- الوردية (close_cash_shift_v2):
  - وجود توقيعين مختلفين لـ close_cash_shift_v2 (5 بارامترات/6 بارامترات) تم تجاوزه؛ النسخة المعتمدة الآن توقيع واحد فقط بستة بارامترات.  
    المرجع: [20260128232000_unify_close_cash_shift_v2_signature.sql](file:///d:/JOMLA/AhmedZ/supabase/migrations/20260128232000_unify_close_cash_shift_v2_signature.sql)
- العملة/سعر الصرف:
  - منطق FX multi-currency على orders/payments تم تعطيله لصالح عملة واحدة YER فقط.  
    المرجع: [20260128224000_force_single_currency_yer_no_fx.sql](file:///d:/JOMLA/AhmedZ/supabase/migrations/20260128224000_force_single_currency_yer_no_fx.sql)
- عكس القيود:
  - reverse_journal_entry بحماية staff-only تم تجاوزه؛ النسخة الفعلية تتطلب service_role أو accounting.manage.  
    المرجع: [20260125120000_phase13_rbac_hardening_privilege_seal.sql](file:///d:/AhmedZ/supabase/migrations/20260125120000_phase13_rbac_hardening_privilege_seal.sql)
 
## نقاط النظام الحرجة (Enforcement Summary)
- التسعير فعليًا:
  - كل تسعير يُستخرج في الخادم عبر get_item_price_with_discount مع تحقق زمني للشريحة/السعر الخاص؛ لا تعديل للسعر الحقيقي في الأصناف.
  - الكوبونات تُفحص وتُزاد ذريًا داخل إنشاء الطلب؛ لا يوجد أي تعديل لعدادات usageCount من الواجهة.
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
- أي مسار Frontend يزيد usageCount للكوبونات (تم إزالته؛ الزيادة تتم داخل إنشاء الطلب فقط).
 
### شفافية الفاتورة (Invoice → Promotion → Approval → Journal)
- الواجهة: get_invoice_audit(uuid p_order_id) تعيد مسار التدقيق الكامل للفاتورة.
- ترابط البيانات: رقم الفاتورة، نوع الخصم (عرض/خصم يدوي)، تفاصيل العرض/الاستهلاك/طلب الموافقة، ورقم قيد اليومية المرتبط بالتسليم.
- المرجع: [20260125130000_remediation_hardening.sql#L1-L103](file:///d:/AhmedZ/supabase/migrations/20260125130000_remediation_hardening.sql#L1-L103)

### Drill-down المالي (P&L → GL → Journal)
- مصروف العروض 6150: get_promotion_expense_drilldown(start,end,min) يعرض قيود اليومية المرتبطة بالمصروف مع ربط الطلب/الفاتورة/الاستهلاك.
- استخدام العرض: get_promotion_usage_drilldown(promotion_id,start,end) يعرض كل حالات الاستهلاك مع ربط قيد اليومية عند التسليم.
- المراجع:
  - [get_promotion_expense_drilldown](file:///d:/AhmedZ/supabase/migrations/20260125130000_remediation_hardening.sql#L104-L176)
  - [get_promotion_usage_drilldown](file:///d:/AhmedZ/supabase/migrations/20260125130000_remediation_hardening.sql#L177-L233)

### لوحة تسوية POS أوفلاين
- مخطط التسوية: أعمدة reconciliation_status/approval_request_id/reconciled_by/reconciled_at/Note على pos_offline_sales مع قيد تحقق للحالات.
- طلب تسوية: request_offline_reconciliation(offline_id,reason) ينشئ طلب موافقة ‘offline_reconciliation’ ويُحدّث حالة التسوية إلى PENDING.
- مزامنة أوفلاين: sync_offline_pos_sale(...) يمنع العروض في الأوفلاين، ويعيد CONFLICT/FAILED عند نقص الحجز/انتهاء الدُفعات، ويتطلب موافقة قبل إعادة محاولة.
- لوحة عرض: get_pos_offline_sales_dashboard(state?,limit?) لعرض الحالات وحالة التسوية.
- المراجع:
  - [قيد النوع وإعداد السياسة](file:///d:/AhmedZ/supabase/migrations/20260125130000_remediation_hardening.sql#L235-L261)
  - [أعمدة التسوية والقيود](file:///d:/AhmedZ/supabase/migrations/20260125130000_remediation_hardening.sql#L264-L281)
  - [مزامنة حالة الموافقة Trigger](file:///d:/AhmedZ/supabase/migrations/20260125130000_remediation_hardening.sql#L282-L320)
  - [request_offline_reconciliation](file:///d:/AhmedZ/supabase/migrations/20260125130000_remediation_hardening.sql#L371-L449)
  - [get_pos_offline_sales_dashboard](file:///d:/AhmedZ/supabase/migrations/20260125130000_remediation_hardening.sql#L451-L506)
  - [sync_offline_pos_sale](file:///d:/AhmedZ/supabase/migrations/20260125130000_remediation_hardening.sql#L507-L684)

### توحيد فلاتر التواريخ
- توحيد startDate/endDate/asOfDate عبر تقارير المبيعات/العملاء/المنتجات/المالية لضمان نتائج متسقة في جميع الشاشات.
- يعتمد على واجهات التقارير الأحدث التي تُعيد النتائج حسب وقت إصدار الفاتورة وتسليم الطلب.

### سياسة مصروف العروض (Promotion Expense)
- تسجيل أثر العرض كمصروف تشغيل (6150) مرتبط بقيود التسليم، مع فصل صريح بين إجمالي الخصم ومصروف العرض.
- رؤوس التقارير تعرض زر “تفاصيل” للـ Drill-down إلى القيود/الاستهلاك/الفواتير.
- المراجع: [get_promotion_expense_drilldown](file:///d:/AhmedZ/supabase/migrations/20260125130000_remediation_hardening.sql#L104-L176)

### خطة التراجع (Rollback Plan)
- قبل أي تراجع: خذ نسخة احتياطية (Snapshot) من قاعدة البيانات.
  - Windows PowerShell:
    - إنشاء مجلد النسخ: New-Item -ItemType Directory -Path .\backups -Force
    - نفّذ pg_dump من بيئة تشغيل آمنة تملك بيانات الاتصال
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

- خطوات التراجع لهذه الهجرة 20260126100000_critical_payment_proof_and_coupon_atomic.sql:
  - تنفيذ داخل معاملة:
    - begin;
    - drop function if exists public.create_order_secure_with_payment_proof(jsonb, uuid, text, text, text, jsonb, text, text, boolean, timestamptz, text, numeric, text, text);
    - commit;

---
هذا المستند هو المرجع الوحيد للحالة الحالية. أي تحليل أو تنفيذ لاحق يجب أن يلتزم هنا بالمنطق الأحدث الناسخ، وأي استنتاج من ملفات قديمة يُعتبر باطلًا.
