do $$
begin
  if exists (
    select 1
    from pg_policies
    where schemaname='storage'
      and tablename='objects'
      and policyname='Admins can upload backups'
  ) then
    execute 'drop policy "Admins can upload backups" on storage.objects';
  end if;
end $$;

create policy "Admins can upload backups"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'automated_backups'
  and public.has_admin_permission('system.settings')
);

do $$
begin
  if exists (
    select 1
    from pg_policies
    where schemaname='storage'
      and tablename='objects'
      and policyname='Admins can update backups'
  ) then
    execute 'drop policy "Admins can update backups" on storage.objects';
  end if;
end $$;

create policy "Admins can update backups"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'automated_backups'
  and public.has_admin_permission('system.settings')
)
with check (
  bucket_id = 'automated_backups'
  and public.has_admin_permission('system.settings')
);

do $$
begin
  if exists (
    select 1
    from pg_policies
    where schemaname='storage'
      and tablename='objects'
      and policyname='Admins can delete backups'
  ) then
    execute 'drop policy "Admins can delete backups" on storage.objects';
  end if;
end $$;

create policy "Admins can delete backups"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'automated_backups'
  and public.has_admin_permission('system.settings')
);
