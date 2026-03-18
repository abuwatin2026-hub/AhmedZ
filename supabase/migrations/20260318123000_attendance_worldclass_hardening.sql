create or replace function public.can_manage_attendance()
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  return public.is_admin()
    or public.can_manage_expenses()
    or public.has_admin_permission('accounting.manage')
    or public.has_admin_permission('expenses.manage');
end;
$$;

alter table public.payroll_employees
  add column if not exists pin_hash text,
  add column if not exists pin_fingerprint text,
  add column if not exists pin_updated_at timestamptz;

update public.payroll_employees
set
  pin_hash = crypt(trim(pin), gen_salt('bf')),
  pin_fingerprint = encode(digest(trim(pin), 'sha256'), 'hex'),
  pin_updated_at = now()
where pin is not null
  and trim(pin) ~ '^[0-9]{4}$'
  and (pin_hash is null or pin_fingerprint is null);

update public.payroll_employees
set pin = null
where pin is not null;

drop index if exists idx_payroll_employees_pin;

create unique index if not exists idx_payroll_employees_pin_fingerprint
  on public.payroll_employees(pin_fingerprint)
  where pin_fingerprint is not null;

alter table public.attendance_config
  add column if not exists allowed_origins text[] not null default '{}',
  add column if not exists weekend_days integer[] not null default '{5}';

create table if not exists public.attendance_webauthn_challenges (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null,
  challenge text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_attendance_webauthn_challenges_lookup
  on public.attendance_webauthn_challenges(auth_user_id, challenge);

alter table public.attendance_webauthn_challenges enable row level security;

drop policy if exists attendance_webauthn_challenges_none on public.attendance_webauthn_challenges;
create policy attendance_webauthn_challenges_none
on public.attendance_webauthn_challenges
for all
using (false)
with check (false);

drop policy if exists attendance_punches_insert on public.attendance_punches;
create policy attendance_punches_insert
on public.attendance_punches
for insert
to authenticated
with check (public.can_manage_attendance());

create or replace function public.issue_attendance_webauthn_challenge()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_challenge text;
begin
  if auth.uid() is null or not public.is_system_user(auth.uid()) then
    raise exception 'not allowed';
  end if;
  v_challenge := replace(replace(replace(encode(gen_random_bytes(32), 'base64'), '+', '-'), '/', '_'), '=', '');
  insert into public.attendance_webauthn_challenges (auth_user_id, challenge, expires_at)
  values (auth.uid(), v_challenge, now() + interval '2 minutes');
  return v_challenge;
end;
$$;

create or replace function public.set_employee_pin(
  p_employee_id uuid,
  p_pin text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fingerprint text;
begin
  if not public.can_manage_attendance() then
    raise exception 'not allowed';
  end if;
  if p_pin is null or trim(p_pin) !~ '^[0-9]{4}$' then
    raise exception 'invalid PIN format';
  end if;
  v_fingerprint := encode(digest(trim(p_pin), 'sha256'), 'hex');
  if exists (
    select 1
    from public.payroll_employees pe
    where pe.pin_fingerprint = v_fingerprint
      and pe.id <> p_employee_id
  ) then
    raise exception 'PIN already used by another employee';
  end if;
  update public.payroll_employees
  set pin_hash = crypt(trim(p_pin), gen_salt('bf')),
      pin_fingerprint = v_fingerprint,
      pin = null,
      pin_updated_at = now()
  where id = p_employee_id;
  if not found then
    raise exception 'employee not found';
  end if;
  insert into public.system_audit_logs(action, module, details, metadata, performed_by, performed_at, risk_level)
  values ('attendance.pin.set', 'attendance', 'Set employee attendance PIN', jsonb_build_object('employee_id', p_employee_id), auth.uid(), now(), 'medium');
end;
$$;

create or replace function public.clear_employee_pin(
  p_employee_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.can_manage_attendance() then
    raise exception 'not allowed';
  end if;
  update public.payroll_employees
  set pin_hash = null,
      pin_fingerprint = null,
      pin = null,
      pin_updated_at = now()
  where id = p_employee_id;
  if not found then
    raise exception 'employee not found';
  end if;
  insert into public.system_audit_logs(action, module, details, metadata, performed_by, performed_at, risk_level)
  values ('attendance.pin.clear', 'attendance', 'Cleared employee attendance PIN', jsonb_build_object('employee_id', p_employee_id), auth.uid(), now(), 'high');
end;
$$;

create or replace function public.punch_attendance_pin(
  p_pin text,
  p_type text,
  p_ip text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_emp record;
  v_config record;
  v_ip text;
  v_last_punch record;
  v_punch_id uuid;
  v_pin text;
  v_pin_fingerprint text;
begin
  if auth.uid() is null or not public.is_system_user(auth.uid()) then
    raise exception 'not allowed';
  end if;
  if p_type not in ('in', 'out') then
    raise exception 'invalid punch type';
  end if;
  v_pin := trim(coalesce(p_pin, ''));
  if v_pin !~ '^[0-9]{4}$' then
    raise exception 'invalid PIN';
  end if;
  v_pin_fingerprint := encode(digest(v_pin, 'sha256'), 'hex');
  select id, full_name, employee_code, is_active, pin_hash
  into v_emp
  from public.payroll_employees
  where pin_fingerprint = v_pin_fingerprint;
  if not found or v_emp.pin_hash is null or crypt(v_pin, v_emp.pin_hash) <> v_emp.pin_hash then
    raise exception 'PIN not found';
  end if;
  if not v_emp.is_active then
    raise exception 'employee is inactive';
  end if;
  v_ip := coalesce(trim(p_ip), '');
  select * into v_config from public.attendance_config limit 1;
  if v_config.allowed_ips is not null and array_length(v_config.allowed_ips, 1) > 0 then
    if v_ip = '' then
      raise exception 'missing punch origin IP';
    end if;
    if not (v_ip = any(v_config.allowed_ips)) then
      raise exception 'punch not allowed from this location';
    end if;
  end if;
  select * into v_last_punch
  from public.attendance_punches
  where employee_id = v_emp.id
  order by punch_time desc
  limit 1;
  if found then
    if v_last_punch.punch_type = p_type then
      if p_type = 'in' then
        raise exception 'already clocked in; clock-out required first';
      end if;
      raise exception 'already clocked out; clock-in required first';
    end if;
    if v_last_punch.punch_time > now() - interval '2 minutes' then
      raise exception 'duplicate punch within 2 minutes';
    end if;
  elsif p_type = 'out' then
    raise exception 'cannot clock out before clock in';
  end if;
  insert into public.attendance_punches (employee_id, punch_time, punch_type, ip_address, is_manual)
  values (v_emp.id, now(), p_type, v_ip, false)
  returning id into v_punch_id;
  insert into public.system_audit_logs(action, module, details, metadata, performed_by, performed_at, risk_level)
  values (
    'attendance.punch.pin',
    'attendance',
    'Attendance punch recorded with PIN',
    jsonb_build_object('employee_id', v_emp.id, 'punch_type', p_type, 'punch_id', v_punch_id, 'ip', nullif(v_ip, '')),
    auth.uid(),
    now(),
    'low'
  );
  return jsonb_build_object(
    'success', true,
    'punch_id', v_punch_id,
    'employee_name', v_emp.full_name,
    'employee_code', v_emp.employee_code,
    'punch_type', p_type,
    'punch_time', now()::text
  );
end;
$$;

create or replace function public.punch_attendance_webauthn(
  p_credential_id text,
  p_type text,
  p_ip text default null,
  p_challenge text default null,
  p_client_data_json text default null,
  p_authenticator_data text default null,
  p_signature text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_emp record;
  v_config record;
  v_ip text;
  v_last_punch record;
  v_punch_id uuid;
  v_challenge_rows integer;
  v_client_data jsonb;
begin
  if auth.uid() is null or not public.is_system_user(auth.uid()) then
    raise exception 'not allowed';
  end if;
  if p_type not in ('in', 'out') then
    raise exception 'invalid punch type';
  end if;
  if p_credential_id is null or length(trim(p_credential_id)) < 5 then
    raise exception 'invalid credential';
  end if;
  if coalesce(trim(p_challenge), '') = '' then
    raise exception 'missing challenge';
  end if;
  if coalesce(trim(p_client_data_json), '') = '' or coalesce(trim(p_authenticator_data), '') = '' or coalesce(trim(p_signature), '') = '' then
    raise exception 'incomplete webauthn assertion';
  end if;
  begin
    v_client_data := convert_from(
      decode(
        replace(replace(trim(p_client_data_json), '-', '+'), '_', '/') || repeat('=', (4 - length(trim(p_client_data_json)) % 4) % 4),
        'base64'
      ),
      'utf8'
    )::jsonb;
  exception when others then
    raise exception 'invalid clientDataJSON';
  end;
  if coalesce(v_client_data->>'type', '') <> 'webauthn.get' then
    raise exception 'invalid webauthn type';
  end if;
  if coalesce(v_client_data->>'challenge', '') <> trim(p_challenge) then
    raise exception 'challenge mismatch';
  end if;
  update public.attendance_webauthn_challenges
  set used_at = now()
  where auth_user_id = auth.uid()
    and challenge = trim(p_challenge)
    and used_at is null
    and expires_at > now();
  get diagnostics v_challenge_rows = row_count;
  if v_challenge_rows = 0 then
    raise exception 'invalid or expired challenge';
  end if;
  select id, full_name, employee_code, is_active
  into v_emp
  from public.payroll_employees
  where webauthn_credential_id = trim(p_credential_id);
  if not found then
    raise exception 'credential not registered';
  end if;
  if not v_emp.is_active then
    raise exception 'employee is inactive';
  end if;
  v_ip := coalesce(trim(p_ip), '');
  select * into v_config from public.attendance_config limit 1;
  if v_config.allowed_origins is not null and array_length(v_config.allowed_origins, 1) > 0 then
    if coalesce(v_client_data->>'origin', '') = '' then
      raise exception 'missing client origin';
    end if;
    if not ((v_client_data->>'origin') = any(v_config.allowed_origins)) then
      raise exception 'origin not allowed';
    end if;
  end if;
  if v_config.allowed_ips is not null and array_length(v_config.allowed_ips, 1) > 0 then
    if v_ip = '' then
      raise exception 'missing punch origin IP';
    end if;
    if not (v_ip = any(v_config.allowed_ips)) then
      raise exception 'punch not allowed from this location';
    end if;
  end if;
  select * into v_last_punch
  from public.attendance_punches
  where employee_id = v_emp.id
  order by punch_time desc
  limit 1;
  if found then
    if v_last_punch.punch_type = p_type then
      if p_type = 'in' then
        raise exception 'already clocked in; clock-out required first';
      end if;
      raise exception 'already clocked out; clock-in required first';
    end if;
    if v_last_punch.punch_time > now() - interval '2 minutes' then
      raise exception 'duplicate punch within 2 minutes';
    end if;
  elsif p_type = 'out' then
    raise exception 'cannot clock out before clock in';
  end if;
  insert into public.attendance_punches (employee_id, punch_time, punch_type, ip_address, is_manual)
  values (v_emp.id, now(), p_type, v_ip, false)
  returning id into v_punch_id;
  insert into public.system_audit_logs(action, module, details, metadata, performed_by, performed_at, risk_level)
  values (
    'attendance.punch.webauthn',
    'attendance',
    'Attendance punch recorded with WebAuthn',
    jsonb_build_object('employee_id', v_emp.id, 'punch_type', p_type, 'punch_id', v_punch_id, 'ip', nullif(v_ip, '')),
    auth.uid(),
    now(),
    'low'
  );
  return jsonb_build_object(
    'success', true,
    'punch_id', v_punch_id,
    'employee_name', v_emp.full_name,
    'employee_code', v_emp.employee_code,
    'punch_type', p_type,
    'punch_time', now()::text
  );
end;
$$;

create or replace function public.get_attendance_daily_summary(
  p_date date default current_date
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_config record;
  v_result jsonb := '[]'::jsonb;
  v_emp record;
  v_first_in timestamptz;
  v_last_out timestamptz;
  v_hours numeric;
  v_status text;
  v_overtime numeric;
  v_is_weekend boolean;
begin
  select * into v_config from public.attendance_config limit 1;
  for v_emp in
    select pe.id, pe.full_name, pe.employee_code
    from public.payroll_employees pe
    where pe.is_active = true
    order by pe.full_name
  loop
    v_is_weekend := (extract(dow from p_date)::int = any(coalesce(v_config.weekend_days, '{5}'::int[])));
    select min(ap.punch_time)
    into v_first_in
    from public.attendance_punches ap
    where ap.employee_id = v_emp.id
      and ap.punch_type = 'in'
      and ap.punch_time::date = p_date;
    select max(ap.punch_time)
    into v_last_out
    from public.attendance_punches ap
    where ap.employee_id = v_emp.id
      and ap.punch_type = 'out'
      and ap.punch_time::date = p_date;
    if v_first_in is null then
      v_hours := 0;
      v_status := case when v_is_weekend then 'offday' else 'absent' end;
      v_overtime := 0;
    else
      if v_last_out is not null and v_last_out > v_first_in then
        v_hours := round(extract(epoch from (v_last_out - v_first_in)) / 3600.0, 2);
      else
        v_hours := 0;
        v_status := 'incomplete';
      end if;
      if v_hours > 0 then
        if v_first_in::time > (v_config.work_start_time + (v_config.late_threshold_minutes || ' minutes')::interval) then
          v_status := 'late';
        else
          v_status := 'present';
        end if;
        if v_hours > v_config.work_hours_per_day then
          v_overtime := round(v_hours - v_config.work_hours_per_day, 2);
        else
          v_overtime := 0;
        end if;
      end if;
    end if;
    v_result := v_result || jsonb_build_object(
      'employee_id', v_emp.id,
      'employee_name', v_emp.full_name,
      'employee_code', v_emp.employee_code,
      'date', p_date,
      'first_in', v_first_in,
      'last_out', v_last_out,
      'hours_worked', coalesce(v_hours, 0),
      'overtime_hours', coalesce(v_overtime, 0),
      'status', coalesce(v_status, 'absent')
    );
  end loop;
  return v_result;
end;
$$;

create or replace function public.sync_punches_to_payroll_attendance(
  p_year integer,
  p_month integer
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_config record;
  v_start_date date;
  v_end_date date;
  v_day date;
  v_emp record;
  v_first_in timestamptz;
  v_last_out timestamptz;
  v_hours numeric;
  v_overtime numeric;
  v_absence numeric;
  v_count integer := 0;
  v_is_weekend boolean;
begin
  if not public.can_manage_attendance() then
    raise exception 'not allowed';
  end if;
  select * into v_config from public.attendance_config limit 1;
  v_start_date := make_date(p_year, p_month, 1);
  v_end_date := (v_start_date + interval '1 month' - interval '1 day')::date;
  for v_emp in select id from public.payroll_employees where is_active = true
  loop
    v_day := v_start_date;
    while v_day <= v_end_date loop
      if v_day > current_date then
        exit;
      end if;
      v_is_weekend := (extract(dow from v_day)::int = any(coalesce(v_config.weekend_days, '{5}'::int[])));
      select min(ap.punch_time) into v_first_in
      from public.attendance_punches ap
      where ap.employee_id = v_emp.id and ap.punch_type = 'in' and ap.punch_time::date = v_day;
      select max(ap.punch_time) into v_last_out
      from public.attendance_punches ap
      where ap.employee_id = v_emp.id and ap.punch_type = 'out' and ap.punch_time::date = v_day;
      if v_is_weekend then
        v_hours := 0;
        v_absence := 0;
        v_overtime := 0;
      elsif v_first_in is null then
        v_hours := 0;
        v_absence := 1;
        v_overtime := 0;
      else
        if v_last_out is not null and v_last_out > v_first_in then
          v_hours := round(extract(epoch from (v_last_out - v_first_in)) / 3600.0, 2);
        else
          v_hours := 0;
        end if;
        v_absence := 0;
        if v_hours > v_config.work_hours_per_day then
          v_overtime := round(v_hours - v_config.work_hours_per_day, 2);
        else
          v_overtime := 0;
        end if;
      end if;
      insert into public.payroll_attendance (employee_id, work_date, hours_worked, overtime_hours, overtime_rate_multiplier, absence_days)
      values (v_emp.id, v_day, v_hours, v_overtime, v_config.overtime_rate_multiplier, v_absence)
      on conflict (employee_id, work_date) do update
        set hours_worked = excluded.hours_worked,
            overtime_hours = excluded.overtime_hours,
            overtime_rate_multiplier = excluded.overtime_rate_multiplier,
            absence_days = excluded.absence_days;
      v_count := v_count + 1;
      v_day := v_day + 1;
    end loop;
  end loop;
  return v_count;
end;
$$;

create or replace function public.register_employee_webauthn(
  p_employee_id uuid,
  p_credential_id text,
  p_public_key text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.can_manage_attendance() then
    raise exception 'not allowed';
  end if;
  update public.payroll_employees
  set webauthn_credential_id = p_credential_id,
      webauthn_public_key = p_public_key
  where id = p_employee_id;
  if not found then
    raise exception 'employee not found';
  end if;
  insert into public.system_audit_logs(action, module, details, metadata, performed_by, performed_at, risk_level)
  values ('attendance.webauthn.register', 'attendance', 'Registered employee WebAuthn credential', jsonb_build_object('employee_id', p_employee_id), auth.uid(), now(), 'medium');
end;
$$;

create or replace function public.get_attendance_webauthn_credentials()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.is_system_user(auth.uid()) then
    raise exception 'not allowed';
  end if;
  return (
    select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb)
    from (
      select pe.id as employee_id, pe.webauthn_credential_id as credential_id,
             pe.full_name, pe.employee_code
      from public.payroll_employees pe
      where pe.is_active = true
        and pe.webauthn_credential_id is not null
    ) t
  );
end;
$$;

revoke execute on function public.punch_attendance_webauthn(text, text, text) from authenticated;
grant execute on function public.punch_attendance_webauthn(text, text, text, text, text, text, text) to authenticated;
grant execute on function public.issue_attendance_webauthn_challenge() to authenticated;
grant execute on function public.set_employee_pin(uuid, text) to authenticated;
grant execute on function public.clear_employee_pin(uuid) to authenticated;

notify pgrst, 'reload schema';
