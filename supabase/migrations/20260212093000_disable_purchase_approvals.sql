do $$
begin
  if to_regclass('public.approval_policies') is not null then
    update public.approval_policies
    set is_active = false
    where request_type in ('po','receipt');
  end if;
end $$;

create or replace function public.approval_required(p_request_type text, p_amount numeric)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_type text;
  v_count int;
begin
  v_type := lower(nullif(btrim(coalesce(p_request_type, '')), ''));
  if v_type in ('po','receipt') then
    return false;
  end if;

  select count(*)
  into v_count
  from public.approval_policies p
  where p.request_type = v_type
    and p.is_active = true
    and p.min_amount <= coalesce(p_amount, 0)
    and (p.max_amount is null or p.max_amount >= coalesce(p_amount, 0));
  return v_count > 0;
end;
$$;

create or replace function public.trg_enforce_po_approval()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.requires_approval := false;
  new.approval_status := 'approved';
  new.approval_request_id := null;
  return new;
end;
$$;

create or replace function public.trg_enforce_receipt_approval()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.requires_approval := false;
  new.approval_status := 'approved';
  new.approval_request_id := null;
  return new;
end;
$$;

do $$
begin
  if to_regclass('public.purchase_orders') is not null then
    drop trigger if exists trg_enforce_po_approval on public.purchase_orders;
    create trigger trg_enforce_po_approval
    before insert or update on public.purchase_orders
    for each row execute function public.trg_enforce_po_approval();
  end if;
  if to_regclass('public.purchase_receipts') is not null then
    drop trigger if exists trg_enforce_receipt_approval on public.purchase_receipts;
    create trigger trg_enforce_receipt_approval
    before insert or update on public.purchase_receipts
    for each row execute function public.trg_enforce_receipt_approval();
  end if;
end $$;

do $$
begin
  if to_regclass('public.purchase_orders') is not null then
    update public.purchase_orders
    set requires_approval = false,
        approval_status = 'approved',
        approval_request_id = null;
  end if;
  if to_regclass('public.purchase_receipts') is not null then
    update public.purchase_receipts
    set requires_approval = false,
        approval_status = 'approved',
        approval_request_id = null;
  end if;
end $$;

notify pgrst, 'reload schema';
