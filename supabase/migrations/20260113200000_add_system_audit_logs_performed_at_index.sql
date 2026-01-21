create index if not exists idx_system_audit_logs_performed_at_desc
on public.system_audit_logs(performed_at desc);
