-- Fix: insert_party_ledger_for_manual_voucher must use base currency when currency_code is NULL
create or replace function public.insert_party_ledger_for_manual_voucher(
  p_entry_id uuid
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entry      record;
  v_line       record;
  v_dir        text;
  v_base_amt   numeric;
  v_foreign_amt numeric;
  v_curr       text;
  v_fx         numeric;
  v_prev       numeric;
  v_delta      numeric;
  v_base_ccy   text;
  v_inserted   integer := 0;
begin
  -- Load the entry
  select id, entry_date, source_table, source_id, source_event, status
  into v_entry
  from public.journal_entries
  where id = p_entry_id;

  if not found then return 0; end if;
  if v_entry.source_table <> 'manual' then return 0; end if;
  if coalesce(v_entry.status, '') <> 'posted' then return 0; end if;

  -- Get base currency once
  v_base_ccy := public.get_base_currency();

  -- Process each journal_line that has party_id set
  for v_line in
    select
      jl.id as line_id,
      jl.account_id,
      jl.debit,
      jl.credit,
      jl.party_id,
      jl.currency_code,
      jl.fx_rate,
      jl.foreign_amount
    from public.journal_lines jl
    where jl.journal_entry_id = p_entry_id
      and jl.party_id is not null
  loop
    -- Skip if already in party_ledger_entries
    if exists (
      select 1 from public.party_ledger_entries ple
      where ple.journal_line_id = v_line.line_id
    ) then
      continue;
    end if;

    -- Determine direction
    if coalesce(v_line.debit, 0) > 0 then
      v_dir     := 'debit';
      v_base_amt := coalesce(v_line.debit, 0);
    else
      v_dir     := 'credit';
      v_base_amt := coalesce(v_line.credit, 0);
    end if;

    -- FX fields — always fall back to base currency if not set
    v_curr        := upper(nullif(trim(coalesce(v_line.currency_code, '')), ''));
    if v_curr is null or v_curr = '' then
      v_curr := coalesce(v_base_ccy, 'YER');
    end if;
    v_fx          := v_line.fx_rate;
    v_foreign_amt := v_line.foreign_amount;
    -- If no foreign_amount and it's the base currency, foreign = base
    if v_foreign_amt is null and v_curr = coalesce(v_base_ccy, 'YER') then
      v_foreign_amt := v_base_amt;
    end if;

    -- Get previous running balance for this party
    select coalesce(max(ple.running_balance), 0)
    into v_prev
    from public.party_ledger_entries ple
    where ple.party_id = v_line.party_id
      and ple.account_id = v_line.account_id;

    -- Calculate delta
    v_delta := case
      when v_dir = 'debit'  then  v_base_amt
      when v_dir = 'credit' then -v_base_amt
      else 0
    end;

    -- Insert into party_ledger_entries
    insert into public.party_ledger_entries(
      party_id,
      account_id,
      journal_entry_id,
      journal_line_id,
      occurred_at,
      direction,
      base_amount,
      foreign_amount,
      currency_code,
      fx_rate,
      running_balance
    ) values (
      v_line.party_id,
      v_line.account_id,
      p_entry_id,
      v_line.line_id,
      v_entry.entry_date,
      v_dir,
      v_base_amt,
      v_foreign_amt,
      v_curr,
      v_fx,
      v_prev + v_delta
    );

    v_inserted := v_inserted + 1;
  end loop;

  return v_inserted;
end;
$$;

comment on function public.insert_party_ledger_for_manual_voucher(uuid) is
  'Inserts party_ledger_entries rows for manual voucher journal_lines that have party_id set. Falls back to base currency when currency_code is null.';
