-- ════════════════════════════════════════════════════════════════════
-- Fix trial balance imbalance (4,571.07 SAR)
-- Root cause: journal_lines with foreign currency but missing
-- foreign_amount / fx_rate, causing trial_balance() to use raw
-- debit/credit instead of recalculating via fx.
-- ════════════════════════════════════════════════════════════════════

set app.allow_ledger_ddl = '1';

-- Temporarily disable user triggers on journal_lines
alter table public.journal_lines disable trigger user;

do $$
declare
  v_base text;
  v_fixed int := 0;
  v_rec record;
begin
  perform set_config('app.allow_ledger_ddl', '1', true);
  v_base := upper(coalesce(public.get_base_currency(), 'SAR'));
  raise notice 'Base currency: %', v_base;

  -- ════════════════════════════════════════════════════════════════
  -- PASS 1: Order-sourced journal entries
  -- ════════════════════════════════════════════════════════════════
  raise notice 'Pass 1: Fixing order-sourced lines with missing foreign_amount...';

  for v_rec in
    select
      jl.id            as jl_id,
      jl.debit,
      jl.credit,
      jl.currency_code as jl_currency,
      jl.fx_rate       as jl_fx,
      je.source_table,
      je.source_id
    from public.journal_lines jl
    join public.journal_entries je on je.id = jl.journal_entry_id
    where je.status = 'posted'
      and je.source_table = 'orders'
      and jl.currency_code is not null
      and upper(jl.currency_code) <> upper(v_base)
      and (jl.foreign_amount is null or jl.foreign_amount = 0)
  loop
    begin
      declare
        v_order_currency text;
        v_order_fx numeric;
        v_order_data jsonb;
        v_line_base numeric;
        v_line_foreign numeric;
      begin
        select
          upper(coalesce(o.currency, o.data->>'currency', v_base)),
          coalesce(o.fx_rate, nullif((o.data->>'fxRate')::numeric, null), 1),
          coalesce(o.data, '{}'::jsonb)
        into v_order_currency, v_order_fx, v_order_data
        from public.orders o
        where o.id = (v_rec.source_id)::uuid;

        if not found then continue; end if;
        if v_order_fx is null or v_order_fx <= 0 then v_order_fx := 1; end if;
        if v_order_currency = v_base then continue; end if;

        v_line_base := greatest(coalesce(v_rec.debit, 0), coalesce(v_rec.credit, 0));
        if v_line_base <= 0 then continue; end if;

        v_line_foreign := round(v_line_base / v_order_fx, 2);

        update public.journal_lines
        set currency_code  = v_order_currency,
            fx_rate        = v_order_fx,
            foreign_amount = v_line_foreign
        where id = v_rec.jl_id;

        v_fixed := v_fixed + 1;
      end;
    exception when others then
      raise notice 'Error fixing order JL %: %', v_rec.jl_id, sqlerrm;
    end;
  end loop;

  raise notice 'Pass 1 complete: fixed % order lines', v_fixed;

  -- ════════════════════════════════════════════════════════════════
  -- PASS 2: Payment-sourced journal entries
  -- ════════════════════════════════════════════════════════════════
  declare v_fixed2 int := 0;
  begin
    raise notice 'Pass 2: Fixing payment-sourced lines...';

    for v_rec in
      select
        jl.id            as jl_id,
        jl.debit,
        jl.credit,
        je.source_id
      from public.journal_lines jl
      join public.journal_entries je on je.id = jl.journal_entry_id
      where je.status = 'posted'
        and je.source_table = 'payments'
        and jl.currency_code is not null
        and upper(jl.currency_code) <> upper(v_base)
        and (jl.foreign_amount is null or jl.foreign_amount = 0)
    loop
      begin
        declare
          v_pay_currency text;
          v_pay_fx numeric;
          v_pay_amount numeric;
        begin
          select
            upper(coalesce(p.currency, '')),
            coalesce(p.fx_rate, 1),
            abs(coalesce(p.amount, 0))
          into v_pay_currency, v_pay_fx, v_pay_amount
          from public.payments p
          where p.id = (v_rec.source_id)::uuid;

          if not found then continue; end if;
          if v_pay_currency = '' or v_pay_currency = v_base then continue; end if;
          if v_pay_amount <= 0 then continue; end if;

          update public.journal_lines
          set currency_code  = v_pay_currency,
              fx_rate        = v_pay_fx,
              foreign_amount = v_pay_amount
          where id = v_rec.jl_id;

          v_fixed2 := v_fixed2 + 1;
        end;
      exception when others then
        raise notice 'Error fixing payment JL %: %', v_rec.jl_id, sqlerrm;
      end;
    end loop;

    raise notice 'Pass 2 complete: fixed % payment lines', v_fixed2;
    v_fixed := v_fixed + v_fixed2;
  end;

  -- ════════════════════════════════════════════════════════════════
  -- PASS 3: Any remaining lines with fx_rate but no foreign_amount
  -- ════════════════════════════════════════════════════════════════
  declare v_fixed3 int := 0;
  begin
    raise notice 'Pass 3: Fixing remaining lines with fx_rate but no foreign_amount...';

    for v_rec in
      select
        jl.id as jl_id,
        jl.debit,
        jl.credit,
        jl.fx_rate as jl_fx
      from public.journal_lines jl
      join public.journal_entries je on je.id = jl.journal_entry_id
      where je.status = 'posted'
        and jl.currency_code is not null
        and upper(jl.currency_code) <> upper(v_base)
        and (jl.foreign_amount is null or jl.foreign_amount = 0)
        and jl.fx_rate is not null
        and jl.fx_rate > 0
    loop
      begin
        declare
          v_line_base numeric;
          v_line_foreign numeric;
        begin
          v_line_base := greatest(coalesce(v_rec.debit, 0), coalesce(v_rec.credit, 0));
          if v_line_base <= 0 then continue; end if;

          v_line_foreign := round(v_line_base / v_rec.jl_fx, 2);

          update public.journal_lines
          set foreign_amount = v_line_foreign
          where id = v_rec.jl_id;

          v_fixed3 := v_fixed3 + 1;
        end;
      exception when others then
        raise notice 'Error fixing remaining JL %: %', v_rec.jl_id, sqlerrm;
      end;
    end loop;

    raise notice 'Pass 3 complete: fixed % remaining lines', v_fixed3;
    v_fixed := v_fixed + v_fixed3;
  end;

  raise notice '=== TOTAL LINES FIXED: % ===', v_fixed;

  -- ════════════════════════════════════════════════════════════════
  -- Verification: check remaining lines still missing foreign_amount
  -- ════════════════════════════════════════════════════════════════
  declare v_remaining int;
  begin
    select count(*) into v_remaining
    from public.journal_lines jl
    join public.journal_entries je on je.id = jl.journal_entry_id
    where je.status = 'posted'
      and jl.currency_code is not null
      and upper(jl.currency_code) <> upper(v_base)
      and (jl.foreign_amount is null or jl.foreign_amount = 0);

    raise notice 'Remaining unfixed foreign-currency lines: %', v_remaining;
  end;
end $$;

-- Re-enable triggers
alter table public.journal_lines enable trigger user;

notify pgrst, 'reload schema';
