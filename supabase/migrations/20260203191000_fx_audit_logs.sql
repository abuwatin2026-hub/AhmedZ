create or replace function public.log_fx_rates_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.system_audit_logs(action, module, details, performed_by, performed_at, metadata)
    values (
      'insert',
      'fx_rates',
      concat('Inserted FX rate ', new.currency_code, ' ', new.rate_type, ' ', new.rate_date::text, ' = ', new.rate::text),
      auth.uid(),
      now(),
      jsonb_build_object(
        'table', 'fx_rates',
        'id', new.id,
        'currency_code', new.currency_code,
        'rate_type', new.rate_type,
        'rate_date', new.rate_date,
        'rate', new.rate
      )
    );
    return new;
  elsif tg_op = 'UPDATE' then
    insert into public.system_audit_logs(action, module, details, performed_by, performed_at, metadata)
    values (
      'update',
      'fx_rates',
      concat('Updated FX rate ', new.currency_code, ' ', new.rate_type, ' ', new.rate_date::text, ' = ', new.rate::text),
      auth.uid(),
      now(),
      jsonb_build_object(
        'table', 'fx_rates',
        'id', new.id,
        'currency_code', new.currency_code,
        'rate_type', new.rate_type,
        'rate_date', new.rate_date,
        'old_rate', old.rate,
        'new_rate', new.rate
      )
    );
    return new;
  elsif tg_op = 'DELETE' then
    insert into public.system_audit_logs(action, module, details, performed_by, performed_at, metadata)
    values (
      'delete',
      'fx_rates',
      concat('Deleted FX rate ', old.currency_code, ' ', old.rate_type, ' ', old.rate_date::text),
      auth.uid(),
      now(),
      jsonb_build_object(
        'table', 'fx_rates',
        'id', old.id,
        'currency_code', old.currency_code,
        'rate_type', old.rate_type,
        'rate_date', old.rate_date,
        'rate', old.rate
      )
    );
    return old;
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_fx_rates_audit on public.fx_rates;
create trigger trg_fx_rates_audit
after insert or update or delete on public.fx_rates
for each row execute function public.log_fx_rates_changes();

create or replace function public.log_currencies_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.system_audit_logs(action, module, details, performed_by, performed_at, metadata)
    values (
      'insert',
      'currencies',
      concat('Inserted currency ', new.code),
      auth.uid(),
      now(),
      jsonb_build_object('table','currencies','code',new.code,'is_base',new.is_base,'is_high_inflation',new.is_high_inflation)
    );
    return new;
  elsif tg_op = 'UPDATE' then
    insert into public.system_audit_logs(action, module, details, performed_by, performed_at, metadata)
    values (
      'update',
      'currencies',
      concat('Updated currency ', new.code),
      auth.uid(),
      now(),
      jsonb_build_object(
        'table','currencies',
        'code',new.code,
        'old_is_base',old.is_base,
        'new_is_base',new.is_base,
        'old_is_high_inflation',old.is_high_inflation,
        'new_is_high_inflation',new.is_high_inflation
      )
    );
    return new;
  elsif tg_op = 'DELETE' then
    insert into public.system_audit_logs(action, module, details, performed_by, performed_at, metadata)
    values (
      'delete',
      'currencies',
      concat('Deleted currency ', old.code),
      auth.uid(),
      now(),
      jsonb_build_object('table','currencies','code',old.code,'is_base',old.is_base,'is_high_inflation',old.is_high_inflation)
    );
    return old;
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_currencies_audit on public.currencies;
create trigger trg_currencies_audit
after insert or update or delete on public.currencies
for each row execute function public.log_currencies_changes();

notify pgrst, 'reload schema';
