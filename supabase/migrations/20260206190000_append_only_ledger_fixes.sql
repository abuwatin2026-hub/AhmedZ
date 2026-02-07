set app.allow_ledger_ddl = '1';

drop trigger if exists trg_accounting_documents_immutable on public.accounting_documents;
drop trigger if exists trg_accounting_documents_guard on public.accounting_documents;
drop trigger if exists trg_journal_entries_immutable on public.journal_entries;
drop trigger if exists trg_journal_lines_immutable on public.journal_lines;
drop trigger if exists trg_journal_entries_block_system_mutation on public.journal_entries;
drop trigger if exists trg_journal_lines_block_system_mutation on public.journal_lines;

drop index if exists public.uq_journal_entries_source_strict;

create or replace function public.trg_accounting_documents_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'accounting_documents are append-only';
  end if;

  if old.document_type is distinct from new.document_type
    or old.source_table is distinct from new.source_table
    or old.source_id is distinct from new.source_id
    or old.branch_id is distinct from new.branch_id
    or old.company_id is distinct from new.company_id
    or old.status is distinct from new.status
    or old.memo is distinct from new.memo
    or old.created_by is distinct from new.created_by
    or old.created_at is distinct from new.created_at
    or old.reversed_document_id is distinct from new.reversed_document_id
  then
    raise exception 'accounting_documents core fields are immutable';
  end if;

  return new;
end;
$$;

create trigger trg_accounting_documents_guard
before update or delete on public.accounting_documents
for each row execute function public.trg_accounting_documents_guard();

create or replace function public.trg_block_system_journal_entry_mutation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(old.source_table, '') <> '' and old.source_table <> 'manual' then
    raise exception 'GL is append-only: system journal entries are immutable';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger trg_journal_entries_block_system_mutation
before update or delete on public.journal_entries
for each row execute function public.trg_block_system_journal_entry_mutation();

create or replace function public.trg_block_system_journal_lines_mutation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source_table text;
begin
  select je.source_table
  into v_source_table
  from public.journal_entries je
  where je.id = old.journal_entry_id;

  if coalesce(v_source_table, '') <> '' and v_source_table <> 'manual' then
    raise exception 'GL is append-only: system journal lines cannot be changed';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return coalesce(new, old);
end;
$$;

create trigger trg_journal_lines_block_system_mutation
before update or delete on public.journal_lines
for each row execute function public.trg_block_system_journal_lines_mutation();

create or replace function public.ensure_accounting_document_number(p_document_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_doc record;
  v_num text;
  v_date date;
begin
  if not public.has_admin_permission('accounting.view') then
    raise exception 'not allowed';
  end if;

  if p_document_id is null then
    raise exception 'document id is required';
  end if;

  select * into v_doc
  from public.accounting_documents
  where id = p_document_id
  for update;

  if not found then
    raise exception 'accounting document not found';
  end if;

  if v_doc.document_number is not null and length(btrim(v_doc.document_number)) > 0 then
    return v_doc.document_number;
  end if;

  if v_doc.document_type = 'invoice' and v_doc.source_table = 'orders' then
    select nullif(o.invoice_number,'') into v_num
    from public.orders o
    where o.id = v_doc.source_id::uuid;
    if v_num is not null and length(btrim(v_num)) > 0 then
      update public.accounting_documents set document_number = v_num where id = v_doc.id;
      return v_num;
    end if;
  end if;

  v_date := current_date;
  if v_doc.source_table = 'purchase_orders' then
    select coalesce(po.purchase_date, current_date) into v_date
    from public.purchase_orders po
    where po.id = v_doc.source_id::uuid;
  elsif v_doc.source_table = 'purchase_receipts' then
    select coalesce(pr.received_at::date, current_date) into v_date
    from public.purchase_receipts pr
    where pr.id = v_doc.source_id::uuid;
  elsif v_doc.source_table = 'payments' then
    select coalesce(p.occurred_at::date, current_date) into v_date
    from public.payments p
    where p.id = v_doc.source_id::uuid;
  elsif v_doc.source_table = 'warehouse_transfers' then
    select coalesce(wt.transfer_date, current_date) into v_date
    from public.warehouse_transfers wt
    where wt.id = v_doc.source_id::uuid;
  elsif v_doc.source_table = 'inventory_transfers' then
    select coalesce(it.transfer_date, current_date) into v_date
    from public.inventory_transfers it
    where it.id = v_doc.source_id::uuid;
  elsif v_doc.source_table = 'inventory_movements' then
    select coalesce(im.occurred_at::date, current_date) into v_date
    from public.inventory_movements im
    where im.id = v_doc.source_id::uuid;
  end if;

  v_num := public.next_document_number(v_doc.document_type, v_doc.branch_id, v_date);
  update public.accounting_documents set document_number = v_num where id = v_doc.id;
  return v_num;
end;
$$;

revoke all on function public.ensure_accounting_document_number(uuid) from public;
revoke execute on function public.ensure_accounting_document_number(uuid) from anon;
grant execute on function public.ensure_accounting_document_number(uuid) to authenticated;

create or replace function public.mark_accounting_document_printed(
  p_document_id uuid,
  p_template text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_doc record;
begin
  if not public.has_admin_permission('accounting.view') then
    raise exception 'not allowed';
  end if;

  update public.accounting_documents
  set print_count = print_count + 1,
      last_printed_at = now(),
      last_printed_template = nullif(btrim(coalesce(p_template,'')),'')
  where id = p_document_id;

  select * into v_doc from public.accounting_documents where id = p_document_id;
  if found then
    insert into public.system_audit_logs(action, module, details, performed_by, performed_at, metadata)
    values (
      'print',
      'documents',
      concat('Printed document ', coalesce(v_doc.document_number, v_doc.id::text)),
      auth.uid(),
      now(),
      jsonb_build_object(
        'documentId', v_doc.id,
        'documentType', v_doc.document_type,
        'documentNumber', v_doc.document_number,
        'sourceTable', v_doc.source_table,
        'sourceId', v_doc.source_id,
        'template', nullif(btrim(coalesce(p_template,'')),'')
      )
    );
  end if;
end;
$$;

revoke all on function public.mark_accounting_document_printed(uuid, text) from public;
revoke execute on function public.mark_accounting_document_printed(uuid, text) from anon;
grant execute on function public.mark_accounting_document_printed(uuid, text) to authenticated;

create or replace function public.post_payment(p_payment_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pay record;
  v_debit_account uuid;
  v_credit_account uuid;
  v_entry_id uuid;
  v_amount_base numeric;
  v_amount_fx numeric;
  v_method text;
  v_currency text;
  v_rate numeric;
  v_cash uuid;
  v_bank uuid;
  v_ar uuid;
  v_ap uuid;
  v_deposits uuid;
  v_expenses uuid;
  v_fx_gain uuid;
  v_fx_loss uuid;
  v_account_currency text;
  v_amount_account numeric;
  v_fx_diff numeric;
  v_override text;
  v_ap_override uuid;
  v_ar_override uuid;
  v_expenses_override uuid;
  v_has_accrual boolean := false;
  v_accrual_entry_id uuid;
  v_settle_account_id uuid;
  v_event text;
  v_order_id uuid;
  v_delivered_at timestamptz;
begin
  if not public.has_admin_permission('accounting.manage') then
    raise exception 'not allowed';
  end if;

  select *
  into v_pay
  from public.payments
  where id = p_payment_id
  for update;
  if not found then
    raise exception 'payment not found';
  end if;

  if exists (
    select 1
    from public.journal_entries je
    where je.source_table = 'payments'
      and je.source_id = p_payment_id::text
  ) then
    return;
  end if;

  v_cash := public.get_account_id_by_code('1010');
  v_bank := public.get_account_id_by_code('1020');
  v_ar := public.get_account_id_by_code('1200');
  v_ap := public.get_account_id_by_code('2010');
  v_deposits := public.get_account_id_by_code('2050');
  v_expenses := public.get_account_id_by_code('6100');
  v_fx_gain := public.get_account_id_by_code('4000');
  v_fx_loss := public.get_account_id_by_code('5000');
  if v_cash is null or v_bank is null or v_ar is null or v_ap is null or v_deposits is null or v_expenses is null or v_fx_gain is null or v_fx_loss is null then
    raise exception 'required accounts not found';
  end if;

  v_method := v_pay.method;
  v_currency := coalesce(nullif(v_pay.currency, ''), 'YER');
  v_rate := public.get_fx_rate(v_currency, v_pay.occurred_at);
  v_amount_fx := v_pay.amount;
  v_amount_base := round(v_amount_fx * v_rate, 2);

  if v_method = 'cash' then
    v_debit_account := v_cash;
  else
    v_debit_account := v_bank;
  end if;

  v_override := nullif(trim(coalesce(v_pay.data->>'overrideAccountId','')), '');
  v_ar_override := public.resolve_override_account(v_ar, v_override, array['asset','liability','equity','expense']);
  v_ap_override := public.resolve_override_account(v_ap, v_override, array['asset','liability','equity','expense']);
  v_expenses_override := public.resolve_override_account(v_expenses, v_override, array['asset','liability','equity','expense']);

  v_event := concat('payment:', v_pay.direction, ':', v_pay.reference_table, ':', coalesce(v_pay.reference_id, ''));

  insert into public.journal_entries(entry_date, memo, source_table, source_id, source_event, created_by)
  values (
    v_pay.occurred_at,
    concat('Payment ', v_pay.direction, ' ', v_pay.reference_table, ':', v_pay.reference_id),
    'payments',
    p_payment_id::text,
    v_event,
    auth.uid()
  )
  returning id into v_entry_id;

  if v_pay.direction = 'in' and v_pay.reference_table = 'orders' then
    v_order_id := nullif(v_pay.reference_id, '')::uuid;
    if v_order_id is null then
      raise exception 'invalid order reference_id';
    end if;

    v_delivered_at := public.order_delivered_at(v_order_id);
    if v_delivered_at is null or v_pay.occurred_at < v_delivered_at then
      insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
      values
        (v_entry_id, v_debit_account, v_amount_base, 0, 'Receive payment'),
        (v_entry_id, v_deposits, 0, v_amount_base, 'Customer deposit');
    else
      insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
      values
        (v_entry_id, v_debit_account, v_amount_base, 0, 'Receive payment'),
        (v_entry_id, v_ar_override, 0, v_amount_base, 'Settle receivable');
    end if;

  elsif v_pay.direction = 'out' and v_pay.reference_table = 'purchase_orders' then
    v_credit_account := case when v_method = 'cash' then v_cash else v_bank end;

    select currency
      into v_account_currency
      from public.ledger_balances
      where account_id = v_ap_override;
    v_account_currency := coalesce(nullif(v_account_currency, ''), v_currency);

    v_amount_account := v_amount_base;
    if v_account_currency <> public.get_base_currency() then
      v_amount_account := round(v_amount_fx, 2);
    end if;

    v_fx_diff := 0;
    if v_account_currency <> v_currency then
      v_fx_diff := v_amount_base - (round(v_amount_account * public.get_fx_rate(v_account_currency, v_pay.occurred_at), 2));
    end if;

    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
    values
      (v_entry_id, v_ap_override, v_amount_account, 0, 'Settle payable'),
      (v_entry_id, v_credit_account, 0, v_amount_base, 'Pay supplier');

    if abs(v_fx_diff) > 0.001 then
      if v_fx_diff > 0 then
        insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
        values (v_entry_id, v_fx_gain, 0, abs(v_fx_diff), 'FX gain');
      else
        insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
        values (v_entry_id, v_fx_loss, abs(v_fx_diff), 0, 'FX loss');
      end if;
    end if;

  elsif v_pay.direction = 'out' and v_pay.reference_table = 'expenses' then
    v_credit_account := case when v_method = 'cash' then v_cash else v_bank end;

    select je.id
    into v_accrual_entry_id
    from public.journal_entries je
    where je.source_table = 'expenses'
      and je.source_id = v_pay.reference_id
      and je.source_event = 'accrual'
    order by je.entry_date desc
    limit 1;

    v_has_accrual := (v_accrual_entry_id is not null);
    if v_has_accrual then
      select jl.account_id
      into v_settle_account_id
      from public.journal_lines jl
      where jl.journal_entry_id = v_accrual_entry_id
        and coalesce(jl.credit, 0) > 0
      order by jl.credit desc, jl.id asc
      limit 1;
      v_settle_account_id := coalesce(v_settle_account_id, v_ap_override);

      insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
      values
        (v_entry_id, v_settle_account_id, v_amount_base, 0, 'Settle payable'),
        (v_entry_id, v_credit_account, 0, v_amount_base, 'Pay expense');
    else
      insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
      values
        (v_entry_id, v_expenses_override, v_amount_base, 0, 'Expense payment'),
        (v_entry_id, v_credit_account, 0, v_amount_base, 'Pay expense');
    end if;
  else
    raise exception 'unsupported payment reference';
  end if;

  perform public.check_journal_entry_balance(v_entry_id);
end;
$$;

revoke all on function public.post_payment(uuid) from public;
revoke execute on function public.post_payment(uuid) from anon;
grant execute on function public.post_payment(uuid) to authenticated;

create or replace function public._payroll_lock_non_draft_lines()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_run_id uuid;
begin
  v_run_id := coalesce(new.run_id, old.run_id);
  select r.status into v_status from public.payroll_runs r where r.id = v_run_id;
  if coalesce(v_status,'draft') <> 'draft' then
    raise exception 'payroll run is locked';
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_payroll_run_lines_lock on public.payroll_run_lines;
create trigger trg_payroll_run_lines_lock
before insert or update or delete on public.payroll_run_lines
for each row execute function public._payroll_lock_non_draft_lines();

create or replace function public.record_payroll_run_accrual_v2(
  p_run_id uuid,
  p_occurred_at timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run record;
  v_entry_id uuid;
  v_expense_account uuid;
  v_payable_account uuid;
  v_amount numeric;
  v_occurred_at timestamptz;
  v_settings record;
begin
  if not (public.can_manage_expenses() or public.has_admin_permission('accounting.manage') or public.is_admin()) then
    raise exception 'not allowed';
  end if;

  if p_run_id is null then
    raise exception 'run_id is required';
  end if;

  v_occurred_at := coalesce(p_occurred_at, now());

  select *
  into v_run
  from public.payroll_runs
  where id = p_run_id
  for update;

  if not found then
    raise exception 'run not found';
  end if;
  if v_run.expense_id is null then
    raise exception 'run has no expense_id';
  end if;
  if coalesce(v_run.status,'') = 'voided' then
    raise exception 'run is voided';
  end if;

  if coalesce(v_run.status,'') in ('accrued','paid') then
    select je.id into v_entry_id
    from public.journal_entries je
    where je.source_table = 'expenses'
      and je.source_id = v_run.expense_id::text
      and je.source_event = 'accrual'
    order by je.entry_date desc
    limit 1;
    return v_entry_id;
  end if;

  perform public.recalc_payroll_run_totals(p_run_id);

  select total_net, cost_center_id, period_ym, memo, expense_id
  into v_amount, v_run.cost_center_id, v_run.period_ym, v_run.memo, v_run.expense_id
  from public.payroll_runs
  where id = p_run_id;

  v_amount := coalesce(v_amount, 0);
  if v_amount <= 0 then
    raise exception 'invalid amount';
  end if;

  select *
  into v_settings
  from public.payroll_settings
  where id = 'app';

  v_expense_account := coalesce(v_settings.salary_expense_account_id, public.get_account_id_by_code('6120'));
  v_payable_account := coalesce(v_settings.salary_payable_account_id, public.get_account_id_by_code('2120'));
  if v_expense_account is null or v_payable_account is null then
    raise exception 'required accounts not found';
  end if;

  insert into public.journal_entries(entry_date, memo, source_table, source_id, source_event, created_by)
  values (
    v_occurred_at,
    concat('Payroll accrual ', coalesce(v_run.period_ym, p_run_id::text)),
    'expenses',
    v_run.expense_id::text,
    'accrual',
    auth.uid()
  )
  returning id into v_entry_id;

  insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo, cost_center_id)
  values
    (v_entry_id, v_expense_account, v_amount, 0, 'Payroll expense', v_run.cost_center_id),
    (v_entry_id, v_payable_account, 0, v_amount, 'Payroll payable', v_run.cost_center_id);

  perform public.check_journal_entry_balance(v_entry_id);

  update public.payroll_runs
  set status = 'accrued',
      accrued_at = v_occurred_at
  where id = p_run_id;

  insert into public.system_audit_logs(action, module, details, performed_by, performed_at, metadata)
  values (
    'payroll_run_accrued',
    'payroll',
    concat('Payroll run accrued ', v_run.period_ym),
    auth.uid(),
    now(),
    jsonb_build_object('runId', p_run_id::text, 'period', v_run.period_ym, 'expenseId', v_run.expense_id::text, 'journalEntryId', v_entry_id::text, 'amount', v_amount)
  );

  return v_entry_id;
end;
$$;

revoke all on function public.record_payroll_run_accrual_v2(uuid, timestamptz) from public;
revoke execute on function public.record_payroll_run_accrual_v2(uuid, timestamptz) from anon;
grant execute on function public.record_payroll_run_accrual_v2(uuid, timestamptz) to authenticated;

create or replace function public.void_delivered_order(
  p_order_id uuid,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order record;
  v_delivered_entry_id uuid;
  v_void_entry_id uuid;
  v_line record;
  v_void_lines_count int := 0;
  v_ar_id uuid;
  v_ar_amount numeric := 0;
  v_sale record;
  v_ret_batch_id uuid;
  v_source_batch record;
  v_movement_id uuid;
  v_wh uuid;
  v_data jsonb;
begin
  perform public._require_staff('void_delivered_order');
  if not (auth.role() = 'service_role' or public.has_admin_permission('accounting.void')) then
    raise exception 'not authorized';
  end if;
  if p_order_id is null then
    raise exception 'p_order_id is required';
  end if;

  select * into v_order from public.orders o where o.id = p_order_id for update;
  if not found then
    raise exception 'order not found';
  end if;
  if coalesce(v_order.status,'') <> 'delivered' then
    raise exception 'only delivered orders can be voided';
  end if;

  if coalesce(v_order.data->>'voidedAt','') <> '' then
    raise exception 'order already voided';
  end if;

  select je.id
  into v_delivered_entry_id
  from public.journal_entries je
  where je.source_table = 'orders'
    and je.source_id = p_order_id::text
    and je.source_event = 'delivered'
  limit 1;
  if not found then
    raise exception 'delivered journal entry not found';
  end if;

  select je.id
  into v_void_entry_id
  from public.journal_entries je
  where je.source_table = 'order_voids'
    and je.source_id = p_order_id::text
    and je.source_event = 'voided'
  limit 1;

  if v_void_entry_id is null then
    insert into public.journal_entries(entry_date, memo, source_table, source_id, source_event, created_by, status)
    values (
      now(),
      concat('Void delivered order ', p_order_id::text),
      'order_voids',
      p_order_id::text,
      'voided',
      auth.uid(),
      'posted'
    )
    returning id into v_void_entry_id;
  end if;

  select count(1)
  into v_void_lines_count
  from public.journal_lines jl
  where jl.journal_entry_id = v_void_entry_id;

  if coalesce(v_void_lines_count, 0) = 0 then
    for v_line in
      select account_id, debit, credit, line_memo
      from public.journal_lines
      where journal_entry_id = v_delivered_entry_id
    loop
      insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
      values (
        v_void_entry_id,
        v_line.account_id,
        coalesce(v_line.credit,0),
        coalesce(v_line.debit,0),
        coalesce(v_line.line_memo,'')
      );
    end loop;
  end if;

  v_ar_id := public.get_account_id_by_code('1200');
  if v_ar_id is not null then
    select coalesce(sum(jl.debit), 0) - coalesce(sum(jl.credit), 0)
    into v_ar_amount
    from public.journal_lines jl
    where jl.journal_entry_id = v_delivered_entry_id
      and jl.account_id = v_ar_id;
    v_ar_amount := greatest(0, coalesce(v_ar_amount, 0));
  end if;

  if not exists (
    select 1
    from public.inventory_movements im
    where im.reference_table = 'orders'
      and im.reference_id = p_order_id::text
      and im.movement_type = 'return_in'
      and coalesce(im.data->>'event','') = 'voided'
  ) then
    for v_sale in
      select im.id, im.item_id, im.quantity, im.unit_cost, im.batch_id, im.warehouse_id, im.occurred_at
      from public.inventory_movements im
      where im.reference_table = 'orders'
        and im.reference_id = p_order_id::text
        and im.movement_type = 'sale_out'
      order by im.occurred_at asc, im.id asc
    loop
      select b.expiry_date, b.production_date, b.unit_cost
      into v_source_batch
      from public.batches b
      where b.id = v_sale.batch_id;

      v_wh := v_sale.warehouse_id;
      if v_wh is null then
        v_wh := coalesce(v_order.warehouse_id, public._resolve_default_admin_warehouse_id());
      end if;
      if v_wh is null then
        raise exception 'warehouse_id is required';
      end if;

      v_ret_batch_id := gen_random_uuid();
      insert into public.batches(
        id,
        item_id,
        receipt_item_id,
        receipt_id,
        warehouse_id,
        batch_code,
        production_date,
        expiry_date,
        quantity_received,
        quantity_consumed,
        unit_cost,
        qc_status,
        data
      )
      values (
        v_ret_batch_id,
        v_sale.item_id::text,
        null,
        null,
        v_wh,
        null,
        v_source_batch.production_date,
        v_source_batch.expiry_date,
        v_sale.quantity,
        0,
        coalesce(v_sale.unit_cost, v_source_batch.unit_cost, 0),
        'released',
        jsonb_build_object(
          'source', 'orders',
          'event', 'voided',
          'orderId', p_order_id::text,
          'sourceBatchId', v_sale.batch_id::text,
          'sourceMovementId', v_sale.id::text
        )
      );

      insert into public.inventory_movements(
        item_id, movement_type, quantity, unit_cost, total_cost,
        reference_table, reference_id, occurred_at, created_by, data, batch_id, warehouse_id
      )
      values (
        v_sale.item_id::text,
        'return_in',
        v_sale.quantity,
        coalesce(v_sale.unit_cost, v_source_batch.unit_cost, 0),
        v_sale.quantity * coalesce(v_sale.unit_cost, v_source_batch.unit_cost, 0),
        'orders',
        p_order_id::text,
        now(),
        auth.uid(),
        jsonb_build_object(
          'orderId', p_order_id::text,
          'warehouseId', v_wh::text,
          'event', 'voided',
          'sourceBatchId', v_sale.batch_id::text,
          'sourceMovementId', v_sale.id::text
        ),
        v_ret_batch_id,
        v_wh
      )
      returning id into v_movement_id;

      perform public.post_inventory_movement(v_movement_id);
      perform public.recompute_stock_for_item(v_sale.item_id::text, v_wh);
    end loop;
  end if;

  v_data := coalesce(v_order.data, '{}'::jsonb);
  v_data := jsonb_set(v_data, '{voidedAt}', to_jsonb(now()::text), true);
  if nullif(trim(coalesce(p_reason,'')),'') is not null then
    v_data := jsonb_set(v_data, '{voidReason}', to_jsonb(p_reason), true);
  end if;
  v_data := jsonb_set(v_data, '{voidedBy}', to_jsonb(auth.uid()::text), true);

  update public.orders
  set data = v_data,
      updated_at = now()
  where id = p_order_id;

  perform public._apply_ar_open_item_credit(p_order_id, v_ar_amount);
end;
$$;

revoke all on function public.void_delivered_order(uuid, text) from public;
revoke execute on function public.void_delivered_order(uuid, text) from anon;
grant execute on function public.void_delivered_order(uuid, text) to authenticated;

notify pgrst, 'reload schema';
