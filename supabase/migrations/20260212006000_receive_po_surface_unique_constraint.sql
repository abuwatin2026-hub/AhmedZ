do $$
begin
  if to_regprocedure('public._receive_purchase_order_partial_impl(uuid,jsonb,timestamptz)') is null
     and to_regprocedure('public.receive_purchase_order_partial(uuid,jsonb,timestamptz)') is not null
  then
    alter function public.receive_purchase_order_partial(uuid, jsonb, timestamptz)
      rename to _receive_purchase_order_partial_impl;
  end if;
end $$;

create or replace function public.receive_purchase_order_partial(
  p_order_id uuid,
  p_items jsonb,
  p_occurred_at timestamptz default now()
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_id uuid;
  v_constraint text;
  v_detail text;
  v_message text;
begin
  v_id := public._receive_purchase_order_partial_impl(p_order_id, p_items, p_occurred_at);
  return v_id;
exception
  when unique_violation then
    get stacked diagnostics
      v_constraint = constraint_name,
      v_detail = pg_exception_detail,
      v_message = message_text;
    raise exception 'DUPLICATE_CONSTRAINT:%:%', coalesce(v_constraint, ''), coalesce(v_detail, v_message, '')
      using errcode = 'P0001';
end;
$$;

revoke all on function public.receive_purchase_order_partial(uuid, jsonb, timestamptz) from public;
grant execute on function public.receive_purchase_order_partial(uuid, jsonb, timestamptz) to authenticated;

notify pgrst, 'reload schema';
