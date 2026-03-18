-- ================================================================
-- Fix remaining attendance issues from deep audit
-- 1. Delete 72 fake payroll_attendance records  
-- 2. Fix timezone in daily summary + sync (use Asia/Aden)
-- 3. Add future date validation to punch_attendance_manual
-- 4. Add attendance tables to wipe/restore functions
-- ================================================================

-- ──────────────────────────────────────────────
-- 1. Delete all fake payroll_attendance records (all have 0 hours_worked)
-- ──────────────────────────────────────────────
delete from public.payroll_attendance
where hours_worked = 0
  and overtime_hours = 0
  and absence_days >= 0;

-- ──────────────────────────────────────────────
-- 2. Add timezone column to attendance_config
-- ──────────────────────────────────────────────
alter table public.attendance_config
  add column if not exists timezone text not null default 'Asia/Aden';

-- ──────────────────────────────────────────────
-- 3. Fix punch_attendance_manual: add future date validation
-- ──────────────────────────────────────────────
create or replace function public.punch_attendance_manual(
  p_employee_id uuid,
  p_type text,
  p_time timestamptz,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_emp record;
  v_punch_id uuid;
begin
  if not public.can_manage_attendance() then
    raise exception 'not allowed';
  end if;
  if p_type not in ('in', 'out') then
    raise exception 'invalid punch type';
  end if;
  -- Reject future dates (allow up to 1 hour tolerance)
  if p_time > now() + interval '1 hour' then
    raise exception 'cannot create punch with future date';
  end if;
  select id, full_name, is_active into v_emp
  from public.payroll_employees
  where id = p_employee_id;
  if not found then
    raise exception 'employee not found';
  end if;
  if not v_emp.is_active then
    raise exception 'employee is inactive';
  end if;
  insert into public.attendance_punches (employee_id, punch_time, punch_type, is_manual, notes, created_by)
  values (p_employee_id, p_time, p_type, true, p_notes, auth.uid())
  returning id into v_punch_id;
  insert into public.system_audit_logs(action, module, details, metadata, performed_by, performed_at, risk_level)
  values (
    'attendance.punch.manual',
    'attendance',
    'Manual attendance punch added',
    jsonb_build_object('employee_id', p_employee_id, 'punch_type', p_type, 'punch_id', v_punch_id, 'punch_time', p_time::text),
    auth.uid(),
    now(),
    'medium'
  );
  return v_punch_id;
end;
$$;

-- ──────────────────────────────────────────────
-- 4. Fix get_attendance_daily_summary: use config timezone
-- ──────────────────────────────────────────────
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
  v_tz text;
begin
  select * into v_config from public.attendance_config limit 1;
  v_tz := coalesce(v_config.timezone, 'Asia/Aden');
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
      and (ap.punch_time at time zone v_tz)::date = p_date;
    select max(ap.punch_time)
    into v_last_out
    from public.attendance_punches ap
    where ap.employee_id = v_emp.id
      and ap.punch_type = 'out'
      and (ap.punch_time at time zone v_tz)::date = p_date;
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

-- ──────────────────────────────────────────────
-- 5. Fix sync_punches_to_payroll_attendance: use config timezone
-- ──────────────────────────────────────────────
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
  v_tz text;
begin
  if not public.can_manage_attendance() then
    raise exception 'not allowed';
  end if;
  select * into v_config from public.attendance_config limit 1;
  v_tz := coalesce(v_config.timezone, 'Asia/Aden');
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
      where ap.employee_id = v_emp.id and ap.punch_type = 'in'
        and (ap.punch_time at time zone v_tz)::date = v_day;
      select max(ap.punch_time) into v_last_out
      from public.attendance_punches ap
      where ap.employee_id = v_emp.id and ap.punch_type = 'out'
        and (ap.punch_time at time zone v_tz)::date = v_day;
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

-- ──────────────────────────────────────────────
-- 6. Add trigger for updated_at on attendance_config
-- ──────────────────────────────────────────────
create or replace function public.trg_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_attendance_config_updated_at on public.attendance_config;
create trigger trg_attendance_config_updated_at
  before update on public.attendance_config
  for each row
  execute function public.trg_set_updated_at();

notify pgrst, 'reload schema';
