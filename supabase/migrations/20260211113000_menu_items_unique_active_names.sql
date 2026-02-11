set app.allow_ledger_ddl = '1';

create unique index if not exists menu_items_active_name_ar_uniq
on public.menu_items (lower(btrim(coalesce(name->>'ar',''))))
where status = 'active'
  and btrim(coalesce(name->>'ar','')) <> '';

create unique index if not exists menu_items_active_name_en_uniq
on public.menu_items (lower(btrim(coalesce(name->>'en',''))))
where status = 'active'
  and btrim(coalesce(name->>'en','')) <> '';

notify pgrst, 'reload schema';
