# تقرير اختبار دخان شامل (Full Enterprise Smoke)

- وقت البدء: 2026-02-11T02:24:43.165Z
- وقت النهاية: 2026-02-11T02:24:43.996Z
- الحالة: PASS
- عدد الاختبارات الناجحة: 17
- عدد الاختبارات الفاشلة: 0
- الزمن الإجمالي (تقريبي): 0 ms

## نتائج الخطوات

- ✅ FX00 — Seed FX rates (0 ms) | {"base":"SAR","usd":3.75,"yer":0.015}
- ✅ ITEM00 — Created item + UOM units (0 ms) | {"item_id":"SMOKE-ITEM-f2444db58c824d63a1bb33c44d0adb9f","pack":"90430ca0-7e15-46f1-afd6-f3f90f602d99","carton":"7f914baa-3389-4547-8e83-df0118d8a2a4"}
- ✅ SHIP00 — Created shipment + expenses (0 ms) | {"shipment_id":"dc70cac6-c35c-4252-91c6-c33e7e87865d"}
- ✅ PO00 — PO+Receive Base (carton) (0 ms) | {"po":"e7f16510-63fa-4ba1-b5f7-825a526bc810","receipt":"9f3f3d72-3d3e-4ad6-93e0-0cf00ec896e1"}
- ✅ PO01 — PO+Receive YER (carton) (0 ms) | {"po":"10d55db7-da44-4378-ac4f-3c6ed2a3c02f","receipt":"93d318a8-f990-4f7b-872a-f5d24866adf1","shipment":"dc70cac6-c35c-4252-91c6-c33e7e87865d"}
- ✅ STK00 — Stock increased after receipts (0 ms) | {"available":48,"avg_cost":0.50750000000000000000}
- ✅ SHIP01 — Close shipment + landed cost (0 ms) | {"shipment_id":"dc70cac6-c35c-4252-91c6-c33e7e87865d"}
- ✅ PAY00 — Supplier payments posted (0 ms) | {"po_base":"e7f16510-63fa-4ba1-b5f7-825a526bc810","po_yer":"10d55db7-da44-4378-ac4f-3c6ed2a3c02f"}
- ✅ SALES00 — Sold item in 3 units/currencies (0 ms) | {"item":"SMOKE-ITEM-f2444db58c824d63a1bb33c44d0adb9f"}
- ✅ ACC00 — Posted balanced entries exist (0 ms) | {"posted_balanced":32}
- ✅ STMT00 — Supplier statement rows all (0 ms) | {"rows":4}
- ✅ STMT01 — Supplier statement rows base (0 ms) | {"rows":2}
- ✅ STMT02 — Supplier statement rows YER (0 ms) | {"rows":2}
- ✅ STMT10 — Customer statement rows all (0 ms) | {"rows":12}
- ✅ STMT11 — Customer statement rows base (0 ms) | {"rows":4}
- ✅ STMT12 — Customer statement rows USD (0 ms) | {"rows":4}
- ✅ STMT13 — Customer statement rows YER (0 ms) | {"rows":4}

## تقييم جاهزية الإنتاج

- جاهز من منظور Smoke Test: نعم
- مخاطر محاسبية مكتشفة: لا
- خروقات صلاحيات مكتشفة: لا
