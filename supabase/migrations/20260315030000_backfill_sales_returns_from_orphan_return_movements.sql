do $$
declare
  v_actor uuid;
begin
  select au.auth_user_id
  into v_actor
  from public.admin_users au
  where au.is_active = true
  order by (case when au.role = 'owner' then 0 else 1 end), au.created_at asc nulls last
  limit 1;

  if v_actor is null then
    raise exception 'no active admin user found for backfill';
  end if;

  with orphan_refs as (
    select
      im.reference_id,
      min(im.occurred_at) as return_date,
      max(im.data->>'orderId') as order_id_text
    from public.inventory_movements im
    left join public.sales_returns sr on sr.id::text = im.reference_id
    where im.reference_table = 'sales_returns'
      and im.movement_type = 'return_in'
      and sr.id is null
      and im.reference_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    group by im.reference_id
  ),
  valid_orphans as (
    select
      o.reference_id::uuid as return_id,
      o.return_date,
      o.order_id_text::uuid as order_id
    from orphan_refs o
    join public.orders ord on ord.id::text = o.order_id_text
    where o.order_id_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      and nullif(trim(coalesce(ord.data->>'voidedAt','')), '') is null
  ),
  items_by_return as (
    select
      vo.return_id,
      jsonb_agg(
        jsonb_build_object(
          'itemId', x.item_id,
          'quantity', x.qty
        )
        order by x.item_id
      ) as items_json
    from valid_orphans vo
    join (
      select
        im.reference_id::uuid as return_id,
        im.item_id::text as item_id,
        sum(coalesce(im.quantity, 0)) as qty
      from public.inventory_movements im
      where im.reference_table = 'sales_returns'
        and im.movement_type = 'return_in'
        and im.reference_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      group by im.reference_id::uuid, im.item_id::text
      having sum(coalesce(im.quantity, 0)) > 0
    ) x on x.return_id = vo.return_id
    group by vo.return_id
  ),
  payments_by_return as (
    select
      p.reference_id::uuid as return_id,
      sum(coalesce(nullif(p.base_amount, 0), p.amount, 0)) as refund_total,
      (array_agg(p.method order by coalesce(nullif(p.base_amount, 0), p.amount, 0) desc nulls last))[1] as best_method
    from public.payments p
    where p.reference_table = 'sales_returns'
      and p.reference_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    group by p.reference_id::uuid
  )
  insert into public.sales_returns (
    id,
    order_id,
    return_date,
    reason,
    refund_method,
    total_refund_amount,
    items,
    status,
    created_by,
    created_at,
    updated_at,
    idempotency_key
  )
  select
    vo.return_id,
    vo.order_id,
    vo.return_date,
    'Backfilled from orphan return_in movements',
    case
      when coalesce(pr.best_method, '') in ('cash','network','kuraimi','ar','store_credit') then pr.best_method
      else 'store_credit'
    end as refund_method,
    coalesce(pr.refund_total, 0),
    coalesce(ibr.items_json, '[]'::jsonb),
    'completed',
    v_actor,
    vo.return_date,
    now(),
    concat('backfill-orphan-return-in-', vo.return_id::text)
  from valid_orphans vo
  left join items_by_return ibr on ibr.return_id = vo.return_id
  left join payments_by_return pr on pr.return_id = vo.return_id
  where not exists (
    select 1 from public.sales_returns sr where sr.id = vo.return_id
  );
end;
$$;

notify pgrst, 'reload schema';
