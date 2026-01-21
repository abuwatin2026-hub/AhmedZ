-- System Audit Logs
create table if not exists public.system_audit_logs (
  id uuid primary key default gen_random_uuid(),
  action text not null,
  module text not null,
  details text,
  metadata jsonb,
  performed_by uuid references auth.users(id),
  performed_at timestamptz not null default now(),
  ip_address text
);
alter table public.system_audit_logs enable row level security;
drop policy if exists audit_logs_select on public.system_audit_logs;
create policy audit_logs_select on public.system_audit_logs for select using (public.is_admin());
drop policy if exists audit_logs_insert on public.system_audit_logs;
create policy audit_logs_insert on public.system_audit_logs for insert with check (auth.uid() is not null);
