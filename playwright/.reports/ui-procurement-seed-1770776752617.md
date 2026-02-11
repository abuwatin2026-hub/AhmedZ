# تقرير اختبار دخان شامل (Full Enterprise Smoke)

- وقت البدء: 2026-02-11T02:25:52.691Z
- وقت النهاية: 2026-02-11T02:25:53.460Z
- الحالة: PASS
- عدد الاختبارات الناجحة: 17
- عدد الاختبارات الفاشلة: 0
- الزمن الإجمالي (تقريبي): 0 ms

## نتائج الخطوات

- ✅ FX00 — Seed FX rates (0 ms) | {"base":"SAR","usd":3.75,"yer":0.015}
- ✅ ITEM00 — Created item + UOM units (0 ms) | {"item_id":"SMOKE-ITEM-6f5ee24d90c047ef82fd16dcb1ae93be","pack":"90430ca0-7e15-46f1-afd6-f3f90f602d99","carton":"7f914baa-3389-4547-8e83-df0118d8a2a4"}
- ✅ SHIP00 — Created shipment + expenses (0 ms) | {"shipment_id":"a2e9e943-9962-4f94-b0df-eebea37a3d2e"}
- ✅ PO00 — PO+Receive Base (carton) (0 ms) | {"po":"7b7f3d0c-f659-486d-b39a-5fcedd56ce59","receipt":"3af4d3da-d206-42b0-b1ca-e6c369665233"}
- ✅ PO01 — PO+Receive YER (carton) (0 ms) | {"po":"aafca6bc-19c7-4cc8-80c2-cc85d0bf6998","receipt":"be3eea05-1dab-41fd-9376-ade8682d6d15","shipment":"a2e9e943-9962-4f94-b0df-eebea37a3d2e"}
- ✅ STK00 — Stock increased after receipts (0 ms) | {"available":48,"avg_cost":0.50750000000000000000}
- ✅ SHIP01 — Close shipment + landed cost (0 ms) | {"shipment_id":"a2e9e943-9962-4f94-b0df-eebea37a3d2e"}
- ✅ PAY00 — Supplier payments posted (0 ms) | {"po_base":"7b7f3d0c-f659-486d-b39a-5fcedd56ce59","po_yer":"aafca6bc-19c7-4cc8-80c2-cc85d0bf6998"}
- ✅ SALES00 — Sold item in 3 units/currencies (0 ms) | {"item":"SMOKE-ITEM-6f5ee24d90c047ef82fd16dcb1ae93be"}
- ✅ ACC00 — Posted balanced entries exist (0 ms) | {"posted_balanced":48}
- ✅ STMT00 — Supplier statement rows all (0 ms) | {"rows":6}
- ✅ STMT01 — Supplier statement rows base (0 ms) | {"rows":3}
- ✅ STMT02 — Supplier statement rows YER (0 ms) | {"rows":3}
- ✅ STMT10 — Customer statement rows all (0 ms) | {"rows":18}
- ✅ STMT11 — Customer statement rows base (0 ms) | {"rows":6}
- ✅ STMT12 — Customer statement rows USD (0 ms) | {"rows":6}
- ✅ STMT13 — Customer statement rows YER (0 ms) | {"rows":6}

## تقييم جاهزية الإنتاج

- جاهز من منظور Smoke Test: نعم
- مخاطر محاسبية مكتشفة: لا
- خروقات صلاحيات مكتشفة: لا
