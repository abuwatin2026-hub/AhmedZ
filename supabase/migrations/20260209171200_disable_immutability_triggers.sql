do $$
begin
  if to_regclass('public.journal_lines') is not null then
    drop trigger if exists trg_journal_lines_block_system_mutation on public.journal_lines;
  end if;
  if to_regclass('public.journal_entries') is not null then
    drop trigger if exists trg_journal_entries_block_system_mutation on public.journal_entries;
  end if;
  if to_regclass('public.inventory_movements') is not null then
    drop trigger if exists trg_inventory_movements_forbid_modify_posted on public.inventory_movements;
  end if;
end $$;

notify pgrst, 'reload schema';

