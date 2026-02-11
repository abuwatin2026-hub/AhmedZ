# تقرير اختبار دخان شامل (Full Enterprise Smoke)

- وقت البدء: 2026-02-11T04:01:44.622Z
- وقت النهاية: 2026-02-11T04:01:45.209Z
- الحالة: PASS
- عدد الاختبارات الناجحة: 17
- عدد الاختبارات الفاشلة: 0
- الزمن الإجمالي (تقريبي): 0 ms

## نتائج الخطوات

- ✅ FX00 — Seed FX rates (0 ms) | {"base":"SAR","usd":3.75,"yer":0.015}
- ✅ ITEM00 — Created item + UOM units (0 ms) | {"item_id":"SMOKE-ITEM-ff98a7956d8543b5b6bbd8b13dc60457","pack":"90430ca0-7e15-46f1-afd6-f3f90f602d99","carton":"7f914baa-3389-4547-8e83-df0118d8a2a4"}
- ✅ SHIP00 — Created shipment + expenses (0 ms) | {"shipment_id":"75101346-044b-47e8-9f9a-2598e50ed710"}
- ✅ PO00 — PO+Receive Base (carton) (0 ms) | {"po":"212f2c03-2aaa-44f8-944d-d9d811692c6c","receipt":"b04e2fa8-563f-4534-b522-9cb2ae1157aa"}
- ✅ PO01 — PO+Receive YER (carton) (0 ms) | {"po":"f9c9365f-f368-4f02-9643-8b62a0d4f01f","receipt":"8ca84d58-3956-4f40-bc5a-521e64dff965","shipment":"75101346-044b-47e8-9f9a-2598e50ed710"}
- ✅ STK00 — Stock increased after receipts (0 ms) | {"available":48,"avg_cost":0.50750000000000000000}
- ✅ SHIP01 — Close shipment + landed cost (0 ms) | {"shipment_id":"75101346-044b-47e8-9f9a-2598e50ed710"}
- ✅ PAY00 — Supplier payments posted (0 ms) | {"po_base":"212f2c03-2aaa-44f8-944d-d9d811692c6c","po_yer":"f9c9365f-f368-4f02-9643-8b62a0d4f01f"}
- ✅ SALES00 — Sold item in 3 units/currencies (0 ms) | {"item":"SMOKE-ITEM-ff98a7956d8543b5b6bbd8b13dc60457"}
- ✅ ACC00 — Posted balanced entries exist (0 ms) | {"posted_balanced":121}
- ✅ STMT00 — Supplier statement rows all (0 ms) | {"rows":14}
- ✅ STMT01 — Supplier statement rows base (0 ms) | {"rows":7}
- ✅ STMT02 — Supplier statement rows YER (0 ms) | {"rows":7}
- ✅ STMT10 — Customer statement rows all (0 ms) | {"rows":42}
- ✅ STMT11 — Customer statement rows base (0 ms) | {"rows":14}
- ✅ STMT12 — Customer statement rows USD (0 ms) | {"rows":14}
- ✅ STMT13 — Customer statement rows YER (0 ms) | {"rows":14}

## تقييم جاهزية الإنتاج

- جاهز من منظور Smoke Test: نعم
- مخاطر محاسبية مكتشفة: لا
- خروقات صلاحيات مكتشفة: لا
