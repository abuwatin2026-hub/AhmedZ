do $$
begin
  begin
    create or replace function public._trg_purchase_receipts_grn_number()
    returns trigger
    language plpgsql
    security definer
    set search_path = public
    as $fn$
    begin
      if new.grn_number is null or length(btrim(new.grn_number)) = 0 then
        if new.branch_id is null then
          new.grn_number := upper(concat('GRN-', substr(new.id::text, 1, 8)));
        else
          new.grn_number := public._assign_grn_number_v2(new.branch_id, new.received_at);
        end if;
      end if;
      return new;
    end;
    $fn$;
  exception when others then
    null;
  end;
end $$;

do $$
begin
  begin
    update public.purchase_orders po
    set branch_id = coalesce(po.branch_id, public.branch_from_warehouse(po.warehouse_id)),
        company_id = coalesce(po.company_id, public.company_from_branch(coalesce(po.branch_id, public.branch_from_warehouse(po.warehouse_id))))
    where po.branch_id is null or po.company_id is null;
  exception when others then
    null;
  end;

  begin
    update public.purchase_receipts pr
    set branch_id = coalesce(pr.branch_id, public.branch_from_warehouse(pr.warehouse_id)),
        company_id = coalesce(pr.company_id, public.company_from_branch(coalesce(pr.branch_id, public.branch_from_warehouse(pr.warehouse_id))))
    where pr.branch_id is null or pr.company_id is null;
  exception when others then
    null;
  end;
end $$;

notify pgrst, 'reload schema';
