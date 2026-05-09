set app.allow_ledger_ddl = '1';

create or replace function public.sync_ar_on_invoice(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order record;
  v_is_cod boolean := false;
  v_entry_id uuid;
  v_ar_id uuid;
  v_ar_amount numeric := 0;
  v_item record;
  v_allocated numeric := 0;
  v_new_open numeric := 0;
  v_currency text;
begin
  if p_order_id is null then
    raise exception 'p_order_id is required';
  end if;

  select o.*
  into v_order
  from public.orders o
  where o.id = p_order_id;
  if not found then
    return;
  end if;

  v_is_cod := public._is_cod_delivery_order(coalesce(v_order.data, '{}'::jsonb), v_order.delivery_zone_id);
  if v_is_cod then
    return;
  end if;

  select je.id
  into v_entry_id
  from public.journal_entries je
  where je.source_table = 'orders'
    and je.source_id = p_order_id::text
    and je.source_event in ('invoiced', 'delivered')
  order by
    case when je.source_event = 'invoiced' then 0 else 1 end asc,
    je.entry_date desc
  limit 1;
  if v_entry_id is null then
    return;
  end if;

  select public.get_account_id_by_code('1200') into v_ar_id;
  if v_ar_id is null then
    raise exception 'AR account not found';
  end if;

  select coalesce(sum(jl.debit), 0) - coalesce(sum(jl.credit), 0)
  into v_ar_amount
  from public.journal_lines jl
  where jl.journal_entry_id = v_entry_id
    and jl.account_id = v_ar_id;

  if coalesce(v_ar_amount, 0) <= 0 then
    return;
  end if;

  v_currency := upper(coalesce(nullif(v_order.currency, ''), nullif(v_order.data->>'currency', ''), 'YER'));

  select a.*
  into v_item
  from public.ar_open_items a
  where a.invoice_id = p_order_id
  order by
    case when a.status = 'open' then 0 else 1 end asc,
    a.created_at desc
  limit 1
  for update;

  if found then
    select coalesce(sum(al.amount), 0)
    into v_allocated
    from public.ar_allocations al
    where al.open_item_id = v_item.id;

    v_new_open := greatest(0, v_ar_amount - coalesce(v_allocated, 0));

    update public.ar_open_items
    set
      journal_entry_id = v_entry_id,
      original_amount = v_ar_amount,
      open_balance = v_new_open,
      currency = coalesce(v_currency, currency),
      status = case when v_new_open <= 0 then 'closed' else 'open' end,
      closed_at = case when v_new_open <= 0 then coalesce(closed_at, now()) else null end
    where id = v_item.id;
  else
    insert into public.ar_open_items(
      invoice_id,
      order_id,
      journal_entry_id,
      original_amount,
      open_balance,
      status,
      currency
    )
    values (
      p_order_id,
      p_order_id,
      v_entry_id,
      v_ar_amount,
      v_ar_amount,
      'open',
      coalesce(v_currency, 'YER')
    );
  end if;
end;
$$;

revoke all on function public.sync_ar_on_invoice(uuid) from public;
revoke execute on function public.sync_ar_on_invoice(uuid) from anon;
grant execute on function public.sync_ar_on_invoice(uuid) to authenticated;

create or replace function public.reconcile_ar_open_item_from_payment(p_payment_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pay record;
  v_order_id uuid;
  v_entry_id uuid;
  v_ar_id uuid;
  v_ar_settle_amount numeric := 0;
  v_open record;
  v_alloc numeric := 0;
  v_has_allocation boolean := false;
begin
  if p_payment_id is null then
    return;
  end if;

  select p.*
  into v_pay
  from public.payments p
  where p.id = p_payment_id;
  if not found then
    return;
  end if;

  if v_pay.direction <> 'in' or coalesce(v_pay.reference_table, '') <> 'orders' then
    return;
  end if;

  if lower(coalesce(v_pay.method, '')) = 'ar' then
    return;
  end if;

  if coalesce(v_pay.reference_id, '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    return;
  end if;

  v_order_id := nullif(v_pay.reference_id, '')::uuid;
  if v_order_id is null then
    return;
  end if;

  if not exists (select 1 from public.orders o where o.id = v_order_id) then
    return;
  end if;

  perform public.sync_ar_on_invoice(v_order_id);

  select je.id
  into v_entry_id
  from public.journal_entries je
  where je.source_table = 'payments'
    and je.source_id = p_payment_id::text
  order by je.created_at desc
  limit 1;
  if v_entry_id is null then
    return;
  end if;

  select public.get_account_id_by_code('1200') into v_ar_id;
  if v_ar_id is null then
    return;
  end if;

  select coalesce(sum(jl.credit), 0) - coalesce(sum(jl.debit), 0)
  into v_ar_settle_amount
  from public.journal_lines jl
  where jl.journal_entry_id = v_entry_id
    and jl.account_id = v_ar_id;
  if coalesce(v_ar_settle_amount, 0) <= 0 then
    return;
  end if;

  select exists(
    select 1
    from public.ar_allocations al
    join public.ar_open_items oi on oi.id = al.open_item_id
    where al.payment_id = p_payment_id
      and oi.invoice_id = v_order_id
  ) into v_has_allocation;
  if v_has_allocation then
    return;
  end if;

  select oi.*
  into v_open
  from public.ar_open_items oi
  where oi.invoice_id = v_order_id
    and oi.status = 'open'
  order by oi.created_at desc
  limit 1
  for update;
  if not found then
    return;
  end if;

  v_alloc := least(greatest(v_open.open_balance, 0), greatest(v_ar_settle_amount, 0));
  if v_alloc <= 0 then
    return;
  end if;

  perform public.allocate_payment_to_open_item(v_open.id, p_payment_id, v_alloc);
end;
$$;

revoke all on function public.reconcile_ar_open_item_from_payment(uuid) from public;
revoke execute on function public.reconcile_ar_open_item_from_payment(uuid) from anon;
grant execute on function public.reconcile_ar_open_item_from_payment(uuid) to authenticated;

create or replace function public.trg_after_journal_entry_insert_flag_payment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.source_table = 'payments' and new.source_event like 'in:orders:%' then
    begin
      perform public.flag_payment_allocation_status((new.source_id)::uuid);
    exception when others then
      null;
    end;
    begin
      perform public.reconcile_ar_open_item_from_payment((new.source_id)::uuid);
    exception when others then
      null;
    end;
  end if;
  return new;
end;
$$;

create or replace function public.backfill_credit_ar_integrity()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order record;
  v_pay record;
  v_synced_count integer := 0;
  v_reconciled_count integer := 0;
  v_rebalanced_count integer := 0;
begin
  for v_order in
    select o.id
    from public.orders o
    where o.status <> 'cancelled'
      and (
        o.payment_method = 'ar'
        or lower(coalesce(o.data->>'isCreditSale', 'false')) in ('true', '1', 'yes')
      )
      and exists (
        select 1
        from public.journal_entries je
        where je.source_table = 'orders'
          and je.source_id = o.id::text
          and je.source_event in ('invoiced', 'delivered')
      )
  loop
    perform public.sync_ar_on_invoice(v_order.id);
    v_synced_count := v_synced_count + 1;
  end loop;

  for v_pay in
    select p.id
    from public.payments p
    where p.direction = 'in'
      and p.reference_table = 'orders'
      and lower(coalesce(p.method, '')) <> 'ar'
      and exists (
        select 1
        from public.journal_entries je
        where je.source_table = 'payments'
          and je.source_id = p.id::text
      )
  loop
    perform public.reconcile_ar_open_item_from_payment(v_pay.id);
    v_reconciled_count := v_reconciled_count + 1;
  end loop;

  update public.ar_open_items oi
  set
    open_balance = greatest(0, oi.original_amount - coalesce(src.allocated_amount, 0)),
    status = case
      when greatest(0, oi.original_amount - coalesce(src.allocated_amount, 0)) <= 0 then 'closed'
      else 'open'
    end,
    closed_at = case
      when greatest(0, oi.original_amount - coalesce(src.allocated_amount, 0)) <= 0 then coalesce(oi.closed_at, now())
      else null
    end
  from (
    select
      oi2.id as open_item_id,
      coalesce(sum(al.amount), 0) as allocated_amount
    from public.ar_open_items oi2
    left join public.ar_allocations al on al.open_item_id = oi2.id
    group by oi2.id
  ) src
  where oi.id = src.open_item_id
    and (
      oi.open_balance is distinct from greatest(0, oi.original_amount - coalesce(src.allocated_amount, 0))
      or oi.status is distinct from case
        when greatest(0, oi.original_amount - coalesce(src.allocated_amount, 0)) <= 0 then 'closed'
        else 'open'
      end
    );
  get diagnostics v_rebalanced_count = row_count;

  return jsonb_build_object(
    'synced_credit_orders', v_synced_count,
    'reconciled_payments_checked', v_reconciled_count,
    'rebalanced_open_items', v_rebalanced_count
  );
end;
$$;

revoke all on function public.backfill_credit_ar_integrity() from public;
revoke execute on function public.backfill_credit_ar_integrity() from anon;
grant execute on function public.backfill_credit_ar_integrity() to authenticated;

create or replace function public.credit_ar_smoke_report(p_limit integer default 20)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  with recent_credit_orders as (
    select o.id, o.created_at
    from public.orders o
    where o.status = 'delivered'
      and (
        o.payment_method = 'ar'
        or lower(coalesce(o.data->>'isCreditSale', 'false')) in ('true', '1', 'yes')
      )
    order by o.created_at desc
    limit greatest(coalesce(p_limit, 20), 1)
  ),
  checks as (
    select
      r.id as order_id,
      exists(
        select 1
        from public.ar_open_items oi
        where oi.invoice_id = r.id
      ) as has_open_item,
      exists(
        select 1
        from public.journal_entries je
        where je.source_table = 'orders'
          and je.source_id = r.id::text
          and je.source_event in ('invoiced', 'delivered')
      ) as has_order_journal,
      exists(
        select 1
        from public.payments p
        where p.reference_table = 'orders'
          and p.reference_id = r.id::text
          and p.direction = 'in'
          and lower(coalesce(p.method, '')) <> 'ar'
      ) as has_real_collection,
      exists(
        select 1
        from public.payments p
        join public.journal_entries je
          on je.source_table = 'payments'
         and je.source_id = p.id::text
        join public.journal_lines jl
          on jl.journal_entry_id = je.id
        where p.reference_table = 'orders'
          and p.reference_id = r.id::text
          and p.direction = 'in'
          and lower(coalesce(p.method, '')) <> 'ar'
          and jl.account_id = public.get_account_id_by_code('1200')
          and jl.credit > 0
      ) as has_ar_settlement_collection,
      exists(
        select 1
        from public.ar_allocations al
        join public.ar_open_items oi on oi.id = al.open_item_id
        where oi.invoice_id = r.id
      ) as has_allocation,
      exists(
        select 1
        from public.ar_open_items oi
        left join (
          select open_item_id, coalesce(sum(amount), 0) as allocated
          from public.ar_allocations
          group by open_item_id
        ) al on al.open_item_id = oi.id
        where oi.invoice_id = r.id
          and oi.open_balance <> greatest(0, oi.original_amount - coalesce(al.allocated, 0))
      ) as has_balance_mismatch
    from recent_credit_orders r
  ),
  anomalies as (
    select
      c.order_id,
      array_remove(array[
        case when not c.has_open_item then 'missing_open_item' end,
        case when c.has_ar_settlement_collection and not c.has_allocation then 'missing_allocation_after_collection' end,
        case when c.has_balance_mismatch then 'open_balance_mismatch' end
      ], null) as issues
    from checks c
  )
  select jsonb_build_object(
    'sample_size', (select count(*) from checks),
    'orders_with_open_item', (select count(*) from checks where has_open_item),
    'orders_with_order_journal', (select count(*) from checks where has_order_journal),
    'orders_with_real_collection', (select count(*) from checks where has_real_collection),
    'orders_with_ar_settlement_collection', (select count(*) from checks where has_ar_settlement_collection),
    'orders_with_allocation', (select count(*) from checks where has_allocation),
    'orders_with_balance_mismatch', (select count(*) from checks where has_balance_mismatch),
    'anomalies', coalesce((
      select jsonb_agg(jsonb_build_object('order_id', a.order_id, 'issues', a.issues))
      from (
        select * from anomalies where coalesce(array_length(issues, 1), 0) > 0 limit 20
      ) a
    ), '[]'::jsonb)
  )
  into v_result;

  return v_result;
end;
$$;

revoke all on function public.credit_ar_smoke_report(integer) from public;
revoke execute on function public.credit_ar_smoke_report(integer) from anon;
grant execute on function public.credit_ar_smoke_report(integer) to authenticated;

select public.backfill_credit_ar_integrity();
select public.credit_ar_smoke_report(50);

select pg_sleep(0.5);
notify pgrst, 'reload schema';
