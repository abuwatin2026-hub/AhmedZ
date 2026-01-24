create or replace function public.get_invoice_audit(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_order record;
  v_invoice_snapshot jsonb;
  v_journal_entry_id uuid;
  v_promotions jsonb;
  v_manual_discount numeric := 0;
  v_discount_type text := 'None';
begin
  v_actor := auth.uid();
  if v_actor is null then
    raise exception 'not authenticated';
  end if;

  select o.*, o.data->'invoiceSnapshot' as invoice_snapshot
  into v_order
  from public.orders o
  where o.id = p_order_id;

  if not found then
    raise exception 'order not found';
  end if;

  if not (
    public.is_admin()
    or public.has_admin_permission('orders.view')
    or v_order.customer_auth_user_id = v_actor
  ) then
    raise exception 'not authorized';
  end if;

  v_invoice_snapshot := coalesce(v_order.invoice_snapshot, '{}'::jsonb);

  select je.id
  into v_journal_entry_id
  from public.journal_entries je
  where je.source_table = 'orders'
    and je.source_id = p_order_id::text
    and je.source_event = 'delivered'
  order by je.created_at desc
  limit 1;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'promotionUsageId', pu.id::text,
        'promotionLineId', pu.promotion_line_id::text,
        'promotionId', pu.promotion_id::text,
        'promotionName', coalesce(nullif(pu.snapshot->>'name',''), pr.name),
        'approvalRequestId', case when pr.approval_request_id is null then null else pr.approval_request_id::text end,
        'approvalStatus', pr.approval_status,
        'bundleQty', pu.bundle_qty,
        'computedOriginalTotal', nullif(pu.snapshot->>'computedOriginalTotal','')::numeric,
        'finalTotal', nullif(pu.snapshot->>'finalTotal','')::numeric,
        'promotionExpense', nullif(pu.snapshot->>'promotionExpense','')::numeric
      )
      order by pu.created_at asc
    ),
    '[]'::jsonb
  )
  into v_promotions
  from public.promotion_usage pu
  left join public.promotions pr on pr.id = pu.promotion_id
  where pu.order_id = p_order_id;

  v_manual_discount := coalesce(
    nullif(v_invoice_snapshot->>'discountAmount','')::numeric,
    nullif(v_order.data->>'discountAmount','')::numeric,
    0
  );

  if jsonb_typeof(v_promotions) = 'array' and jsonb_array_length(v_promotions) > 0 then
    v_discount_type := 'Promotion';
  elsif v_manual_discount > 0 then
    v_discount_type := 'Manual Discount';
  end if;

  return jsonb_build_object(
    'orderId', p_order_id::text,
    'invoiceNumber', coalesce(
      nullif(v_invoice_snapshot->>'invoiceNumber',''),
      nullif(v_order.invoice_number,'')
    ),
    'invoiceIssuedAt', nullif(v_invoice_snapshot->>'issuedAt',''),
    'discountType', v_discount_type,
    'manualDiscountAmount', v_manual_discount,
    'manualDiscountApprovalRequestId', case when v_order.discount_approval_request_id is null then null else v_order.discount_approval_request_id::text end,
    'manualDiscountApprovalStatus', v_order.discount_approval_status,
    'promotions', v_promotions,
    'journalEntryId', case when v_journal_entry_id is null then null else v_journal_entry_id::text end
  );
end;
$$;

revoke all on function public.get_invoice_audit(uuid) from public;
grant execute on function public.get_invoice_audit(uuid) to authenticated;

create or replace function public.get_promotion_expense_drilldown(
  p_start_date timestamptz,
  p_end_date timestamptz,
  p_min_amount numeric default 0
)
returns table (
  entry_date timestamptz,
  journal_entry_id uuid,
  order_id uuid,
  invoice_number text,
  debit numeric,
  credit numeric,
  amount numeric,
  promotion_usage_ids uuid[],
  promotion_ids uuid[]
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
begin
  v_actor := auth.uid();
  if v_actor is null then
    raise exception 'not authenticated';
  end if;
  if not public.has_admin_permission('accounting.view') then
    raise exception 'not authorized';
  end if;

  return query
  with promo_usage as (
    select
      pu.order_id,
      array_agg(pu.id) as usage_ids,
      array_agg(distinct pu.promotion_id) as promo_ids
    from public.promotion_usage pu
    group by pu.order_id
  ),
  promo_account as (
    select coa.id
    from public.chart_of_accounts coa
    where coa.code = '6150' and coa.is_active = true
    limit 1
  )
  select
    je.entry_date,
    je.id as journal_entry_id,
    (je.source_id)::uuid as order_id,
    coalesce(nullif(o.data->'invoiceSnapshot'->>'invoiceNumber',''), nullif(o.invoice_number,'')) as invoice_number,
    jl.debit,
    jl.credit,
    (jl.debit - jl.credit) as amount,
    coalesce(pu.usage_ids, '{}'::uuid[]) as promotion_usage_ids,
    coalesce(pu.promo_ids, '{}'::uuid[]) as promotion_ids
  from public.journal_entries je
  join public.journal_lines jl on jl.journal_entry_id = je.id
  join promo_account pa on pa.id = jl.account_id
  left join public.orders o on o.id = (je.source_id)::uuid
  left join promo_usage pu on pu.order_id = (je.source_id)::uuid
  where je.source_table = 'orders'
    and je.source_event = 'delivered'
    and je.entry_date >= p_start_date
    and je.entry_date <= p_end_date
    and abs(jl.debit - jl.credit) >= coalesce(p_min_amount, 0)
  order by je.entry_date desc, je.id desc;
end;
$$;

revoke all on function public.get_promotion_expense_drilldown(timestamptz, timestamptz, numeric) from public;
grant execute on function public.get_promotion_expense_drilldown(timestamptz, timestamptz, numeric) to authenticated;

create or replace function public.get_promotion_usage_drilldown(
  p_promotion_id uuid,
  p_start_date timestamptz,
  p_end_date timestamptz
)
returns table (
  promotion_usage_id uuid,
  order_id uuid,
  invoice_number text,
  channel text,
  created_at timestamptz,
  computed_original_total numeric,
  final_total numeric,
  promotion_expense numeric,
  journal_entry_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
begin
  v_actor := auth.uid();
  if v_actor is null then
    raise exception 'not authenticated';
  end if;
  if not (public.has_admin_permission('reports.view') or public.has_admin_permission('accounting.view')) then
    raise exception 'not authorized';
  end if;

  return query
  select
    pu.id as promotion_usage_id,
    pu.order_id,
    coalesce(nullif(o.data->'invoiceSnapshot'->>'invoiceNumber',''), nullif(o.invoice_number,'')) as invoice_number,
    pu.channel,
    pu.created_at,
    coalesce(nullif(pu.snapshot->>'computedOriginalTotal','')::numeric, 0) as computed_original_total,
    coalesce(nullif(pu.snapshot->>'finalTotal','')::numeric, 0) as final_total,
    coalesce(nullif(pu.snapshot->>'promotionExpense','')::numeric, 0) as promotion_expense,
    je.id as journal_entry_id
  from public.promotion_usage pu
  left join public.orders o on o.id = pu.order_id
  left join public.journal_entries je
    on je.source_table = 'orders'
   and je.source_id = pu.order_id::text
   and je.source_event = 'delivered'
  where pu.promotion_id = p_promotion_id
    and pu.created_at >= p_start_date
    and pu.created_at <= p_end_date
  order by pu.created_at desc;
end;
$$;

revoke all on function public.get_promotion_usage_drilldown(uuid, timestamptz, timestamptz) from public;
grant execute on function public.get_promotion_usage_drilldown(uuid, timestamptz, timestamptz) to authenticated;

do $$
begin
  alter table public.approval_requests drop constraint if exists approval_requests_request_type_check;
exception when undefined_object then
  null;
end $$;

alter table public.approval_requests
  add constraint approval_requests_request_type_check
  check (request_type in ('po','receipt','discount','transfer','writeoff','offline_reconciliation'));

insert into public.approval_policies(request_type, min_amount, max_amount, steps_count, is_active)
select 'offline_reconciliation', 0, null, 1, true
where not exists (
  select 1
  from public.approval_policies ap
  where ap.request_type = 'offline_reconciliation'
);

insert into public.approval_policy_steps(policy_id, step_no, approver_role)
select ap.id, 1, 'manager'
from public.approval_policies ap
where ap.request_type = 'offline_reconciliation'
  and not exists (
    select 1
    from public.approval_policy_steps s
    where s.policy_id = ap.id and s.step_no = 1
  );

alter table public.pos_offline_sales
  add column if not exists reconciliation_status text not null default 'NONE',
  add column if not exists reconciliation_approval_request_id uuid references public.approval_requests(id),
  add column if not exists reconciled_by uuid references auth.users(id),
  add column if not exists reconciled_at timestamptz,
  add column if not exists reconciliation_note text;

do $$
begin
  alter table public.pos_offline_sales drop constraint if exists pos_offline_sales_reconciliation_status_check;
exception when undefined_object then
  null;
end $$;

alter table public.pos_offline_sales
  add constraint pos_offline_sales_reconciliation_status_check
  check (reconciliation_status in ('NONE','PENDING','APPROVED','REJECTED'));

create or replace function public.trg_sync_offline_reconciliation_approval()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op <> 'UPDATE' then
    return new;
  end if;

  if new.request_type = 'offline_reconciliation'
     and new.target_table = 'pos_offline_sales'
     and new.status is distinct from old.status then
    update public.pos_offline_sales
    set reconciliation_status = upper(new.status),
        reconciliation_approval_request_id = new.id,
        reconciled_by = case
          when new.status = 'approved' then new.approved_by
          when new.status = 'rejected' then new.rejected_by
          else null
        end,
        reconciled_at = case
          when new.status = 'approved' then new.approved_at
          when new.status = 'rejected' then new.rejected_at
          else null
        end,
        updated_at = now()
    where offline_id = new.target_id;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_sync_offline_reconciliation_approval on public.approval_requests;
create trigger trg_sync_offline_reconciliation_approval
after update on public.approval_requests
for each row execute function public.trg_sync_offline_reconciliation_approval();

create or replace function public.register_pos_offline_sale_created(
  p_offline_id text,
  p_order_id uuid,
  p_created_at timestamptz,
  p_warehouse_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
begin
  v_actor := auth.uid();
  if v_actor is null then
    raise exception 'not authenticated';
  end if;
  if not public.is_staff() then
    raise exception 'not allowed';
  end if;

  if p_offline_id is null or btrim(p_offline_id) = '' then
    raise exception 'p_offline_id is required';
  end if;
  if p_order_id is null then
    raise exception 'p_order_id is required';
  end if;
  if p_warehouse_id is null then
    raise exception 'p_warehouse_id is required';
  end if;

  insert into public.pos_offline_sales(offline_id, order_id, warehouse_id, state, payload, created_by, created_at, updated_at)
  values (p_offline_id, p_order_id, p_warehouse_id, 'CREATED_OFFLINE', '{}'::jsonb, v_actor, coalesce(p_created_at, now()), now())
  on conflict (offline_id)
  do update set
    order_id = excluded.order_id,
    warehouse_id = excluded.warehouse_id,
    created_by = coalesce(public.pos_offline_sales.created_by, excluded.created_by),
    created_at = least(public.pos_offline_sales.created_at, excluded.created_at),
    updated_at = now();

  return jsonb_build_object('status', 'OK', 'offlineId', p_offline_id, 'orderId', p_order_id::text);
end;
$$;

revoke all on function public.register_pos_offline_sale_created(text, uuid, timestamptz, uuid) from public;
grant execute on function public.register_pos_offline_sale_created(text, uuid, timestamptz, uuid) to authenticated;

create or replace function public.request_offline_reconciliation(
  p_offline_id text,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_row record;
  v_req_id uuid;
  v_reason text;
begin
  v_actor := auth.uid();
  if v_actor is null then
    raise exception 'not authenticated';
  end if;
  if not public.is_staff() then
    raise exception 'not allowed';
  end if;

  v_reason := nullif(trim(coalesce(p_reason, '')), '');

  select *
  into v_row
  from public.pos_offline_sales s
  where s.offline_id = p_offline_id
  for update;

  if not found then
    raise exception 'offline sale not found';
  end if;

  if v_row.state not in ('CONFLICT','FAILED') then
    return jsonb_build_object('status', 'NOT_REQUIRED', 'offlineId', p_offline_id, 'state', v_row.state);
  end if;

  if v_row.reconciliation_status = 'PENDING'
     and v_row.reconciliation_approval_request_id is not null then
    return jsonb_build_object(
      'status', 'PENDING',
      'offlineId', p_offline_id,
      'approvalRequestId', v_row.reconciliation_approval_request_id::text
    );
  end if;

  v_req_id := public.create_approval_request(
    'pos_offline_sales',
    p_offline_id,
    'offline_reconciliation',
    0,
    jsonb_build_object(
      'offlineId', p_offline_id,
      'orderId', v_row.order_id::text,
      'state', v_row.state,
      'lastError', v_row.last_error,
      'reason', v_reason
    )
  );

  update public.pos_offline_sales
  set reconciliation_status = 'PENDING',
      reconciliation_approval_request_id = v_req_id,
      reconciliation_note = v_reason,
      updated_at = now()
  where offline_id = p_offline_id;

  return jsonb_build_object(
    'status', 'PENDING',
    'offlineId', p_offline_id,
    'approvalRequestId', v_req_id::text
  );
end;
$$;

revoke all on function public.request_offline_reconciliation(text, text) from public;
grant execute on function public.request_offline_reconciliation(text, text) to authenticated;

create or replace function public.get_pos_offline_sales_dashboard(
  p_state text default null,
  p_limit int default 200
)
returns table (
  offline_id text,
  order_id uuid,
  warehouse_id uuid,
  state text,
  created_by uuid,
  created_at timestamptz,
  synced_at timestamptz,
  updated_at timestamptz,
  last_error text,
  reconciliation_status text,
  reconciliation_approval_request_id uuid,
  reconciled_by uuid,
  reconciled_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if not (public.has_admin_permission('reports.view') or public.has_admin_permission('accounting.view')) then
    raise exception 'not authorized';
  end if;

  return query
  select
    s.offline_id,
    s.order_id,
    s.warehouse_id,
    s.state,
    s.created_by,
    s.created_at,
    case when s.state = 'CREATED_OFFLINE' then null else s.updated_at end as synced_at,
    s.updated_at,
    s.last_error,
    s.reconciliation_status,
    s.reconciliation_approval_request_id,
    s.reconciled_by,
    s.reconciled_at
  from public.pos_offline_sales s
  where (p_state is null or s.state = p_state)
  order by s.created_at desc
  limit greatest(1, least(coalesce(p_limit, 200), 500));
end;
$$;

revoke all on function public.get_pos_offline_sales_dashboard(text, int) from public;
grant execute on function public.get_pos_offline_sales_dashboard(text, int) to authenticated;

create or replace function public.sync_offline_pos_sale(
  p_offline_id text,
  p_order_id uuid,
  p_order_data jsonb,
  p_items jsonb,
  p_warehouse_id uuid,
  p_payments jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_existing_state text;
  v_reco_status text;
  v_reco_req uuid;
  v_err text;
  v_result jsonb;
  v_payment jsonb;
  v_i int := 0;
begin
  v_actor := auth.uid();
  if not public.is_staff() then
    raise exception 'not allowed';
  end if;

  if p_offline_id is null or btrim(p_offline_id) = '' then
    raise exception 'p_offline_id is required';
  end if;
  if p_order_id is null then
    raise exception 'p_order_id is required';
  end if;
  if p_warehouse_id is null then
    raise exception 'p_warehouse_id is required';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'p_items must be a json array';
  end if;
  if p_payments is null then
    p_payments := '[]'::jsonb;
  end if;
  if jsonb_typeof(p_payments) <> 'array' then
    raise exception 'p_payments must be a json array';
  end if;

  if jsonb_typeof(coalesce(p_order_data, '{}'::jsonb)->'promotionLines') = 'array'
     and jsonb_array_length(coalesce(p_order_data, '{}'::jsonb)->'promotionLines') > 0 then
    raise exception 'POS offline promotions are not allowed';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_items) e(value)
    where (e.value ? 'promotionId')
       or (e.value ? 'promotion_id')
       or lower(coalesce(e.value->>'lineType','')) = 'promotion'
       or lower(coalesce(e.value->>'line_type','')) = 'promotion'
  ) then
    raise exception 'POS offline promotions are not allowed';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_offline_id));

  select s.state, coalesce(s.reconciliation_status, 'NONE'), s.reconciliation_approval_request_id
  into v_existing_state, v_reco_status, v_reco_req
  from public.pos_offline_sales s
  where s.offline_id = p_offline_id
  for update;

  if found and v_existing_state = 'DELIVERED' then
    return jsonb_build_object('status', 'DELIVERED', 'orderId', p_order_id::text, 'offlineId', p_offline_id);
  end if;

  if found and v_existing_state in ('CONFLICT','FAILED') and v_reco_status <> 'APPROVED' then
    return jsonb_build_object(
      'status', 'REQUIRES_RECONCILIATION',
      'orderId', p_order_id::text,
      'offlineId', p_offline_id,
      'approvalRequestId', case when v_reco_req is null then null else v_reco_req::text end
    );
  end if;

  insert into public.pos_offline_sales(offline_id, order_id, warehouse_id, state, payload, created_by, created_at, updated_at)
  values (p_offline_id, p_order_id, p_warehouse_id, 'SYNCED', coalesce(p_order_data, '{}'::jsonb), v_actor, now(), now())
  on conflict (offline_id)
  do update set
    order_id = excluded.order_id,
    warehouse_id = excluded.warehouse_id,
    state = case
      when public.pos_offline_sales.state = 'DELIVERED' then 'DELIVERED'
      else 'SYNCED'
    end,
    payload = excluded.payload,
    created_by = coalesce(public.pos_offline_sales.created_by, excluded.created_by),
    updated_at = now();

  select * from public.orders o where o.id = p_order_id for update;
  if not found then
    insert into public.orders(id, customer_auth_user_id, status, invoice_number, data, created_at, updated_at)
    values (
      p_order_id,
      v_actor,
      'pending',
      null,
      coalesce(p_order_data, '{}'::jsonb),
      now(),
      now()
    );
  else
    update public.orders
    set data = coalesce(p_order_data, data),
        updated_at = now()
    where id = p_order_id;
  end if;

  begin
    perform public.confirm_order_delivery(p_order_id, p_items, coalesce(p_order_data, '{}'::jsonb), p_warehouse_id);
  exception when others then
    v_err := sqlerrm;
    update public.pos_offline_sales
    set state = case
          when v_err ilike '%insufficient%' then 'CONFLICT'
          when v_err ilike '%expired%' then 'CONFLICT'
          when v_err ilike '%reservation%' then 'CONFLICT'
          else 'FAILED'
        end,
        last_error = v_err,
        reconciliation_status = case when v_existing_state in ('CONFLICT','FAILED') then 'NONE' else reconciliation_status end,
        reconciliation_approval_request_id = case when v_existing_state in ('CONFLICT','FAILED') then null else reconciliation_approval_request_id end,
        reconciled_by = case when v_existing_state in ('CONFLICT','FAILED') then null else reconciled_by end,
        reconciled_at = case when v_existing_state in ('CONFLICT','FAILED') then null else reconciled_at end,
        updated_at = now()
    where offline_id = p_offline_id;
    update public.orders
    set data = jsonb_set(coalesce(data, '{}'::jsonb), '{offlineState}', to_jsonb('CONFLICT'::text), true),
        updated_at = now()
    where id = p_order_id;
    return jsonb_build_object('status', 'CONFLICT', 'orderId', p_order_id::text, 'offlineId', p_offline_id, 'error', v_err);
  end;

  for v_payment in
    select value
    from jsonb_array_elements(p_payments)
  loop
    begin
      perform public.record_order_payment(
        p_order_id,
        coalesce(nullif(v_payment->>'amount','')::numeric, 0),
        coalesce(nullif(v_payment->>'method',''), ''),
        coalesce(nullif(v_payment->>'occurredAt','')::timestamptz, now()),
        'offline:' || p_offline_id || ':' || v_i::text
      );
    exception when others then
      null;
    end;
    v_i := v_i + 1;
  end loop;

  update public.pos_offline_sales
  set state = 'DELIVERED',
      last_error = null,
      updated_at = now()
  where offline_id = p_offline_id;

  update public.orders
  set data = jsonb_set(coalesce(data, '{}'::jsonb), '{offlineState}', to_jsonb('DELIVERED'::text), true),
      updated_at = now()
  where id = p_order_id;

  v_result := jsonb_build_object('status', 'DELIVERED', 'orderId', p_order_id::text, 'offlineId', p_offline_id);
  return v_result;
end;
$$;

revoke all on function public.sync_offline_pos_sale(text, uuid, jsonb, jsonb, uuid, jsonb) from public;
grant execute on function public.sync_offline_pos_sale(text, uuid, jsonb, jsonb, uuid, jsonb) to authenticated;

