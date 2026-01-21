create index if not exists idx_journal_entries_entry_date on public.journal_entries(entry_date);
create index if not exists idx_journal_entries_source_table_entry_date on public.journal_entries(source_table, entry_date);
create index if not exists idx_orders_status_updated_at on public.orders(status, updated_at);
create index if not exists idx_payments_ref_dir_occurred_at on public.payments(reference_table, direction, occurred_at);
create index if not exists idx_coa_code_active on public.chart_of_accounts(code, is_active);
