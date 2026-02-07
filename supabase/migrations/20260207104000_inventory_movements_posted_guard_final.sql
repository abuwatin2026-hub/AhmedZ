do $$
begin
  if to_regclass('public.inventory_movements') is null then
    return;
  end if;

  drop trigger if exists trg_inventory_movements_forbid_delete_posted on public.inventory_movements;
  drop trigger if exists trg_inventory_movements_forbid_modify_posted on public.inventory_movements;

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

  create trigger trg_inventory_movements_forbid_modify_posted
  before update or delete on public.inventory_movements
  for each row execute function public.trg_forbid_modify_posted_inventory_movements();
end $$;

notify pgrst, 'reload schema';
