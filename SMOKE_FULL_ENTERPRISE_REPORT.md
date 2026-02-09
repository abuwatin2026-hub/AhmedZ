# تقرير اختبار دخان شامل (Full Enterprise Smoke)

- وقت البدء: 2026-02-09T04:57:57.510Z
- وقت النهاية: 2026-02-09T04:57:58.142Z
- الحالة: PASS
- عدد الاختبارات الناجحة: 25
- عدد الاختبارات الفاشلة: 0
- الزمن الإجمالي (تقريبي): 308 ms

## نتائج الخطوات

- ✅ INIT01 — Prerequisites and owner session (3 ms)
- ✅ INIT02 — Default warehouse available (2 ms) | {"warehouse_id":"501dc417-95b0-4bd0-8813-558e9d7e350d"}
- ✅ GL01 — Manual balanced journal entry (15 ms) | {"entry_id":"27789f82-497d-4362-b95e-6744bd91ec9f"}
- ✅ GL02 — Unbalanced journal entry rejected (4 ms) | {"entry_id":"679f3766-7bd2-4d5e-8b1a-f75aefe3e23d"}
- ✅ GL03 — Journal line debit+credit rejected (2 ms) | {"entry_id":"3896e174-0169-409c-8c9c-ff7a1d7d8553"}
- ✅ DOC01 — Document engine numbering/approval/immutability (4 ms) | {"document_id":"9c015d74-b141-4cb3-836c-5252778be984","number":"JV-MAIN-2026-000001"}
- ✅ GL04 — Period closing and closed-period enforcement (8 ms) | {"period_id":"582fd950-11ff-41a8-a4c9-c32251001b70"}
- ✅ GL05 — Reverse journal entry (5 ms) | {"entry_id":"27789f82-497d-4362-b95e-6744bd91ec9f","reversal_id":"3d715685-e3f5-4588-9869-907af0faf4fc"}
- ✅ GL06 — Immutability of posted journal entries/lines (1 ms) | {"entry_id":"3d715685-e3f5-4588-9869-907af0faf4fc"}
- ✅ FX01 — Multi-currency order+payment realized FX (29 ms) | {"order_id":"29e80b08-0e88-43a3-a080-ad5cd8eaffad","payment_id":"f9c80160-8cf7-40cb-88ff-8f43cc27ed4c"}
- ✅ FX02 — Unrealized FX revaluation + auto-reversal (14 ms) | {"period_end":"2026-02-19","audit_rows":1}
- ✅ FX03 — High-inflation FX normalization (4 ms) | {"base":"SAR","base_is_high":false}
- ✅ PO01 — Purchase order receive+partial payment (69 ms) | {"po_id":"0ff4c792-aaf0-41ab-bfef-aabcb43c7b04","receipt_id":"7dc04820-a456-433d-bf1b-8d21bbc8b56f","item_id":"SMOKE-PO-bda0fa7941d54c2fa6aade79ae3455ee"}
- ✅ PO02 — Purchase return (27 ms) | {"purchase_return_id":"5b31bfbf-fa6f-40e2-9071-070e998c1adc"}
- ✅ SALES01 — Sales delivery + partial/full payments + COGS movements (38 ms) | {"order_id":"2636bd9d-22f5-4422-8e55-435ed34532f8","payments":2}
- ✅ SALES02 — Sales return flow (16 ms) | {"sales_return_id":"57d9a5f3-4ca2-43ba-aa07-292c7bea78f2"}
- ✅ INV01 — Inventory posted journal immutability (1 ms) | {"entry_id":"c0e6a2a8-b99b-45d1-887e-7d14fa673209"}
- ✅ INV02 — Inventory movement append-only after posting (2 ms) | {"movement_id":"158f70cd-c7d4-4a53-aa53-fdeec9991eaa"}
- ✅ EXP01 — Expense accrual + override + payment + delete guard (14 ms) | {"expense_id":"1b41f215-faa9-4324-82dd-744d6324a541"}
- ✅ PAY01 — Payroll run compute + accrual posting (18 ms) | {"run_id":"9dcc1445-cdf1-4bda-a782-c9058bd95bf4","entry_id":"035e4fd1-9c10-49af-b5d9-085520d5cb2b"}
- ✅ BANK01 — Bank reconciliation import/match/close (14 ms) | {"batch_id":"9ad7cbd7-9b7b-472a-a888-cf983378ab85"}
- ✅ IMM01 — Immutability: orders.base_total and payments.base_amount (6 ms) | {"order_id":"2636bd9d-22f5-4422-8e55-435ed34532f8","payment_id":"b9f08625-01cd-45ff-a26b-d50d926834cb"}
- ✅ IMM02 — Delete guards: orders/payments/inventory (6 ms)
- ✅ SEC01 — RLS: payments read + journal/fx write blocked for unauthorized (5 ms)
- ✅ AUD01 — Audit logs coverage for critical events (1 ms) | {"rows":5}

## تقييم جاهزية الإنتاج

- جاهز من منظور Smoke Test: نعم
- مخاطر محاسبية مكتشفة: لا
- خروقات صلاحيات مكتشفة: لا
