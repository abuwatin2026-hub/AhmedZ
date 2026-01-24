insert into public.chart_of_accounts(code, name, account_type, normal_balance)
values ('6150', 'Promotion Expense', 'expense', 'debit')
on conflict (code) do update
set name = excluded.name,
    account_type = excluded.account_type,
    normal_balance = excluded.normal_balance,
    is_active = true;

create or replace function public.post_order_delivery(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order record;
  v_entry_id uuid;
  v_total numeric;
  v_ar uuid;
  v_deposits uuid;
  v_sales uuid;
  v_delivery_income uuid;
  v_vat_payable uuid;
  v_promo_expense_account uuid;
  v_delivered_at timestamptz;
  v_deposits_paid numeric;
  v_ar_amount numeric;
  v_discount_amount numeric;
  v_delivery_fee numeric;
  v_tax_amount numeric;
  v_items_revenue numeric;
  v_sales_amount numeric;
  v_promo_expense_total numeric := 0;
begin
  if not (auth.role() = 'service_role' or public.has_admin_permission('accounting.manage')) then
    raise exception 'not authorized to post accounting entries';
  end if;
  if p_order_id is null then
    raise exception 'p_order_id is required';
  end if;

  select o.*
  into v_order
  from public.orders o
  where o.id = p_order_id;

  if not found then
    raise exception 'order not found';
  end if;

  v_total := coalesce(nullif((v_order.data->>'total')::numeric, null), 0);
  if v_total <= 0 then
    return;
  end if;

  v_ar := public.get_account_id_by_code('1200');
  v_deposits := public.get_account_id_by_code('2050');
  v_sales := public.get_account_id_by_code('4010');
  v_delivery_income := public.get_account_id_by_code('4020');
  v_vat_payable := public.get_account_id_by_code('2020');
  v_promo_expense_account := coalesce(public.get_account_id_by_code('6150'), public.get_account_id_by_code('6100'));

  v_discount_amount := coalesce(nullif((v_order.data->>'discountAmount')::numeric, null), 0);
  v_delivery_fee := coalesce(nullif((v_order.data->>'deliveryFee')::numeric, null), 0);
  v_tax_amount := coalesce(nullif((v_order.data->>'taxAmount')::numeric, null), 0);

  v_tax_amount := least(greatest(0, v_tax_amount), v_total);
  v_delivery_fee := least(greatest(0, v_delivery_fee), v_total - v_tax_amount);
  v_items_revenue := greatest(0, v_total - v_delivery_fee - v_tax_amount);

  select coalesce(sum(coalesce(nullif((pl->>'promotionExpense')::numeric, null), 0)), 0)
  into v_promo_expense_total
  from jsonb_array_elements(coalesce(v_order.data->'promotionLines', '[]'::jsonb)) as pl;

  v_promo_expense_total := public._money_round(coalesce(v_promo_expense_total, 0));
  v_sales_amount := public._money_round(v_items_revenue + v_promo_expense_total);

  v_delivered_at := public.order_delivered_at(p_order_id);
  if v_delivered_at is null then
    v_delivered_at := coalesce(v_order.updated_at, now());
  end if;

  select coalesce(sum(p.amount), 0)
  into v_deposits_paid
  from public.payments p
  where p.reference_table = 'orders'
    and p.reference_id = p_order_id::text
    and p.direction = 'in'
    and p.occurred_at < v_delivered_at;

  v_deposits_paid := least(v_total, greatest(0, coalesce(v_deposits_paid, 0)));
  v_ar_amount := greatest(0, v_total - v_deposits_paid);

  insert into public.journal_entries(entry_date, memo, source_table, source_id, source_event, created_by)
  values (
    coalesce(v_order.updated_at, now()),
    concat('Order delivered ', v_order.id::text),
    'orders',
    v_order.id::text,
    'delivered',
    auth.uid()
  )
  on conflict (source_table, source_id, source_event)
  do update set entry_date = excluded.entry_date, memo = excluded.memo
  returning id into v_entry_id;

  delete from public.journal_lines jl where jl.journal_entry_id = v_entry_id;

  if v_deposits_paid > 0 then
    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
    values (v_entry_id, v_deposits, public._money_round(v_deposits_paid), 0, 'Apply customer deposit');
  end if;

  if v_ar_amount > 0 then
    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
    values (v_entry_id, v_ar, public._money_round(v_ar_amount), 0, 'Accounts receivable');
  end if;

  if v_sales_amount > 0 then
    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
    values (v_entry_id, v_sales, 0, public._money_round(v_sales_amount), 'Sales revenue');
  end if;

  if v_promo_expense_total > 0 and v_promo_expense_account is not null then
    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
    values (v_entry_id, v_promo_expense_account, public._money_round(v_promo_expense_total), 0, 'Promotion expense');
  end if;

  if v_delivery_fee > 0 and v_delivery_income is not null then
    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
    values (v_entry_id, v_delivery_income, 0, public._money_round(v_delivery_fee), 'Delivery income');
  end if;

  if v_tax_amount > 0 and v_vat_payable is not null then
    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
    values (v_entry_id, v_vat_payable, 0, public._money_round(v_tax_amount), 'VAT payable');
  end if;
end;
$$;

create or replace function public.get_promotion_performance(
  p_start_date timestamptz,
  p_end_date timestamptz,
  p_promotion_id uuid default null
)
returns table (
  promotion_id uuid,
  promotion_name text,
  usage_count bigint,
  bundles_sold numeric,
  gross_before_promo numeric,
  net_after_promo numeric,
  promotion_expense numeric
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.can_view_sales_reports() then
    raise exception 'not allowed';
  end if;

  return query
  select
    p.id as promotion_id,
    p.name as promotion_name,
    count(*) as usage_count,
    public._money_round(sum(coalesce(u.bundle_qty, 0)), 6) as bundles_sold,
    public._money_round(sum(coalesce(nullif((u.snapshot->>'computedOriginalTotal')::numeric, null), 0))) as gross_before_promo,
    public._money_round(sum(coalesce(nullif((u.snapshot->>'finalTotal')::numeric, null), 0))) as net_after_promo,
    public._money_round(sum(coalesce(nullif((u.snapshot->>'promotionExpense')::numeric, null), 0))) as promotion_expense
  from public.promotion_usage u
  join public.promotions p on p.id = u.promotion_id
  left join public.orders o on o.id = u.order_id
  where (p_promotion_id is null or u.promotion_id = p_promotion_id)
    and u.created_at >= p_start_date
    and u.created_at <= p_end_date
    and (o.id is null or o.status = 'delivered')
  group by p.id, p.name
  order by promotion_expense desc, net_after_promo desc;
end;
$$;

revoke all on function public.get_promotion_performance(timestamptz, timestamptz, uuid) from public;
revoke execute on function public.get_promotion_performance(timestamptz, timestamptz, uuid) from anon;
grant execute on function public.get_promotion_performance(timestamptz, timestamptz, uuid) to authenticated;

