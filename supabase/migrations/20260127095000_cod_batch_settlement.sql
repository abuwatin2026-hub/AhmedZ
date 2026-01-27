create or replace view public.v_cod_unsettled_orders as
select
  o.id as order_id,
  nullif(coalesce(o.data->>'deliveredBy', o.data->>'assignedDeliveryUserId', ''), '')::uuid as driver_id,
  coalesce(nullif((o.data->>'total')::numeric, null), 0) as amount,
  coalesce((
    select sum(p.amount)
    from public.payments p
    where p.reference_table = 'orders'
      and p.reference_id = o.id::text
      and p.direction = 'in'
  ), 0) as paid_amount,
  greatest(
    coalesce(nullif((o.data->>'total')::numeric, null), 0) - coalesce((
      select sum(p.amount)
      from public.payments p
      where p.reference_table = 'orders'
        and p.reference_id = o.id::text
        and p.direction = 'in'
    ), 0),
    0
  ) as remaining_amount,
  nullif(o.data->>'deliveredAt', '')::timestamptz as delivered_at,
  o.created_at as created_at
from public.orders o
where o.status = 'delivered'
  and nullif(o.data->>'paidAt', '') is null
  and coalesce(nullif(o.data->>'paymentMethod', ''), '') = 'cash'
  and coalesce(nullif(o.data->>'orderSource', ''), '') <> 'in_store'
  and o.delivery_zone_id is not null
  and greatest(
    coalesce(nullif((o.data->>'total')::numeric, null), 0) - coalesce((
      select sum(p.amount)
      from public.payments p
      where p.reference_table = 'orders'
        and p.reference_id = o.id::text
        and p.direction = 'in'
    ), 0),
    0
  ) > 0;

create or replace function public.cod_settle_orders(
  p_driver_id uuid,
  p_order_ids uuid[],
  p_occurred_at timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shift_id uuid;
  v_at timestamptz;
  v_settlement_id uuid;
  v_entry_id uuid;
  v_total numeric := 0;
  v_order_id uuid;
  v_order record;
  v_data jsonb;
  v_amount numeric;
  v_paid numeric;
  v_remaining numeric;
  v_balance numeric;
begin
  if not (auth.role() = 'service_role' or public.has_admin_permission('accounting.manage')) then
    raise exception 'not authorized to post accounting entries';
  end if;
  if p_driver_id is null then
    raise exception 'p_driver_id is required';
  end if;
  if p_order_ids is null or array_length(p_order_ids, 1) is null or array_length(p_order_ids, 1) = 0 then
    raise exception 'p_order_ids is required';
  end if;

  v_at := coalesce(p_occurred_at, now());

  select s.id
  into v_shift_id
  from public.cash_shifts s
  where s.cashier_id = auth.uid()
    and coalesce(s.status, 'open') = 'open'
  order by s.opened_at desc
  limit 1;

  if v_shift_id is null then
    raise exception 'cash method requires an open cash shift';
  end if;

  foreach v_order_id in array p_order_ids
  loop
    select o.*
    into v_order
    from public.orders o
    where o.id = v_order_id
    for update;

    if not found then
      raise exception 'order not found';
    end if;

    v_data := coalesce(v_order.data, '{}'::jsonb);

    if v_order.status::text <> 'delivered' then
      raise exception 'order must be delivered first';
    end if;

    if not public._is_cod_delivery_order(v_data, v_order.delivery_zone_id) then
      raise exception 'order is not COD delivery';
    end if;

    if nullif(v_data->>'paidAt','') is not null then
      raise exception 'order already settled';
    end if;

    if nullif(v_data->>'deliveredBy','')::uuid is distinct from p_driver_id
       and nullif(v_data->>'assignedDeliveryUserId','')::uuid is distinct from p_driver_id then
      raise exception 'order driver mismatch';
    end if;

    v_amount := coalesce(nullif((v_data->>'total')::numeric, null), 0);
    if v_amount <= 0 then
      raise exception 'invalid order total';
    end if;

    perform public.cod_post_delivery(v_order_id, p_driver_id, coalesce(nullif(v_data->>'deliveredAt','')::timestamptz, v_at));

    select coalesce(sum(p.amount), 0)
    into v_paid
    from public.payments p
    where p.reference_table = 'orders'
      and p.reference_id = v_order_id::text
      and p.direction = 'in';
    v_remaining := greatest(v_amount - v_paid, 0);
    v_total := v_total + v_remaining;
  end loop;

  if v_total <= 0 then
    raise exception 'invalid settlement amount';
  end if;

  insert into public.cod_settlements(driver_id, shift_id, total_amount, occurred_at, created_by, data)
  values (p_driver_id, v_shift_id, v_total, v_at, auth.uid(), jsonb_build_object('batch', true))
  returning id into v_settlement_id;

  foreach v_order_id in array p_order_ids
  loop
    select o.*
    into v_order
    from public.orders o
    where o.id = v_order_id;

    v_data := coalesce(v_order.data, '{}'::jsonb);
    v_amount := coalesce(nullif((v_data->>'total')::numeric, null), 0);
    select coalesce(sum(p.amount), 0)
    into v_paid
    from public.payments p
    where p.reference_table = 'orders'
      and p.reference_id = v_order_id::text
      and p.direction = 'in';
    v_remaining := greatest(v_amount - v_paid, 0);
    if v_remaining <= 0 then
      continue;
    end if;

    insert into public.cod_settlement_orders(settlement_id, order_id, amount)
    values (v_settlement_id, v_order_id, v_remaining);

    perform public.record_order_payment(
      v_order_id,
      v_remaining,
      'cash',
      v_at,
      'cod_settle_batch:' || v_settlement_id::text || ':' || v_order_id::text
    );

    v_data := jsonb_set(v_data, '{paidAt}', to_jsonb(v_at::text), true);
    update public.orders
    set data = v_data,
        updated_at = now()
    where id = v_order_id;
  end loop;

  insert into public.ledger_entries(entry_type, reference_type, reference_id, occurred_at, created_by, data)
  values (
    'settlement',
    'settlement',
    v_settlement_id::text,
    v_at,
    auth.uid(),
    jsonb_build_object('driverId', p_driver_id::text, 'shiftId', v_shift_id::text, 'amount', v_total, 'orderCount', array_length(p_order_ids, 1))
  )
  returning id into v_entry_id;

  insert into public.ledger_lines(entry_id, account, debit, credit)
  values
    (v_entry_id, 'Cash_On_Hand', v_total, 0),
    (v_entry_id, 'Cash_In_Transit', 0, v_total);

  v_balance := public._driver_ledger_next_balance(p_driver_id, 0, v_total);
  insert into public.driver_ledger(driver_id, reference_type, reference_id, debit, credit, balance_after, occurred_at, created_by)
  values (p_driver_id, 'settlement', v_settlement_id::text, 0, v_total, v_balance, v_at, auth.uid());

  return v_settlement_id;
end;
$$;

revoke all on function public.cod_settle_orders(uuid, uuid[], timestamptz) from public;
grant execute on function public.cod_settle_orders(uuid, uuid[], timestamptz) to authenticated;
