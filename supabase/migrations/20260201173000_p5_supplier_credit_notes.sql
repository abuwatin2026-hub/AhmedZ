create table if not exists public.supplier_credit_notes (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers(id) on delete restrict,
  reference_purchase_receipt_id uuid not null references public.purchase_receipts(id) on delete restrict,
  amount numeric not null check (amount > 0),
  reason text,
  status text not null default 'draft' check (status in ('draft','applied','cancelled')),
  created_by uuid references auth.users(id) on delete set null,
  applied_at timestamptz,
  journal_entry_id uuid references public.journal_entries(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_supplier_credit_notes_supplier on public.supplier_credit_notes(supplier_id, created_at desc);
create index if not exists idx_supplier_credit_notes_receipt on public.supplier_credit_notes(reference_purchase_receipt_id, created_at desc);

create table if not exists public.supplier_credit_note_allocations (
  id uuid primary key default gen_random_uuid(),
  credit_note_id uuid not null references public.supplier_credit_notes(id) on delete cascade,
  root_batch_id uuid not null references public.batches(id) on delete restrict,
  affected_batch_id uuid references public.batches(id) on delete restrict,
  receipt_id uuid not null references public.purchase_receipts(id) on delete restrict,
  amount_total numeric not null default 0,
  amount_to_inventory numeric not null default 0,
  amount_to_cogs numeric not null default 0,
  batch_qty_received numeric not null default 0,
  batch_qty_onhand numeric not null default 0,
  batch_qty_sold numeric not null default 0,
  unit_cost_before numeric not null default 0,
  unit_cost_after numeric not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_supplier_credit_note_allocations_note on public.supplier_credit_note_allocations(credit_note_id, created_at desc);
create index if not exists idx_supplier_credit_note_allocations_batch on public.supplier_credit_note_allocations(affected_batch_id);

alter table public.supplier_credit_notes enable row level security;
alter table public.supplier_credit_note_allocations enable row level security;

drop policy if exists supplier_credit_notes_admin_all on public.supplier_credit_notes;
create policy supplier_credit_notes_admin_all on public.supplier_credit_notes
  for all using (public.has_admin_permission('accounting.manage')) with check (public.has_admin_permission('accounting.manage'));

drop policy if exists supplier_credit_note_allocations_admin_all on public.supplier_credit_note_allocations;
create policy supplier_credit_note_allocations_admin_all on public.supplier_credit_note_allocations
  for all using (public.has_admin_permission('accounting.manage')) with check (public.has_admin_permission('accounting.manage'));

do $$
begin
  if to_regclass('public.set_updated_at') is not null then
    drop trigger if exists trg_supplier_credit_notes_updated_at on public.supplier_credit_notes;
    create trigger trg_supplier_credit_notes_updated_at
    before update on public.supplier_credit_notes
    for each row execute function public.set_updated_at();
  end if;
end $$;

create or replace function public.apply_supplier_credit_note(p_credit_note_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_note record;
  v_ap uuid;
  v_inv uuid;
  v_cogs uuid;
  v_total_amount numeric;
  v_je uuid;
  v_roots_total_received numeric := 0;
  v_root record;
  v_root_share numeric;
  v_chain_onhand numeric;
  v_inventory_part numeric;
  v_cogs_part numeric;
  v_batch record;
  v_batch_credit numeric;
  v_new_cost numeric;
  v_line record;
begin
  perform public._require_staff('apply_supplier_credit_note');
  if not (auth.role() = 'service_role' or public.has_admin_permission('accounting.manage')) then
    raise exception 'not authorized';
  end if;
  if p_credit_note_id is null then
    raise exception 'p_credit_note_id is required';
  end if;

  select *
  into v_note
  from public.supplier_credit_notes n
  where n.id = p_credit_note_id
  for update;
  if not found then
    raise exception 'supplier credit note not found';
  end if;
  if v_note.status = 'applied' then
    return;
  end if;
  if v_note.status = 'cancelled' then
    raise exception 'credit note is cancelled';
  end if;

  v_total_amount := coalesce(v_note.amount, 0);
  if v_total_amount <= 0 then
    raise exception 'invalid amount';
  end if;

  v_ap := public.get_account_id_by_code('2010');
  v_inv := public.get_account_id_by_code('1410');
  v_cogs := public.get_account_id_by_code('5010');
  if v_ap is null or v_inv is null or v_cogs is null then
    raise exception 'required accounts missing';
  end if;

  select coalesce(sum(coalesce(b.quantity_received,0)),0)
  into v_roots_total_received
  from public.batches b
  where b.receipt_id = v_note.reference_purchase_receipt_id;

  if v_roots_total_received <= 0 then
    raise exception 'no batches for receipt';
  end if;

  insert into public.journal_entries(entry_date, memo, source_table, source_id, source_event, created_by, status)
  values (
    now(),
    concat('Supplier credit note ', v_note.id::text),
    'supplier_credit_notes',
    v_note.id::text,
    'applied',
    auth.uid(),
    'posted'
  )
  on conflict (source_table, source_id, source_event)
  do update set entry_date = excluded.entry_date, memo = excluded.memo
  returning id into v_je;

  delete from public.journal_lines jl where jl.journal_entry_id = v_je;

  delete from public.supplier_credit_note_allocations a where a.credit_note_id = v_note.id;

  v_inventory_part := 0;
  v_cogs_part := 0;

  for v_root in
    select
      b.id as root_batch_id,
      b.item_id,
      b.quantity_received,
      b.cost_per_unit,
      b.unit_cost
    from public.batches b
    where b.receipt_id = v_note.reference_purchase_receipt_id
    order by b.created_at asc, b.id asc
  loop
    v_root_share := v_total_amount * (coalesce(v_root.quantity_received,0) / v_roots_total_received);

    with recursive chain as (
      select b.id
      from public.batches b
      where b.id = v_root.root_batch_id
      union all
      select b2.id
      from public.batches b2
      join chain c on (b2.data->>'sourceBatchId')::uuid = c.id
      where b2.data ? 'sourceBatchId'
    )
    select coalesce(sum(greatest(coalesce(b.quantity_received,0) - coalesce(b.quantity_consumed,0) - coalesce(b.quantity_transferred,0), 0)), 0)
    into v_chain_onhand
    from chain c
    join public.batches b on b.id = c.id;

    if coalesce(v_root.quantity_received,0) <= 0 then
      continue;
    end if;

    v_inventory_part := v_inventory_part + (v_root_share * (greatest(coalesce(v_chain_onhand,0),0) / coalesce(v_root.quantity_received,0)));
    v_cogs_part := v_cogs_part + (v_root_share - (v_root_share * (greatest(coalesce(v_chain_onhand,0),0) / coalesce(v_root.quantity_received,0))));

    insert into public.supplier_credit_note_allocations(
      credit_note_id,
      root_batch_id,
      affected_batch_id,
      receipt_id,
      amount_total,
      amount_to_inventory,
      amount_to_cogs,
      batch_qty_received,
      batch_qty_onhand,
      batch_qty_sold,
      unit_cost_before,
      unit_cost_after
    )
    values (
      v_note.id,
      v_root.root_batch_id,
      v_root.root_batch_id,
      v_note.reference_purchase_receipt_id,
      v_root_share,
      v_root_share * (greatest(coalesce(v_chain_onhand,0),0) / coalesce(v_root.quantity_received,0)),
      v_root_share - (v_root_share * (greatest(coalesce(v_chain_onhand,0),0) / coalesce(v_root.quantity_received,0))),
      coalesce(v_root.quantity_received,0),
      greatest(coalesce(v_chain_onhand,0),0),
      greatest(coalesce(v_root.quantity_received,0) - greatest(coalesce(v_chain_onhand,0),0), 0),
      coalesce(v_root.cost_per_unit, v_root.unit_cost, 0),
      coalesce(v_root.cost_per_unit, v_root.unit_cost, 0)
    );

    if coalesce(v_chain_onhand,0) <= 0 then
      continue;
    end if;

    for v_batch in
      with recursive chain as (
        select b.id
        from public.batches b
        where b.id = v_root.root_batch_id
        union all
        select b2.id
        from public.batches b2
        join chain c on (b2.data->>'sourceBatchId')::uuid = c.id
        where b2.data ? 'sourceBatchId'
      )
      select
        b.id as batch_id,
        b.cost_per_unit,
        b.unit_cost,
        greatest(coalesce(b.quantity_received,0) - coalesce(b.quantity_consumed,0) - coalesce(b.quantity_transferred,0), 0) as remaining
      from chain c
      join public.batches b on b.id = c.id
      where greatest(coalesce(b.quantity_received,0) - coalesce(b.quantity_consumed,0) - coalesce(b.quantity_transferred,0), 0) > 0
      for update
    loop
      v_batch_credit :=
        (v_root_share * (v_chain_onhand / coalesce(v_root.quantity_received,0))) * (v_batch.remaining / v_chain_onhand);

      v_new_cost := greatest(0, coalesce(v_batch.cost_per_unit, v_batch.unit_cost, 0) - (v_batch_credit / v_batch.remaining));

      update public.batches
      set cost_per_unit = v_new_cost,
          unit_cost = v_new_cost
      where id = v_batch.batch_id;

      insert into public.supplier_credit_note_allocations(
        credit_note_id,
        root_batch_id,
        affected_batch_id,
        receipt_id,
        amount_total,
        amount_to_inventory,
        amount_to_cogs,
        batch_qty_received,
        batch_qty_onhand,
        batch_qty_sold,
        unit_cost_before,
        unit_cost_after
      )
      values (
        v_note.id,
        v_root.root_batch_id,
        v_batch.batch_id,
        v_note.reference_purchase_receipt_id,
        v_root_share,
        v_batch_credit,
        0,
        coalesce(v_root.quantity_received,0),
        v_batch.remaining,
        0,
        coalesce(v_batch.cost_per_unit, v_batch.unit_cost, 0),
        v_new_cost
      );
    end loop;
  end loop;

  v_inventory_part := public._money_round(v_inventory_part);
  v_cogs_part := public._money_round(v_cogs_part);

  if v_inventory_part + v_cogs_part > v_total_amount + 0.01 then
    raise exception 'allocation exceeded amount';
  end if;

  insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
  values (v_je, v_ap, v_total_amount, 0, 'Supplier credit note');

  if v_inventory_part > 0 then
    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
    values (v_je, v_inv, 0, v_inventory_part, 'Reduce inventory cost');
  end if;
  if v_cogs_part > 0 then
    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
    values (v_je, v_cogs, 0, v_cogs_part, 'Reduce COGS');
  end if;

  update public.supplier_credit_notes
  set status = 'applied',
      applied_at = now(),
      journal_entry_id = v_je,
      updated_at = now()
  where id = v_note.id;
end;
$$;

revoke all on function public.apply_supplier_credit_note(uuid) from public;
revoke execute on function public.apply_supplier_credit_note(uuid) from anon;
grant execute on function public.apply_supplier_credit_note(uuid) to authenticated;

select pg_sleep(0.5);
notify pgrst, 'reload schema';
