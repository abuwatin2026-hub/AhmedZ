-- ================================================================
-- Custom WebAuthn Passkey credentials storage
-- Independent of Supabase MFA (which requires Pro plan)
-- ================================================================

-- Table: passkey_credentials
create table if not exists public.passkey_credentials (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references public.customers(auth_user_id) on delete cascade,
  credential_id     text not null unique,               -- base64url encoded credential ID
  public_key_cbor   text not null,                      -- base64url encoded CBOR public key
  sign_count        bigint not null default 0,
  aaguid            text,                               -- authenticator AAGUID
  device_name       text not null default 'Passkey',    -- friendly name
  transports        text[],                             -- ['internal','hybrid',...]
  created_at        timestamptz not null default now(),
  last_used_at      timestamptz,
  constraint passkey_credentials_user_id_max check (true) -- allow multiple per user
);

-- Table: passkey_challenges (ephemeral, 5-min TTL)
create table if not exists public.passkey_challenges (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null,
  challenge   text not null,        -- base64url encoded random bytes
  purpose     text not null default 'registration',  -- 'registration' | 'authentication'
  expires_at  timestamptz not null default (now() + interval '5 minutes'),
  created_at  timestamptz not null default now()
);

-- Auto-cleanup expired challenges
create or replace function public.cleanup_passkey_challenges()
returns void language sql security definer as $$
  delete from public.passkey_challenges where expires_at < now();
$$;

-- RLS
alter table public.passkey_credentials enable row level security;
alter table public.passkey_challenges enable row level security;

-- Policies: users can only see their own credentials
drop policy if exists "customers can read own passkeys" on public.passkey_credentials;
create policy "customers can read own passkeys"
  on public.passkey_credentials for select
  using (auth.uid() = user_id);

drop policy if exists "service can manage passkeys" on public.passkey_credentials;
create policy "service can manage passkeys"
  on public.passkey_credentials for all
  using (true) with check (true);

-- passkey_challenges: all via service role only
drop policy if exists "service manages challenges" on public.passkey_challenges;
create policy "service manages challenges"
  on public.passkey_challenges for all
  using (true) with check (true);

-- RPC: list user's passkeys (called from frontend with user JWT)
create or replace function public.list_passkey_credentials()
returns table (
  id uuid,
  device_name text,
  aaguid text,
  created_at timestamptz,
  last_used_at timestamptz,
  transports text[]
)
language sql
security definer
set search_path = public
as $$
  select id, device_name, aaguid, created_at, last_used_at, transports
  from public.passkey_credentials
  where user_id = auth.uid()
  order by created_at desc;
$$;

grant execute on function public.list_passkey_credentials() to authenticated;

-- RPC: delete a passkey (user can only delete their own)
create or replace function public.delete_passkey_credential(p_credential_pk uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_count int;
begin
  delete from public.passkey_credentials
  where id = p_credential_pk and user_id = auth.uid();
  get diagnostics deleted_count = row_count;
  return deleted_count > 0;
end;
$$;

grant execute on function public.delete_passkey_credential(uuid) to authenticated;

notify pgrst, 'reload schema';
