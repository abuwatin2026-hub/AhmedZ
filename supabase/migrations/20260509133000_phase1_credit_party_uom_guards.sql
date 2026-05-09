set app.allow_ledger_ddl = '1';

create or replace function public._is_credit_order_row(p_order public.orders)
returns boolean
language sql
stable
as $$
  select (
    coalesce(p_order.payment_method, '') = 'ar'
    or lower(coalesce(p_order.data->>'isCreditSale', 'false')) in ('true', '1', 'yes')
  );
$$;

revoke all on function public._is_credit_order_row(public.orders) from public;
grant execute on function public._is_credit_order_row(public.orders) to authenticated;

create or replace function public.enforce_credit_order_party_id()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public._is_credit_order_row(new) and new.party_id is null then
    raise exception 'credit order requires party_id';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_orders_enforce_credit_party_id on public.orders;
create trigger trg_orders_enforce_credit_party_id
before insert or update on public.orders
for each row execute function public.enforce_credit_order_party_id();

create or replace function public.enforce_credit_order_party_before_posting()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
begin
  if new.source_table = 'orders' and new.source_event in ('invoiced', 'delivered') then
    select *
    into v_order
    from public.orders o
    where o.id = nullif(new.source_id, '')::uuid;

    if found and public._is_credit_order_row(v_order) and v_order.party_id is null then
      raise exception 'cannot post credit order without party_id (order=%)', v_order.id;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_journal_entries_enforce_credit_party_before_posting on public.journal_entries;
create trigger trg_journal_entries_enforce_credit_party_before_posting
before insert on public.journal_entries
for each row execute function public.enforce_credit_order_party_before_posting();

create or replace function public.backfill_party_ledger_for_credit_orders()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_line record;
  v_curr text;
  v_dir text;
  v_amt numeric;
  v_prev numeric;
  v_delta numeric;
  v_lock_key bigint;
  v_inserted integer := 0;
begin
  for v_line in
    select
      o.party_id,
      je.id as journal_entry_id,
      je.entry_date,
      jl.id as journal_line_id,
      jl.account_id,
      jl.debit,
      jl.credit,
      jl.currency_code,
      jl.fx_rate,
      jl.foreign_amount
    from public.orders o
    join public.journal_entries je
      on je.source_table = 'orders'
     and je.source_id = o.id::text
     and je.source_event in ('invoiced', 'delivered')
    join public.journal_lines jl
      on jl.journal_entry_id = je.id
    join public.party_subledger_accounts psa
      on psa.account_id = jl.account_id
     and psa.is_active = true
    where o.status = 'delivered'
      and public._is_credit_order_row(o)
      and o.party_id is not null
      and coalesce(je.status, 'posted') = 'posted'
      and not exists (
        select 1
        from public.party_ledger_entries ple
        where ple.journal_line_id = jl.id
      )
    order by je.entry_date asc, jl.id asc
  loop
    v_dir := case when coalesce(v_line.debit, 0) > 0 then 'debit' else 'credit' end;
    v_amt := greatest(coalesce(v_line.debit, 0), coalesce(v_line.credit, 0));
    if v_amt <= 0 then
      continue;
    end if;

    v_curr := upper(nullif(btrim(coalesce(v_line.currency_code, '')), ''));
    if v_curr is null then
      v_curr := public.get_base_currency();
    end if;

    v_lock_key := hashtextextended(v_line.party_id::text || '|' || v_line.account_id::text || '|' || v_curr, 0);
    perform pg_advisory_xact_lock(v_lock_key);

    select ple.running_balance
    into v_prev
    from public.party_ledger_entries ple
    where ple.party_id = v_line.party_id
      and ple.account_id = v_line.account_id
      and ple.currency_code = v_curr
    order by ple.occurred_at desc, ple.created_at desc, ple.id desc
    limit 1;

    v_delta := public._party_ledger_delta(v_line.account_id, v_dir, v_amt);

    insert into public.party_ledger_entries(
      party_id, account_id, journal_entry_id, journal_line_id,
      occurred_at, direction, foreign_amount, base_amount, currency_code, fx_rate, running_balance
    )
    values (
      v_line.party_id,
      v_line.account_id,
      v_line.journal_entry_id,
      v_line.journal_line_id,
      v_line.entry_date,
      v_dir,
      v_line.foreign_amount,
      v_amt,
      v_curr,
      v_line.fx_rate,
      coalesce(v_prev, 0) + coalesce(v_delta, 0)
    )
    on conflict (journal_line_id) do nothing;

    if found then
      v_inserted := v_inserted + 1;
    end if;
  end loop;

  return v_inserted;
end;
$$;

revoke all on function public.backfill_party_ledger_for_credit_orders() from public;
revoke execute on function public.backfill_party_ledger_for_credit_orders() from anon;
grant execute on function public.backfill_party_ledger_for_credit_orders() to authenticated;

create or replace function public.phase1_credit_party_uom_backfill()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated_party integer := 0;
  v_unresolved_party integer := 0;
  v_ledger_backfilled integer := 0;
  v_uom_backfilled integer := 0;
begin
  update public.orders o
  set party_id = fpl.party_id
  from public.financial_party_links fpl
  where o.status = 'delivered'
    and public._is_credit_order_row(o)
    and o.party_id is null
    and o.customer_auth_user_id is not null
    and fpl.role = 'customer'
    and fpl.linked_entity_type = 'customers'
    and fpl.linked_entity_id = o.customer_auth_user_id::text;
  get diagnostics v_updated_party = row_count;

  select count(*)
  into v_unresolved_party
  from public.orders o
  where o.status = 'delivered'
    and public._is_credit_order_row(o)
    and o.party_id is null;

  if v_unresolved_party > 0 then
    raise exception 'credit delivered orders still missing party_id: %', v_unresolved_party;
  end if;

  v_ledger_backfilled := public.backfill_party_ledger_for_credit_orders();

  begin
    alter table public.inventory_movements disable trigger user;
  exception when others then
    null;
  end;

  begin
    update public.inventory_movements im
    set
      uom_id = coalesce(
        im.uom_id,
        iu.sales_uom_id,
        iu.base_uom_id,
        u_code.id,
        u_name.id
      ),
      qty_base = coalesce(im.qty_base, im.quantity)
    from public.menu_items mi
    left join public.item_uom iu
      on iu.item_id = mi.id
    left join public.uom u_code
      on u_code.code = mi.base_unit
    left join public.uom u_name
      on u_name.name = mi.base_unit
    where im.movement_type = 'sale_out'
      and im.item_id = mi.id
      and (im.uom_id is null or im.qty_base is null);
    get diagnostics v_uom_backfilled = row_count;
  exception when others then
    begin
      alter table public.inventory_movements enable trigger user;
    exception when others then
      null;
    end;
    raise;
  end;

  begin
    alter table public.inventory_movements enable trigger user;
  exception when others then
    null;
  end;

  return jsonb_build_object(
    'updated_credit_orders_party_id', v_updated_party,
    'unresolved_credit_orders_party_id', v_unresolved_party,
    'credit_order_entries_party_ledger_backfilled', v_ledger_backfilled,
    'sale_out_uom_or_qtybase_backfilled', v_uom_backfilled
  );
end;
$$;

revoke all on function public.phase1_credit_party_uom_backfill() from public;
revoke execute on function public.phase1_credit_party_uom_backfill() from anon;
grant execute on function public.phase1_credit_party_uom_backfill() to authenticated;

alter table public.inventory_movements
  drop constraint if exists ck_inventory_sale_out_uom_qtybase;

alter table public.inventory_movements
  add constraint ck_inventory_sale_out_uom_qtybase
  check (
    movement_type <> 'sale_out'
    or (
      uom_id is not null
      and coalesce(qty_base, 0) > 0
    )
  ) not valid;

select public.phase1_credit_party_uom_backfill();

alter table public.inventory_movements
  validate constraint ck_inventory_sale_out_uom_qtybase;

select pg_sleep(0.5);
notify pgrst, 'reload schema';
