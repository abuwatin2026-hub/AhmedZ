create or replace function public.generate_transfer_number_v2(
  p_from_warehouse_id uuid,
  p_transfer_date date default current_date
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_branch_id uuid;
begin
  v_branch_id := public.branch_from_warehouse(p_from_warehouse_id);
  v_branch_id := coalesce(v_branch_id, public.get_default_branch_id());
  return public.next_document_number('transfer', v_branch_id, coalesce(p_transfer_date, current_date));
end;
$$;

create or replace function public.set_transfer_number()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.transfer_number is null or length(btrim(new.transfer_number)) = 0 then
    new.transfer_number := public.generate_transfer_number_v2(new.from_warehouse_id, new.transfer_date);
  end if;
  return new;
end;
$$;

create or replace function public._trg_inventory_transfers_unified_number()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_branch_id uuid;
begin
  if new.transfer_number is null
     or length(btrim(new.transfer_number)) = 0
     or new.transfer_number ~* '^IT-'
  then
    v_branch_id := public.branch_from_warehouse(new.from_warehouse_id);
    v_branch_id := coalesce(v_branch_id, public.get_default_branch_id());
    new.transfer_number := public.next_document_number('transfer', v_branch_id, coalesce(new.transfer_date, current_date));
  end if;
  return new;
end;
$$;

drop trigger if exists trg_inventory_transfers_unified_number on public.inventory_transfers;
create trigger trg_inventory_transfers_unified_number
before insert on public.inventory_transfers
for each row execute function public._trg_inventory_transfers_unified_number();
