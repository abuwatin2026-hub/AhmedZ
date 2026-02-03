create or replace function public.uuid_from_text(p_text text)
returns uuid
language sql
immutable
as $$
  select (
    substr(md5(coalesce(p_text,'')), 1, 8) || '-' ||
    substr(md5(coalesce(p_text,'')), 9, 4) || '-' ||
    substr(md5(coalesce(p_text,'')), 13, 4) || '-' ||
    substr(md5(coalesce(p_text,'')), 17, 4) || '-' ||
    substr(md5(coalesce(p_text,'')), 21, 12)
  )::uuid;
$$;

create or replace function public.get_fx_rate(p_currency text, p_date date, p_rate_type text)
returns numeric
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_currency text;
  v_type text;
  v_date date;
  v_base text;
  v_rate numeric;
  v_base_high boolean := false;
begin
  v_currency := upper(nullif(btrim(coalesce(p_currency, '')), ''));
  v_type := lower(nullif(btrim(coalesce(p_rate_type, '')), ''));
  v_date := coalesce(p_date, current_date);
  v_base := public.get_base_currency();

  if v_type is null then
    v_type := 'operational';
  end if;
  if v_currency is null then
    v_currency := v_base;
  end if;

  if v_currency = v_base then
    if v_type = 'accounting' then
      select coalesce(c.is_high_inflation, false)
      into v_base_high
      from public.currencies c
      where upper(c.code) = upper(v_base)
      limit 1;
      if v_base_high then
        select fr.rate
        into v_rate
        from public.fx_rates fr
        where upper(fr.currency_code) = v_base
          and fr.rate_type = v_type
          and fr.rate_date <= v_date
        order by fr.rate_date desc
        limit 1;
        return v_rate;
      end if;
    end if;
    return 1;
  end if;

  select fr.rate
  into v_rate
  from public.fx_rates fr
  where upper(fr.currency_code) = v_currency
    and fr.rate_type = v_type
    and fr.rate_date <= v_date
  order by fr.rate_date desc
  limit 1;

  return v_rate;
end;
$$;

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

    insert into public.journal_entries(entry_date, memo, source_table, source_id, source_event, created_by)
    values (
      p_period_end,
      concat('FX Revaluation AR ', v_item.entity_id::text),
      'fx_revaluation',
      v_source_id::text,
      'reval',
      auth.uid()
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

    insert into public.journal_entries(entry_date, memo, source_table, source_id, source_event, created_by)
    values (
      p_period_end,
      concat('FX Revaluation AP ', v_item.entity_id::text),
      'fx_revaluation',
      v_source_id::text,
      'reval',
      auth.uid()
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
end;
$$;

revoke all on function public.run_fx_revaluation(date) from public;
grant execute on function public.run_fx_revaluation(date) to service_role, authenticated;

notify pgrst, 'reload schema';
