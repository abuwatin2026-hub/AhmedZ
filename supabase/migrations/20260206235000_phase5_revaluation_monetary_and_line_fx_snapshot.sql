set app.allow_ledger_ddl = '1';

do $$
begin
  if to_regclass('public.journal_lines') is not null then
    begin
      alter table public.journal_lines add column currency_code text;
    exception when duplicate_column then null;
    end;
    begin
      alter table public.journal_lines add column fx_rate numeric;
    exception when duplicate_column then null;
    end;
    begin
      alter table public.journal_lines add column foreign_amount numeric;
    exception when duplicate_column then null;
    end;
  end if;
end $$;

do $$
begin
  if to_regclass('public.fx_revaluation_monetary_audit') is null then
    create table public.fx_revaluation_monetary_audit (
      id uuid primary key default gen_random_uuid(),
      period_end date not null,
      account_id uuid not null references public.chart_of_accounts(id) on delete restrict,
      currency text not null,
      original_base numeric not null,
      revalued_base numeric not null,
      diff numeric not null,
      journal_entry_id uuid not null references public.journal_entries(id) on delete restrict,
      reversal_journal_entry_id uuid references public.journal_entries(id) on delete restrict,
      created_at timestamptz not null default now(),
      unique(period_end, account_id, currency)
    );
  end if;
end $$;

create or replace function public.run_fx_revaluation(p_period_end date)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gain_unreal uuid := public.get_account_id_by_code('6250');
  v_loss_unreal uuid := public.get_account_id_by_code('6251');
  v_ar uuid := public.get_account_id_by_code('1200');
  v_ap uuid := public.get_account_id_by_code('2010');
  v_base text := public.get_base_currency();
  v_base_high boolean := false;
  v_item record;
  v_rate numeric;
  v_revalued numeric;
  v_diff numeric;
  v_reval_entry_id uuid;
  v_rev_entry_id uuid;
  v_source_id uuid;
  v_cash uuid := public.get_account_id_by_code('1010');
  v_bank uuid := public.get_account_id_by_code('1020');
begin
  if p_period_end is null then
    raise exception 'period end required';
  end if;

  select coalesce(c.is_high_inflation, false)
  into v_base_high
  from public.currencies c
  where upper(c.code) = upper(v_base)
  limit 1;

  for v_item in
    select a.id as open_item_id,
           a.invoice_id as entity_id,
           upper(coalesce(o.currency, v_base)) as currency,
           coalesce(a.open_balance, 0) as original_base,
           coalesce(o.total, 0) as invoice_total_foreign,
           coalesce(o.base_total, coalesce(o.total,0) * coalesce(o.fx_rate,1)) as invoice_total_base
    from public.ar_open_items a
    join public.orders o on o.id = a.invoice_id
    where a.status = 'open'
  loop
    if exists(
      select 1
      from public.fx_revaluation_audit x
      where x.period_end = p_period_end
        and x.entity_type = 'AR'
        and x.entity_id = v_item.entity_id
    ) then
      continue;
    end if;

    if upper(v_item.currency) = upper(v_base) then
      if not v_base_high then
        continue;
      end if;
      v_rate := public.get_fx_rate(v_base, p_period_end, 'accounting');
      if v_rate is null then
        raise exception 'accounting rate missing for base currency % at %', v_base, p_period_end;
      end if;
      v_revalued := v_item.original_base * v_rate;
    else
      v_rate := public.get_fx_rate(v_item.currency, p_period_end, 'accounting');
      if v_rate is null then
        raise exception 'accounting fx rate missing for currency % at %', v_item.currency, p_period_end;
      end if;
      if coalesce(v_item.invoice_total_base, 0) <= 0 then
        continue;
      end if;
      v_revalued := (v_item.invoice_total_foreign * (v_item.original_base / v_item.invoice_total_base)) * v_rate;
    end if;

    v_diff := v_revalued - v_item.original_base;
    if abs(v_diff) <= 0.0000001 then
      continue;
    end if;

    v_source_id := public.uuid_from_text(concat('AR:', v_item.entity_id::text, ':', p_period_end::text, ':reval'));

    insert into public.journal_entries(entry_date, memo, source_table, source_id, source_event, created_by, currency_code, fx_rate, foreign_amount)
    values (
      p_period_end,
      concat('FX Revaluation AR ', v_item.entity_id::text),
      'fx_revaluation',
      v_source_id::text,
      'reval',
      auth.uid(),
      case when upper(v_item.currency) <> upper(v_base) then v_item.currency else null end,
      case when upper(v_item.currency) <> upper(v_base) then v_rate else null end,
      case when upper(v_item.currency) <> upper(v_base) then (v_item.invoice_total_foreign * (v_item.original_base / nullif(v_item.invoice_total_base,0))) else null end
    )
    returning id into v_reval_entry_id;

    if v_diff > 0 then
      insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
      values
        (v_reval_entry_id, v_ar, v_diff, 0, 'Increase AR'),
        (v_reval_entry_id, v_gain_unreal, 0, v_diff, 'Unrealized FX Gain');
    else
      insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
      values
        (v_reval_entry_id, v_loss_unreal, abs(v_diff), 0, 'Unrealized FX Loss'),
        (v_reval_entry_id, v_ar, 0, abs(v_diff), 'Decrease AR');
    end if;

    select je.id into v_rev_entry_id
    from public.journal_entries je
    where je.source_table = 'journal_entries'
      and je.source_id = v_reval_entry_id::text
      and je.source_event = 'reversal'
    limit 1;

    if v_rev_entry_id is null then
      insert into public.journal_entries(entry_date, memo, source_table, source_id, source_event, created_by, document_id, branch_id, company_id)
      select
        (p_period_end + interval '1 day'),
        concat('Reversal FX Revaluation AR ', v_item.entity_id::text),
        'journal_entries',
        v_reval_entry_id::text,
        'reversal',
        auth.uid(),
        je.document_id,
        je.branch_id,
        je.company_id
      from public.journal_entries je
      where je.id = v_reval_entry_id
      returning id into v_rev_entry_id;

      insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
      select v_rev_entry_id, jl.account_id, jl.credit, jl.debit, 'Reversal'
      from public.journal_lines jl
      where jl.journal_entry_id = v_reval_entry_id;
    end if;

    insert into public.fx_revaluation_audit(period_end, entity_type, entity_id, currency, original_base, revalued_base, diff, journal_entry_id, reversal_journal_entry_id)
    values (p_period_end, 'AR', v_item.entity_id, v_item.currency, v_item.original_base, v_revalued, v_diff, v_reval_entry_id, v_rev_entry_id)
    on conflict (period_end, entity_type, entity_id) do nothing;
  end loop;

  for v_item in
    select po.id as entity_id,
           upper(coalesce(po.currency, v_base)) as currency,
           greatest(0, coalesce(po.base_total, 0) - coalesce((select sum(coalesce(p.base_amount, p.amount)) from public.payments p where p.reference_table='purchase_orders' and p.direction='out' and p.reference_id = po.id::text), 0)) as original_base,
           coalesce(po.total_amount, 0) - coalesce((select sum(coalesce(p.amount,0)) from public.payments p where p.reference_table='purchase_orders' and p.direction='out' and p.reference_id = po.id::text), 0) as remaining_foreign
    from public.purchase_orders po
    where coalesce(po.base_total, 0) > coalesce((select sum(coalesce(p.base_amount, p.amount)) from public.payments p where p.reference_table='purchase_orders' and p.direction='out' and p.reference_id = po.id::text), 0)
  loop
    if exists(
      select 1
      from public.fx_revaluation_audit x
      where x.period_end = p_period_end
        and x.entity_type = 'AP'
        and x.entity_id = v_item.entity_id
    ) then
      continue;
    end if;

    if upper(v_item.currency) = upper(v_base) then
      if not v_base_high then
        continue;
      end if;
      v_rate := public.get_fx_rate(v_base, p_period_end, 'accounting');
      if v_rate is null then
        raise exception 'accounting rate missing for base currency % at %', v_base, p_period_end;
      end if;
      v_revalued := v_item.original_base * v_rate;
    else
      v_rate := public.get_fx_rate(v_item.currency, p_period_end, 'accounting');
      if v_rate is null then
        raise exception 'accounting fx rate missing for currency % at %', v_item.currency, p_period_end;
      end if;
      v_revalued := greatest(0, v_item.remaining_foreign) * v_rate;
    end if;

    v_diff := v_revalued - v_item.original_base;
    if abs(v_diff) <= 0.0000001 then
      continue;
    end if;

    v_source_id := public.uuid_from_text(concat('AP:', v_item.entity_id::text, ':', p_period_end::text, ':reval'));

    insert into public.journal_entries(entry_date, memo, source_table, source_id, source_event, created_by, currency_code, fx_rate, foreign_amount)
    values (
      p_period_end,
      concat('FX Revaluation AP ', v_item.entity_id::text),
      'fx_revaluation',
      v_source_id::text,
      'reval',
      auth.uid(),
      case when upper(v_item.currency) <> upper(v_base) then v_item.currency else null end,
      case when upper(v_item.currency) <> upper(v_base) then v_rate else null end,
      case when upper(v_item.currency) <> upper(v_base) then v_item.remaining_foreign else null end
    )
    returning id into v_reval_entry_id;

    if v_diff > 0 then
      insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
      values
        (v_reval_entry_id, v_loss_unreal, v_diff, 0, 'Unrealized FX Loss'),
        (v_reval_entry_id, v_ap, 0, v_diff, 'Increase AP');
    else
      insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
      values
        (v_reval_entry_id, v_ap, abs(v_diff), 0, 'Decrease AP'),
        (v_reval_entry_id, v_gain_unreal, 0, abs(v_diff), 'Unrealized FX Gain');
    end if;

    select je.id into v_rev_entry_id
    from public.journal_entries je
    where je.source_table = 'journal_entries'
      and je.source_id = v_reval_entry_id::text
      and je.source_event = 'reversal'
    limit 1;

    if v_rev_entry_id is null then
      insert into public.journal_entries(entry_date, memo, source_table, source_id, source_event, created_by, document_id, branch_id, company_id)
      select
        (p_period_end + interval '1 day'),
        concat('Reversal FX Revaluation AP ', v_item.entity_id::text),
        'journal_entries',
        v_reval_entry_id::text,
        'reversal',
        auth.uid(),
        je.document_id,
        je.branch_id,
        je.company_id
      from public.journal_entries je
      where je.id = v_reval_entry_id
      returning id into v_rev_entry_id;

      insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
      select v_rev_entry_id, jl.account_id, jl.credit, jl.debit, 'Reversal'
      from public.journal_lines jl
      where jl.journal_entry_id = v_reval_entry_id;
    end if;

    insert into public.fx_revaluation_audit(period_end, entity_type, entity_id, currency, original_base, revalued_base, diff, journal_entry_id, reversal_journal_entry_id)
    values (p_period_end, 'AP', v_item.entity_id, v_item.currency, v_item.original_base, v_revalued, v_diff, v_reval_entry_id, v_rev_entry_id)
    on conflict (period_end, entity_type, entity_id) do nothing;
  end loop;

  for v_item in
    select
      jl.account_id,
      upper(jl.currency_code) as currency,
      sum(case when jl.debit > 0 then coalesce(jl.foreign_amount, 0) else -coalesce(jl.foreign_amount, 0) end) as net_foreign,
      sum(jl.debit - jl.credit) as original_base
    from public.journal_lines jl
    join public.journal_entries je on je.id = jl.journal_entry_id
    where je.entry_date::date <= p_period_end
      and jl.account_id in (v_cash, v_bank)
      and jl.currency_code is not null
      and upper(jl.currency_code) <> upper(v_base)
      and jl.foreign_amount is not null
      and abs(jl.foreign_amount) > 0.0000001
    group by jl.account_id, upper(jl.currency_code)
  loop
    if exists (
      select 1
      from public.fx_revaluation_monetary_audit a
      where a.period_end = p_period_end
        and a.account_id = v_item.account_id
        and upper(a.currency) = upper(v_item.currency)
    ) then
      continue;
    end if;

    v_rate := public.get_fx_rate(v_item.currency, p_period_end, 'accounting');
    if v_rate is null then
      raise exception 'accounting fx rate missing for currency % at %', v_item.currency, p_period_end;
    end if;

    v_revalued := coalesce(v_item.net_foreign, 0) * v_rate;
    v_diff := v_revalued - coalesce(v_item.original_base, 0);
    if abs(v_diff) <= 0.0000001 then
      continue;
    end if;

    v_source_id := public.uuid_from_text(concat('MON:', v_item.account_id::text, ':', v_item.currency, ':', p_period_end::text, ':reval'));

    insert into public.journal_entries(entry_date, memo, source_table, source_id, source_event, created_by, currency_code, fx_rate, foreign_amount)
    values (
      p_period_end,
      concat('FX Revaluation Monetary ', v_item.account_id::text, ' ', v_item.currency),
      'fx_revaluation',
      v_source_id::text,
      'reval',
      auth.uid(),
      v_item.currency,
      v_rate,
      v_item.net_foreign
    )
    returning id into v_reval_entry_id;

    if v_diff > 0 then
      insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
      values
        (v_reval_entry_id, v_item.account_id, v_diff, 0, 'Revalue monetary account'),
        (v_reval_entry_id, v_gain_unreal, 0, v_diff, 'Unrealized FX Gain');
    else
      insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
      values
        (v_reval_entry_id, v_loss_unreal, abs(v_diff), 0, 'Unrealized FX Loss'),
        (v_reval_entry_id, v_item.account_id, 0, abs(v_diff), 'Revalue monetary account');
    end if;

    insert into public.journal_entries(entry_date, memo, source_table, source_id, source_event, created_by)
    values (
      (p_period_end + interval '1 day'),
      concat('Reversal FX Revaluation Monetary ', v_item.account_id::text, ' ', v_item.currency),
      'journal_entries',
      v_reval_entry_id::text,
      'reversal',
      auth.uid()
    )
    returning id into v_rev_entry_id;

    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
    select v_rev_entry_id, jl.account_id, jl.credit, jl.debit, 'Reversal'
    from public.journal_lines jl
    where jl.journal_entry_id = v_reval_entry_id;

    insert into public.fx_revaluation_monetary_audit(period_end, account_id, currency, original_base, revalued_base, diff, journal_entry_id, reversal_journal_entry_id)
    values (p_period_end, v_item.account_id, v_item.currency, v_item.original_base, v_revalued, v_diff, v_reval_entry_id, v_rev_entry_id)
    on conflict (period_end, account_id, currency) do nothing;
  end loop;
end;
$$;

notify pgrst, 'reload schema';
