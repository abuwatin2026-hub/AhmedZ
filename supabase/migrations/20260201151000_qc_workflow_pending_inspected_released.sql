alter table public.stock_management
  add column if not exists qc_hold_quantity numeric not null default 0;

create or replace function public.recompute_stock_for_item(
  p_item_id text,
  p_warehouse_id uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_food boolean := false;
begin
  perform public._require_staff('recompute_stock_for_item');

  if p_item_id is null or btrim(p_item_id) = '' then
    raise exception 'item_id is required';
  end if;
  if p_warehouse_id is null then
    raise exception 'warehouse_id is required';
  end if;

  select (coalesce(mi.category,'') = 'food')
  into v_is_food
  from public.menu_items mi
  where mi.id::text = p_item_id::text;

  insert into public.stock_management(item_id, warehouse_id, available_quantity, qc_hold_quantity, reserved_quantity, unit, low_stock_threshold, last_updated, data)
  select p_item_id, p_warehouse_id, 0, 0, 0, coalesce(mi.unit_type, 'piece'), 5, now(), '{}'::jsonb
  from public.menu_items mi
  where mi.id::text = p_item_id::text
  on conflict (item_id, warehouse_id) do nothing;

  update public.stock_management sm
  set
    reserved_quantity = coalesce((
      select sum(r.quantity)
      from public.order_item_reservations r
      where r.item_id::text = p_item_id::text
        and r.warehouse_id = p_warehouse_id
    ), 0),
    available_quantity = coalesce((
      select sum(
        greatest(
          coalesce(b.quantity_received,0)
          - coalesce(b.quantity_consumed,0)
          - coalesce(b.quantity_transferred,0),
          0
        )
      )
      from public.batches b
      where b.item_id::text = p_item_id::text
        and b.warehouse_id = p_warehouse_id
        and coalesce(b.status,'active') = 'active'
        and coalesce(b.qc_status,'') = 'released'
        and not exists (
          select 1 from public.batch_recalls br
          where br.batch_id = b.id and br.status = 'active'
        )
        and (
          not coalesce(v_is_food, false)
          or (b.expiry_date is not null and b.expiry_date >= current_date)
        )
    ), 0),
    qc_hold_quantity = coalesce((
      select sum(
        greatest(
          coalesce(b.quantity_received,0)
          - coalesce(b.quantity_consumed,0)
          - coalesce(b.quantity_transferred,0),
          0
        )
      )
      from public.batches b
      where b.item_id::text = p_item_id::text
        and b.warehouse_id = p_warehouse_id
        and coalesce(b.status,'active') = 'active'
        and coalesce(b.qc_status,'') <> 'released'
        and not exists (
          select 1 from public.batch_recalls br
          where br.batch_id = b.id and br.status = 'active'
        )
        and (
          not coalesce(v_is_food, false)
          or (b.expiry_date is not null and b.expiry_date >= current_date)
        )
    ), 0),
    last_updated = now(),
    updated_at = now()
  where sm.item_id::text = p_item_id::text
    and sm.warehouse_id = p_warehouse_id;
end;
$$;

revoke all on function public.recompute_stock_for_item(text, uuid) from public;
revoke execute on function public.recompute_stock_for_item(text, uuid) from anon;
grant execute on function public.recompute_stock_for_item(text, uuid) to authenticated;

create or replace function public.qc_inspect_batch(
  p_batch_id uuid,
  p_result text,
  p_notes text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch record;
begin
  perform public._require_staff('qc_inspect_batch');
  if not public.has_admin_permission('qc.inspect') then
    raise exception 'ليس لديك صلاحية فحص QC';
  end if;
  if p_batch_id is null then
    raise exception 'batch_id is required';
  end if;
  if coalesce(p_result,'') not in ('pass','fail') then
    raise exception 'result must be pass or fail';
  end if;

  select b.id, b.item_id, b.warehouse_id, coalesce(b.qc_status,'') as qc_status
  into v_batch
  from public.batches b
  where b.id = p_batch_id
  for update;
  if not found then
    raise exception 'batch not found';
  end if;

  if v_batch.qc_status not in ('pending','quarantined') then
    raise exception 'batch qc_status must be pending';
  end if;

  insert into public.qc_checks(batch_id, check_type, result, checked_by, checked_at, notes)
  values (p_batch_id, 'inspection', p_result, auth.uid(), now(), nullif(p_notes,''));

  update public.batches
  set qc_status = 'inspected',
      updated_at = now()
  where id = p_batch_id;

  perform public.recompute_stock_for_item(v_batch.item_id, v_batch.warehouse_id);
end;
$$;

revoke all on function public.qc_inspect_batch(uuid, text, text) from public;
revoke execute on function public.qc_inspect_batch(uuid, text, text) from anon;
grant execute on function public.qc_inspect_batch(uuid, text, text) to authenticated;

create or replace function public.qc_release_batch(
  p_batch_id uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch record;
  v_last_result text;
begin
  perform public._require_staff('qc_release_batch');
  if not public.has_admin_permission('qc.release') then
    raise exception 'ليس لديك صلاحية إفراج QC';
  end if;
  if p_batch_id is null then
    raise exception 'batch_id is required';
  end if;

  select b.id, b.item_id, b.warehouse_id, coalesce(b.qc_status,'') as qc_status
  into v_batch
  from public.batches b
  where b.id = p_batch_id
  for update;
  if not found then
    raise exception 'batch not found';
  end if;

  if v_batch.qc_status <> 'inspected' then
    raise exception 'batch qc_status must be inspected';
  end if;

  select qc.result
  into v_last_result
  from public.qc_checks qc
  where qc.batch_id = p_batch_id
    and qc.check_type = 'inspection'
  order by qc.checked_at desc
  limit 1;

  if coalesce(v_last_result,'') <> 'pass' then
    raise exception 'QC inspection must pass before release';
  end if;

  update public.batches
  set qc_status = 'released',
      updated_at = now()
  where id = p_batch_id;

  perform public.recompute_stock_for_item(v_batch.item_id, v_batch.warehouse_id);
end;
$$;

revoke all on function public.qc_release_batch(uuid) from public;
revoke execute on function public.qc_release_batch(uuid) from anon;
grant execute on function public.qc_release_batch(uuid) to authenticated;

select pg_sleep(0.5);
notify pgrst, 'reload schema';
