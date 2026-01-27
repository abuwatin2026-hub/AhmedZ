create or replace function public.post_invoice_issued(p_order_id uuid, p_issued_at timestamptz)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order record;
  v_data jsonb;
  v_is_cod boolean := false;
  v_entry_id uuid;
  v_total numeric := 0;
  v_subtotal numeric := 0;
  v_discount_amount numeric := 0;
  v_delivery_fee numeric := 0;
  v_tax_amount numeric := 0;
  v_deposits_paid numeric := 0;
  v_ar_amount numeric := 0;
  v_accounts jsonb;
  v_ar uuid;
  v_deposits uuid;
  v_sales uuid;
  v_delivery_income uuid;
  v_vat_payable uuid;
begin
  if not (auth.role() = 'service_role' or public.has_admin_permission('accounting.manage')) then
    raise exception 'not authorized to post accounting entries';
  end if;
  if p_order_id is null then
    raise exception 'p_order_id is required';
  end if;
  select *
  into v_order
  from public.orders o
  where o.id = p_order_id
  for update;
  if not found then
    raise exception 'order not found';
  end if;
  v_data := coalesce(v_order.data, '{}'::jsonb);
  v_is_cod := public._is_cod_delivery_order(v_data, v_order.delivery_zone_id);
  if v_is_cod then
    return;
  end if;
  select s.data->'accounting_accounts' into v_accounts from public.app_settings s where s.id = 'singleton';
  v_ar := public.get_account_id_by_code(coalesce(v_accounts->>'ar','1200'));
  v_deposits := public.get_account_id_by_code(coalesce(v_accounts->>'deposits','2050'));
  v_sales := public.get_account_id_by_code(coalesce(v_accounts->>'sales','4010'));
  v_delivery_income := public.get_account_id_by_code(coalesce(v_accounts->>'delivery_income','4020'));
  v_vat_payable := public.get_account_id_by_code(coalesce(v_accounts->>'vat_payable','2020'));
  v_total := coalesce(nullif((v_data->'invoiceSnapshot'->>'total')::numeric, null), coalesce(nullif((v_data->>'total')::numeric, null), 0));
  if v_total <= 0 then
    return;
  end if;
  v_subtotal := coalesce(nullif((v_data->'invoiceSnapshot'->>'subtotal')::numeric, null), coalesce(nullif((v_data->>'subtotal')::numeric, null), 0));
  v_discount_amount := coalesce(nullif((v_data->'invoiceSnapshot'->>'discountAmount')::numeric, null), coalesce(nullif((v_data->>'discountAmount')::numeric, null), 0));
  v_delivery_fee := coalesce(nullif((v_data->'invoiceSnapshot'->>'deliveryFee')::numeric, null), coalesce(nullif((v_data->>'deliveryFee')::numeric, null), 0));
  v_tax_amount := coalesce(nullif((v_data->'invoiceSnapshot'->>'taxAmount')::numeric, null), coalesce(nullif((v_data->>'taxAmount')::numeric, null), 0));
  v_tax_amount := least(greatest(0, v_tax_amount), v_total);
  v_delivery_fee := least(greatest(0, v_delivery_fee), v_total - v_tax_amount);
  select coalesce(sum(p.amount), 0)
  into v_deposits_paid
  from public.payments p
  where p.reference_table = 'orders'
    and p.reference_id = p_order_id::text
    and p.direction = 'in'
    and p.occurred_at < coalesce(p_issued_at, now());
  v_deposits_paid := least(v_total, greatest(0, coalesce(v_deposits_paid, 0)));
  v_ar_amount := greatest(0, v_total - v_deposits_paid);
  begin
    insert into public.journal_entries(entry_date, memo, source_table, source_id, source_event, created_by)
    values (
      coalesce(p_issued_at, now()),
      concat('Order invoiced ', p_order_id::text),
      'orders',
      p_order_id::text,
      'invoiced',
      auth.uid()
    )
    returning id into v_entry_id;
  exception
    when unique_violation then
      raise exception 'posting already exists for this source; create a reversal instead';
  end;
  if v_deposits_paid > 0 and v_deposits is not null then
    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
    values (v_entry_id, v_deposits, v_deposits_paid, 0, 'Apply customer deposit');
  end if;
  if v_ar_amount > 0 and v_ar is not null then
    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
    values (v_entry_id, v_ar, v_ar_amount, 0, 'Accounts receivable');
  end if;
  if (v_total - v_delivery_fee - v_tax_amount) > 0 and v_sales is not null then
    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
    values (v_entry_id, v_sales, 0, (v_total - v_delivery_fee - v_tax_amount), 'Sales revenue');
  end if;
  if v_delivery_fee > 0 and v_delivery_income is not null then
    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
    values (v_entry_id, v_delivery_income, 0, v_delivery_fee, 'Delivery income');
  end if;
  if v_tax_amount > 0 and v_vat_payable is not null then
    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
    values (v_entry_id, v_vat_payable, 0, v_tax_amount, 'VAT payable');
  end if;
  perform public.check_journal_entry_balance(v_entry_id);
  perform public.sync_ar_on_invoice(p_order_id);
end;
$$;
revoke all on function public.post_invoice_issued(uuid, timestamptz) from public;
grant execute on function public.post_invoice_issued(uuid, timestamptz) to authenticated;
