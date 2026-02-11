# تقرير اختبار دخان شامل (Full Enterprise Smoke)

- وقت البدء: 2026-02-11T02:33:01.817Z
- وقت النهاية: 2026-02-11T02:33:02.511Z
- الحالة: PASS
- عدد الاختبارات الناجحة: 17
- عدد الاختبارات الفاشلة: 0
- الزمن الإجمالي (تقريبي): 0 ms

## نتائج الخطوات

- ✅ FX00 — Seed FX rates (0 ms) | {"base":"SAR","usd":3.75,"yer":0.015}
- ✅ ITEM00 — Created item + UOM units (0 ms) | {"item_id":"SMOKE-ITEM-b6f48bee75c44199a029e5aadc2e02cb","pack":"90430ca0-7e15-46f1-afd6-f3f90f602d99","carton":"7f914baa-3389-4547-8e83-df0118d8a2a4"}
- ✅ SHIP00 — Created shipment + expenses (0 ms) | {"shipment_id":"621e052c-3c6c-44d4-8c42-ccd01267e3b7"}
- ✅ PO00 — PO+Receive Base (carton) (0 ms) | {"po":"8adec2d8-65e9-49a4-b0b1-acda42c3b24a","receipt":"f51c7841-3254-428f-9a5e-40d0aee42bca"}
- ✅ PO01 — PO+Receive YER (carton) (0 ms) | {"po":"8f5aebce-8d0d-467b-b351-284424205508","receipt":"5bd167b1-1aa5-4ce7-95af-c433220cee73","shipment":"621e052c-3c6c-44d4-8c42-ccd01267e3b7"}
- ✅ STK00 — Stock increased after receipts (0 ms) | {"available":48,"avg_cost":0.50750000000000000000}
- ✅ SHIP01 — Close shipment + landed cost (0 ms) | {"shipment_id":"621e052c-3c6c-44d4-8c42-ccd01267e3b7"}
- ✅ PAY00 — Supplier payments posted (0 ms) | {"po_base":"8adec2d8-65e9-49a4-b0b1-acda42c3b24a","po_yer":"8f5aebce-8d0d-467b-b351-284424205508"}
- ✅ SALES00 — Sold item in 3 units/currencies (0 ms) | {"item":"SMOKE-ITEM-b6f48bee75c44199a029e5aadc2e02cb"}
- ✅ ACC00 — Posted balanced entries exist (0 ms) | {"posted_balanced":64}
- ✅ STMT00 — Supplier statement rows all (0 ms) | {"rows":8}
- ✅ STMT01 — Supplier statement rows base (0 ms) | {"rows":4}
- ✅ STMT02 — Supplier statement rows YER (0 ms) | {"rows":4}
- ✅ STMT10 — Customer statement rows all (0 ms) | {"rows":24}
- ✅ STMT11 — Customer statement rows base (0 ms) | {"rows":8}
- ✅ STMT12 — Customer statement rows USD (0 ms) | {"rows":8}
- ✅ STMT13 — Customer statement rows YER (0 ms) | {"rows":8}

## تقييم جاهزية الإنتاج

- جاهز من منظور Smoke Test: نعم
- مخاطر محاسبية مكتشفة: لا
- خروقات صلاحيات مكتشفة: لا
