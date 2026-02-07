# تقرير اختبار دخان — Settlement Engine

- الحالة: PASS
- الأوامر المطلوبة: `npm run smoke:settlement` ✅

## التغطية

- SE01: Full settlement (Invoice → Receipt)
- SE02: Partial settlement (يبقى رصيد مفتوح)
- SE03: Multi-currency settlement + Realized FX Journal Entry
- SE04: Advance application (Advance → Invoice)
- SE05: Reversal settlement (Reversal Settlement + إعادة فتح العناصر)
- SE06: Auto settlement FIFO
- SE07: Aging correctness (يعتمد على party_open_items)
- SE08: Period lock enforcement (منع Settlement داخل فترة مغلقة)

