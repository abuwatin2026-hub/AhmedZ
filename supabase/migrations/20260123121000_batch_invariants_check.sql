create or replace function public.check_batch_invariants(
  p_item_id text default null,
  p_warehouse_id uuid default null
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_over_consumed int := 0;
  v_negative_remaining int := 0;
  v_reserved_exceeds int := 0;
  v_totals_exceed int := 0;
  v_result json;
begin
  select count(*) into v_over_consumed
  from public.batches b
  where (p_item_id is null or b.item_id = p_item_id)
    and (p_warehouse_id is null or b.warehouse_id is not distinct from p_warehouse_id)
    and coalesce(b.quantity_consumed,0) > coalesce(b.quantity_received,0);

  select count(*) into v_negative_remaining
  from public.batches b
  where (p_item_id is null or b.item_id = p_item_id)
    and (p_warehouse_id is null or b.warehouse_id is not distinct from p_warehouse_id)
    and ((coalesce(b.quantity_received,0) - coalesce(b.quantity_consumed,0)) < 0);

  with sm as (
    select sm.item_id::text as item_id_text, sm.warehouse_id, sm.data->'reservedBatches' as rb
    from public.stock_management sm
  ),
  entries as (
    select sm.item_id_text, sm.warehouse_id, e.key as batch_id_text, e.value as entry
    from sm, jsonb_each(coalesce(rb,'{}'::jsonb)) e
  ),
  normalized as (
    select item_id_text, warehouse_id, batch_id_text,
           case when jsonb_typeof(entry)='array' then entry else jsonb_build_array(entry) end as arr
    from entries
  ),
  sum_res as (
    select item_id_text, warehouse_id, batch_id_text,
           sum(coalesce(nullif(x.value->>'qty','')::numeric,0)) as reserved_qty
    from normalized, jsonb_array_elements(arr) x
    group by item_id_text, warehouse_id, batch_id_text
  )
  select count(*) into v_reserved_exceeds
  from public.batches b
  left join sum_res sr on sr.batch_id_text = b.id::text
                        and sr.item_id_text = b.item_id
                        and (sr.warehouse_id is not distinct from b.warehouse_id)
  where (p_item_id is null or b.item_id = p_item_id)
    and (p_warehouse_id is null or b.warehouse_id is not distinct from p_warehouse_id)
    and coalesce(sr.reserved_qty,0) > (coalesce(b.quantity_received,0) - coalesce(b.quantity_consumed,0) + 1e-9);

  with sm as (
    select sm.item_id::text as item_id_text, sm.warehouse_id, sm.data->'reservedBatches' as rb
    from public.stock_management sm
  ),
  entries as (
    select sm.item_id_text, sm.warehouse_id, e.key as batch_id_text, e.value as entry
    from sm, jsonb_each(coalesce(rb,'{}'::jsonb)) e
  ),
  normalized as (
    select item_id_text, warehouse_id, batch_id_text,
           case when jsonb_typeof(entry)='array' then entry else jsonb_build_array(entry) end as arr
    from entries
  ),
  sum_res as (
    select item_id_text, warehouse_id, batch_id_text,
           sum(coalesce(nullif(x.value->>'qty','')::numeric,0)) as reserved_qty
    from normalized, jsonb_array_elements(arr) x
    group by item_id_text, warehouse_id, batch_id_text
  ),
  agg as (
    select b.item_id, b.warehouse_id,
           sum(coalesce(b.quantity_received,0)) as total_received,
           sum(coalesce(b.quantity_consumed,0)) as total_consumed,
           sum(coalesce(sr.reserved_qty,0)) as total_reserved
    from public.batches b
    left join sum_res sr on sr.batch_id_text = b.id::text
                         and sr.item_id_text = b.item_id
                         and (sr.warehouse_id is not distinct from b.warehouse_id)
    where (p_item_id is null or b.item_id = p_item_id)
      and (p_warehouse_id is null or b.warehouse_id is not distinct from p_warehouse_id)
    group by b.item_id, b.warehouse_id
  )
  select count(*) into v_totals_exceed
  from agg
  where (coalesce(total_consumed,0) + coalesce(total_reserved,0)) > (coalesce(total_received,0) + 1e-9);

  v_result := json_build_object(
    'ok', ((v_over_consumed = 0) and (v_negative_remaining = 0) and (v_reserved_exceeds = 0) and (v_totals_exceed = 0)),
    'violations', json_build_object(
      'over_consumed', v_over_consumed,
      'negative_remaining', v_negative_remaining,
      'reserved_exceeds_remaining', v_reserved_exceeds,
      'totals_exceed_received', v_totals_exceed
    )
  );

  return v_result;
end;
$$;

revoke all on function public.check_batch_invariants(text, uuid) from public;
grant execute on function public.check_batch_invariants(text, uuid) to anon, authenticated;

