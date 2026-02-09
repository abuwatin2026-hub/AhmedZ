set app.allow_ledger_ddl = '1';

create or replace function public.run_base_currency_historical_restatement(
  p_batch int default 20,
  p_posting_date timestamptz default null
)
returns table(
  batch_id uuid,
  processed int,
  restated int,
  skipped int,
  settlements_created int,
  original_entry_ids uuid[],
  restated_entry_ids uuid[]
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old_base text;
  v_new_base text;
  v_lock_at timestamptz;
  v_post_ts timestamptz;
  v_row record;
  v_entry public.journal_entries%rowtype;
  v_new_entry_id uuid;
  v_rate_old_to_new numeric;
  v_fx_gain uuid := public.get_account_id_by_code('6200');
  v_fx_loss uuid := public.get_account_id_by_code('6201');
  v_debit_sum numeric;
  v_credit_sum numeric;
  v_diff numeric;
  v_processed int := 0;
  v_restated int := 0;
  v_skipped int := 0;
  v_item_currency text;
  v_fx numeric;
  v_amt_base numeric;
  v_batch uuid := gen_random_uuid();
  v_orig_ids uuid[] := '{}'::uuid[];
  v_new_ids uuid[] := '{}'::uuid[];
begin
  if auth.role() <> 'service_role' and not public.has_admin_permission('accounting.manage') then
    raise exception 'not allowed';
  end if;

  select old_base_currency, new_base_currency, locked_at
  into v_old_base, v_new_base, v_lock_at
  from public.base_currency_restatement_state
  where id = 'sar_base_lock'
  limit 1;

  if v_old_base is null or v_new_base is null then
    raise exception 'restatement state missing';
  end if;

  v_post_ts := coalesce(p_posting_date, v_lock_at);
  if public.is_in_closed_period(v_post_ts) then
    raise exception 'posting date in closed period';
  end if;

  batch_id := v_batch;
  processed := 0;
  restated := 0;
  skipped := 0;
  settlements_created := 0;
  original_entry_ids := '{}'::uuid[];
  restated_entry_ids := '{}'::uuid[];

  for v_row in
    select t.journal_entry_id
    from public.historical_base_currency_restatement_targets t
    left join public.base_currency_restatement_entry_map m
      on m.original_journal_entry_id = t.journal_entry_id
    where m.original_journal_entry_id is null
    order by t.entry_date asc, t.created_at asc, t.journal_entry_id asc
    limit greatest(coalesce(p_batch, 0), 0)
  loop
    v_processed := v_processed + 1;
    processed := v_processed;

    v_orig_ids := array_append(v_orig_ids, v_row.journal_entry_id::uuid);

    select * into v_entry
    from public.journal_entries je
    where je.id = v_row.journal_entry_id
    limit 1;

    if not found then
      insert into public.base_currency_restatement_entry_map(original_journal_entry_id, status, notes, batch_id)
      values (v_row.journal_entry_id, 'skipped', 'journal entry not found', v_batch);
      v_skipped := v_skipped + 1;
      skipped := v_skipped;
      continue;
    end if;

    v_rate_old_to_new := public.get_fx_rate(v_old_base, v_entry.entry_date::date, 'accounting');
    if v_rate_old_to_new is null or v_rate_old_to_new <= 0 then
      insert into public.base_currency_restatement_entry_map(original_journal_entry_id, status, notes, batch_id)
      values (v_entry.id, 'skipped', 'missing/invalid old_base->new_base accounting rate', v_batch);
      v_skipped := v_skipped + 1;
      skipped := v_skipped;
      continue;
    end if;

    insert into public.journal_entries(
      entry_date,
      memo,
      source_table,
      source_id,
      source_event,
      created_by,
      journal_id,
      document_id,
      branch_id,
      company_id,
      reference_entry_id
    )
    values (
      v_post_ts,
      concat('Historical base currency restatement (SAR)', E'\n', 'Original JE: ', v_entry.id::text),
      'base_currency_restatement',
      v_entry.id::text,
      'historical_base_currency_restatement',
      auth.uid(),
      v_entry.journal_id,
      v_entry.document_id,
      v_entry.branch_id,
      v_entry.company_id,
      v_entry.id
    )
    returning id into v_new_entry_id;

    v_new_ids := array_append(v_new_ids, v_new_entry_id);

    for v_row in
      select jl.*
      from public.journal_lines jl
      where jl.journal_entry_id = v_entry.id
      order by jl.created_at asc, jl.id asc
    loop
      insert into public.journal_lines(
        journal_entry_id,
        account_id,
        debit,
        credit,
        line_memo,
        cost_center_id,
        party_id,
        currency_code,
        fx_rate,
        foreign_amount,
        dept_id,
        project_id
      )
      values (
        v_new_entry_id,
        v_row.account_id,
        coalesce(v_row.credit, 0),
        coalesce(v_row.debit, 0),
        concat('Restatement reversal: ', coalesce(v_row.line_memo,'')),
        v_row.cost_center_id,
        v_row.party_id,
        v_row.currency_code,
        v_row.fx_rate,
        v_row.foreign_amount,
        v_row.dept_id,
        v_row.project_id
      );

      v_item_currency := upper(nullif(btrim(coalesce(v_row.currency_code, '')), ''));
      v_fx := null;

      if v_item_currency is not null and v_item_currency <> upper(v_new_base) and v_row.foreign_amount is not null and v_row.foreign_amount > 0 then
        v_fx := public.get_fx_rate(v_item_currency, v_entry.entry_date::date, 'accounting');
        if v_fx is null or v_fx <= 0 then
          v_fx := public.get_fx_rate(v_item_currency, v_entry.entry_date::date, 'operational');
        end if;
        if v_fx is null or v_fx <= 0 then
          v_item_currency := null;
          v_fx := null;
        end if;
      else
        v_item_currency := null;
        v_fx := null;
      end if;

      if v_item_currency is null then
        v_amt_base := public._money_round(greatest(coalesce(v_row.debit, 0), coalesce(v_row.credit, 0)) * v_rate_old_to_new);

        insert into public.journal_lines(
          journal_entry_id,
          account_id,
          debit,
          credit,
          line_memo,
          cost_center_id,
          party_id,
          currency_code,
          fx_rate,
          foreign_amount,
          dept_id,
          project_id
        )
        values (
          v_new_entry_id,
          v_row.account_id,
          case when coalesce(v_row.debit, 0) > 0 then v_amt_base else 0 end,
          case when coalesce(v_row.credit, 0) > 0 then v_amt_base else 0 end,
          concat('Restated base (SAR) from old base ', upper(v_old_base)),
          v_row.cost_center_id,
          v_row.party_id,
          null,
          null,
          null,
          v_row.dept_id,
          v_row.project_id
        );
      else
        v_amt_base := public._money_round(coalesce(v_row.foreign_amount, 0) * v_fx);

        insert into public.journal_lines(
          journal_entry_id,
          account_id,
          debit,
          credit,
          line_memo,
          cost_center_id,
          party_id,
          currency_code,
          fx_rate,
          foreign_amount,
          dept_id,
          project_id
        )
        values (
          v_new_entry_id,
          v_row.account_id,
          case when coalesce(v_row.debit, 0) > 0 then v_amt_base else 0 end,
          case when coalesce(v_row.credit, 0) > 0 then v_amt_base else 0 end,
          concat('Restated FX (', v_item_currency, '→', upper(v_new_base), ')'),
          v_row.cost_center_id,
          v_row.party_id,
          v_item_currency,
          v_fx,
          v_row.foreign_amount,
          v_row.dept_id,
          v_row.project_id
        );
      end if;
    end loop;

    select coalesce(sum(coalesce(jl.debit,0)),0), coalesce(sum(coalesce(jl.credit,0)),0)
    into v_debit_sum, v_credit_sum
    from public.journal_lines jl
    where jl.journal_entry_id = v_new_entry_id;

    v_diff := coalesce(v_debit_sum,0) - coalesce(v_credit_sum,0);
    if abs(v_diff) > 0.02 then
      if v_fx_gain is null or v_fx_loss is null then
        raise exception 'missing fx gain/loss accounts';
      end if;
      if v_diff > 0 then
        insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
        values (v_new_entry_id, v_fx_gain, 0, abs(v_diff), 'Restatement balancing (credit)');
      else
        insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
        values (v_new_entry_id, v_fx_loss, abs(v_diff), 0, 'Restatement balancing (debit)');
      end if;
    end if;

    perform public.check_journal_entry_balance(v_new_entry_id);

    insert into public.base_currency_restatement_entry_map(original_journal_entry_id, restated_journal_entry_id, status, notes, batch_id)
    values (v_entry.id, v_new_entry_id, 'restated', null, v_batch);

    v_restated := v_restated + 1;
    restated := v_restated;
  end loop;

  skipped := v_skipped;
  processed := v_processed;
  settlements_created := 0;
  original_entry_ids := v_orig_ids;
  restated_entry_ids := v_new_ids;

  return query
  select batch_id, processed, restated, skipped, settlements_created, original_entry_ids, restated_entry_ids;
end;
$$;

revoke all on function public.run_base_currency_historical_restatement(int, timestamptz) from public;
grant execute on function public.run_base_currency_historical_restatement(int, timestamptz) to authenticated;

notify pgrst, 'reload schema';

