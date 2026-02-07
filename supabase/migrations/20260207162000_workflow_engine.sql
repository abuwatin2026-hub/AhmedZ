set app.allow_ledger_ddl = '1';

do $$
begin
  if to_regclass('public.workflow_definitions') is null then
    create table public.workflow_definitions (
      id uuid primary key default gen_random_uuid(),
      name text not null,
      module text not null,
      is_active boolean not null default true,
      created_at timestamptz not null default now(),
      created_by uuid references auth.users(id) on delete set null
    );
    create index if not exists idx_workflow_definitions_module on public.workflow_definitions(module, is_active);
  end if;
end $$;

do $$
begin
  if to_regclass('public.workflow_rules') is null then
    create table public.workflow_rules (
      id uuid primary key default gen_random_uuid(),
      definition_id uuid not null references public.workflow_definitions(id) on delete cascade,
      priority int not null default 100,
      conditions jsonb not null default '{}'::jsonb,
      steps jsonb not null default '[]'::jsonb,
      is_active boolean not null default true,
      created_at timestamptz not null default now(),
      created_by uuid references auth.users(id) on delete set null
    );
    create index if not exists idx_workflow_rules_def on public.workflow_rules(definition_id, is_active, priority);
  end if;
end $$;

do $$
begin
  if to_regclass('public.workflow_instances') is null then
    create table public.workflow_instances (
      id uuid primary key default gen_random_uuid(),
      definition_id uuid not null references public.workflow_definitions(id) on delete restrict,
      rule_id uuid not null references public.workflow_rules(id) on delete restrict,
      module text not null,
      target_table text not null,
      target_id text not null,
      company_id uuid references public.companies(id) on delete set null,
      branch_id uuid references public.branches(id) on delete set null,
      amount_base numeric not null default 0,
      currency_code text,
      status text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
      current_step int not null default 1,
      created_at timestamptz not null default now(),
      created_by uuid references auth.users(id) on delete set null,
      decided_at timestamptz,
      decided_by uuid references auth.users(id) on delete set null,
      metadata jsonb not null default '{}'::jsonb,
      unique(target_table, target_id, module, status) deferrable initially deferred
    );
    create index if not exists idx_workflow_instances_target on public.workflow_instances(target_table, target_id, status);
  end if;
end $$;

do $$
begin
  if to_regclass('public.workflow_approvals') is null then
    create table public.workflow_approvals (
      id uuid primary key default gen_random_uuid(),
      instance_id uuid not null references public.workflow_instances(id) on delete cascade,
      step_no int not null,
      decision text not null check (decision in ('approved','rejected')),
      decided_at timestamptz not null default now(),
      decided_by uuid references auth.users(id) on delete set null,
      note text,
      metadata jsonb not null default '{}'::jsonb,
      unique(instance_id, step_no, decided_by)
    );
    create index if not exists idx_workflow_approvals_instance on public.workflow_approvals(instance_id, step_no);
  end if;
end $$;

alter table public.workflow_definitions enable row level security;
alter table public.workflow_rules enable row level security;
alter table public.workflow_instances enable row level security;
alter table public.workflow_approvals enable row level security;

drop policy if exists workflow_definitions_select on public.workflow_definitions;
create policy workflow_definitions_select on public.workflow_definitions
for select using (public.has_admin_permission('accounting.view'));
drop policy if exists workflow_definitions_write on public.workflow_definitions;
create policy workflow_definitions_write on public.workflow_definitions
for all using (public.has_admin_permission('accounting.manage'))
with check (public.has_admin_permission('accounting.manage'));

drop policy if exists workflow_rules_select on public.workflow_rules;
create policy workflow_rules_select on public.workflow_rules
for select using (public.has_admin_permission('accounting.view'));
drop policy if exists workflow_rules_write on public.workflow_rules;
create policy workflow_rules_write on public.workflow_rules
for all using (public.has_admin_permission('accounting.manage'))
with check (public.has_admin_permission('accounting.manage'));

drop policy if exists workflow_instances_select on public.workflow_instances;
create policy workflow_instances_select on public.workflow_instances
for select using (public.has_admin_permission('accounting.view'));
drop policy if exists workflow_instances_insert on public.workflow_instances;
create policy workflow_instances_insert on public.workflow_instances
for insert with check (public.has_admin_permission('accounting.manage'));
drop policy if exists workflow_instances_update on public.workflow_instances;
create policy workflow_instances_update on public.workflow_instances
for update using (public.has_admin_permission('accounting.manage'))
with check (public.has_admin_permission('accounting.manage'));
drop policy if exists workflow_instances_delete_none on public.workflow_instances;
create policy workflow_instances_delete_none on public.workflow_instances
for delete using (false);

drop policy if exists workflow_approvals_select on public.workflow_approvals;
create policy workflow_approvals_select on public.workflow_approvals
for select using (public.has_admin_permission('accounting.view'));
drop policy if exists workflow_approvals_insert on public.workflow_approvals;
create policy workflow_approvals_insert on public.workflow_approvals
for insert with check (public.has_admin_permission('accounting.manage'));
drop policy if exists workflow_approvals_update_none on public.workflow_approvals;
create policy workflow_approvals_update_none on public.workflow_approvals
for update using (false);
drop policy if exists workflow_approvals_delete_none on public.workflow_approvals;
create policy workflow_approvals_delete_none on public.workflow_approvals
for delete using (false);

create or replace function public._match_workflow_rule(p_conditions jsonb, p_amount numeric, p_company_id uuid, p_branch_id uuid, p_currency text)
returns boolean
language plpgsql
immutable
as $$
declare
  v_min numeric;
  v_max numeric;
  v_ccy text;
begin
  v_min := nullif(p_conditions->>'minAmount','')::numeric;
  v_max := nullif(p_conditions->>'maxAmount','')::numeric;
  v_ccy := nullif(p_conditions->>'currency','');

  if v_min is not null and p_amount < v_min then
    return false;
  end if;
  if v_max is not null and p_amount > v_max then
    return false;
  end if;
  if v_ccy is not null and upper(v_ccy) <> upper(coalesce(p_currency,'')) then
    return false;
  end if;
  if p_conditions ? 'companyId' then
    if nullif(p_conditions->>'companyId','')::uuid is distinct from p_company_id then
      return false;
    end if;
  end if;
  if p_conditions ? 'branchId' then
    if nullif(p_conditions->>'branchId','')::uuid is distinct from p_branch_id then
      return false;
    end if;
  end if;
  return true;
exception
  when others then
    return false;
end;
$$;

create or replace function public.start_workflow(
  p_module text,
  p_target_table text,
  p_target_id text,
  p_amount_base numeric,
  p_currency_code text default null,
  p_company_id uuid default null,
  p_branch_id uuid default null,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_def uuid;
  v_rule record;
  v_id uuid;
begin
  if not public.has_admin_permission('accounting.manage') then
    raise exception 'not allowed';
  end if;
  if p_module is null or btrim(p_module) = '' then
    raise exception 'module required';
  end if;
  if p_target_table is null or btrim(p_target_table) = '' then
    raise exception 'target_table required';
  end if;
  if p_target_id is null or btrim(p_target_id) = '' then
    raise exception 'target_id required';
  end if;

  select wd.id
  into v_def
  from public.workflow_definitions wd
  where wd.is_active = true
    and lower(wd.module) = lower(p_module)
  order by wd.created_at desc
  limit 1;

  if v_def is null then
    return null;
  end if;

  select wr.*
  into v_rule
  from public.workflow_rules wr
  where wr.definition_id = v_def
    and wr.is_active = true
    and public._match_workflow_rule(wr.conditions, coalesce(p_amount_base,0), p_company_id, p_branch_id, p_currency_code)
  order by wr.priority asc, wr.created_at asc
  limit 1;

  if not found then
    return null;
  end if;

  insert into public.workflow_instances(definition_id, rule_id, module, target_table, target_id, company_id, branch_id, amount_base, currency_code, status, current_step, created_by, metadata)
  values (v_def, v_rule.id, lower(p_module), lower(p_target_table), p_target_id, p_company_id, p_branch_id, coalesce(p_amount_base,0), upper(nullif(p_currency_code,'')), 'pending', 1, auth.uid(), coalesce(p_metadata,'{}'::jsonb))
  returning id into v_id;

  insert into public.system_audit_logs(action, module, details, performed_by, performed_at, metadata, risk_level, reason_code)
  values (
    'workflow.start',
    'workflow',
    v_id::text,
    auth.uid(),
    now(),
    jsonb_build_object('instanceId', v_id::text, 'module', p_module, 'targetTable', p_target_table, 'targetId', p_target_id),
    'LOW',
    'WORKFLOW_START'
  );

  return v_id;
end;
$$;

revoke all on function public.start_workflow(text, text, text, numeric, text, uuid, uuid, jsonb) from public;
grant execute on function public.start_workflow(text, text, text, numeric, text, uuid, uuid, jsonb) to authenticated;

create or replace function public.decide_workflow(
  p_instance_id uuid,
  p_decision text,
  p_note text default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inst public.workflow_instances%rowtype;
  v_rule public.workflow_rules%rowtype;
  v_steps jsonb;
  v_step jsonb;
  v_permission text;
  v_min int;
  v_mode text;
  v_approved_count int;
begin
  if not public.has_admin_permission('accounting.manage') then
    raise exception 'not allowed';
  end if;

  if p_instance_id is null then
    raise exception 'instance_id required';
  end if;

  select * into v_inst
  from public.workflow_instances wi
  where wi.id = p_instance_id
  for update;

  if not found then
    raise exception 'workflow instance not found';
  end if;

  if v_inst.status <> 'pending' then
    return v_inst.status;
  end if;

  select * into v_rule
  from public.workflow_rules wr
  where wr.id = v_inst.rule_id;

  v_steps := coalesce(v_rule.steps, '[]'::jsonb);
  v_step := null;
  select value into v_step
  from jsonb_array_elements(v_steps)
  where (value->>'stepNo')::int = v_inst.current_step
  limit 1;

  if v_step is null then
    update public.workflow_instances
    set status = 'approved',
        decided_at = now(),
        decided_by = auth.uid()
    where id = v_inst.id;
    return 'approved';
  end if;

  v_permission := nullif(v_step->>'approverPermission','');
  if v_permission is not null and not public.has_admin_permission(v_permission) then
    raise exception 'missing permission %', v_permission;
  end if;

  if lower(coalesce(p_decision,'')) not in ('approved','rejected') then
    raise exception 'invalid decision';
  end if;

  insert into public.workflow_approvals(instance_id, step_no, decision, decided_by, note)
  values (v_inst.id, v_inst.current_step, lower(p_decision), auth.uid(), nullif(trim(coalesce(p_note,'')), ''))
  on conflict (instance_id, step_no, decided_by) do nothing;

  if lower(p_decision) = 'rejected' then
    update public.workflow_instances
    set status = 'rejected',
        decided_at = now(),
        decided_by = auth.uid()
    where id = v_inst.id;
    insert into public.system_audit_logs(action, module, details, performed_by, performed_at, metadata, risk_level, reason_code)
    values ('workflow.reject','workflow',v_inst.id::text,auth.uid(),now(),jsonb_build_object('instanceId',v_inst.id::text),'MEDIUM','WORKFLOW_REJECT');
    return 'rejected';
  end if;

  v_mode := lower(coalesce(v_step->>'mode','serial'));
  v_min := coalesce(nullif(v_step->>'minApprovals','')::int, 1);

  select count(*) into v_approved_count
  from public.workflow_approvals wa
  where wa.instance_id = v_inst.id
    and wa.step_no = v_inst.current_step
    and wa.decision = 'approved';

  if v_mode = 'parallel' then
    if v_approved_count < greatest(v_min, 1) then
      insert into public.system_audit_logs(action, module, details, performed_by, performed_at, metadata, risk_level, reason_code)
      values ('workflow.approve_step_partial','workflow',v_inst.id::text,auth.uid(),now(),jsonb_build_object('instanceId',v_inst.id::text,'step',v_inst.current_step,'approvedCount',v_approved_count),'LOW','WORKFLOW_STEP_PARTIAL');
      return 'pending';
    end if;
  end if;

  update public.workflow_instances
  set current_step = current_step + 1
  where id = v_inst.id;

  select * into v_inst from public.workflow_instances where id = p_instance_id;

  select value into v_step
  from jsonb_array_elements(v_steps)
  where (value->>'stepNo')::int = v_inst.current_step
  limit 1;

  if v_step is null then
    update public.workflow_instances
    set status = 'approved',
        decided_at = now(),
        decided_by = auth.uid()
    where id = v_inst.id;
    insert into public.system_audit_logs(action, module, details, performed_by, performed_at, metadata, risk_level, reason_code)
    values ('workflow.approve','workflow',v_inst.id::text,auth.uid(),now(),jsonb_build_object('instanceId',v_inst.id::text),'LOW','WORKFLOW_APPROVE');
    return 'approved';
  end if;

  insert into public.system_audit_logs(action, module, details, performed_by, performed_at, metadata, risk_level, reason_code)
  values ('workflow.advance','workflow',v_inst.id::text,auth.uid(),now(),jsonb_build_object('instanceId',v_inst.id::text,'step',v_inst.current_step),'LOW','WORKFLOW_ADVANCE');

  return 'pending';
end;
$$;

revoke all on function public.decide_workflow(uuid, text, text) from public;
grant execute on function public.decide_workflow(uuid, text, text) to authenticated;

create or replace function public.get_workflow_status(p_module text, p_target_table text, p_target_id text)
returns table(
  instance_id uuid,
  status text,
  current_step int,
  amount_base numeric,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    wi.id,
    wi.status,
    wi.current_step,
    wi.amount_base,
    wi.created_at
  from public.workflow_instances wi
  where public.has_admin_permission('accounting.view')
    and lower(wi.module) = lower(p_module)
    and lower(wi.target_table) = lower(p_target_table)
    and wi.target_id = p_target_id
  order by wi.created_at desc
  limit 1;
$$;

revoke all on function public.get_workflow_status(text, text, text) from public;
grant execute on function public.get_workflow_status(text, text, text) to authenticated;

create or replace function public.approve_party_document_with_workflow(p_document_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_doc public.party_documents%rowtype;
  v_amount numeric := 0;
  v_wf uuid;
  v_status record;
begin
  if not public.has_admin_permission('accounting.approve') then
    raise exception 'not allowed';
  end if;
  select * into v_doc from public.party_documents where id = p_document_id;
  if not found then
    raise exception 'document not found';
  end if;

  select coalesce(sum(
    greatest(coalesce(nullif(l->>'debit','')::numeric,0), coalesce(nullif(l->>'credit','')::numeric,0))
  ),0)
  into v_amount
  from jsonb_array_elements(coalesce(v_doc.lines,'[]'::jsonb)) l;

  v_wf := public.start_workflow('party_documents', 'party_documents', v_doc.id::text, v_amount, null, null, null, jsonb_build_object('docType', v_doc.doc_type, 'docNumber', v_doc.doc_number));

  if v_wf is not null then
    select * into v_status from public.get_workflow_status('party_documents','party_documents', v_doc.id::text);
    if v_status.status is distinct from 'approved' then
      raise exception 'workflow pending for document %', v_doc.id;
    end if;
  end if;

  return public.approve_party_document(p_document_id);
end;
$$;

revoke all on function public.approve_party_document_with_workflow(uuid) from public;
grant execute on function public.approve_party_document_with_workflow(uuid) to authenticated;

notify pgrst, 'reload schema';

