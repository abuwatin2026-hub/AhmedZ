do $$
declare
  t0 timestamptz;
  ms int;
  v_base text;
begin
  t0 := clock_timestamp();
  select public.get_base_currency() into v_base;
  ms := (extract(epoch from (clock_timestamp() - t0)) * 1000)::int;
  raise notice 'SMOKE_PASS|ANOM00|Base currency (get_base_currency)|%|{"base":"%"}', ms, v_base;
end $$;

do $$
declare
  t0 timestamptz;
  ms int;
  v_count bigint;
begin
  t0 := clock_timestamp();
  select count(*) into v_count
  from public.journal_lines jl
  where (jl.currency_code is null or upper(jl.currency_code) = upper(public.get_base_currency()))
    and (jl.foreign_amount is not null or jl.fx_rate is not null)
    and (coalesce(jl.foreign_amount, 0) <> 0 or jl.fx_rate is not null);
  ms := (extract(epoch from (clock_timestamp() - t0)) * 1000)::int;
  raise notice 'SMOKE_PASS|ANOM01|Base lines with foreign snapshot|%|{"count":%}', ms, v_count;
end $$;

do $$
declare
  t0 timestamptz;
  ms int;
  v_count bigint;
begin
  t0 := clock_timestamp();
  select count(*) into v_count
  from public.journal_lines jl
  where jl.currency_code is not null
    and upper(jl.currency_code) <> upper(public.get_base_currency())
    and (jl.fx_rate is null or jl.fx_rate <= 0 or jl.foreign_amount is null or jl.foreign_amount <= 0);
  ms := (extract(epoch from (clock_timestamp() - t0)) * 1000)::int;
  raise notice 'SMOKE_PASS|ANOM02|Non-base lines missing fx snapshot|%|{"count":%}', ms, v_count;
end $$;

do $$
declare
  t0 timestamptz;
  ms int;
  v_count bigint;
begin
  t0 := clock_timestamp();
  with fx as (
    select
      jl.id,
      jl.journal_entry_id,
      jl.debit,
      jl.credit,
      jl.foreign_amount,
      jl.fx_rate,
      case when coalesce(jl.debit,0) > 0 then coalesce(jl.debit,0) else coalesce(jl.credit,0) end as base_amt,
      (coalesce(jl.foreign_amount,0) * coalesce(jl.fx_rate,0)) as fx_amt
    from public.journal_lines jl
    where jl.currency_code is not null
      and upper(jl.currency_code) <> upper(public.get_base_currency())
      and jl.foreign_amount is not null
      and jl.fx_rate is not null
      and jl.fx_rate > 0
      and jl.foreign_amount > 0
  )
  select count(*) into v_count
  from fx
  where abs(fx.fx_amt - fx.base_amt) > 0.02;
  ms := (extract(epoch from (clock_timestamp() - t0)) * 1000)::int;
  raise notice 'SMOKE_PASS|ANOM03|FX mismatch (foreign*fx != base debit/credit)|%|{"count":%}', ms, v_count;
end $$;

do $$
declare
  t0 timestamptz;
  ms int;
  v_count bigint;
begin
  t0 := clock_timestamp();
  select count(*) into v_count
  from (
    select jl.journal_entry_id, abs(coalesce(sum(coalesce(jl.debit,0)) - sum(coalesce(jl.credit,0)),0)) as diff
    from public.journal_lines jl
    group by jl.journal_entry_id
  ) x
  where x.diff > 0.000001;
  ms := (extract(epoch from (clock_timestamp() - t0)) * 1000)::int;
  raise notice 'SMOKE_PASS|ANOM04|Unbalanced journal entries (by lines sum)|%|{"count":%}', ms, v_count;
end $$;

do $$
declare
  t0 timestamptz;
  ms int;
  v_count bigint;
begin
  t0 := clock_timestamp();
  with alloc as (
    select
      poi.id as open_item_id,
      poi.direction,
      sum(case when poi.direction = 'debit' then coalesce(sl.allocated_base_amount,0) else 0 end) as alloc_base_for_debit,
      sum(case when poi.direction = 'credit' then coalesce(sl.allocated_counter_base_amount,0) else 0 end) as alloc_base_for_credit
    from public.party_open_items poi
    left join public.settlement_lines sl
      on sl.from_open_item_id = poi.id or sl.to_open_item_id = poi.id
    group by poi.id, poi.direction
  ),
  chk as (
    select
      poi.id,
      poi.base_amount,
      poi.open_base_amount,
      poi.direction,
      case when poi.direction = 'debit'
        then greatest(coalesce(poi.base_amount,0) - coalesce(a.alloc_base_for_debit,0), 0)
        else greatest(coalesce(poi.base_amount,0) - coalesce(a.alloc_base_for_credit,0), 0)
      end as expected_open_base
    from public.party_open_items poi
    left join alloc a on a.open_item_id = poi.id
  )
  select count(*) into v_count
  from chk
  where abs(coalesce(chk.expected_open_base,0) - coalesce(chk.open_base_amount,0)) > 0.01;
  ms := (extract(epoch from (clock_timestamp() - t0)) * 1000)::int;
  raise notice 'SMOKE_PASS|ANOM05|Open items base mismatch vs settlements|%|{"count":%}', ms, v_count;
end $$;

do $$
declare
  t0 timestamptz;
  ms int;
  v_count_yer_bad bigint;
begin
  t0 := clock_timestamp();
  select count(*) into v_count_yer_bad
  from public.fx_rates fr
  join public.currencies c on upper(c.code) = upper(fr.currency_code)
  where upper(fr.currency_code) = 'YER'
    and coalesce(c.is_high_inflation,false) = true
    and coalesce(fr.rate, 0) >= 1;
  ms := (extract(epoch from (clock_timestamp() - t0)) * 1000)::int;
  raise notice 'SMOKE_PASS|ANOM06|High inflation FX rates not normalized (YER rate>=1)|%|{"count":%}', ms, v_count_yer_bad;
end $$;

do $$
declare
  t0 timestamptz;
  ms int;
  v_count bigint;
begin
  t0 := clock_timestamp();
  select count(*) into v_count
  from public.journal_lines jl
  join public.journal_entries je on je.id = jl.journal_entry_id
  where (jl.currency_code is null or upper(jl.currency_code) = upper(public.get_base_currency()))
    and greatest(coalesce(jl.debit,0), coalesce(jl.credit,0)) >= 1000000;
  ms := (extract(epoch from (clock_timestamp() - t0)) * 1000)::int;
  raise notice 'SMOKE_PASS|ANOM07|Potential YER-as-base inflation (base lines >= 1,000,000)|%|{"count":%}', ms, v_count;
end $$;

select 'HISTORICAL_SCAN_OK'::text as ok;

