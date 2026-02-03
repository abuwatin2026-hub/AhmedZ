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
  v_entry_id uuid;
  v_rev_entry_id uuid;
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
    select a.id,
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

    insert into public.journal_entries(entry_date, memo, source_table, source_id, source_event, created_by)
    values (
      p_period_end,
      concat('FX Revaluation AR ', v_item.entity_id::text),
      'ar_open_items',
      v_item.id::text,
      concat('fx_reval:', p_period_end::text),
      auth.uid()
    )
    on conflict (source_table, source_id, source_event)
    do update set entry_date = excluded.entry_date, memo = excluded.memo
    returning id into v_entry_id;

    delete from public.journal_lines jl where jl.journal_entry_id = v_entry_id;

    if v_diff > 0 then
      insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
      values
        (v_entry_id, v_ar, v_diff, 0, 'Increase AR'),
        (v_entry_id, v_gain_unreal, 0, v_diff, 'Unrealized FX Gain');
    else
      insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
      values
        (v_entry_id, v_loss_unreal, abs(v_diff), 0, 'Unrealized FX Loss'),
        (v_entry_id, v_ar, 0, abs(v_diff), 'Decrease AR');
    end if;

    insert into public.journal_entries(entry_date, memo, source_table, source_id, source_event, created_by)
    values (
      p_period_end + interval '1 day',
      concat('Reversal FX Revaluation AR ', v_item.entity_id::text),
      'ar_open_items',
      v_item.id::text,
      concat('fx_reval_rev:', p_period_end::text),
      auth.uid()
    )
    on conflict (source_table, source_id, source_event)
    do update set entry_date = excluded.entry_date, memo = excluded.memo
    returning id into v_rev_entry_id;

    delete from public.journal_lines jl where jl.journal_entry_id = v_rev_entry_id;

    if v_diff > 0 then
      insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
      values
        (v_rev_entry_id, v_gain_unreal, v_diff, 0, 'Reverse Unrealized FX Gain'),
        (v_rev_entry_id, v_ar, 0, v_diff, 'Reverse Increase AR');
    else
      insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
      values
        (v_rev_entry_id, v_ar, abs(v_diff), 0, 'Reverse Decrease AR'),
        (v_rev_entry_id, v_loss_unreal, 0, abs(v_diff), 'Reverse Unrealized FX Loss');
    end if;

    insert into public.fx_revaluation_audit(period_end, entity_type, entity_id, currency, original_base, revalued_base, diff, journal_entry_id, reversal_journal_entry_id)
    values (p_period_end, 'AR', v_item.entity_id, v_item.currency, v_item.original_base, v_revalued, v_diff, v_entry_id, v_rev_entry_id)
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

    insert into public.journal_entries(entry_date, memo, source_table, source_id, source_event, created_by)
    values (
      p_period_end,
      concat('FX Revaluation AP ', v_item.entity_id::text),
      'purchase_orders',
      v_item.entity_id::text,
      concat('fx_reval:', p_period_end::text),
      auth.uid()
    )
    on conflict (source_table, source_id, source_event)
    do update set entry_date = excluded.entry_date, memo = excluded.memo
    returning id into v_entry_id;

    delete from public.journal_lines jl where jl.journal_entry_id = v_entry_id;

    if v_diff > 0 then
      insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
      values
        (v_entry_id, v_loss_unreal, v_diff, 0, 'Unrealized FX Loss'),
        (v_entry_id, v_ap, 0, v_diff, 'Increase AP');
    else
      insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
      values
        (v_entry_id, v_ap, abs(v_diff), 0, 'Decrease AP'),
        (v_entry_id, v_gain_unreal, 0, abs(v_diff), 'Unrealized FX Gain');
    end if;

    insert into public.journal_entries(entry_date, memo, source_table, source_id, source_event, created_by)
    values (
      p_period_end + interval '1 day',
      concat('Reversal FX Revaluation AP ', v_item.entity_id::text),
      'purchase_orders',
      v_item.entity_id::text,
      concat('fx_reval_rev:', p_period_end::text),
      auth.uid()
    )
    on conflict (source_table, source_id, source_event)
    do update set entry_date = excluded.entry_date, memo = excluded.memo
    returning id into v_rev_entry_id;

    delete from public.journal_lines jl where jl.journal_entry_id = v_rev_entry_id;

    if v_diff > 0 then
      insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
      values
        (v_rev_entry_id, v_ap, v_diff, 0, 'Reverse Increase AP'),
        (v_rev_entry_id, v_loss_unreal, 0, v_diff, 'Reverse Unrealized FX Loss');
    else
      insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
      values
        (v_rev_entry_id, v_gain_unreal, abs(v_diff), 0, 'Reverse Unrealized FX Gain'),
        (v_rev_entry_id, v_ap, 0, abs(v_diff), 'Reverse Decrease AP');
    end if;

    insert into public.fx_revaluation_audit(period_end, entity_type, entity_id, currency, original_base, revalued_base, diff, journal_entry_id, reversal_journal_entry_id)
    values (p_period_end, 'AP', v_item.entity_id, v_item.currency, v_item.original_base, v_revalued, v_diff, v_entry_id, v_rev_entry_id)
    on conflict (period_end, entity_type, entity_id) do nothing;
  end loop;
end;
$$;

revoke all on function public.run_fx_revaluation(date) from public;
grant execute on function public.run_fx_revaluation(date) to service_role, authenticated;

create or replace function public.allocate_landed_cost_to_inventory(p_shipment_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entry_id uuid;
  v_total_expenses_base numeric;
  v_inventory uuid := public.get_account_id_by_code('1400');
  v_clearing uuid := public.get_account_id_by_code('2060');
begin
  if p_shipment_id is null then
    raise exception 'p_shipment_id required';
  end if;

  if exists(select 1 from public.landed_cost_audit a where a.shipment_id = p_shipment_id) then
    return;
  end if;

  select coalesce(sum(coalesce(ie.amount,0) * coalesce(ie.exchange_rate,1)), 0)
  into v_total_expenses_base
  from public.import_expenses ie
  where ie.shipment_id = p_shipment_id;

  if v_total_expenses_base <= 0 then
    return;
  end if;

  insert into public.journal_entries(entry_date, memo, source_table, source_id, source_event, created_by)
  values (
    current_date,
    concat('Landed cost allocation shipment ', p_shipment_id::text),
    'import_shipments',
    p_shipment_id::text,
    'landed_cost_allocation',
    auth.uid()
  )
  on conflict (source_table, source_id, source_event)
  do update set entry_date = excluded.entry_date, memo = excluded.memo
  returning id into v_entry_id;

  delete from public.journal_lines jl where jl.journal_entry_id = v_entry_id;

  insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
  values
    (v_entry_id, v_inventory, v_total_expenses_base, 0, 'Capitalize landed cost'),
    (v_entry_id, v_clearing, 0, v_total_expenses_base, 'Clear landed cost');

  insert into public.landed_cost_audit(shipment_id, total_expenses_base, journal_entry_id)
  values (p_shipment_id, v_total_expenses_base, v_entry_id)
  on conflict (shipment_id) do nothing;
end;
$$;

revoke all on function public.allocate_landed_cost_to_inventory(uuid) from public;
grant execute on function public.allocate_landed_cost_to_inventory(uuid) to service_role, authenticated;

notify pgrst, 'reload schema';
