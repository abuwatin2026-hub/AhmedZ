set app.allow_ledger_ddl = '1';

create or replace function public._resolve_party_for_entry(p_source_table text, p_source_id text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_party_id uuid;
  v_order record;
  v_po record;
  v_pay record;
  v_exp record;
  v_note record;
  v_party_text text;
  v_emp uuid;
begin
  v_party_id := null;

  if p_source_table = 'orders' then
    begin
      select
        o.party_id,
        o.customer_auth_user_id,
        o.currency,
        o.fx_rate,
        o.total,
        o.base_total
      into v_order
      from public.orders o
      where o.id = (p_source_id)::uuid;

      if v_order.party_id is not null then
        return v_order.party_id;
      end if;

      if v_order.customer_auth_user_id is not null then
        v_party_id := public.ensure_financial_party_for_customer(v_order.customer_auth_user_id);
      end if;
    exception when others then
      v_party_id := null;
    end;
    return v_party_id;
  end if;

  if p_source_table = 'purchase_receipts' or p_source_table = 'purchase_orders' then
    begin
      if p_source_table = 'purchase_receipts' then
        select po.supplier_id
        into v_po
        from public.purchase_receipts pr
        join public.purchase_orders po on po.id = pr.purchase_order_id
        where pr.id = (p_source_id)::uuid;
      else
        select po.supplier_id
        into v_po
        from public.purchase_orders po
        where po.id = (p_source_id)::uuid;
      end if;
      if v_po.supplier_id is not null then
        v_party_id := public.ensure_financial_party_for_supplier(v_po.supplier_id);
      end if;
    exception when others then
      v_party_id := null;
    end;
    return v_party_id;
  end if;

  if p_source_table = 'supplier_credit_notes' then
    begin
      select n.supplier_id
      into v_note
      from public.supplier_credit_notes n
      where n.id = (p_source_id)::uuid;
      if v_note.supplier_id is not null then
        return public.ensure_financial_party_for_supplier(v_note.supplier_id);
      end if;
    exception when others then
      return null;
    end;
    return null;
  end if;

  if p_source_table = 'inventory_movements' then
    declare
      v_im record;
    begin
      select im.movement_type, im.reference_table, im.reference_id, im.data
      into v_im
      from public.inventory_movements im
      where im.id = (p_source_id)::uuid;

      if v_im.movement_type = 'sale_out' and v_im.reference_table = 'orders' then
        begin
          select o.party_id, o.customer_auth_user_id
          into v_order
          from public.orders o
          where o.id = (v_im.reference_id)::uuid;

          if v_order.party_id is not null then
            return v_order.party_id;
          end if;

          if v_order.customer_auth_user_id is not null then
            return public.ensure_financial_party_for_customer(v_order.customer_auth_user_id);
          end if;
        exception when others then
          null;
        end;
      end if;

      if v_im.movement_type = 'purchase_in' and v_im.reference_table = 'purchase_receipts' then
        begin
          select po.supplier_id
          into v_po
          from public.purchase_receipts pr
          join public.purchase_orders po on po.id = pr.purchase_order_id
          where pr.id = (v_im.reference_id)::uuid;
          if v_po.supplier_id is not null then
            return public.ensure_financial_party_for_supplier(v_po.supplier_id);
          end if;
        exception when others then
          null;
        end;
      end if;

      if v_im.movement_type = 'return_out' and v_im.reference_table = 'purchase_returns' then
        begin
          select po.supplier_id
          into v_po
          from public.purchase_returns r
          join public.purchase_orders po on po.id = r.purchase_order_id
          where r.id = (v_im.reference_id)::uuid;
          if v_po.supplier_id is not null then
            return public.ensure_financial_party_for_supplier(v_po.supplier_id);
          end if;
        exception when others then
          null;
        end;
      end if;
    exception when others then
      null;
    end;
    return null;
  end if;

  if p_source_table = 'payments' then
    begin
      select *
      into v_pay
      from public.payments p
      where p.id = (p_source_id)::uuid;
    exception when others then
      return null;
    end;

    if v_pay.id is null then
      return null;
    end if;

    if v_pay.reference_table = 'orders' then
      begin
        select o.party_id, o.customer_auth_user_id
        into v_order
        from public.orders o
        where o.id = (v_pay.reference_id)::uuid;

        if v_order.party_id is not null then
          return v_order.party_id;
        end if;

        if v_order.customer_auth_user_id is not null then
          return public.ensure_financial_party_for_customer(v_order.customer_auth_user_id);
        end if;
      exception when others then
        null;
      end;
    end if;

    if v_pay.reference_table = 'financial_parties' then
      begin
        v_party_id := nullif(trim(coalesce(v_pay.reference_id, '')), '')::uuid;
        return v_party_id;
      exception when others then
        return null;
      end;
    end if;

    if v_pay.reference_table = 'expenses' then
      begin
        select e.data
        into v_exp
        from public.expenses e
        where e.id = (v_pay.reference_id)::uuid;
      exception when others then
        v_exp := null;
      end;
      if v_exp is not null then
        v_party_text := nullif(btrim(coalesce(v_exp.data->>'partyId', '')), '');
        if v_party_text is not null then
          begin
            v_party_id := v_party_text::uuid;
            return v_party_id;
          exception when others then
            null;
          end;
        end if;
        v_party_text := nullif(btrim(coalesce(v_exp.data->>'employeeId', '')), '');
        if v_party_text is not null then
          begin
            v_emp := v_party_text::uuid;
            return public.ensure_financial_party_for_employee(v_emp);
          exception when others then
            null;
          end;
        end if;
      end if;
      return null;
    end if;
  end if;

  if p_source_table = 'expenses' then
    begin
      select e.data
      into v_exp
      from public.expenses e
      where e.id = (p_source_id)::uuid;
    exception when others then
      v_exp := null;
    end;
    if v_exp is not null then
      v_party_text := nullif(btrim(coalesce(v_exp.data->>'partyId', '')), '');
      if v_party_text is not null then
        begin
          v_party_id := v_party_text::uuid;
          return v_party_id;
        exception when others then
          null;
        end;
      end if;
      v_party_text := nullif(btrim(coalesce(v_exp.data->>'employeeId', '')), '');
      if v_party_text is not null then
        begin
          v_emp := v_party_text::uuid;
          return public.ensure_financial_party_for_employee(v_emp);
        exception when others then
          null;
        end;
      end if;
    end if;
    return null;
  end if;

  return null;
end;
$$;

do $$
begin
  perform public.backfill_party_ledger_for_credit_orders();
exception when undefined_function then
  null;
end $$;

select pg_sleep(0.5);
notify pgrst, 'reload schema';
