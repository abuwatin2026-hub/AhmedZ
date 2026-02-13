set app.allow_ledger_ddl = '1';

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

  begin
    perform public.reconcile_purchase_order_receipt_status(p_order_id);
  exception
    when undefined_function then
      null;
    when others then
      null;
  end;

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

do $$
declare
  v_id uuid;
begin
  for v_id in
    select po.id
    from public.purchase_orders po
    where po.status in ('draft','partial')
      and exists (select 1 from public.purchase_receipts pr where pr.purchase_order_id = po.id)
    order by po.updated_at desc nulls last
    limit 500
  loop
    begin
      perform public.reconcile_purchase_order_receipt_status(v_id);
    exception when others then
      null;
    end;
  end loop;
end $$;

revoke all on function public.receive_purchase_order_partial(uuid, jsonb, timestamptz) from public;
grant execute on function public.receive_purchase_order_partial(uuid, jsonb, timestamptz) to authenticated;

notify pgrst, 'reload schema';
