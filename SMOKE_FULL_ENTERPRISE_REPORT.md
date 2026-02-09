# تقرير اختبار دخان شامل (Full Enterprise Smoke)

- وقت البدء: 2026-02-09T17:55:34.736Z
- وقت النهاية: 2026-02-09T17:55:35.655Z
- الحالة: PASS
- عدد الاختبارات الناجحة: 25
- عدد الاختبارات الفاشلة: 0
- الزمن الإجمالي (تقريبي): 423 ms

## نتائج الخطوات

- ✅ INIT01 — Prerequisites and owner session (5 ms)
- ✅ INIT02 — Default warehouse available (3 ms) | {"warehouse_id":"182ee297-2a98-4250-85c7-beb5f60598bf"}
- ✅ GL01 — Manual balanced journal entry (24 ms) | {"entry_id":"6cadb7de-4fbb-4c36-b2f7-68bd36b75989"}
- ✅ GL02 — Unbalanced journal entry rejected (7 ms) | {"entry_id":"ea5d1ae5-ec1a-422a-89db-1e6764e87c3e"}
- ✅ GL03 — Journal line debit+credit rejected (4 ms) | {"entry_id":"6ca46c13-2527-4162-aca5-622940db81bb"}
- ✅ DOC01 — Document engine numbering/approval/immutability (8 ms) | {"document_id":"cc117431-fc5e-4a08-8303-88ec01c13f67","number":"JV-MAIN-2026-000001"}
- ✅ GL04 — Period closing and closed-period enforcement (12 ms) | {"period_id":"34c7a611-78e4-47be-b9f0-215177525791"}
- ✅ GL05 — Reverse journal entry (10 ms) | {"entry_id":"6cadb7de-4fbb-4c36-b2f7-68bd36b75989","reversal_id":"f66447bf-8892-44c0-a6c2-450d70c65f14"}
- ✅ GL06 — Immutability of posted journal entries/lines (2 ms) | {"entry_id":"f66447bf-8892-44c0-a6c2-450d70c65f14"}
- ✅ FX01 — Multi-currency order+payment realized FX (44 ms) | {"order_id":"ae29efdb-2cf5-491f-a4e1-92035035ab26","payment_id":"d8c8b560-1f2f-4ba6-a94a-6ba3724890b4"}
- ✅ FX02 — Unrealized FX revaluation + auto-reversal (22 ms) | {"period_end":"2026-02-19","audit_rows":1}
- ✅ FX03 — High-inflation FX normalization (5 ms) | {"base":"SAR","base_is_high":false}
- ✅ PO01 — Purchase order receive+partial payment (80 ms) | {"po_id":"7b1f51d6-e53a-4219-9e27-5bb6598fd6d2","receipt_id":"f393e24f-b9f4-410d-93b9-14a65cf059d6","item_id":"SMOKE-PO-fb31d7b7111949dca6ecf9290439bc24"}
- ✅ PO02 — Purchase return (28 ms) | {"purchase_return_id":"733c9252-4b57-4331-b397-65f718406fb6"}
- ✅ SALES01 — Sales delivery + partial/full payments + COGS movements (49 ms) | {"order_id":"79d37257-c811-4817-bb13-e3540d2babb4","payments":2}
- ✅ SALES02 — Sales return flow (22 ms) | {"sales_return_id":"ed2a70d7-cf01-42e3-ab35-a21a4757eeae"}
- ✅ INV01 — Inventory posted journal immutability (2 ms) | {"entry_id":"ea85fa57-50f8-4d21-96b7-1e326ce590bf"}
- ✅ INV02 — Inventory movement append-only after posting (3 ms) | {"movement_id":"ab6b35e2-d393-4c71-a616-127a11afc09c"}
- ✅ EXP01 — Expense accrual + override + payment + delete guard (27 ms) | {"expense_id":"02cfda21-c1b5-406d-8600-2f519fbc834d"}
- ✅ PAY01 — Payroll run compute + accrual posting (21 ms) | {"run_id":"6f156a8f-b420-493a-b85f-4bc943bb2fef","entry_id":"74bd702a-e5b0-4f2f-872d-b415d04df7a8"}
- ✅ BANK01 — Bank reconciliation import/match/close (19 ms) | {"batch_id":"870135b9-4f4b-4cc1-96f0-e876c3b66c7d"}
- ✅ IMM01 — Immutability: orders.base_total and payments.base_amount (10 ms) | {"order_id":"79d37257-c811-4817-bb13-e3540d2babb4","payment_id":"174f1e07-5213-4995-a223-cd92a7b3adad"}
- ✅ IMM02 — Delete guards: orders/payments/inventory (9 ms)
- ✅ SEC01 — RLS: payments read + journal/fx write blocked for unauthorized (6 ms)
- ✅ AUD01 — Audit logs coverage for critical events (1 ms) | {"rows":5}

## تقييم جاهزية الإنتاج

- جاهز من منظور Smoke Test: نعم
- مخاطر محاسبية مكتشفة: لا
- خروقات صلاحيات مكتشفة: لا
