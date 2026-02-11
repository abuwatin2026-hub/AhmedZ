# تقرير اختبار دخان شامل (Full Enterprise Smoke)

- وقت البدء: 2026-02-11T02:15:23.788Z
- وقت النهاية: 2026-02-11T02:15:24.551Z
- الحالة: PASS
- عدد الاختبارات الناجحة: 17
- عدد الاختبارات الفاشلة: 0
- الزمن الإجمالي (تقريبي): 0 ms

## نتائج الخطوات

- ✅ FX00 — Seed FX rates (0 ms) | {"base":"SAR","usd":3.75,"yer":0.015}
- ✅ ITEM00 — Created item + UOM units (0 ms) | {"item_id":"SMOKE-ITEM-007f8b95f4aa484294eb8b6fb001a413","pack":"90430ca0-7e15-46f1-afd6-f3f90f602d99","carton":"7f914baa-3389-4547-8e83-df0118d8a2a4"}
- ✅ SHIP00 — Created shipment + expenses (0 ms) | {"shipment_id":"5d5f0292-1aca-48b5-9f4b-3d99ba616953"}
- ✅ PO00 — PO+Receive Base (carton) (0 ms) | {"po":"1501140d-d969-47dd-b48f-245cd216a431","receipt":"475b872d-63da-43fa-a779-69e6d03df87e"}
- ✅ PO01 — PO+Receive YER (carton) (0 ms) | {"po":"205de32a-c84e-49ee-be66-331cc73456d1","receipt":"34b29252-1ea4-4b83-90b0-cb01fb121e17","shipment":"5d5f0292-1aca-48b5-9f4b-3d99ba616953"}
- ✅ STK00 — Stock increased after receipts (0 ms) | {"available":48,"avg_cost":0.50750000000000000000}
- ✅ SHIP01 — Close shipment + landed cost (0 ms) | {"shipment_id":"5d5f0292-1aca-48b5-9f4b-3d99ba616953"}
- ✅ PAY00 — Supplier payments posted (0 ms) | {"po_base":"1501140d-d969-47dd-b48f-245cd216a431","po_yer":"205de32a-c84e-49ee-be66-331cc73456d1"}
- ✅ SALES00 — Sold item in 3 units/currencies (0 ms) | {"item":"SMOKE-ITEM-007f8b95f4aa484294eb8b6fb001a413"}
- ✅ ACC00 — Posted balanced entries exist (0 ms) | {"posted_balanced":16}
- ✅ STMT00 — Supplier statement rows all (0 ms) | {"rows":2}
- ✅ STMT01 — Supplier statement rows base (0 ms) | {"rows":1}
- ✅ STMT02 — Supplier statement rows YER (0 ms) | {"rows":1}
- ✅ STMT10 — Customer statement rows all (0 ms) | {"rows":6}
- ✅ STMT11 — Customer statement rows base (0 ms) | {"rows":2}
- ✅ STMT12 — Customer statement rows USD (0 ms) | {"rows":2}
- ✅ STMT13 — Customer statement rows YER (0 ms) | {"rows":2}

## تقييم جاهزية الإنتاج

- جاهز من منظور Smoke Test: نعم
- مخاطر محاسبية مكتشفة: لا
- خروقات صلاحيات مكتشفة: لا
