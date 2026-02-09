do $$
begin
  -- journal_entries immutable
  create or replace function public.trg_block_system_journal_entry_mutation()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
  as $$
  begin
    if coalesce(old.source_table, '') <> '' and old.source_table <> 'manual' then
      raise exception 'GL is append-only: system journal entries are immutable';
    end if;
    return coalesce(new, old);
  end;
  $$;

  drop trigger if exists trg_journal_entries_block_system_mutation on public.journal_entries;
  create trigger trg_journal_entries_block_system_mutation
  before update or delete on public.journal_entries
  for each row execute function public.trg_block_system_journal_entry_mutation();

  -- journal_lines append-only
  create or replace function public.trg_block_system_journal_lines_mutation()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
  as $$
  declare
    v_source_table text;
  begin
    select je.source_table
    into v_source_table
    from public.journal_entries je
    where je.id = coalesce(new.journal_entry_id, old.journal_entry_id);

    if coalesce(v_source_table, '') <> '' and v_source_table <> 'manual' then
      if tg_op = 'DELETE' then
        raise exception 'GL is append-only: system journal lines cannot be deleted';
      end if;
      raise exception 'GL is append-only: system journal lines cannot be changed';
    end if;

    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end;
  $$;

  drop trigger if exists trg_journal_lines_block_system_mutation on public.journal_lines;
  create trigger trg_journal_lines_block_system_mutation
  before update or delete on public.journal_lines
  for each row execute function public.trg_block_system_journal_lines_mutation();

  -- inventory movements modify/delete guard if posted
  create or replace function public.trg_forbid_modify_posted_inventory_movements()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
  as $fn$
  begin
    if exists (
      select 1
      from public.journal_entries je
      where je.source_table = 'inventory_movements'
        and je.source_id = old.id::text
      limit 1
    ) then
      raise exception 'cannot modify posted inventory movement; create reversal instead';
    end if;
    return coalesce(new, old);
  end;
  $fn$;

  drop trigger if exists trg_inventory_movements_forbid_modify_posted on public.inventory_movements;
  create trigger trg_inventory_movements_forbid_modify_posted
  before update or delete on public.inventory_movements
  for each row execute function public.trg_forbid_modify_posted_inventory_movements();
end $$;

notify pgrst, 'reload schema';

