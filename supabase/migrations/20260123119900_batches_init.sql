-- المرحلة 0–1: إنشاء جدول الدُفعات المستقل + Backfill + View أرصدة الدُفعات
-- دون أي تعديل على RPC الحالية

-- 1) جدول الدُفعات
create table if not exists public.batches (
  id uuid primary key,
  item_id text not null references public.menu_items(id) on delete cascade,
  receipt_item_id uuid references public.purchase_receipt_items(id) on delete set null,
  receipt_id uuid references public.purchase_receipts(id) on delete set null,
  warehouse_id uuid references public.warehouses(id) on delete set null,
  batch_code text,
  production_date date,
  expiry_date date,
  quantity_received numeric not null check (quantity_received >= 0),
  quantity_consumed numeric not null default 0 check (quantity_consumed >= 0),
  unit_cost numeric not null default 0,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint batches_qty_consistency check (quantity_consumed <= quantity_received),
  constraint batches_dates_consistency check (production_date is null or expiry_date is null or expiry_date >= production_date)
);

create index if not exists idx_batches_item_expiry on public.batches(item_id, expiry_date);
create index if not exists idx_batches_wh_item on public.batches(warehouse_id, item_id);
create index if not exists idx_batches_remaining on public.batches((quantity_received - quantity_consumed));

-- Trigger updated_at (تفترض وجود public.set_updated_at)
drop trigger if exists trg_batches_updated_at on public.batches;
create trigger trg_batches_updated_at
  before update on public.batches
  for each row
  execute function public.set_updated_at();

-- RLS بسيط: قراءة عامة، إدارة للمسؤولين
alter table public.batches enable row level security;
do $$
begin
  begin drop policy if exists batches_select_all on public.batches; exception when undefined_object then null; end;
  begin drop policy if exists batches_manage_admin on public.batches; exception when undefined_object then null; end;
end $$;
create policy batches_select_all on public.batches for select using (true);
create policy batches_manage_admin on public.batches for all using (public.is_admin()) with check (public.is_admin());


-- 2) دالة Backfill من حركات الشراء (purchase_in) إلى جدول الدُفعات
create or replace function public.backfill_batches_from_movements()
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted int := 0;
  v_updated int := 0;
  v_default_wh uuid;
  v_im record;
  v_receipt_id uuid;
  v_receipt_item_id uuid;
  v_expiry date;
  v_production date;
  v_wh uuid;
  v_consumed numeric;
begin
  -- تحديد مخزن افتراضي عند الحاجة
  if to_regclass('public.warehouses') is not null then
    select w.id
    into v_default_wh
    from public.warehouses w
    where w.is_active = true
    order by (upper(coalesce(w.code,''))='MAIN') desc, w.code asc
    limit 1;
  else
    v_default_wh := null;
  end if;

  for v_im in
    select *
    from public.inventory_movements im
    where im.movement_type = 'purchase_in'
      and im.batch_id is not null
  loop
    v_receipt_id := null;
    v_receipt_item_id := null;
    v_wh := coalesce(
      v_im.warehouse_id,
      case
        when (v_im.data ? 'warehouseId') and (v_im.data->>'warehouseId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          then (v_im.data->>'warehouseId')::uuid
        else v_default_wh
      end
    );

    -- receipt_id من reference أو من data
    if coalesce(v_im.reference_table,'') = 'purchase_receipts' then
      begin
        if coalesce(v_im.reference_id,'') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
          v_receipt_id := v_im.reference_id::uuid;
        end if;
      exception when others then
        v_receipt_id := null;
      end;
    end if;
    if v_receipt_id is null and (v_im.data ? 'purchaseReceiptId') then
      begin
        v_receipt_id := (v_im.data->>'purchaseReceiptId')::uuid;
      exception when others then
        v_receipt_id := null;
      end;
    end if;

    if v_receipt_id is not null then
      select pri.id
      into v_receipt_item_id
      from public.purchase_receipt_items pri
      where pri.receipt_id = v_receipt_id
        and pri.item_id = v_im.item_id
      limit 1;
    end if;

    -- تواريخ الصلاحية/الإنتاج
    v_expiry := null;
    v_production := null;
    if (v_im.data ? 'expiryDate') and (v_im.data->>'expiryDate') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
      v_expiry := (v_im.data->>'expiryDate')::date;
    end if;
    if (v_im.data ? 'harvestDate') and (v_im.data->>'harvestDate') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
      v_production := (v_im.data->>'harvestDate')::date;
    end if;

    -- كمية مستهلكة من الحركات الخارجة
    select coalesce(sum(im2.quantity), 0)
    into v_consumed
    from public.inventory_movements im2
    where im2.batch_id = v_im.batch_id
      and im2.movement_type in ('sale_out','wastage_out','adjust_out','return_out','transfer_out');

    if exists (select 1 from public.batches b where b.id = v_im.batch_id) then
      update public.batches
      set item_id = v_im.item_id,
          receipt_item_id = v_receipt_item_id,
          receipt_id = v_receipt_id,
          warehouse_id = v_wh,
          unit_cost = v_im.unit_cost,
          quantity_received = v_im.quantity,
          quantity_consumed = least(greatest(v_consumed, 0), v_im.quantity),
          expiry_date = coalesce(v_expiry, expiry_date),
          production_date = coalesce(v_production, production_date),
          data = coalesce(data, '{}'::jsonb) || jsonb_build_object('source','backfill')
      where id = v_im.batch_id;
      v_updated := v_updated + 1;
    else
      insert into public.batches(
        id, item_id, receipt_item_id, receipt_id, warehouse_id,
        batch_code, production_date, expiry_date,
        quantity_received, quantity_consumed, unit_cost, data
      )
      values (
        v_im.batch_id, v_im.item_id, v_receipt_item_id, v_receipt_id, v_wh,
        null, v_production, v_expiry,
        v_im.quantity, least(greatest(v_consumed,0), v_im.quantity), v_im.unit_cost,
        jsonb_build_object('source','backfill')
      );
      v_inserted := v_inserted + 1;
    end if;
  end loop;

  return json_build_object('inserted', v_inserted, 'updated', v_updated);
end;
$$;


-- 3) View أرصدة الدُفعات من جدول batches
create or replace view public.v_batch_balances as
select
  b.item_id,
  b.id as batch_id,
  b.warehouse_id,
  b.expiry_date,
  greatest(coalesce(b.quantity_received,0) - coalesce(b.quantity_consumed,0), 0) as remaining_qty
from public.batches b;

drop view if exists public.v_food_batch_balances;
create view public.v_food_batch_balances as
select
  b.item_id,
  b.id as batch_id,
  b.warehouse_id,
  b.expiry_date,
  coalesce(b.quantity_received, 0) as received_qty,
  coalesce(b.quantity_consumed, 0) as consumed_qty,
  greatest(coalesce(b.quantity_received,0) - coalesce(b.quantity_consumed,0), 0) as remaining_qty
from public.batches b
where b.id is not null;


-- 4) تنفيذ Backfill الآن
select public.backfill_batches_from_movements();
