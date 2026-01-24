do $$
begin
  if to_regclass('public.pos_offline_sales') is null then
    create table public.pos_offline_sales (
      id uuid primary key default gen_random_uuid(),
      offline_id text not null unique,
      order_id uuid not null unique,
      warehouse_id uuid references public.warehouses(id) on delete set null,
      state text not null check (state in ('CREATED_OFFLINE','SYNCED','DELIVERED','FAILED','CONFLICT')),
      last_error text,
      payload jsonb not null default '{}'::jsonb,
      created_by uuid references auth.users(id) on delete set null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    if to_regclass('public.set_updated_at') is not null then
      drop trigger if exists trg_pos_offline_sales_updated_at on public.pos_offline_sales;
      create trigger trg_pos_offline_sales_updated_at
      before update on public.pos_offline_sales
      for each row execute function public.set_updated_at();
    end if;
    create index if not exists idx_pos_offline_sales_state_created on public.pos_offline_sales(state, created_at desc);
    create index if not exists idx_pos_offline_sales_order on public.pos_offline_sales(order_id);
    alter table public.pos_offline_sales enable row level security;
    drop policy if exists pos_offline_sales_select_staff on public.pos_offline_sales;
    create policy pos_offline_sales_select_staff
    on public.pos_offline_sales
    for select
    using (public.is_staff() and created_by = auth.uid());
    drop policy if exists pos_offline_sales_manage_admin on public.pos_offline_sales;
    create policy pos_offline_sales_manage_admin
    on public.pos_offline_sales
    for all
    using (public.is_admin())
    with check (public.is_admin());
  end if;
end $$;

create or replace function public.sync_offline_pos_sale(
  p_offline_id text,
  p_order_id uuid,
  p_order_data jsonb,
  p_items jsonb,
  p_warehouse_id uuid,
  p_payments jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_existing_state text;
  v_err text;
  v_result jsonb;
  v_payment jsonb;
  v_i int := 0;
begin
  v_actor := auth.uid();
  if not public.is_staff() then
    raise exception 'not allowed';
  end if;

  if p_offline_id is null or btrim(p_offline_id) = '' then
    raise exception 'p_offline_id is required';
  end if;
  if p_order_id is null then
    raise exception 'p_order_id is required';
  end if;
  if p_warehouse_id is null then
    raise exception 'p_warehouse_id is required';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'p_items must be a json array';
  end if;
  if p_payments is null then
    p_payments := '[]'::jsonb;
  end if;
  if jsonb_typeof(p_payments) <> 'array' then
    raise exception 'p_payments must be a json array';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_offline_id));

  select s.state
  into v_existing_state
  from public.pos_offline_sales s
  where s.offline_id = p_offline_id
  for update;

  if found and v_existing_state = 'DELIVERED' then
    return jsonb_build_object('status', 'DELIVERED', 'orderId', p_order_id::text, 'offlineId', p_offline_id);
  end if;

  insert into public.pos_offline_sales(offline_id, order_id, warehouse_id, state, payload, created_by, created_at, updated_at)
  values (p_offline_id, p_order_id, p_warehouse_id, 'SYNCED', coalesce(p_order_data, '{}'::jsonb), v_actor, now(), now())
  on conflict (offline_id)
  do update set
    order_id = excluded.order_id,
    warehouse_id = excluded.warehouse_id,
    state = case when public.pos_offline_sales.state = 'DELIVERED' then 'DELIVERED' else 'SYNCED' end,
    payload = excluded.payload,
    created_by = coalesce(public.pos_offline_sales.created_by, excluded.created_by),
    updated_at = now();

  select * from public.orders o where o.id = p_order_id for update;
  if not found then
    insert into public.orders(id, customer_auth_user_id, status, invoice_number, data, created_at, updated_at)
    values (
      p_order_id,
      v_actor,
      'pending',
      null,
      coalesce(p_order_data, '{}'::jsonb),
      now(),
      now()
    );
  else
    update public.orders
    set data = coalesce(p_order_data, data),
        updated_at = now()
    where id = p_order_id;
  end if;

  begin
    perform public.confirm_order_delivery(p_order_id, p_items, coalesce(p_order_data, '{}'::jsonb), p_warehouse_id);
  exception when others then
    v_err := sqlerrm;
    update public.pos_offline_sales
    set state = case
          when v_err ilike '%insufficient%' then 'CONFLICT'
          when v_err ilike '%expired%' then 'CONFLICT'
          when v_err ilike '%reservation%' then 'CONFLICT'
          else 'FAILED'
        end,
        last_error = v_err,
        updated_at = now()
    where offline_id = p_offline_id;
    update public.orders
    set data = jsonb_set(coalesce(data, '{}'::jsonb), '{offlineState}', to_jsonb('CONFLICT'::text), true),
        updated_at = now()
    where id = p_order_id;
    return jsonb_build_object('status', 'CONFLICT', 'orderId', p_order_id::text, 'offlineId', p_offline_id, 'error', v_err);
  end;

  for v_payment in
    select value
    from jsonb_array_elements(p_payments)
  loop
    begin
      perform public.record_order_payment(
        p_order_id,
        coalesce(nullif(v_payment->>'amount','')::numeric, 0),
        coalesce(nullif(v_payment->>'method',''), ''),
        coalesce(nullif(v_payment->>'occurredAt','')::timestamptz, now()),
        'offline:' || p_offline_id || ':' || v_i::text
      );
    exception when others then
      null;
    end;
    v_i := v_i + 1;
  end loop;

  update public.pos_offline_sales
  set state = 'DELIVERED',
      last_error = null,
      updated_at = now()
  where offline_id = p_offline_id;

  update public.orders
  set data = jsonb_set(coalesce(data, '{}'::jsonb), '{offlineState}', to_jsonb('DELIVERED'::text), true),
      updated_at = now()
  where id = p_order_id;

  v_result := jsonb_build_object('status', 'DELIVERED', 'orderId', p_order_id::text, 'offlineId', p_offline_id);
  return v_result;
end;
$$;

revoke all on function public.sync_offline_pos_sale(text, uuid, jsonb, jsonb, uuid, jsonb) from public;
grant execute on function public.sync_offline_pos_sale(text, uuid, jsonb, jsonb, uuid, jsonb) to authenticated;
