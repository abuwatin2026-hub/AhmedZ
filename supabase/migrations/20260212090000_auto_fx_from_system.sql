do $$
begin
  if to_regclass('public.purchase_orders') is not null then
    create or replace function public.trg_purchase_orders_fx_lock()
    returns trigger
    language plpgsql
    security definer
    set search_path = public
    as $fn$
    declare
      v_rate numeric;
      v_lock_amounts boolean := false;
      v_on_date date;
    begin
      if tg_op = 'INSERT' then
        if new.currency is null then
          new.currency := public.get_base_currency();
        end if;
        v_on_date := coalesce(new.purchase_date, current_date);
        v_rate := public.get_fx_rate(new.currency, v_on_date, 'accounting');
        if v_rate is null or v_rate <= 0 then
          raise exception 'لا يوجد سعر صرف محاسبي لهذه العملة في التاريخ المحدد. أضف السعر من شاشة أسعار الصرف.';
        end if;
        new.fx_rate := v_rate;
        new.base_total := coalesce(new.total_amount, 0) * coalesce(new.fx_rate, 0);
        return new;
      end if;
      if tg_op = 'UPDATE' then
        v_lock_amounts := coalesce(old.status, 'draft') <> 'draft'
          or exists (select 1 from public.purchase_receipts pr where pr.purchase_order_id = old.id limit 1)
          or exists (
            select 1
            from public.payments p
            where p.reference_table = 'purchase_orders'
              and p.direction = 'out'
              and p.reference_id = old.id::text
            limit 1
          )
          or exists (
            select 1
            from public.inventory_movements im
            where im.reference_table = 'purchase_orders'
              and im.reference_id = old.id::text
            limit 1
          );
  
        if (new.status = 'completed') and (old.status is distinct from 'completed') then
          new.fx_locked := true;
        end if;
        if coalesce(old.fx_locked, false) = true then
          new.currency := old.currency;
          new.fx_rate := old.fx_rate;
          new.total_amount := old.total_amount;
          new.base_total := old.base_total;
          return new;
        end if;
        if v_lock_amounts then
          new.currency := old.currency;
          new.fx_rate := old.fx_rate;
          new.total_amount := old.total_amount;
          new.base_total := old.base_total;
          return new;
        end if;
  
        if new.currency is null then
          new.currency := coalesce(old.currency, public.get_base_currency());
        end if;
        v_on_date := coalesce(new.purchase_date, old.purchase_date, current_date);
        v_rate := public.get_fx_rate(new.currency, v_on_date, 'accounting');
        if v_rate is null or v_rate <= 0 then
          raise exception 'لا يوجد سعر صرف محاسبي لهذه العملة في التاريخ المحدد. أضف السعر من شاشة أسعار الصرف.';
        end if;
        new.fx_rate := v_rate;
        new.base_total := coalesce(new.total_amount, 0) * coalesce(new.fx_rate, 0);
        return new;
      end if;
      return new;
    end;
    $fn$;
  
    drop trigger if exists trg_purchase_orders_fx_lock on public.purchase_orders;
    create trigger trg_purchase_orders_fx_lock
    before insert or update on public.purchase_orders
    for each row execute function public.trg_purchase_orders_fx_lock();
  end if;
end $$;

do $$
begin
  if to_regclass('public.import_expenses') is not null then
    create or replace function public.trg_import_expenses_set_fx_system()
    returns trigger
    language plpgsql
    security definer
    set search_path = public
    as $fn$
    declare
      v_rate numeric;
      v_on_date date;
      v_currency text;
    begin
      v_currency := upper(nullif(btrim(coalesce(new.currency, '')), ''));
      if v_currency is null then
        v_currency := public.get_base_currency();
      end if;
      new.currency := v_currency;
      v_on_date := coalesce(new.paid_at, current_date);
      v_rate := public.get_fx_rate(v_currency, v_on_date, 'operational');
      if v_rate is null or v_rate <= 0 then
        raise exception 'لا يوجد سعر صرف تشغيلي لهذه العملة في التاريخ المحدد. أضف السعر من شاشة أسعار الصرف.';
      end if;
      new.exchange_rate := v_rate;
      return new;
    end;
    $fn$;
  
    drop trigger if exists trg_import_expenses_set_fx_system on public.import_expenses;
    create trigger trg_import_expenses_set_fx_system
    before insert or update on public.import_expenses
    for each row execute function public.trg_import_expenses_set_fx_system();
  end if;
end $$;

notify pgrst, 'reload schema';
