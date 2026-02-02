do $$
begin
  if to_regclass('public.purchase_orders') is null then
    return;
  end if;

  begin
    alter table public.purchase_orders
      add column po_number text;
  exception when duplicate_column then
    null;
  end;

  begin
    create sequence if not exists public.purchase_order_number_seq;
  exception when others then
    null;
  end;

  create or replace function public._assign_po_number(p_date date)
  returns text
  language plpgsql
  security definer
  set search_path = public
  as $fn$
  declare
    v_seq bigint;
    v_date date;
  begin
    v_date := coalesce(p_date, current_date);
    v_seq := nextval('public.purchase_order_number_seq'::regclass);
    return concat('PO-', to_char(v_date, 'YYMMDD'), '-', lpad(v_seq::text, 6, '0'));
  end
  $fn$;

  create or replace function public._trg_purchase_orders_po_number()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
  as $fn$
  begin
    if new.po_number is null or length(trim(new.po_number)) = 0 then
      new.po_number := public._assign_po_number(new.purchase_date);
    end if;
    if new.reference_number is not null and length(trim(new.reference_number)) = 0 then
      new.reference_number := null;
    end if;
    return new;
  end
  $fn$;

  drop trigger if exists trg_purchase_orders_po_number on public.purchase_orders;
  create trigger trg_purchase_orders_po_number
  before insert or update on public.purchase_orders
  for each row execute function public._trg_purchase_orders_po_number();

  update public.purchase_orders
  set po_number = public._assign_po_number(purchase_date)
  where po_number is null or length(trim(po_number)) = 0;

  begin
    alter table public.purchase_orders
      alter column po_number set not null;
  exception when others then
    null;
  end;

  create unique index if not exists idx_purchase_orders_po_number_unique
    on public.purchase_orders(po_number);
end $$;

