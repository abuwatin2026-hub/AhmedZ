set app.allow_ledger_ddl = '1';

do $$
begin
  if to_regclass('public.ledger_public_keys') is null then
    create table public.ledger_public_keys (
      id uuid primary key default gen_random_uuid(),
      key_name text not null,
      algorithm text not null default 'ed25519',
      public_key text not null,
      is_active boolean not null default true,
      created_at timestamptz not null default now(),
      created_by uuid references auth.users(id) on delete set null,
      unique(key_name)
    );
  end if;
end $$;

do $$
begin
  if to_regclass('public.ledger_entry_signatures') is null then
    create table public.ledger_entry_signatures (
      id uuid primary key default gen_random_uuid(),
      journal_entry_id uuid not null references public.journal_entries(id) on delete cascade,
      chain_hash text not null,
      algorithm text not null default 'ed25519',
      signature text not null,
      public_key_id uuid references public.ledger_public_keys(id) on delete set null,
      signed_at timestamptz not null default now(),
      signed_by uuid references auth.users(id) on delete set null,
      metadata jsonb not null default '{}'::jsonb,
      unique(journal_entry_id, public_key_id)
    );
    create index if not exists idx_ledger_entry_signatures_entry on public.ledger_entry_signatures(journal_entry_id, signed_at desc);
    create index if not exists idx_ledger_entry_signatures_key on public.ledger_entry_signatures(public_key_id, signed_at desc);
  end if;
end $$;

alter table public.ledger_public_keys enable row level security;
alter table public.ledger_entry_signatures enable row level security;

drop policy if exists ledger_public_keys_select on public.ledger_public_keys;
create policy ledger_public_keys_select on public.ledger_public_keys
for select using (public.has_admin_permission('accounting.view'));
drop policy if exists ledger_public_keys_write on public.ledger_public_keys;
create policy ledger_public_keys_write on public.ledger_public_keys
for all using (public.has_admin_permission('accounting.manage'))
with check (public.has_admin_permission('accounting.manage'));

drop policy if exists ledger_entry_signatures_select on public.ledger_entry_signatures;
create policy ledger_entry_signatures_select on public.ledger_entry_signatures
for select using (public.has_admin_permission('accounting.view'));
drop policy if exists ledger_entry_signatures_insert on public.ledger_entry_signatures;
create policy ledger_entry_signatures_insert on public.ledger_entry_signatures
for insert with check (public.has_admin_permission('accounting.manage'));
drop policy if exists ledger_entry_signatures_update_none on public.ledger_entry_signatures;
create policy ledger_entry_signatures_update_none on public.ledger_entry_signatures
for update using (false);
drop policy if exists ledger_entry_signatures_delete_none on public.ledger_entry_signatures;
create policy ledger_entry_signatures_delete_none on public.ledger_entry_signatures
for delete using (false);

create or replace function public.sign_ledger_entry(
  p_journal_entry_id uuid,
  p_public_key_id uuid,
  p_signature text,
  p_algorithm text default 'ed25519',
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_chain text;
  v_id uuid;
begin
  if not public.has_admin_permission('accounting.manage') then
    raise exception 'not allowed';
  end if;
  if p_journal_entry_id is null then
    raise exception 'journal_entry_id required';
  end if;
  if p_public_key_id is null then
    raise exception 'public_key_id required';
  end if;
  if nullif(btrim(coalesce(p_signature,'')), '') is null then
    raise exception 'signature required';
  end if;

  select lec.chain_hash into v_chain
  from public.ledger_entry_hash_chain lec
  where lec.journal_entry_id = p_journal_entry_id;
  if v_chain is null then
    raise exception 'hash chain missing for entry';
  end if;

  insert into public.ledger_entry_signatures(journal_entry_id, chain_hash, algorithm, signature, public_key_id, signed_by, metadata)
  values (p_journal_entry_id, v_chain, lower(coalesce(p_algorithm,'ed25519')), p_signature, p_public_key_id, auth.uid(), coalesce(p_metadata,'{}'::jsonb))
  on conflict (journal_entry_id, public_key_id) do update
  set chain_hash = excluded.chain_hash,
      algorithm = excluded.algorithm,
      signature = excluded.signature,
      signed_at = now(),
      signed_by = excluded.signed_by,
      metadata = excluded.metadata
  returning id into v_id;

  insert into public.system_audit_logs(action, module, details, performed_by, performed_at, metadata, risk_level, reason_code)
  values (
    'ledger.signature',
    'forensic',
    p_journal_entry_id::text,
    auth.uid(),
    now(),
    jsonb_build_object('entryId', p_journal_entry_id::text, 'signatureId', v_id::text, 'publicKeyId', p_public_key_id::text),
    'LOW',
    'LEDGER_SIGNATURE'
  );

  return v_id;
end;
$$;

revoke all on function public.sign_ledger_entry(uuid, uuid, text, text, jsonb) from public;
grant execute on function public.sign_ledger_entry(uuid, uuid, text, text, jsonb) to authenticated;

create or replace function public.export_ledger_hashes(
  p_start date default null,
  p_end date default null,
  p_limit int default 50000
)
returns table(
  journal_entry_id uuid,
  entry_date date,
  content_hash text,
  chain_hash text,
  prev_chain_hash text,
  signature_count int
)
language sql
stable
security definer
set search_path = public
as $$
  select
    je.id as journal_entry_id,
    je.entry_date::date as entry_date,
    lec.content_hash,
    lec.chain_hash,
    lec.prev_chain_hash,
    coalesce((
      select count(1) from public.ledger_entry_signatures s where s.journal_entry_id = je.id
    ),0) as signature_count
  from public.journal_entries je
  join public.ledger_entry_hash_chain lec on lec.journal_entry_id = je.id
  where public.has_admin_permission('accounting.view')
    and (p_start is null or je.entry_date::date >= p_start)
    and (p_end is null or je.entry_date::date <= p_end)
  order by je.entry_date asc, je.created_at asc, je.id asc
  limit greatest(coalesce(p_limit,50000),1);
$$;

revoke all on function public.export_ledger_hashes(date, date, int) from public;
grant execute on function public.export_ledger_hashes(date, date, int) to authenticated;

notify pgrst, 'reload schema';

