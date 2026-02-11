# تقرير اختبار دخان شامل (Full Enterprise Smoke)

- وقت البدء: 2026-02-11T02:38:52.293Z
- وقت النهاية: 2026-02-11T02:38:53.026Z
- الحالة: PASS
- عدد الاختبارات الناجحة: 17
- عدد الاختبارات الفاشلة: 0
- الزمن الإجمالي (تقريبي): 0 ms

## نتائج الخطوات

- ✅ FX00 — Seed FX rates (0 ms) | {"base":"SAR","usd":3.75,"yer":0.015}
- ✅ ITEM00 — Created item + UOM units (0 ms) | {"item_id":"SMOKE-ITEM-baa925658ec34a1c9610274354e9c2ee","pack":"90430ca0-7e15-46f1-afd6-f3f90f602d99","carton":"7f914baa-3389-4547-8e83-df0118d8a2a4"}
- ✅ SHIP00 — Created shipment + expenses (0 ms) | {"shipment_id":"6985a6c9-919f-4aa2-8f04-e6918d2a64f5"}
- ✅ PO00 — PO+Receive Base (carton) (0 ms) | {"po":"353cd570-3ea1-4291-9378-ceababe3e461","receipt":"3211c62c-f7dc-4e2a-b2d6-ccc7dadeaea4"}
- ✅ PO01 — PO+Receive YER (carton) (0 ms) | {"po":"df4506a3-3b61-4a3e-835f-55aa69c15493","receipt":"3d5c7363-c7db-4144-9a15-6d501ee3c6ef","shipment":"6985a6c9-919f-4aa2-8f04-e6918d2a64f5"}
- ✅ STK00 — Stock increased after receipts (0 ms) | {"available":48,"avg_cost":0.50750000000000000000}
- ✅ SHIP01 — Close shipment + landed cost (0 ms) | {"shipment_id":"6985a6c9-919f-4aa2-8f04-e6918d2a64f5"}
- ✅ PAY00 — Supplier payments posted (0 ms) | {"po_base":"353cd570-3ea1-4291-9378-ceababe3e461","po_yer":"df4506a3-3b61-4a3e-835f-55aa69c15493"}
- ✅ SALES00 — Sold item in 3 units/currencies (0 ms) | {"item":"SMOKE-ITEM-baa925658ec34a1c9610274354e9c2ee"}
- ✅ ACC00 — Posted balanced entries exist (0 ms) | {"posted_balanced":84}
- ✅ STMT00 — Supplier statement rows all (0 ms) | {"rows":10}
- ✅ STMT01 — Supplier statement rows base (0 ms) | {"rows":5}
- ✅ STMT02 — Supplier statement rows YER (0 ms) | {"rows":5}
- ✅ STMT10 — Customer statement rows all (0 ms) | {"rows":30}
- ✅ STMT11 — Customer statement rows base (0 ms) | {"rows":10}
- ✅ STMT12 — Customer statement rows USD (0 ms) | {"rows":10}
- ✅ STMT13 — Customer statement rows YER (0 ms) | {"rows":10}

## تقييم جاهزية الإنتاج

- جاهز من منظور Smoke Test: نعم
- مخاطر محاسبية مكتشفة: لا
- خروقات صلاحيات مكتشفة: لا
