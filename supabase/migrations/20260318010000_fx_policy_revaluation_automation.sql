-- ════════════════════════════════════════════════════════════════════
-- MIGRATION: 20260318010000_fx_policy_revaluation_automation.sql
--
-- Implements:
-- 1. Auto-sync accounting rate = operational when no explicit accounting
--    rate exists (fallback policy)
-- 2. run_monthly_fx_revaluation: idempotent function with FX-REV-YYYY-MM
--    sequential reference numbering
-- 3. Monthly cron job (last day of month, 01:00) that auto-runs revaluation
-- ════════════════════════════════════════════════════════════════════

-- ─── 1. Ensure accounting rate always has a value ──────────────────
-- For any currency that has operational but no accounting rate for a date,
-- the fallback function already returns operational. But we ensure the
-- FxRatesScreen shows both types clearly by syncing on insert.

create or replace function public.trg_sync_accounting_rate_on_operational()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- When a new operational rate is inserted, auto-insert accounting rate
  -- for same currency + date IF no accounting rate already exists for that date
  if NEW.rate_type = 'operational' then
    insert into public.fx_rates(currency_code, rate, rate_date, rate_type)
    values (NEW.currency_code, NEW.rate, NEW.rate_date, 'accounting')
    on conflict (currency_code, rate_date, rate_type) do nothing;
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_sync_accounting_rate on public.fx_rates;
create trigger trg_sync_accounting_rate
  after insert on public.fx_rates
  for each row execute function public.trg_sync_accounting_rate_on_operational();

-- Add unique constraint to prevent duplicate rates
alter table public.fx_rates
  drop constraint if exists fx_rates_currency_date_type_uq;
alter table public.fx_rates
  add constraint fx_rates_currency_date_type_uq
  unique (currency_code, rate_date, rate_type);

-- ─── 2. FX-REV sequential reference sequence ──────────────────────
create sequence if not exists public.fx_rev_seq
  start 1 increment 1 minvalue 1 no maxvalue cache 1;

-- Table to track monthly revaluation runs
create table if not exists public.fx_monthly_revaluation_log (
  id uuid primary key default gen_random_uuid(),
  ref_code text not null unique,  -- FX-REV-2026-03
  period_year int not null,
  period_month int not null,
  closing_rate_date date not null,
  currencies_revalued int not null default 0,
  total_gain numeric not null default 0,
  total_loss numeric not null default 0,
  net_fx_diff numeric not null default 0,
  journal_entry_id uuid references public.journal_entries(id),
  status text not null default 'completed',
  ran_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique(period_year, period_month)
);

comment on table public.fx_monthly_revaluation_log is
  'Audit log for monthly FX revaluation runs — each month must have exactly one entry before period close';

-- ─── 3. Main monthly revaluation function ─────────────────────────
create or replace function public.run_monthly_fx_revaluation(
  p_year int,
  p_month int,
  p_closing_rate_date date default null  -- defaults to last day of month
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ref_code text;
  v_rate_date date;
  v_first_day date;
  v_last_day date;
  v_base text;
  v_fx_gain_acct uuid;
  v_fx_loss_acct uuid;
  v_unrealized_gain_acct uuid;
  v_unrealized_loss_acct uuid;
  v_entry_id uuid;
  v_cur record;
  v_acct record;
  v_fx_rate_close numeric;
  v_fx_rate_book numeric;
  v_foreign_balance numeric;
  v_base_at_book numeric;
  v_base_at_close numeric;
  v_diff numeric;
  v_total_gain numeric := 0;
  v_total_loss numeric := 0;
  v_currencies_revalued int := 0;
  v_has_lines boolean := false;
  v_already_run int;
begin
  if not public.has_admin_permission('accounting.manage') then
    raise exception 'not allowed';
  end if;

  -- Check idempotency — don't run twice for same month
  select count(*) into v_already_run
  from public.fx_monthly_revaluation_log
  where period_year = p_year and period_month = p_month
    and status = 'completed';

  if v_already_run > 0 then
    raise exception 'إعادة تقييم % / % تم تنفيذها مسبقاً. استخدم قيد عكسي للتصحيح.', p_year, p_month;
  end if;

  -- Set up date range
  v_first_day := make_date(p_year, p_month, 1);
  v_last_day := (v_first_day + interval '1 month' - interval '1 day')::date;
  v_rate_date := coalesce(p_closing_rate_date, v_last_day);
  v_ref_code := format('FX-REV-%s-%s', p_year, lpad(p_month::text, 2, '0'));
  v_base := public.get_base_currency();

  -- Get accounts
  v_fx_gain_acct := public.get_account_id_by_code('6200');
  v_fx_loss_acct := public.get_account_id_by_code('6201');
  v_unrealized_gain_acct := public.get_account_id_by_code('6250');
  v_unrealized_loss_acct := public.get_account_id_by_code('6251');

  if v_unrealized_gain_acct is null then
    raise exception 'حساب أرباح العملة غير المحققة (6250) غير موجود';
  end if;

  -- Create the revaluation journal entry
  insert into public.journal_entries(
    entry_date, memo, source_table, source_id, source_event,
    created_by, status
  ) values (
    v_last_day::timestamptz + interval '23 hours 58 minutes',
    format('إعادة تقييم العملات الأجنبية %s — %s', v_ref_code, v_rate_date::text),
    'fx_revaluation',
    v_ref_code,
    format('monthly_revaluation:%s:%s', p_year, p_month),
    auth.uid(),
    'posted'
  )
  on conflict (source_table, source_id, source_event) do update
    set entry_date = excluded.entry_date, memo = excluded.memo
  returning id into v_entry_id;

  -- Remove any existing lines (re-run safety)
  delete from public.journal_lines where journal_entry_id = v_entry_id;

  -- ── For each foreign currency, revalue monetary balances ──
  for v_cur in
    select distinct jl.currency_code
    from public.journal_lines jl
    join public.journal_entries je on je.id = jl.journal_entry_id
    where je.status = 'posted'
      and jl.currency_code is not null
      and upper(jl.currency_code) <> upper(v_base)
      and je.entry_date::date <= v_last_day
  loop
    -- Get closing rate (accounting type preferred, fallback to operational)
    v_fx_rate_close := public.get_fx_rate(v_cur.currency_code, 'accounting', v_rate_date);
    if v_fx_rate_close is null then
      v_fx_rate_close := public.get_fx_rate(v_cur.currency_code, 'operational', v_rate_date);
    end if;
    if v_fx_rate_close is null or v_fx_rate_close <= 0 then
      raise warning 'لا يوجد سعر صرف لـ % بتاريخ %، تخطي...', v_cur.currency_code, v_rate_date;
      continue;
    end if;

    -- For each monetary account with a foreign balance
    for v_acct in
      select jl.account_id, coa.code as acct_code,
             sum(jl.foreign_amount) as foreign_total,
             sum(jl.debit - jl.credit) as base_total,
             -- Average book rate
             case when abs(sum(jl.foreign_amount)) > 0.0001
               then abs(sum(jl.debit - jl.credit)) / abs(sum(jl.foreign_amount))
               else v_fx_rate_close
             end as book_rate
      from public.journal_lines jl
      join public.journal_entries je on je.id = jl.journal_entry_id
      join public.chart_of_accounts coa on coa.id = jl.account_id
      where je.status = 'posted'
        and jl.currency_code = v_cur.currency_code
        and je.entry_date::date <= v_last_day
        -- Only monetary accounts: cash, bank, AR, AP
        and coa.code in ('1010','1020','1200','2010','2050')
      group by jl.account_id, coa.code
      having abs(sum(jl.foreign_amount)) > 0.0001
    loop
      v_foreign_balance := v_acct.foreign_total;
      v_base_at_book    := v_acct.base_total;
      v_base_at_close   := v_foreign_balance * v_fx_rate_close;
      v_diff            := v_base_at_close - v_base_at_book;

      if abs(v_diff) < 0.01 then continue; end if;

      -- Record revaluation line on the monetary account
      insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo,
                                       currency_code, fx_rate, foreign_amount)
      values (
        v_entry_id,
        v_acct.account_id,
        case when v_diff > 0 then v_diff else 0 end,
        case when v_diff < 0 then abs(v_diff) else 0 end,
        format('إعادة تقييم %s — %s', v_cur.currency_code, v_acct.acct_code),
        v_cur.currency_code,
        v_fx_rate_close,
        null
      );

      -- Offset to unrealized FX gain/loss
      insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
      values (
        v_entry_id,
        case when v_diff > 0 then v_unrealized_gain_acct else v_unrealized_loss_acct end,
        case when v_diff > 0 then 0 else abs(v_diff) end,
        case when v_diff > 0 then v_diff else 0 end,
        format('%s غير محقق — %s', case when v_diff > 0 then 'ربح عملة' else 'خسارة عملة' end, v_cur.currency_code)
      );

      if v_diff > 0 then
        v_total_gain := v_total_gain + v_diff;
      else
        v_total_loss := v_total_loss + abs(v_diff);
      end if;
      v_has_lines := true;

      -- Log to audit table
      insert into public.fx_revaluation_audit(
        period_end, entity_type, entity_id, currency,
        original_base, revalued_base, diff, journal_entry_id
      ) values (
        v_last_day, 'account', v_acct.account_id, v_cur.currency_code,
        v_base_at_book, v_base_at_close, v_diff, v_entry_id
      );

    end loop;

    v_currencies_revalued := v_currencies_revalued + 1;
  end loop;

  -- Verify balance
  perform public.check_journal_entry_balance(v_entry_id);

  -- Log the run
  insert into public.fx_monthly_revaluation_log(
    ref_code, period_year, period_month, closing_rate_date,
    currencies_revalued, total_gain, total_loss, net_fx_diff,
    journal_entry_id, ran_by
  ) values (
    v_ref_code, p_year, p_month, v_rate_date,
    v_currencies_revalued, v_total_gain, v_total_loss,
    v_total_gain - v_total_loss, v_entry_id, auth.uid()
  );

  return jsonb_build_object(
    'ref_code', v_ref_code,
    'period', format('%s/%s', p_year, p_month),
    'closing_rate_date', v_rate_date,
    'currencies_revalued', v_currencies_revalued,
    'total_gain_sar', v_total_gain,
    'total_loss_sar', v_total_loss,
    'net_fx_diff_sar', v_total_gain - v_total_loss,
    'journal_entry_id', v_entry_id,
    'has_lines', v_has_lines
  );
end;
$$;

revoke all on function public.run_monthly_fx_revaluation(int, int, date) from public;
grant execute on function public.run_monthly_fx_revaluation(int, int, date) to authenticated;

-- ─── 4. Wrapper function for cron ─────────────────────────────────
create or replace function public.cron_run_monthly_fx_revaluation()
returns void language plpgsql security definer set search_path = public as $$
declare
  v_today date := current_date;
  v_next  date := (date_trunc('month', current_date) + interval '1 month')::date;
begin
  if v_today <> (v_next - interval '1 day')::date then return; end if;
  perform public.run_monthly_fx_revaluation(
    extract(year from v_today)::int,
    extract(month from v_today)::int,
    v_today
  );
exception when others then
  raise warning 'FX monthly revaluation cron failed: %', sqlerrm;
end;
$$;

-- ─── 5. Monthly cron — days 28-31 at 01:00AM, wrapper checks last day ─
select cron.unschedule('fx_monthly_revaluation')
where exists (select 1 from cron.job where jobname = 'fx_monthly_revaluation');

select cron.schedule(
  'fx_monthly_revaluation',
  '0 1 28-31 * *',
  'select public.cron_run_monthly_fx_revaluation()'
);

-- Enable RLS on new log table
alter table public.fx_monthly_revaluation_log enable row level security;
create policy "owner_all" on public.fx_monthly_revaluation_log
  for all using (public.is_owner() or public.has_admin_permission('accounting.view'));

notify pgrst, 'reload schema';
