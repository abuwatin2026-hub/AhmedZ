# CONSOLIDATION_ENGINE_ARCHITECTURE

تاريخ آخر تحديث: 2026-02-07

## الهدف

توفير طبقة Consolidation Enterprise-Grade فوق GL الحالي بدون كسر أي مسار محاسبي، وبدون تعديل أي قيد مُرحّل (posted)، وبما يحافظ على Append‑Only وRLS وPeriod Lock.

## مبادئ تصميم إلزامية

- لا يتم إنشاء أو تعديل `journal_entries/journal_lines` لأغراض التجميع.
- كل إلغاءات Intercompany وترجمات FX وإضافات CTA/NCI تتم كـ Consolidation Adjustments محسوبة داخل طبقة التجميع أو داخل Snapshot فقط.
- جميع العمليات تقرأ من مصدر الحقيقة: `enterprise_gl_lines` (الذي يقرأ من GL + COA).

## مخطط البيانات

### 1) تعريف مجموعات التجميع

- `consolidation_groups`
  - يحدد الكيان الأب (Parent Company) وعملة العرض/التقرير (Reporting Currency).
- `consolidation_group_members`
  - يحدد أعضاء المجموعة (Companies) ونسبة الملكية (`ownership_pct`) وطريقة التجميع (`consolidation_method`).

### 2) تعريف علاقات الأطراف Intercompany

- `consolidation_intercompany_parties`
  - يربط `party_id` المستخدم في قيود شركة ما بالطرف المقابل الذي يمثل شركة أخرى ضمن نفس مجموعة التجميع.
  - هذا هو “Signal” المعتمد للتفريق بين معاملات خارجية وبين معاملات بين شركات المجموعة بدون تغيير مسارات التسجيل الحالية.

### 3) قواعد الإلغاءات

- `consolidation_elimination_accounts`
  - يحدد الحسابات التي يتم إلغاؤها عند كون الطرف Intercompany.
  - الأنواع الحالية: `ar_ap`, `revenue_expense`, `fx`.
- `consolidation_unrealized_profit_rules`
  - قاعدة واحدة لكل Group (قابلة للتفعيل/التعطيل).
  - تحسب الربح غير المحقق من معاملات Intercompany وتولد Adjustments على:
    - `inventory_account_code` (تخفيض مخزون)
    - `cogs_account_code` (زيادة تكلفة)
  - `percent_remaining` يحدد نسبة المخزون غير المباع خارج المجموعة.

### 4) اللقطات (Snapshots)

- `consolidation_snapshot_headers`
- `consolidation_snapshot_lines`
  - يتم تخزين نتائج `consolidated_trial_balance` لكل (Group, As‑Of, Rollup, CurrencyView) لتسريع التقارير التاريخية وتقليل تكلفة إعادة الحساب.

## وظائف ومحركات الحساب

### 1) مصدر البيانات: enterprise_gl_lines

طبقة القراءة الأساسية للتقارير، وتحتوي:
- `company_id/branch_id`
- `account_code/account_type/ifrs_statement/ifrs_category/ifrs_line`
- `signed_base_amount` (عملة النظام الأساسية)
- `currency_code/foreign_amount/signed_foreign_amount` (لقطة FX على السطر)
- `party_id` لاكتشاف Intercompany

### 2) تحويل العملات (FX)

- `get_fx_rate(currency, date, rate_type)`
  - اتجاه السعر: Base per 1 Foreign.
- `fx_convert(amount, from, to, date, rate_type)`
  - تحويل عبر عملة النظام الأساسية كمحور Pivot.
- `get_fx_rate_avg(currency, start, end, rate_type)`
  - متوسط بسيط من جدول `fx_rates` مع fallback على آخر سعر متاح.

### 3) consolidated_trial_balance

الدالة: `consolidated_trial_balance(group_id, as_of, rollup, currency_view)`

تعيد:
- `balance_base`: الرصيد بالعملة الأساسية للنظام.
- `revalued_balance_base`: حسب `currency_view`:
  - `base`: يساوي `balance_base`.
  - `revalued`: إعادة تقييم الأرصدة النقدية/العملات حسب `currency_code` و`foreign_amount` على مستوى GL line.
  - `reporting`/`translated`: الرصيد مترجم إلى عملة Reporting Currency (IAS 21) ويعاد في نفس الحقل `revalued_balance_base`، بينما يبقى `balance_base` موجودًا للتدقيق.

#### IAS 21 Translation

- Balance Sheet (Assets/Liabilities): سعر إقفال عند `as_of`.
- P&L (Income/Expense): متوسط YTD (من بداية السنة حتى `as_of`).
- Equity: ترجمة تاريخية على مستوى السطر (حسب `entry_date`).
- CTA: يتم توليده كـ Plug لضمان توازن الميزانية المترجمة (Assets = Liabilities + Equity) في عملة Reporting.

#### Ownership وMinority Interest

- `consolidation_method = full`
  - يتم تضمين 100% من أرصدة الشركة التابعة.
  - يتم توليد NCI في حساب 3060 = (1-ownership_pct) * Net Assets (Assets - Liabilities).
- `consolidation_method = equity`
  - يتم تضمين الأرصدة بنمط proportional (`ownership_pct`) كقيمة أولية حالياً.

#### Intercompany Eliminations

عند `party_id` ∈ `consolidation_intercompany_parties`:
- AR/AP: إلغاء أرصدة `account_code` المحددة ضمن `consolidation_elimination_accounts(elimination_type='ar_ap')`.
- Rev/Exp: إلغاء أرصدة الحسابات المحددة ضمن `elimination_type='revenue_expense'`.
- FX: إلغاء أرصدة الحسابات المحددة ضمن `elimination_type='fx'`.

#### Unrealized Profit

عند تفعيل `consolidation_unrealized_profit_rules`:
- الربح الإجمالي بين الشركات = (Intercompany Income) - (Intercompany Expenses)
- الربح غير المحقق = الربح الإجمالي * `percent_remaining`
- القيود التجميعية المحسوبة:
  - Inventory: -unrealized
  - COGS: +unrealized

### 4) create_consolidation_snapshot

RPC: `create_consolidation_snapshot(group_id, as_of, rollup, currency_view) -> snapshot_id`

- يقوم بإعادة توليد Snapshot Header وLines بشكل Idempotent.
- لا يغيّر أي شيء في GL.

## الأمن والحوكمة

- جميع الجداول الجديدة مفعّل عليها RLS.
- القراءة: `accounting.view`
- الكتابة: `accounting.manage`
- `consolidated_trial_balance` يتطلب `can_view_enterprise_financial_reports()`.

## Smoke Coverage

- ملف: [smoke_consolidation_full.sql](file:///D:/AhmedZ/supabase/smoke/smoke_consolidation_full.sql)
  - يغطي Multi-company consolidation + intercompany eliminations + IAS21 translation + ownership/NCI + snapshots.

