do $$
begin
  create or replace function public.enforce_purchase_items_editability()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
  as $fn$
  declare
    v_po_id uuid;
    v_status text;
    v_has_receipts boolean;
    v_sensitive_changed boolean := false;
  begin
    v_po_id := coalesce(new.purchase_order_id, old.purchase_order_id);
    select status into v_status from public.purchase_orders where id = v_po_id;
    v_status := coalesce(v_status, 'draft');
    select exists (
      select 1
      from public.purchase_receipts
      where purchase_order_id = v_po_id
      limit 1
    ) into v_has_receipts;

    if tg_op = 'UPDATE' then
      v_sensitive_changed :=
        (to_jsonb(new)->>'item_id') is distinct from (to_jsonb(old)->>'item_id')
        or (to_jsonb(new)->>'purchase_order_id') is distinct from (to_jsonb(old)->>'purchase_order_id')
        or (to_jsonb(new)->>'quantity') is distinct from (to_jsonb(old)->>'quantity')
        or (to_jsonb(new)->>'uom_id') is distinct from (to_jsonb(old)->>'uom_id')
        or (to_jsonb(new)->>'unit_cost') is distinct from (to_jsonb(old)->>'unit_cost')
        or (to_jsonb(new)->>'total_cost') is distinct from (to_jsonb(old)->>'total_cost')
        or (to_jsonb(new)->>'qty_base') is distinct from (to_jsonb(old)->>'qty_base')
        or (to_jsonb(new)->>'unit_cost_base') is distinct from (to_jsonb(old)->>'unit_cost_base')
        or (to_jsonb(new)->>'unit_cost_foreign') is distinct from (to_jsonb(old)->>'unit_cost_foreign');

      if v_sensitive_changed and (v_status <> 'draft' or v_has_receipts or coalesce(old.received_quantity, 0) > 0) then
        raise exception 'cannot modify purchase items after receiving';
      end if;
      return new;
    end if;

    if tg_op = 'DELETE' then
      if (v_status <> 'draft') or v_has_receipts or coalesce(old.received_quantity, 0) > 0 then
        raise exception 'cannot delete purchase items after receiving';
      end if;
      return old;
    end if;

    return new;
  end;
  $fn$;
end;
$$;

notify pgrst, 'reload schema';
