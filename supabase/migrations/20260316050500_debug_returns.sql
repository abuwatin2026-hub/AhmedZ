-- Debug function to expose returns_sales intermediate values for a specific item
create or replace function public.debug_returns_for_item(p_item_id text)
returns table(
  return_id text,
  qty_returned numeric,
  gross_value numeric,
  fx_rate numeric,
  returned_sales_contrib numeric
)
language sql
security definer
stable
as $$
  -- Reuse the same CTEs as get_product_sales_report_v9
  with
  sales_orders as (
    select o.id, o.data
    from public.orders o
    where (o.data->>'status' = 'delivered' or o.status = 'delivered' or (o.data->>'paidAt') is not null)
      and (o.data->>'voidedAt') is null
  ),
  returns_base as (
    select
      sr.id as return_id,
      sr.order_id,
      coalesce(nullif(sr.total_refund_amount, 0), 0) as return_amount,
      (sr.items) as items
    from public.sales_returns sr
    where sr.status = 'completed'
  ),
  return_items as (
    select
      rb.return_id,
      rb.order_id,
      rb.return_amount,
      (ri->>'itemId')::text as item_id_text,
      (ri->>'quantity')::numeric as qty_returned
    from returns_base rb
    cross join lateral jsonb_array_elements(rb.items::jsonb) as ri
    where (ri->>'itemId')::text = p_item_id
  )
  select
    ri.return_id::text,
    ri.qty_returned,
    ri.qty_returned as gross_value_approx,
    1.0::numeric as fx_rate,
    ri.qty_returned * 1.0 as returned_sales_contrib
  from return_items ri
$$;

grant execute on function public.debug_returns_for_item(text) to authenticated;
notify pgrst, 'reload schema';
