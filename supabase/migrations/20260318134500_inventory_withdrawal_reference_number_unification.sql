set app.allow_ledger_ddl = '1';

alter table if exists public.inventory_withdrawal_requests
  add column if not exists reference_number text;

do $$
declare
  v_has_request_number boolean;
begin
  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'inventory_withdrawal_requests'
      and column_name = 'request_number'
  )
  into v_has_request_number;

  if v_has_request_number then
    execute $q$
      update public.inventory_withdrawal_requests
      set reference_number = nullif(btrim(request_number), '')
      where (reference_number is null or btrim(reference_number) = '')
        and request_number is not null
    $q$;
  end if;
end;
$$;

update public.inventory_withdrawal_requests
set reference_number = 'WD-' || to_char(now(), 'YYYYMMDD-') || upper(substring(gen_random_uuid()::text, 1, 6))
where reference_number is null or btrim(reference_number) = '';

alter table public.inventory_withdrawal_requests
  alter column reference_number set default ('WD-' || to_char(now(), 'YYYYMMDD-') || upper(substring(gen_random_uuid()::text, 1, 6)));

alter table public.inventory_withdrawal_requests
  alter column reference_number set not null;

create unique index if not exists uq_inventory_withdrawal_requests_reference_number
  on public.inventory_withdrawal_requests(reference_number);

do $$
declare
  v_has_request_number boolean;
begin
  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'inventory_withdrawal_requests'
      and column_name = 'request_number'
  )
  into v_has_request_number;

  if v_has_request_number then
    execute $fn$
      create or replace function public.trg_sync_inventory_withdrawal_numbers()
      returns trigger
      language plpgsql
      as $b$
      begin
        if new.reference_number is null or btrim(new.reference_number) = '' then
          new.reference_number := nullif(btrim(new.request_number), '');
        end if;
        if (new.reference_number is null or btrim(new.reference_number) = '') then
          new.reference_number := 'WD-' || to_char(now(), 'YYYYMMDD-') || upper(substring(gen_random_uuid()::text, 1, 6));
        end if;
        if new.request_number is null or btrim(new.request_number) = '' then
          new.request_number := new.reference_number;
        end if;
        return new;
      end;
      $b$;
    $fn$;

    drop trigger if exists trg_sync_inventory_withdrawal_numbers
      on public.inventory_withdrawal_requests;

    create trigger trg_sync_inventory_withdrawal_numbers
    before insert or update of reference_number, request_number
    on public.inventory_withdrawal_requests
    for each row
    execute function public.trg_sync_inventory_withdrawal_numbers();

    execute $q$
      update public.inventory_withdrawal_requests
      set request_number = reference_number
      where request_number is null or btrim(request_number) = ''
    $q$;
  end if;
end;
$$;

notify pgrst, 'reload schema';
