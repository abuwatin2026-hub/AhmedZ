-- Drop ambiguous old function signatures to fix "Could not choose the best candidate function" error
-- These were replaced by versions with p_cost_center_id parameter in 20260114000000_cost_centers.sql

drop function if exists public.balance_sheet(date);
drop function if exists public.income_statement(date, date);
drop function if exists public.trial_balance(date, date);
drop function if exists public.general_ledger(text, date, date);
drop function if exists public.cash_flow_statement(date, date);
