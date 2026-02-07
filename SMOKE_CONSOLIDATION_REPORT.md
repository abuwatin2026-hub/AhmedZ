# تقرير اختبار دخان شامل (Full Enterprise Smoke)

- وقت البدء: 2026-02-07T02:02:02.893Z
- وقت النهاية: 2026-02-07T02:02:03.183Z
- الحالة: FAIL
- عدد الاختبارات الناجحة: 1
- عدد الاختبارات الفاشلة: 1
- الزمن الإجمالي (تقريبي): 1 ms
- آخر خطوة مكتملة: CON00 — Consolidation engine core exists

## نتائج الخطوات

- ✅ CON00 — Consolidation engine core exists (1 ms)

## سجل الخطأ

```
SET
SET
SET
DO
DO

NOTICE:  SMOKE_PASS|CON00|Consolidation engine core exists|1|{}
ERROR:  column "l.ifrs_line" must appear in the GROUP BY clause or be used in an aggregate function
LINE 29: ...oalesce(p_rollup,'')) = 'ifrs_line' then coalesce(l.ifrs_lin...
                                                              ^
QUERY:  with members as (
    select m.company_id, m.ownership_pct
    from public.consolidation_group_members m
    where m.group_id = p_group_id
  ),
  excluded as (
    select r.account_code
    from public.intercompany_elimination_rules r
    where r.group_id = p_group_id
      and r.rule_type = 'exclude'
  ),
  lines as (
    select
      l.*,
      m.ownership_pct
    from public.enterprise_gl_lines l
    join members m on m.company_id = l.company_id
    where l.entry_date <= p_as_of
      and not exists (select 1 from excluded e where e.account_code = l.account_code)
  ),
  grouped as (
    select
      case
        when lower(coalesce(p_rollup,'')) = 'ifrs_line' then coalesce(l.ifrs_line, l.account_name, l.account_code)
        when lower(coalesce(p_rollup,'')) = 'ifrs_category' then coalesce(l.ifrs_category, l.account_type, l.account_code)
        else l.account_code
      end as group_key,
      case
        when lower(coalesce(p_rollup,'')) = 'ifrs_line' then coalesce(l.ifrs_line, l.account_name, l.account_code)
        when lower(coalesce(p_rollup,'')) = 'ifrs_category' then coalesce(l.ifrs_category, l.account_type, l.account_code)
        else max(l.account_name)
      end as group_name,
      max(l.account_type) as account_type,
      max(l.ifrs_statement) as ifrs_statement,
      max(l.ifrs_category) as ifrs_category,
      upper(case when lower(coalesce(p_currency_view,'')) = 'revalued' then coalesce(nullif(l.currency_code,''), v_base) else v_base end) as currency_code,
      sum(l.signed_base_amount * l.ownership_pct) as balance_base,
      sum(l.signed_foreign_amount * l.ownership_pct) as balance_foreign
    from lines l
    group by 1
  )
  select
    g.group_key,
    g.group_name,
    g.account_type,
    g.ifrs_statement,
    g.ifrs_category,
    g.currency_code,
    coalesce(g.balance_base,0) as balance_base,
    case
      when lower(coalesce(p_currency_view,'')) <> 'revalued' then coalesce(g.balance_base,0)
      when upper(g.currency_code) = upper(v_base) or g.balance_foreign is null then coalesce(g.balance_base,0)
      else coalesce(g.balance_foreign,0) * public.get_fx_rate(g.currency_code, p_as_of, 'accounting')
    end as revalued_balance_base
  from grouped g
  order by g.group_key
CONTEXT:  PL/pgSQL function consolidated_trial_balance(uuid,date,text,text) line 15 at RETURN QUERY
SQL statement "select count(*)                     from public.consolidated_trial_balance(v_group, current_date, 'account', 'base')
  where group_key = '1010'"
PL/pgSQL function inline_code_block line 42 at SQL statement
```

## تقييم جاهزية الإنتاج

- جاهز من منظور Smoke Test: لا
- مخاطر محاسبية/تشغيلية محتملة: مرتفعة حتى معالجة سبب الفشل
- التوصية: إصلاح السبب ثم إعادة تشغيل smoke:full حتى PASS
