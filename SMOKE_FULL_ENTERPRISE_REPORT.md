# تقرير اختبار دخان شامل (Full Enterprise Smoke)

- وقت البدء: 2026-02-07T00:06:33.011Z
- وقت النهاية: 2026-02-07T00:06:33.593Z
- الحالة: PASS
- عدد الاختبارات الناجحة: 25
- عدد الاختبارات الفاشلة: 0
- الزمن الإجمالي (تقريبي): 332 ms

## نتائج الخطوات

- ✅ INIT01 — Prerequisites and owner session (3 ms)
- ✅ INIT02 — Default warehouse available (1 ms) | {"warehouse_id":"b0293812-aa52-4d54-bdf8-0df2711bd83d"}
- ✅ GL01 — Manual balanced journal entry (11 ms) | {"entry_id":"8910e697-828d-4081-b16c-252295f4803a"}
- ✅ GL02 — Unbalanced journal entry rejected (4 ms) | {"entry_id":"b92f0e4a-898c-4497-b0e0-7d04e9af6f0e"}
- ✅ GL03 — Journal line debit+credit rejected (2 ms) | {"entry_id":"c27c5647-00b2-417f-b1fb-57bb45fa1054"}
- ✅ DOC01 — Document engine numbering/approval/immutability (4 ms) | {"document_id":"b6114cf6-2f18-4759-836e-4ee9802ed7c5","number":"JV-MAIN-2026-000020"}
- ✅ GL04 — Period closing and closed-period enforcement (7 ms) | {"period_id":"4a0f89c3-2b1b-4e0d-ba2d-0ac70cc39dcd"}
- ✅ GL05 — Reverse journal entry (8 ms) | {"entry_id":"8910e697-828d-4081-b16c-252295f4803a","reversal_id":"5d8f789f-02e7-4f3c-9b76-85d6731b5662"}
- ✅ GL06 — Immutability of posted journal entries/lines (4 ms) | {"entry_id":"5d8f789f-02e7-4f3c-9b76-85d6731b5662"}
- ✅ FX01 — Multi-currency order+payment realized FX (26 ms) | {"order_id":"02a3bb44-455a-47d4-bec3-1a8eca707fe6","payment_id":"4e3a5469-d0a9-4277-b0e3-acbe62059d89"}
- ✅ FX02 — Unrealized FX revaluation + auto-reversal (56 ms) | {"period_end":"2026-02-17","audit_rows":1}
- ✅ FX03 — High-inflation FX normalization (1 ms) | {"base":"YER","base_is_high":true}
- ✅ PO01 — Purchase order receive+partial payment (55 ms) | {"po_id":"ba680cb8-8339-482b-b8b1-2116e44ec9d7","receipt_id":"948fff74-63e2-47b8-bc80-bdac879c56c2","item_id":"SMOKE-PO-c753140d5f384ec7878699a30046f7db"}
- ✅ PO02 — Purchase return (26 ms) | {"purchase_return_id":"e1c67a39-cf6c-417e-b879-4a7d2c157f7c"}
- ✅ SALES01 — Sales delivery + partial/full payments + COGS movements (42 ms) | {"order_id":"1b54220e-31a9-43fd-9649-91086cab405b","payments":2}
- ✅ SALES02 — Sales return flow (14 ms) | {"sales_return_id":"9e898149-9108-417a-8f9a-15f4bf4f2229"}
- ✅ INV01 — Inventory posted journal immutability (1 ms) | {"entry_id":"383162f5-3e11-4b96-93a4-7ef0fad1f59d"}
- ✅ INV02 — Inventory movement append-only after posting (3 ms) | {"movement_id":"9c079bfb-6c6c-4f36-a8db-724caa686eb5"}
- ✅ EXP01 — Expense accrual + override + payment + delete guard (13 ms) | {"expense_id":"3a5214e8-541e-4a5c-9902-b69806919c6a"}
- ✅ PAY01 — Payroll run compute + accrual posting (24 ms) | {"run_id":"3ff7a27d-5501-4522-8f55-074ab3d2b00a","entry_id":"c77e07fc-00d6-4396-b3d6-3a08c9b6237e"}
- ✅ BANK01 — Bank reconciliation import/match/close (9 ms) | {"batch_id":"9f9c1c57-a157-4425-a21c-a78c16ea2aaa"}
- ✅ IMM01 — Immutability: orders.base_total and payments.base_amount (7 ms) | {"order_id":"1b54220e-31a9-43fd-9649-91086cab405b","payment_id":"fbfbb8bb-1791-4330-9253-b6f2710eaaeb"}
- ✅ IMM02 — Delete guards: orders/payments/inventory (7 ms)
- ✅ SEC01 — RLS: payments read + journal/fx write blocked for unauthorized (3 ms)
- ✅ AUD01 — Audit logs coverage for critical events (1 ms) | {"rows":71}

## تقييم جاهزية الإنتاج

- جاهز من منظور Smoke Test: نعم
- مخاطر محاسبية مكتشفة: لا
- خروقات صلاحيات مكتشفة: لا
