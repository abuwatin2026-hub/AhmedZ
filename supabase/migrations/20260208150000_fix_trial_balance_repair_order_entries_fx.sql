set app.allow_ledger_ddl = '1';

do $$
declare
  v_base text := public.get_base_currency();
  v_accounts jsonb;
  v_ar uuid;
  v_deposits uuid;
  v_sales uuid;
  v_delivery_income uuid;
  v_vat_payable uuid;
  r record;
  v_data jsonb;
  v_currency text;
  v_fx numeric;
  v_total_foreign numeric;
  v_total_base numeric;
  v_delivery_base numeric;
  v_tax_base numeric;
  v_items_revenue_base numeric;
  v_deposits_paid_base numeric;
  v_ar_amount_base numeric;
  v_cutoff timestamptz;
begin
  select s.data->'accounting_accounts'
  into v_accounts
  from public.app_settings s
  where s.id = 'singleton';

  v_ar := public.get_account_id_by_code(coalesce(v_accounts->>'ar','1200'));
  v_deposits := public.get_account_id_by_code(coalesce(v_accounts->>'deposits','2050'));
  v_sales := public.get_account_id_by_code(coalesce(v_accounts->>'sales','4010'));
  v_delivery_income := public.get_account_id_by_code(coalesce(v_accounts->>'delivery_income','4020'));
  v_vat_payable := public.get_account_id_by_code(coalesce(v_accounts->>'vat_payable','2020'));

  for r in
    select
      je.id as entry_id,
      je.source_event,
      o.id as order_id,
      o.base_total,
      o.fx_rate,
      o.total as order_total_col,
      o.currency as order_currency_col,
      o.data as order_data,
      public.order_delivered_at(o.id) as delivered_at,
      nullif(o.data->'invoiceSnapshot'->>'issuedAt', '')::timestamptz as invoice_issued_at,
      coalesce(sum(jl.debit), 0) as entry_total
    from public.orders o
    join public.journal_entries je
      on je.source_table = 'orders'
     and je.source_id = o.id::text
     and je.source_event in ('delivered', 'invoiced')
    join public.journal_lines jl on jl.journal_entry_id = je.id
    where upper(coalesce(nullif(btrim(o.currency),''), nullif(btrim(o.data->>'currency'),''), v_base)) <> upper(v_base)
      and o.base_total is not null
      and o.base_total > 0
    group by
      je.id, je.source_event,
      o.id, o.base_total, o.fx_rate, o.total, o.currency, o.data
  loop
    v_data := coalesce(r.order_data, '{}'::jsonb);
    v_currency := upper(coalesce(nullif(btrim(coalesce(r.order_currency_col, v_data->>'currency', v_base)), ''), v_base));

    begin
      v_fx := coalesce(r.fx_rate, nullif((v_data->>'fxRate')::numeric, null), 1);
    exception when others then
      v_fx := 1;
    end;

    v_total_foreign := coalesce(
      nullif((v_data->'invoiceSnapshot'->>'total')::numeric, null),
      nullif((v_data->>'total')::numeric, null),
      coalesce(r.order_total_col, 0),
      0
    );

    v_total_base := coalesce(r.base_total, 0);
    if v_total_base <= 0 or v_total_foreign <= 0 then
      continue;
    end if;

    if abs(coalesce(r.entry_total, 0) - v_total_foreign) > 0.01 then
      continue;
    end if;
    if abs(coalesce(r.entry_total, 0) - v_total_base) <= 0.01 then
      continue;
    end if;

    if r.source_event = 'invoiced' then
      v_cutoff := coalesce(r.invoice_issued_at, now());
      v_delivery_base := coalesce(nullif((v_data->'invoiceSnapshot'->>'deliveryFee')::numeric, null), nullif((v_data->>'deliveryFee')::numeric, null), 0) * v_fx;
      v_tax_base := coalesce(nullif((v_data->'invoiceSnapshot'->>'taxAmount')::numeric, null), nullif((v_data->>'taxAmount')::numeric, null), 0) * v_fx;
    else
      v_cutoff := coalesce(r.delivered_at, now());
      if (v_data ? 'invoiceSnapshot') then
        v_delivery_base := coalesce(nullif((v_data->'invoiceSnapshot'->>'deliveryFee')::numeric, null), 0) * v_fx;
        v_tax_base := coalesce(nullif((v_data->'invoiceSnapshot'->>'taxAmount')::numeric, null), 0) * v_fx;
      else
        v_delivery_base := coalesce(nullif((v_data->>'deliveryFee')::numeric, null), 0) * v_fx;
        v_tax_base := coalesce(nullif((v_data->>'taxAmount')::numeric, null), 0) * v_fx;
      end if;
    end if;

    v_tax_base := least(greatest(0, v_tax_base), v_total_base);
    v_delivery_base := least(greatest(0, v_delivery_base), v_total_base - v_tax_base);
    v_items_revenue_base := greatest(0, v_total_base - v_delivery_base - v_tax_base);

    select coalesce(sum(coalesce(p.base_amount, 0)), 0)
    into v_deposits_paid_base
    from public.payments p
    where p.reference_table = 'orders'
      and p.reference_id = r.order_id::text
      and p.direction = 'in'
      and p.occurred_at < v_cutoff;

    v_deposits_paid_base := least(v_total_base, greatest(0, coalesce(v_deposits_paid_base, 0)));
    v_ar_amount_base := greatest(0, v_total_base - v_deposits_paid_base);

    update public.journal_entries
    set
      currency_code = case when v_currency <> v_base then v_currency else null end,
      fx_rate = case when v_currency <> v_base then v_fx else null end,
      foreign_amount = case when v_currency <> v_base then v_total_foreign else null end,
      memo = case
        when r.source_event = 'invoiced' then concat('Order invoiced ', r.order_id::text)
        else concat('Order delivered ', r.order_id::text)
      end
    where id = r.entry_id;

    delete from public.journal_lines jl where jl.journal_entry_id = r.entry_id;

    if v_deposits_paid_base > 0 and v_deposits is not null then
      insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
      values (r.entry_id, v_deposits, v_deposits_paid_base, 0, 'Apply customer deposit');
    end if;

    if v_ar_amount_base > 0 and v_ar is not null then
      insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
      values (r.entry_id, v_ar, v_ar_amount_base, 0, 'Accounts receivable');
    end if;

    if v_items_revenue_base > 0 and v_sales is not null then
      insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
      values (r.entry_id, v_sales, 0, v_items_revenue_base, 'Sales revenue');
    end if;

    if v_delivery_base > 0 and v_delivery_income is not null then
      insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
      values (r.entry_id, v_delivery_income, 0, v_delivery_base, 'Delivery income');
    end if;

    if v_tax_base > 0 and v_vat_payable is not null then
      insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
      values (r.entry_id, v_vat_payable, 0, v_tax_base, 'VAT payable');
    end if;

    perform public.check_journal_entry_balance(r.entry_id);

    if r.source_event = 'invoiced' then
      perform public.sync_ar_on_invoice(r.order_id);
    end if;
  end loop;
end $$;

notify pgrst, 'reload schema';
