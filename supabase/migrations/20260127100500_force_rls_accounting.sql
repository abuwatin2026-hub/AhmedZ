-- FORCE RLS Hardening for Accounting Tables
-- الهدف: فرض تطبيق سياسات RLS دائمًا لمنع أي تجاوز عبر أدوار عليا أو استدعاءات غير متوقعة
-- دون تغيير أي سياسة قائمة أو توسيع صلاحيات.
-- This migration enables FORCE ROW LEVEL SECURITY on immutable accounting tables.

alter table if exists public.ledger_entries force row level security;
alter table if exists public.ledger_lines force row level security;
alter table if exists public.driver_ledger force row level security;
alter table if exists public.cod_settlements force row level security;
alter table if exists public.cod_settlement_orders force row level security;
