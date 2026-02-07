do $$
declare
  v_tables text[] := array[
    'public.menu_items',
    'public.suppliers',
    'public.purchase_orders',
    'public.purchase_receipts',
    'public.inventory_movements',
    'public.stock_management',
    'public.batches',
    'public.orders',
    'public.payments',
    'public.journal_entries',
    'public.journal_lines',
    'public.accounting_documents',
    'public.ar_open_items',
    'public.ledger_entries',
    'public.cod_settlements',
    'public.payroll_employees',
    'public.payroll_runs',
    'public.customers'
  ];
  v_t text;
  v_cnt bigint;
begin
  create temporary table if not exists tmp_handover_counts(
    table_name text primary key,
    row_count bigint not null
  ) on commit drop;

  foreach v_t in array v_tables loop
    if to_regclass(v_t) is not null then
      execute 'select count(*) from ' || v_t into v_cnt;
      insert into tmp_handover_counts(table_name, row_count)
      values (v_t, coalesce(v_cnt, 0))
      on conflict (table_name) do update set row_count = excluded.row_count;
    end if;
  end loop;
end $$;

select *
from tmp_handover_counts
order by row_count desc, table_name asc;

