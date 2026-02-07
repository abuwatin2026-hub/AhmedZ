set app.allow_ledger_ddl = '1';

do $$
begin
  if to_regclass('public.system_audit_logs') is null then
    return;
  end if;

  if to_regclass('public.fx_revaluation_monetary_audit') is not null or to_regclass('public.fx_revaluation_audit') is not null then
    create or replace function public.trg_log_fx_revaluation_run()
    returns trigger
    language plpgsql
    security definer
    set search_path = public
    as $fn$
    declare
      v_period text;
    begin
      if auth.uid() is null then
        return new;
      end if;
      v_period := coalesce(new.period_end::text, '');
      if v_period = '' then
        return new;
      end if;

      if not exists (
        select 1
        from public.system_audit_logs l
        where l.action = 'fx_revaluation.run'
          and l.module = 'accounting'
          and coalesce(l.metadata->>'period_end','') = v_period
        limit 1
      ) then
        insert into public.system_audit_logs(action, module, details, performed_by, performed_at, metadata)
        values (
          'fx_revaluation.run',
          'accounting',
          concat('FX revaluation run for ', v_period),
          auth.uid(),
          now(),
          jsonb_build_object('period_end', v_period)
        );
      end if;

      return new;
    end;
    $fn$;
  end if;

  if to_regclass('public.fx_revaluation_monetary_audit') is not null then
    drop trigger if exists trg_fx_revaluation_monetary_audit_log_run on public.fx_revaluation_monetary_audit;
    create trigger trg_fx_revaluation_monetary_audit_log_run
    after insert on public.fx_revaluation_monetary_audit
    for each row execute function public.trg_log_fx_revaluation_run();
  end if;

  if to_regclass('public.fx_revaluation_audit') is not null then
    drop trigger if exists trg_fx_revaluation_audit_log_run on public.fx_revaluation_audit;
    create trigger trg_fx_revaluation_audit_log_run
    after insert on public.fx_revaluation_audit
    for each row execute function public.trg_log_fx_revaluation_run();
  end if;

  if to_regclass('public.accounting_periods') is not null then
    create or replace function public.trg_log_accounting_period_closed()
    returns trigger
    language plpgsql
    security definer
    set search_path = public
    as $fn$
    begin
      if auth.uid() is null then
        return new;
      end if;
      if tg_op = 'UPDATE' and coalesce(old.status,'') is distinct from coalesce(new.status,'') and new.status = 'closed' then
        insert into public.system_audit_logs(action, module, details, performed_by, performed_at, metadata)
        values (
          'accounting_periods.close',
          'accounting',
          concat('Closed period ', coalesce(new.name,'')),
          auth.uid(),
          now(),
          jsonb_build_object('period_id', new.id::text, 'name', new.name, 'start', new.start_date, 'end', new.end_date)
        );
      end if;
      return new;
    end;
    $fn$;

    drop trigger if exists trg_accounting_periods_log_close on public.accounting_periods;
    create trigger trg_accounting_periods_log_close
    after update of status on public.accounting_periods
    for each row execute function public.trg_log_accounting_period_closed();
  end if;

  if to_regclass('public.journal_entries') is not null then
    create or replace function public.trg_log_reverse_journal_entry()
    returns trigger
    language plpgsql
    security definer
    set search_path = public
    as $fn$
    begin
      if auth.uid() is null then
        return new;
      end if;
      if coalesce(new.source_table,'') = 'journal_entries' and coalesce(new.source_event,'') = 'reversal' then
        insert into public.system_audit_logs(action, module, details, performed_by, performed_at, metadata)
        values (
          'journal_entries.reverse',
          'accounting',
          concat('Reversed journal entry ', coalesce(new.source_id,'')),
          auth.uid(),
          now(),
          jsonb_build_object('new_entry_id', new.id::text, 'reversed_entry_id', new.source_id, 'memo', new.memo)
        );
      end if;
      return new;
    end;
    $fn$;

    drop trigger if exists trg_journal_entries_log_reverse on public.journal_entries;
    create trigger trg_journal_entries_log_reverse
    after insert on public.journal_entries
    for each row execute function public.trg_log_reverse_journal_entry();
  end if;

  if to_regclass('public.app_settings') is not null then
    create or replace function public.trg_log_accounting_accounts_settings_change()
    returns trigger
    language plpgsql
    security definer
    set search_path = public
    as $fn$
    declare
      v_old jsonb;
      v_new jsonb;
    begin
      if auth.uid() is null then
        return new;
      end if;
      if tg_op <> 'UPDATE' then
        return new;
      end if;
      if new.id is distinct from 'singleton' and new.id is distinct from 'app' then
        return new;
      end if;

      v_old := coalesce(old.data->'settings'->'accounting_accounts', old.data->'accounting_accounts');
      v_new := coalesce(new.data->'settings'->'accounting_accounts', new.data->'accounting_accounts');

      if v_old is distinct from v_new then
        insert into public.system_audit_logs(action, module, details, performed_by, performed_at, metadata)
        values (
          'app_settings.accounting_accounts_update',
          'accounting',
          concat('Updated accounting_accounts in app_settings ', new.id),
          auth.uid(),
          now(),
          jsonb_build_object('settings_id', new.id, 'old', v_old, 'new', v_new)
        );
      end if;

      return new;
    end;
    $fn$;

    drop trigger if exists trg_app_settings_log_accounting_accounts_change on public.app_settings;
    create trigger trg_app_settings_log_accounting_accounts_change
    after update on public.app_settings
    for each row execute function public.trg_log_accounting_accounts_settings_change();
  end if;
end $$;

notify pgrst, 'reload schema';
