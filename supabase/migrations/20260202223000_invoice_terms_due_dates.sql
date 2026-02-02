do $$
begin
  if to_regclass('public.purchase_orders') is not null then
    begin
      alter table public.purchase_orders
        add column payment_terms text not null default 'cash';
    exception when duplicate_column then
      null;
    end;

    begin
      alter table public.purchase_orders
        add column net_days integer not null default 0;
    exception when duplicate_column then
      null;
    end;

    begin
      alter table public.purchase_orders
        add column due_date date;
    exception when duplicate_column then
      null;
    end;

    begin
      alter table public.purchase_orders
        add constraint purchase_orders_payment_terms_check
        check (payment_terms in ('cash','credit'));
    exception when duplicate_object then
      null;
    end;

    begin
      alter table public.purchase_orders
        add constraint purchase_orders_net_days_check
        check (net_days >= 0);
    exception when duplicate_object then
      null;
    end;

    update public.purchase_orders
    set payment_terms = case
      when coalesce(total_amount, 0) > 0 and coalesce(paid_amount, 0) + 1e-9 < coalesce(total_amount, 0) then 'credit'
      else 'cash'
    end
    where payment_terms not in ('cash','credit');

    update public.purchase_orders
    set payment_terms = 'credit'
    where payment_terms = 'cash'
      and coalesce(total_amount, 0) > 0
      and coalesce(paid_amount, 0) + 1e-9 < coalesce(total_amount, 0);

    update public.purchase_orders
    set net_days = 30
    where payment_terms = 'credit'
      and coalesce(net_days, 0) = 0
      and coalesce(total_amount, 0) > 0
      and coalesce(paid_amount, 0) + 1e-9 < coalesce(total_amount, 0);

    update public.purchase_orders
    set due_date = (coalesce(purchase_date, current_date) + greatest(coalesce(net_days, 0), 0))
    where due_date is null;
  end if;

  if to_regclass('public.orders') is not null then
    begin
      alter table public.orders
        add column invoice_terms text not null default 'cash';
    exception when duplicate_column then
      null;
    end;

    begin
      alter table public.orders
        add column net_days integer not null default 0;
    exception when duplicate_column then
      null;
    end;

    begin
      alter table public.orders
        add column due_date date;
    exception when duplicate_column then
      null;
    end;

    begin
      alter table public.orders
        add constraint orders_invoice_terms_check
        check (invoice_terms in ('cash','credit'));
    exception when duplicate_object then
      null;
    end;

    begin
      alter table public.orders
        add constraint orders_net_days_check
        check (net_days >= 0);
    exception when duplicate_object then
      null;
    end;

    create or replace function public._sync_order_terms_columns()
    returns trigger
    language plpgsql
    security definer
    set search_path = public
    as $fn$
    declare
      v_terms text;
      v_net_days integer;
      v_due date;
      v_due_text text;
      v_basis timestamptz;
    begin
      v_terms := nullif(trim(coalesce(new.data->>'invoiceTerms','')), '');
      if v_terms is null then
        if coalesce((new.data->>'isCreditSale')::boolean, false) or coalesce(new.data->>'paymentMethod','') = 'ar' then
          v_terms := 'credit';
        else
          v_terms := 'cash';
        end if;
      end if;
      if v_terms <> 'credit' then
        v_terms := 'cash';
      end if;

      v_net_days := 0;
      begin
        v_net_days := greatest(0, coalesce(nullif((new.data->>'netDays')::int, 0), (new.data->>'creditDays')::int, new.net_days, 0));
      exception when others then
        v_net_days := greatest(0, coalesce(new.net_days, 0));
      end;

      v_due_text := nullif(trim(coalesce(new.data->>'dueDate','')), '');
      v_due := null;
      if v_due_text is not null then
        begin
          v_due := v_due_text::date;
        exception when others then
          v_due := null;
        end;
      end if;

      if v_due is null then
        begin
          v_basis := nullif(trim(coalesce(new.data->>'invoiceIssuedAt','')), '')::timestamptz;
        exception when others then
          v_basis := null;
        end;
        if v_basis is null then
          begin
            v_basis := nullif(trim(coalesce(new.data->>'deliveredAt','')), '')::timestamptz;
          exception when others then
            v_basis := null;
          end;
        end if;
        if v_basis is null then
          v_basis := coalesce(new.created_at, now());
        end if;

        if v_terms = 'cash' then
          v_due := (v_basis::date);
        else
          v_due := (v_basis::date + greatest(v_net_days, 0));
        end if;
      end if;

      new.invoice_terms := v_terms;
      new.net_days := greatest(0, coalesce(v_net_days, 0));
      new.due_date := v_due;
      return new;
    end
    $fn$;

    drop trigger if exists trg_orders_sync_terms on public.orders;
    create trigger trg_orders_sync_terms
    before insert or update on public.orders
    for each row execute function public._sync_order_terms_columns();

    update public.orders
    set data = data
    where true;
  end if;
end $$;
