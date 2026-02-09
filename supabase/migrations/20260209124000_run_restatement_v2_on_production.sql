set request.jwt.claim.role = 'service_role';
set request.jwt.claims = '{"role":"service_role"}';
set app.allow_ledger_ddl = '1';

do $$
declare
  v_lock_at timestamptz;
  v_lock_date date;
  v_min_date date;
  v_batch_no int := 0;
  v_max_batches int := 10000;
  v_batch_size int := 20;
  v_row record;
  v_before_debit numeric;
  v_before_credit numeric;
  v_after_debit numeric;
  v_after_credit numeric;
begin
  select locked_at into v_lock_at
  from public.base_currency_restatement_state
  where id = 'sar_base_lock'
  limit 1;

  if v_lock_at is null then
    raise exception 'missing base_currency_restatement_state.sar_base_lock';
  end if;

  v_lock_date := v_lock_at::date;
  select min(entry_date)::date into v_min_date from public.journal_entries;
  if v_min_date is null then
    return;
  end if;

  if to_regclass('public.base_currency_restatement_batch_audit_v2') is null then
    create table public.base_currency_restatement_batch_audit_v2 (
      id uuid primary key default gen_random_uuid(),
      batch_no int not null,
      batch_id uuid,
      lock_date date not null,
      range_start date not null,
      range_end date not null,
      processed int not null,
      restated int not null,
      skipped int not null,
      settlements_created int not null,
      debit_before numeric,
      credit_before numeric,
      debit_after numeric,
      credit_after numeric,
      created_at timestamptz not null default now()
    );
    create index if not exists idx_base_currency_restatement_batch_audit_v2_batch_no on public.base_currency_restatement_batch_audit_v2(batch_no);
  end if;

  loop
    v_batch_no := v_batch_no + 1;
    if v_batch_no > v_max_batches then
      raise exception 'restatement v2 max batches exceeded';
    end if;

    select
      coalesce(sum(coalesce(jl.debit,0)),0),
      coalesce(sum(coalesce(jl.credit,0)),0)
    into v_before_debit, v_before_credit
    from public.journal_entries je
    join public.journal_lines jl on jl.journal_entry_id = je.id
    where je.entry_date::date >= v_min_date
      and je.entry_date::date <= v_lock_date;

    select *
    into v_row
    from public.run_base_currency_historical_restatement_v2b(v_batch_size, v_lock_at)
    limit 1;

    select
      coalesce(sum(coalesce(jl.debit,0)),0),
      coalesce(sum(coalesce(jl.credit,0)),0)
    into v_after_debit, v_after_credit
    from public.journal_entries je
    join public.journal_lines jl on jl.journal_entry_id = je.id
    where je.entry_date::date >= v_min_date
      and je.entry_date::date <= v_lock_date;

    insert into public.base_currency_restatement_batch_audit_v2(
      batch_no,
      batch_id,
      lock_date,
      range_start,
      range_end,
      processed,
      restated,
      skipped,
      settlements_created,
      debit_before,
      credit_before,
      debit_after,
      credit_after
    )
    values (
      v_batch_no,
      v_row.batch_id,
      v_lock_date,
      v_min_date,
      v_lock_date,
      coalesce(v_row.processed,0),
      coalesce(v_row.restated,0),
      coalesce(v_row.skipped,0),
      coalesce(v_row.settlements_created,0),
      v_before_debit,
      v_before_credit,
      v_after_debit,
      v_after_credit
    );

    if abs(coalesce(v_after_debit,0) - coalesce(v_after_credit,0)) > 0.01 then
      raise exception 'ledger not balanced after restatement v2 batch %', v_batch_no;
    end if;

    if coalesce(v_row.processed,0) = 0 then
      exit;
    end if;
    if coalesce(v_row.processed,0) < v_batch_size then
      exit;
    end if;
  end loop;

  perform public.run_fx_revaluation(v_lock_date);
end $$;

notify pgrst, 'reload schema';
