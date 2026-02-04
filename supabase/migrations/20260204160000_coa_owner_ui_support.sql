do $$
begin
  if to_regclass('public.chart_of_accounts') is null then
    return;
  end if;

  drop policy if exists coa_admin_select on public.chart_of_accounts;
  create policy coa_admin_select
  on public.chart_of_accounts
  for select
  using (public.has_admin_permission('accounting.view'));

  drop policy if exists coa_admin_write on public.chart_of_accounts;
  create policy coa_admin_write
  on public.chart_of_accounts
  for all
  using (public.is_owner())
  with check (public.is_owner());
end $$;

create or replace function public.list_chart_of_accounts(p_include_inactive boolean default true)
returns table(
  id uuid,
  code text,
  name text,
  account_type text,
  normal_balance text,
  is_active boolean,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_admin_permission('accounting.view') then
    raise exception 'not allowed';
  end if;

  return query
  select
    coa.id,
    coa.code,
    coa.name,
    coa.account_type,
    coa.normal_balance,
    coa.is_active,
    coa.created_at
  from public.chart_of_accounts coa
  where p_include_inactive = true or coa.is_active = true
  order by coa.code asc;
end;
$$;

revoke all on function public.list_chart_of_accounts(boolean) from public;
grant execute on function public.list_chart_of_accounts(boolean) to authenticated;

create or replace function public.create_chart_account(
  p_code text,
  p_name text,
  p_account_type text,
  p_normal_balance text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
  v_name text;
  v_id uuid;
begin
  if not public.is_owner() then
    raise exception 'not allowed';
  end if;

  v_code := btrim(coalesce(p_code, ''));
  v_name := btrim(coalesce(p_name, ''));
  if v_code = '' then
    raise exception 'code is required';
  end if;
  if v_code !~ '^[0-9]{3,10}$' then
    raise exception 'invalid code';
  end if;
  if v_name = '' then
    raise exception 'name is required';
  end if;
  if coalesce(p_account_type,'') not in ('asset','liability','equity','income','expense') then
    raise exception 'invalid account_type';
  end if;
  if coalesce(p_normal_balance,'') not in ('debit','credit') then
    raise exception 'invalid normal_balance';
  end if;

  insert into public.chart_of_accounts(code, name, account_type, normal_balance, is_active)
  values (v_code, v_name, p_account_type, p_normal_balance, true)
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.create_chart_account(text, text, text, text) from public;
grant execute on function public.create_chart_account(text, text, text, text) to authenticated;

create or replace function public.update_chart_account(
  p_account_id uuid,
  p_code text default null,
  p_name text default null,
  p_account_type text default null,
  p_normal_balance text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing record;
  v_used boolean;
  v_next_code text;
  v_next_name text;
  v_next_type text;
  v_next_balance text;
begin
  if not public.is_owner() then
    raise exception 'not allowed';
  end if;
  if p_account_id is null then
    raise exception 'account_id is required';
  end if;

  select *
  into v_existing
  from public.chart_of_accounts coa
  where coa.id = p_account_id
  for update;
  if not found then
    raise exception 'account not found';
  end if;

  select exists(select 1 from public.journal_lines jl where jl.account_id = p_account_id)
  into v_used;

  v_next_code := btrim(coalesce(p_code, v_existing.code));
  v_next_name := btrim(coalesce(p_name, v_existing.name));
  v_next_type := coalesce(p_account_type, v_existing.account_type);
  v_next_balance := coalesce(p_normal_balance, v_existing.normal_balance);

  if v_next_code = '' then
    raise exception 'code is required';
  end if;
  if v_next_code !~ '^[0-9]{3,10}$' then
    raise exception 'invalid code';
  end if;
  if v_next_name = '' then
    raise exception 'name is required';
  end if;
  if coalesce(v_next_type,'') not in ('asset','liability','equity','income','expense') then
    raise exception 'invalid account_type';
  end if;
  if coalesce(v_next_balance,'') not in ('debit','credit') then
    raise exception 'invalid normal_balance';
  end if;

  if v_used then
    if v_next_code is distinct from v_existing.code
      or v_next_type is distinct from v_existing.account_type
      or v_next_balance is distinct from v_existing.normal_balance
    then
      raise exception 'account is used and cannot change code/type/balance';
    end if;
  end if;

  update public.chart_of_accounts
  set code = v_next_code,
      name = v_next_name,
      account_type = v_next_type,
      normal_balance = v_next_balance
  where id = p_account_id;
end;
$$;

revoke all on function public.update_chart_account(uuid, text, text, text, text) from public;
grant execute on function public.update_chart_account(uuid, text, text, text, text) to authenticated;

create or replace function public.set_chart_account_active(p_account_id uuid, p_is_active boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_used boolean;
  v_is_control boolean;
  v_row record;
begin
  if not public.is_owner() then
    raise exception 'not allowed';
  end if;
  if p_account_id is null then
    raise exception 'account_id is required';
  end if;

  select *
  into v_row
  from public.chart_of_accounts coa
  where coa.id = p_account_id
  for update;
  if not found then
    raise exception 'account not found';
  end if;

  if coalesce(p_is_active, true) = false then
    select exists(select 1 from public.journal_lines jl where jl.account_id = p_account_id)
    into v_used;

    select exists (
      select 1
      from public.app_settings s
      cross join lateral jsonb_each_text(coalesce(s.data->'settings'->'accounting_accounts', '{}'::jsonb)) e
      where e.value = p_account_id::text
    )
    into v_is_control;

    if v_used then
      raise exception 'cannot deactivate account with journal lines';
    end if;
    if v_is_control then
      raise exception 'cannot deactivate control account';
    end if;
  end if;

  update public.chart_of_accounts
  set is_active = coalesce(p_is_active, true)
  where id = p_account_id;
end;
$$;

revoke all on function public.set_chart_account_active(uuid, boolean) from public;
grant execute on function public.set_chart_account_active(uuid, boolean) to authenticated;

select pg_sleep(0.5);
notify pgrst, 'reload schema';
