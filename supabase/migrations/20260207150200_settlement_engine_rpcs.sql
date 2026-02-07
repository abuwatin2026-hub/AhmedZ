set app.allow_ledger_ddl = '1';

create or replace function public._open_item_effective_fx_rate(p_foreign numeric, p_base numeric)
returns numeric
language sql
immutable
as $$
  select
    case
      when p_foreign is null then null
      when abs(coalesce(p_foreign,0)) <= 1e-12 then null
      else (p_base / p_foreign)
    end
$$;

create or replace function public._party_open_item_apply_delta(
  p_open_item_id uuid,
  p_delta_base numeric,
  p_delta_foreign numeric
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item public.party_open_items%rowtype;
  v_new_base numeric;
  v_new_foreign numeric;
begin
  select * into v_item
  from public.party_open_items poi
  where poi.id = p_open_item_id
  for update;

  if not found then
    raise exception 'open item not found';
  end if;

  v_new_base := coalesce(v_item.open_base_amount, 0) + coalesce(p_delta_base, 0);

  if v_item.open_foreign_amount is null then
    v_new_foreign := null;
  else
    v_new_foreign := coalesce(v_item.open_foreign_amount, 0) + coalesce(p_delta_foreign, 0);
  end if;

  if v_new_base < -1e-6 then
    raise exception 'open_base_amount would become negative';
  end if;

  if v_new_foreign is not null and v_new_foreign < -1e-6 then
    raise exception 'open_foreign_amount would become negative';
  end if;

  update public.party_open_items
  set open_base_amount = greatest(v_new_base, 0),
      open_foreign_amount = case when v_new_foreign is null then null else greatest(v_new_foreign, 0) end,
      status = case
        when greatest(v_new_base, 0) <= 1e-6 and (v_new_foreign is null or greatest(v_new_foreign, 0) <= 1e-6) then 'settled'
        when greatest(v_new_base, 0) <= 1e-6 and v_new_foreign is not null and greatest(v_new_foreign, 0) > 1e-6 then 'partially_settled'
        when greatest(v_new_base, 0) > 1e-6 then 'partially_settled'
        else 'open'
      end
  where id = p_open_item_id;
end;
$$;

create or replace function public._create_settlement_fx_journal_entry(
  p_party_id uuid,
  p_settlement_id uuid,
  p_settlement_date timestamptz,
  p_account_id uuid,
  p_diff_base numeric
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entry_id uuid;
  v_gain uuid := public.get_account_id_by_code('6200');
  v_loss uuid := public.get_account_id_by_code('6201');
  v_base text := public.get_base_currency();
begin
  if p_settlement_id is null or p_party_id is null then
    return null;
  end if;

  if abs(coalesce(p_diff_base, 0)) <= 1e-9 then
    return null;
  end if;

  if p_account_id is null then
    raise exception 'missing settlement account';
  end if;

  if v_gain is null or v_loss is null then
    raise exception 'missing fx gain/loss accounts';
  end if;

  insert into public.journal_entries(entry_date, memo, source_table, source_id, source_event, created_by, currency_code, fx_rate, foreign_amount)
  values (
    p_settlement_date,
    concat('Settlement Realized FX ', p_settlement_id::text),
    'settlements',
    p_settlement_id::text,
    'realized_fx',
    auth.uid(),
    v_base,
    1,
    null
  )
  returning id into v_entry_id;

  if p_diff_base > 0 then
    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo, party_id, currency_code, fx_rate, foreign_amount)
    values
      (v_entry_id, p_account_id, p_diff_base, 0, 'Clear FX diff on party account', p_party_id, v_base, 1, null),
      (v_entry_id, v_gain, 0, p_diff_base, 'FX Gain Realized', null, v_base, 1, null);
  else
    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo, party_id, currency_code, fx_rate, foreign_amount)
    values
      (v_entry_id, p_account_id, 0, abs(p_diff_base), 'Clear FX diff on party account', p_party_id, v_base, 1, null),
      (v_entry_id, v_loss, abs(p_diff_base), 0, 'FX Loss Realized', null, v_base, 1, null);
  end if;

  perform public.check_journal_entry_balance(v_entry_id);
  return v_entry_id;
end;
$$;

create or replace function public.create_settlement(
  p_party_id uuid,
  p_settlement_date timestamptz,
  p_allocations jsonb,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_settlement_id uuid;
  v_currency text;
  v_alloc jsonb;
  v_first jsonb;
  v_from public.party_open_items%rowtype;
  v_to public.party_open_items%rowtype;
  v_alloc_foreign numeric;
  v_base_from numeric;
  v_base_to numeric;
  v_rate_from numeric;
  v_rate_to numeric;
  v_realized_fx numeric;
  v_role text;
  v_fx_total numeric := 0;
  v_fx_account uuid := null;
  v_fx_entry uuid := null;
  v_notes text;
begin
  if not public.has_admin_permission('accounting.manage') then
    raise exception 'not allowed';
  end if;

  if p_party_id is null then
    raise exception 'party_id required';
  end if;

  if p_allocations is null or jsonb_typeof(p_allocations) <> 'array' then
    raise exception 'allocations must be json array';
  end if;

  if jsonb_array_length(p_allocations) = 0 then
    raise exception 'allocations is empty';
  end if;

  if public.is_in_closed_period(coalesce(p_settlement_date, now())) then
    raise exception 'accounting period is closed';
  end if;

  v_notes := nullif(trim(coalesce(p_notes,'')), '');

  v_first := p_allocations->0;
  select * into v_from
  from public.party_open_items poi
  where poi.id = nullif(v_first->>'fromOpenItemId','')::uuid;
  if not found then
    raise exception 'from open item not found';
  end if;
  v_currency := upper(coalesce(v_from.currency_code, public.get_base_currency()));

  insert into public.settlement_headers(party_id, settlement_date, currency_code, created_by, notes)
  values (p_party_id, coalesce(p_settlement_date, now()), v_currency, auth.uid(), v_notes)
  returning id into v_settlement_id;

  for v_alloc in select value from jsonb_array_elements(p_allocations)
  loop
    select * into v_from
    from public.party_open_items poi
    where poi.id = nullif(v_alloc->>'fromOpenItemId','')::uuid
    for update;

    if not found then
      raise exception 'from open item not found';
    end if;

    select * into v_to
    from public.party_open_items poi
    where poi.id = nullif(v_alloc->>'toOpenItemId','')::uuid
    for update;

    if not found then
      raise exception 'to open item not found';
    end if;

    if v_from.party_id <> p_party_id or v_to.party_id <> p_party_id then
      raise exception 'party mismatch';
    end if;

    if v_from.status = 'settled' or v_to.status = 'settled' then
      raise exception 'open item already settled';
    end if;

    if v_from.direction <> 'debit' or v_to.direction <> 'credit' then
      raise exception 'allocations must be debit(from) to credit(to)';
    end if;

    if upper(coalesce(v_from.currency_code,'')) <> upper(coalesce(v_to.currency_code,'')) then
      raise exception 'currency mismatch';
    end if;

    v_currency := upper(coalesce(v_from.currency_code, public.get_base_currency()));
    if upper(coalesce(v_currency,'')) <> upper(coalesce((select currency_code from public.settlement_headers where id = v_settlement_id), v_currency)) then
      raise exception 'settlement currency mismatch';
    end if;

    if v_from.open_foreign_amount is not null or v_to.open_foreign_amount is not null then
      v_alloc_foreign := nullif(trim(coalesce(v_alloc->>'allocatedForeignAmount','')), '')::numeric;
      if v_alloc_foreign is null or v_alloc_foreign <= 0 then
        raise exception 'allocatedForeignAmount required for foreign settlement';
      end if;
      if v_from.open_foreign_amount is null or v_to.open_foreign_amount is null then
        raise exception 'both items must have foreign amount';
      end if;
      if v_alloc_foreign - least(coalesce(v_from.open_foreign_amount,0), coalesce(v_to.open_foreign_amount,0)) > 1e-6 then
        raise exception 'allocated foreign exceeds open';
      end if;

      v_rate_from := coalesce(public._open_item_effective_fx_rate(v_from.foreign_amount, v_from.base_amount), 1);
      v_rate_to := coalesce(public._open_item_effective_fx_rate(v_to.foreign_amount, v_to.base_amount), 1);

      v_base_from := v_alloc_foreign * v_rate_from;
      v_base_to := v_alloc_foreign * v_rate_to;
    else
      v_alloc_foreign := null;
      v_base_from := nullif(trim(coalesce(v_alloc->>'allocatedBaseAmount','')), '')::numeric;
      if v_base_from is null or v_base_from <= 0 then
        raise exception 'allocatedBaseAmount required';
      end if;
      if v_base_from - least(coalesce(v_from.open_base_amount,0), coalesce(v_to.open_base_amount,0)) > 1e-6 then
        raise exception 'allocated base exceeds open';
      end if;
      v_base_to := v_base_from;
      v_rate_from := null;
      v_rate_to := null;
    end if;

    v_realized_fx := coalesce(v_base_to,0) - coalesce(v_base_from,0);

    insert into public.settlement_lines(
      settlement_id,
      from_open_item_id,
      to_open_item_id,
      allocated_foreign_amount,
      allocated_base_amount,
      allocated_counter_base_amount,
      fx_rate,
      counter_fx_rate,
      realized_fx_amount
    )
    values (
      v_settlement_id,
      v_from.id,
      v_to.id,
      v_alloc_foreign,
      v_base_from,
      v_base_to,
      v_rate_from,
      v_rate_to,
      v_realized_fx
    );

    perform public._party_open_item_apply_delta(v_from.id, -v_base_from, case when v_alloc_foreign is null then null else -v_alloc_foreign end);
    perform public._party_open_item_apply_delta(v_to.id, -v_base_to, case when v_alloc_foreign is null then null else -v_alloc_foreign end);

    select coalesce(v_from.item_role, v_to.item_role) into v_role;

    if v_alloc_foreign is not null
      and v_from.account_id = v_to.account_id
      and v_role in ('ar','ap')
      and upper(v_currency) <> upper(public.get_base_currency())
      and abs(coalesce(v_realized_fx,0)) > 1e-6
    then
      v_fx_total := v_fx_total + v_realized_fx;
      v_fx_account := v_from.account_id;
    end if;
  end loop;

  if abs(coalesce(v_fx_total,0)) > 1e-6 and v_fx_account is not null then
    v_fx_entry := public._create_settlement_fx_journal_entry(p_party_id, v_settlement_id, coalesce(p_settlement_date, now()), v_fx_account, v_fx_total);
  end if;

  insert into public.system_audit_logs(action, module, details, performed_by, performed_at, metadata, risk_level, reason_code)
  values (
    'settlements.create',
    'accounting',
    v_settlement_id::text,
    auth.uid(),
    now(),
    jsonb_build_object('settlementId', v_settlement_id::text, 'partyId', p_party_id::text, 'fxEntryId', coalesce(v_fx_entry, '00000000-0000-0000-0000-000000000000'::uuid)::text),
    'MEDIUM',
    'SETTLEMENT_CREATE'
  );

  return v_settlement_id;
end;
$$;

create or replace function public.void_settlement(
  p_settlement_id uuid,
  p_reason text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_set public.settlement_headers%rowtype;
  v_rev_id uuid;
  v_line record;
  v_reason text;
  v_fx record;
  v_fx_rev uuid;
begin
  if not public.has_admin_permission('accounting.manage') then
    raise exception 'not allowed';
  end if;
  if not public.has_admin_permission('accounting.void') then
    raise exception 'not allowed';
  end if;

  if p_settlement_id is null then
    raise exception 'settlement_id required';
  end if;

  v_reason := nullif(trim(coalesce(p_reason,'')),'');
  if v_reason is null then
    v_reason := 'settlement reversal';
  end if;

  if public.is_in_closed_period(now()) then
    raise exception 'accounting period is closed';
  end if;

  select * into v_set
  from public.settlement_headers sh
  where sh.id = p_settlement_id
  for update;

  if not found then
    raise exception 'settlement not found';
  end if;

  if exists (
    select 1 from public.settlement_headers x where x.reverses_settlement_id = p_settlement_id
  ) then
    raise exception 'already reversed';
  end if;

  insert into public.settlement_headers(
    party_id,
    settlement_date,
    currency_code,
    status,
    settlement_type,
    reverses_settlement_id,
    created_by,
    notes
  )
  values (
    v_set.party_id,
    now(),
    v_set.currency_code,
    'posted',
    'reversal',
    v_set.id,
    auth.uid(),
    concat('Reversal: ', v_reason)
  )
  returning id into v_rev_id;

  for v_line in
    select *
    from public.settlement_lines sl
    where sl.settlement_id = p_settlement_id
  loop
    insert into public.settlement_lines(
      settlement_id,
      from_open_item_id,
      to_open_item_id,
      allocated_foreign_amount,
      allocated_base_amount,
      allocated_counter_base_amount,
      fx_rate,
      counter_fx_rate,
      realized_fx_amount
    )
    values (
      v_rev_id,
      v_line.from_open_item_id,
      v_line.to_open_item_id,
      v_line.allocated_foreign_amount,
      v_line.allocated_base_amount,
      v_line.allocated_counter_base_amount,
      v_line.fx_rate,
      v_line.counter_fx_rate,
      -coalesce(v_line.realized_fx_amount,0)
    );

    perform public._party_open_item_apply_delta(v_line.from_open_item_id, coalesce(v_line.allocated_base_amount,0), case when v_line.allocated_foreign_amount is null then null else coalesce(v_line.allocated_foreign_amount,0) end);
    perform public._party_open_item_apply_delta(v_line.to_open_item_id, coalesce(v_line.allocated_counter_base_amount,0), case when v_line.allocated_foreign_amount is null then null else coalesce(v_line.allocated_foreign_amount,0) end);
  end loop;

  for v_fx in
    select je.id
    from public.journal_entries je
    where je.source_table = 'settlements'
      and je.source_id = p_settlement_id::text
      and je.source_event = 'realized_fx'
  loop
    v_fx_rev := public.reverse_journal_entry(v_fx.id, concat('Reversal of settlement FX: ', v_reason));
  end loop;

  insert into public.system_audit_logs(action, module, details, performed_by, performed_at, metadata, risk_level, reason_code)
  values (
    'settlements.reverse',
    'accounting',
    p_settlement_id::text,
    auth.uid(),
    now(),
    jsonb_build_object('settlementId', p_settlement_id::text, 'reversalSettlementId', v_rev_id::text, 'reason', v_reason),
    'HIGH',
    'SETTLEMENT_REVERSE'
  );

  return v_rev_id;
end;
$$;

create or replace function public.auto_settle_party_items(p_party_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_allocs jsonb := '[]'::jsonb;
  v_debit record;
  v_credit record;
  v_remaining_base numeric;
  v_remaining_foreign numeric;
  v_alloc_base numeric;
  v_alloc_foreign numeric;
  v_id uuid;
begin
  if not public.has_admin_permission('accounting.manage') then
    raise exception 'not allowed';
  end if;

  if p_party_id is null then
    raise exception 'party_id required';
  end if;

  if public.is_in_closed_period(now()) then
    raise exception 'accounting period is closed';
  end if;

  for v_debit in
    select *
    from public.party_open_items
    where party_id = p_party_id
      and status in ('open','partially_settled')
      and direction = 'debit'
    order by due_date asc nulls last, occurred_at asc, created_at asc
  loop
    v_remaining_base := coalesce(v_debit.open_base_amount, 0);
    v_remaining_foreign := coalesce(v_debit.open_foreign_amount, 0);

    if v_remaining_base <= 1e-6 and (v_debit.open_foreign_amount is null or v_remaining_foreign <= 1e-6) then
      continue;
    end if;

    for v_credit in
      select *
      from public.party_open_items
      where party_id = p_party_id
        and status in ('open','partially_settled')
        and direction = 'credit'
        and upper(currency_code) = upper(v_debit.currency_code)
      order by due_date asc nulls last, occurred_at asc, created_at asc
    loop
      if v_remaining_base <= 1e-6 and (v_debit.open_foreign_amount is null or v_remaining_foreign <= 1e-6) then
        exit;
      end if;

      if v_credit.open_foreign_amount is not null or v_debit.open_foreign_amount is not null then
        if v_credit.open_foreign_amount is null or v_debit.open_foreign_amount is null then
          continue;
        end if;
        v_alloc_foreign := least(coalesce(v_remaining_foreign,0), coalesce(v_credit.open_foreign_amount,0));
        if v_alloc_foreign <= 1e-6 then
          continue;
        end if;
        v_allocs := v_allocs || jsonb_build_array(jsonb_build_object('fromOpenItemId', v_debit.id::text, 'toOpenItemId', v_credit.id::text, 'allocatedForeignAmount', v_alloc_foreign));
        v_remaining_foreign := v_remaining_foreign - v_alloc_foreign;
        v_remaining_base := v_remaining_base - (v_alloc_foreign * coalesce(public._open_item_effective_fx_rate(v_debit.foreign_amount, v_debit.base_amount), 1));
      else
        v_alloc_base := least(coalesce(v_remaining_base,0), coalesce(v_credit.open_base_amount,0));
        if v_alloc_base <= 1e-6 then
          continue;
        end if;
        v_allocs := v_allocs || jsonb_build_array(jsonb_build_object('fromOpenItemId', v_debit.id::text, 'toOpenItemId', v_credit.id::text, 'allocatedBaseAmount', v_alloc_base));
        v_remaining_base := v_remaining_base - v_alloc_base;
      end if;
    end loop;
  end loop;

  if jsonb_array_length(v_allocs) = 0 then
    return null;
  end if;

  v_id := public.create_settlement(p_party_id, now(), v_allocs, 'auto_settle_party_items');

  insert into public.system_audit_logs(action, module, details, performed_by, performed_at, metadata, risk_level, reason_code)
  values (
    'settlements.auto_run',
    'accounting',
    coalesce(v_id, '00000000-0000-0000-0000-000000000000'::uuid)::text,
    auth.uid(),
    now(),
    jsonb_build_object('partyId', p_party_id::text, 'settlementId', coalesce(v_id, '00000000-0000-0000-0000-000000000000'::uuid)::text),
    'LOW',
    'SETTLEMENT_AUTO'
  );

  return v_id;
end;
$$;

create or replace function public.list_party_open_items(
  p_party_id uuid,
  p_currency text default null,
  p_status text default null
)
returns table(
  id uuid,
  party_id uuid,
  journal_entry_id uuid,
  journal_line_id uuid,
  account_code text,
  account_name text,
  direction text,
  occurred_at timestamptz,
  due_date date,
  item_role text,
  item_type text,
  source_table text,
  source_id text,
  source_event text,
  currency_code text,
  foreign_amount numeric,
  base_amount numeric,
  open_foreign_amount numeric,
  open_base_amount numeric,
  status text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    poi.id,
    poi.party_id,
    poi.journal_entry_id,
    poi.journal_line_id,
    coa.code as account_code,
    coa.name as account_name,
    poi.direction,
    poi.occurred_at,
    poi.due_date,
    poi.item_role,
    poi.item_type,
    poi.source_table,
    poi.source_id,
    poi.source_event,
    poi.currency_code,
    poi.foreign_amount,
    poi.base_amount,
    poi.open_foreign_amount,
    poi.open_base_amount,
    poi.status
  from public.party_open_items poi
  join public.chart_of_accounts coa on coa.id = poi.account_id
  where public.has_admin_permission('accounting.view')
    and poi.party_id = p_party_id
    and (p_currency is null or upper(poi.currency_code) = upper(p_currency))
    and (p_status is null or poi.status = p_status or (p_status = 'open_active' and poi.status in ('open','partially_settled')))
  order by poi.occurred_at asc, poi.created_at asc;
$$;

revoke all on function public.create_settlement(uuid, timestamptz, jsonb, text) from public;
grant execute on function public.create_settlement(uuid, timestamptz, jsonb, text) to authenticated;

revoke all on function public.void_settlement(uuid, text) from public;
grant execute on function public.void_settlement(uuid, text) to authenticated;

revoke all on function public.auto_settle_party_items(uuid) from public;
grant execute on function public.auto_settle_party_items(uuid) to authenticated;

revoke all on function public.list_party_open_items(uuid, text, text) from public;
grant execute on function public.list_party_open_items(uuid, text, text) to authenticated;

notify pgrst, 'reload schema';
