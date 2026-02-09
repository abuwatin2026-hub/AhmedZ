set app.allow_ledger_ddl = '1';

create or replace function public.create_manual_journal_entry(
  p_entry_date timestamptz,
  p_memo text,
  p_lines jsonb,
  p_journal_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entry_id uuid;
  v_line jsonb;
  v_account_code text;
  v_account_id uuid;
  v_debit numeric;
  v_credit numeric;
  v_memo text;
  v_cost_center_id uuid;
  v_journal_id uuid;
  v_party_id uuid;
  v_currency_code text;
  v_fx_rate numeric;
  v_foreign_amount numeric;
  v_entry_date timestamptz;
  v_base text := public.get_base_currency();
  v_base_amount numeric;
begin
  if not public.is_owner_or_manager() then
    raise exception 'not allowed';
  end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    raise exception 'p_lines must be a json array';
  end if;

  v_entry_date := coalesce(p_entry_date, now());
  v_memo := nullif(trim(coalesce(p_memo, '')), '');
  v_journal_id := coalesce(p_journal_id, public.get_default_journal_id(), '00000000-0000-4000-8000-000000000001'::uuid);

  insert into public.journal_entries(entry_date, memo, source_table, source_id, source_event, created_by, journal_id)
  values (
    v_entry_date,
    v_memo,
    'manual',
    null,
    null,
    auth.uid(),
    v_journal_id
  )
  returning id into v_entry_id;

  for v_line in select value from jsonb_array_elements(p_lines)
  loop
    v_account_code := nullif(trim(coalesce(v_line->>'accountCode', '')), '');
    v_debit := coalesce(nullif(v_line->>'debit', '')::numeric, 0);
    v_credit := coalesce(nullif(v_line->>'credit', '')::numeric, 0);
    v_cost_center_id := nullif(v_line->>'costCenterId', '')::uuid;
    v_party_id := nullif(v_line->>'partyId', '')::uuid;
    v_currency_code := upper(nullif(trim(coalesce(v_line->>'currencyCode','')), ''));
    v_fx_rate := null;
    v_foreign_amount := null;
    begin
      v_fx_rate := nullif(v_line->>'fxRate', '')::numeric;
    exception when others then
      v_fx_rate := null;
    end;
    begin
      v_foreign_amount := nullif(v_line->>'foreignAmount', '')::numeric;
    exception when others then
      v_foreign_amount := null;
    end;

    if v_account_code is null then
      raise exception 'accountCode is required';
    end if;

    select id into v_account_id
    from public.chart_of_accounts
    where code = v_account_code
      and is_active = true
    limit 1;
    if v_account_id is null then
      raise exception 'account not found: %', v_account_code;
    end if;

    if (v_debit > 0 and v_credit > 0) or (v_debit = 0 and v_credit = 0) then
      raise exception 'either debit or credit must be > 0';
    end if;

    if v_currency_code is not null and upper(v_currency_code) = upper(v_base) then
      v_currency_code := null;
      v_fx_rate := null;
      v_foreign_amount := null;
    end if;

    if v_currency_code is not null and upper(v_currency_code) <> upper(v_base) then
      if v_fx_rate is null or v_fx_rate <= 0 then
        v_fx_rate := public.get_fx_rate(v_currency_code, v_entry_date::date, 'accounting');
      end if;
      if v_fx_rate is null or v_fx_rate <= 0 then
        raise exception 'accounting fx rate missing for currency % at %', v_currency_code, v_entry_date::date;
      end if;
      if v_foreign_amount is null or v_foreign_amount <= 0 then
        v_foreign_amount := greatest(coalesce(v_debit, 0), coalesce(v_credit, 0));
      end if;
      if v_foreign_amount is null or v_foreign_amount <= 0 then
        raise exception 'foreignAmount required for currency %', v_currency_code;
      end if;
      v_base_amount := public._money_round(v_foreign_amount * v_fx_rate);
      if v_debit > 0 then
        v_debit := v_base_amount;
        v_credit := 0;
      else
        v_credit := v_base_amount;
        v_debit := 0;
      end if;
    else
      v_currency_code := null;
      v_fx_rate := null;
      v_foreign_amount := null;
    end if;

    v_memo := nullif(trim(coalesce(v_line->>'memo', '')), '');

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
      foreign_amount
    )
    values (
      v_entry_id,
      v_account_id,
      v_debit,
      v_credit,
      v_memo,
      v_cost_center_id,
      v_party_id,
      v_currency_code,
      v_fx_rate,
      v_foreign_amount
    );
  end loop;

  perform public.check_journal_entry_balance(v_entry_id);
  return v_entry_id;
end;
$$;

create or replace function public.trg_journal_lines_fx_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_base text := public.get_base_currency();
  v_amt_base numeric;
begin
  if new.currency_code is null or upper(new.currency_code) = upper(v_base) then
    return new;
  end if;

  if new.fx_rate is null or new.fx_rate <= 0 then
    raise exception 'fx_rate required for non-base currency_code';
  end if;
  if new.foreign_amount is null or new.foreign_amount <= 0 then
    raise exception 'foreign_amount required for non-base currency_code';
  end if;

  if (coalesce(new.debit,0) > 0 and coalesce(new.credit,0) > 0) or (coalesce(new.debit,0) = 0 and coalesce(new.credit,0) = 0) then
    raise exception 'either debit or credit must be > 0';
  end if;

  v_amt_base := public._money_round(new.foreign_amount * new.fx_rate);
  if coalesce(new.debit, 0) > 0 then
    if abs(coalesce(new.debit,0) - v_amt_base) > 0.02 then
      raise exception 'base debit mismatch for fx line';
    end if;
  else
    if abs(coalesce(new.credit,0) - v_amt_base) > 0.02 then
      raise exception 'base credit mismatch for fx line';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_journal_lines_fx_guard on public.journal_lines;
create trigger trg_journal_lines_fx_guard
before insert on public.journal_lines
for each row execute function public.trg_journal_lines_fx_guard();

create or replace view public.enterprise_gl_lines as
select
  je.entry_date::date as entry_date,
  je.id as journal_entry_id,
  jl.id as journal_line_id,
  je.memo as entry_memo,
  je.source_table,
  je.source_id,
  je.source_event,
  je.company_id,
  je.branch_id,
  je.journal_id,
  je.document_id,
  jl.account_id,
  coa.code as account_code,
  coa.name as account_name,
  coa.account_type,
  coa.normal_balance,
  coa.ifrs_statement,
  coa.ifrs_category,
  coa.ifrs_line,
  case
    when jl.currency_code is not null
      and upper(jl.currency_code) <> upper(public.get_base_currency())
      and jl.fx_rate is not null
      and jl.foreign_amount is not null
      and jl.debit > 0
      then public._money_round(jl.foreign_amount * jl.fx_rate)
    else jl.debit
  end as debit,
  case
    when jl.currency_code is not null
      and upper(jl.currency_code) <> upper(public.get_base_currency())
      and jl.fx_rate is not null
      and jl.foreign_amount is not null
      and jl.credit > 0
      then public._money_round(jl.foreign_amount * jl.fx_rate)
    else jl.credit
  end as credit,
  case
    when coa.normal_balance = 'credit' then (
      (case
        when jl.currency_code is not null
          and upper(jl.currency_code) <> upper(public.get_base_currency())
          and jl.fx_rate is not null
          and jl.foreign_amount is not null
          and jl.credit > 0
          then public._money_round(jl.foreign_amount * jl.fx_rate)
        else coalesce(jl.credit,0)
      end)
      -
      (case
        when jl.currency_code is not null
          and upper(jl.currency_code) <> upper(public.get_base_currency())
          and jl.fx_rate is not null
          and jl.foreign_amount is not null
          and jl.debit > 0
          then public._money_round(jl.foreign_amount * jl.fx_rate)
        else coalesce(jl.debit,0)
      end)
    )
    else (
      (case
        when jl.currency_code is not null
          and upper(jl.currency_code) <> upper(public.get_base_currency())
          and jl.fx_rate is not null
          and jl.foreign_amount is not null
          and jl.debit > 0
          then public._money_round(jl.foreign_amount * jl.fx_rate)
        else coalesce(jl.debit,0)
      end)
      -
      (case
        when jl.currency_code is not null
          and upper(jl.currency_code) <> upper(public.get_base_currency())
          and jl.fx_rate is not null
          and jl.foreign_amount is not null
          and jl.credit > 0
          then public._money_round(jl.foreign_amount * jl.fx_rate)
        else coalesce(jl.credit,0)
      end)
    )
  end as signed_base_amount,
  upper(coalesce(jl.currency_code, public.get_base_currency())) as currency_code,
  jl.fx_rate,
  jl.foreign_amount,
  case
    when jl.currency_code is null or upper(jl.currency_code) = upper(public.get_base_currency()) or jl.foreign_amount is null
      then null
    else
      case when jl.debit > 0 then coalesce(jl.foreign_amount,0) else -coalesce(jl.foreign_amount,0) end
  end as signed_foreign_amount,
  jl.party_id,
  jl.cost_center_id,
  jl.dept_id,
  jl.project_id,
  jl.line_memo
from public.journal_entries je
join public.journal_lines jl on jl.journal_entry_id = je.id
join public.chart_of_accounts coa on coa.id = jl.account_id;

alter view public.enterprise_gl_lines set (security_invoker = true);
grant select on public.enterprise_gl_lines to authenticated;

notify pgrst, 'reload schema';

