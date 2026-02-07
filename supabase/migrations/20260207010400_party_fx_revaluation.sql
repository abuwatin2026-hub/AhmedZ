set app.allow_ledger_ddl = '1';

create or replace function public.run_party_fx_revaluation(
  p_as_of date default current_date,
  p_account_codes text[] default array['1200','2010','1210','2110']
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_as_of date;
  v_entry_date timestamptz;
  v_run_id uuid;
  v_entry_id uuid;
  v_base text;
  v_gain uuid;
  v_loss uuid;
  v_row record;
  v_account record;
  v_rate numeric;
  v_foreign_norm numeric;
  v_current_norm numeric;
  v_expected_norm numeric;
  v_adj_norm numeric;
  v_has_any boolean := false;
begin
  if not public.has_admin_permission('accounting.manage') then
    raise exception 'not allowed';
  end if;

  v_as_of := coalesce(p_as_of, current_date);
  v_entry_date := (v_as_of::timestamptz + interval '23 hours 59 minutes 59 seconds');
  v_run_id := gen_random_uuid();
  v_base := public.get_base_currency();
  v_gain := public.get_account_id_by_code('6250');
  v_loss := public.get_account_id_by_code('6251');
  if v_gain is null or v_loss is null then
    raise exception 'missing FX unrealized accounts';
  end if;
  v_entry_id := null;

  for v_row in
    select
      ple.party_id,
      ple.account_id,
      ple.currency_code,
      max(ple.occurred_at) as last_occurred_at
    from public.party_ledger_entries ple
    join public.chart_of_accounts coa on coa.id = ple.account_id
    where ple.currency_code is not null
      and upper(ple.currency_code) <> upper(v_base)
      and ple.currency_code <> ''
      and (p_account_codes is null or coa.code = any(p_account_codes))
    group by ple.party_id, ple.account_id, ple.currency_code
  loop
    select coa.id, coa.code, coa.normal_balance
    into v_account
    from public.chart_of_accounts coa
    where coa.id = v_row.account_id;

    v_rate := public.get_fx_rate(v_row.currency_code, v_as_of, 'accounting');
    if v_rate is null or v_rate <= 0 then
      continue;
    end if;

    select
      coalesce(sum(public._party_ledger_delta(ple.account_id, ple.direction, coalesce(ple.foreign_amount, 0))), 0),
      coalesce((select ple2.running_balance
                from public.party_ledger_entries ple2
                where ple2.party_id = v_row.party_id
                  and ple2.account_id = v_row.account_id
                  and ple2.currency_code = v_row.currency_code
                order by ple2.occurred_at desc, ple2.created_at desc, ple2.id desc
                limit 1), 0)
    into v_foreign_norm, v_current_norm
    from public.party_ledger_entries ple
    where ple.party_id = v_row.party_id
      and ple.account_id = v_row.account_id
      and ple.currency_code = v_row.currency_code;

    if abs(coalesce(v_foreign_norm, 0)) <= 0.0000001 then
      continue;
    end if;

    v_expected_norm := coalesce(v_foreign_norm, 0) * coalesce(v_rate, 1);
    v_adj_norm := v_expected_norm - coalesce(v_current_norm, 0);
    if abs(v_adj_norm) <= 0.0000001 then
      continue;
    end if;

    v_has_any := true;
    if v_entry_id is null then
      insert into public.journal_entries(entry_date, memo, source_table, source_id, source_event, created_by, status)
      values (v_entry_date, concat('Party FX revaluation as of ', v_as_of::text), 'party_fx_revaluation', v_run_id::text, 'revalue', auth.uid(), 'posted')
      returning id into v_entry_id;
    end if;

    if v_account.normal_balance = 'debit' then
      if v_adj_norm > 0 then
        insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo, party_id)
        values (v_entry_id, v_account.id, abs(v_adj_norm), 0, concat('Revalue ', v_account.code, ' ', v_row.currency_code), v_row.party_id);
        insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
        values (v_entry_id, v_gain, 0, abs(v_adj_norm), 'FX unrealized gain');
      else
        insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
        values (v_entry_id, v_loss, abs(v_adj_norm), 0, 'FX unrealized loss');
        insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo, party_id)
        values (v_entry_id, v_account.id, 0, abs(v_adj_norm), concat('Revalue ', v_account.code, ' ', v_row.currency_code), v_row.party_id);
      end if;
    else
      if v_adj_norm > 0 then
        insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
        values (v_entry_id, v_loss, abs(v_adj_norm), 0, 'FX unrealized loss');
        insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo, party_id)
        values (v_entry_id, v_account.id, 0, abs(v_adj_norm), concat('Revalue ', v_account.code, ' ', v_row.currency_code), v_row.party_id);
      else
        insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo, party_id)
        values (v_entry_id, v_account.id, abs(v_adj_norm), 0, concat('Revalue ', v_account.code, ' ', v_row.currency_code), v_row.party_id);
        insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
        values (v_entry_id, v_gain, 0, abs(v_adj_norm), 'FX unrealized gain');
      end if;
    end if;
  end loop;

  if v_entry_id is null then
    return null;
  end if;

  perform public.check_journal_entry_balance(v_entry_id);
  return v_entry_id;
end;
$$;

revoke all on function public.run_party_fx_revaluation(date, text[]) from public;
revoke execute on function public.run_party_fx_revaluation(date, text[]) from anon;
grant execute on function public.run_party_fx_revaluation(date, text[]) to authenticated;

notify pgrst, 'reload schema';
