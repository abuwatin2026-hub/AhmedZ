create or replace function public.compute_customer_ar_balance_in_company(
  p_customer_id uuid,
  p_company_id uuid
)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  with ar as (
    select public.get_account_id_by_code('1200') as ar_id
  )
  select coalesce(sum(jl.debit - jl.credit), 0)
  from public.journal_lines jl
  join public.journal_entries je on je.id = jl.journal_entry_id
  join ar on jl.account_id = ar.ar_id
  left join public.orders o_del
    on je.source_table = 'orders'
   and je.source_event = 'delivered'
   and je.source_id = o_del.id::text
  left join public.payments pay
    on je.source_table = 'payments'
   and je.source_id = pay.id::text
  left join public.orders o_pay
    on pay.reference_table = 'orders'
   and pay.reference_id = o_pay.id::text
  where (o_del.customer_auth_user_id = p_customer_id or o_pay.customer_auth_user_id = p_customer_id)
    and (p_company_id is null or coalesce(o_del.company_id, o_pay.company_id, je.company_id) = p_company_id);
$$;

revoke all on function public.compute_customer_ar_balance_in_company(uuid, uuid) from public;
revoke execute on function public.compute_customer_ar_balance_in_company(uuid, uuid) from anon;
grant execute on function public.compute_customer_ar_balance_in_company(uuid, uuid) to authenticated;

create or replace function public.get_customer_credit_summary(p_customer_id uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_customer record;
  v_balance numeric := 0;
  v_available numeric := 0;
  v_company_id uuid;
begin
  select c.*
  into v_customer
  from public.customers c
  where c.auth_user_id = p_customer_id;

  if not found then
    return json_build_object('exists', false);
  end if;

  select s.company_id into v_company_id
  from public.get_admin_session_scope() s
  limit 1;

  if v_company_id is null then
    v_balance := public.compute_customer_ar_balance(p_customer_id);
    update public.customers
    set current_balance = v_balance,
        updated_at = now()
    where auth_user_id = p_customer_id;
  else
    v_balance := public.compute_customer_ar_balance_in_company(p_customer_id, v_company_id);
  end if;

  v_available := greatest(coalesce(v_customer.credit_limit, 0) - v_balance, 0);

  return json_build_object(
    'exists', true,
    'customer_id', p_customer_id,
    'company_id', v_company_id,
    'customer_type', v_customer.customer_type,
    'payment_terms', v_customer.payment_terms,
    'credit_limit', coalesce(v_customer.credit_limit, 0),
    'current_balance', v_balance,
    'available_credit', v_available
  );
end;
$$;

revoke all on function public.get_customer_credit_summary(uuid) from public;
revoke execute on function public.get_customer_credit_summary(uuid) from anon;
grant execute on function public.get_customer_credit_summary(uuid) to authenticated;

create or replace function public.check_customer_credit_limit(
  p_customer_id uuid,
  p_order_amount numeric
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit numeric := 0;
  v_terms text := 'cash';
  v_current_balance numeric := 0;
  v_company_id uuid;
begin
  if p_customer_id is null then
    return true;
  end if;
  select coalesce(c.credit_limit, 0), coalesce(c.payment_terms, 'cash')
  into v_limit, v_terms
  from public.customers c
  where c.auth_user_id = p_customer_id;
  if not found then
    return true;
  end if;
  if v_terms = 'cash' then
    return true;
  end if;
  if v_limit <= 0 then
    return coalesce(p_order_amount, 0) <= 0;
  end if;

  select s.company_id into v_company_id
  from public.get_admin_session_scope() s
  limit 1;

  if v_company_id is null then
    v_current_balance := public.compute_customer_ar_balance(p_customer_id);
    update public.customers
    set current_balance = v_current_balance,
        updated_at = now()
    where auth_user_id = p_customer_id;
  else
    v_current_balance := public.compute_customer_ar_balance_in_company(p_customer_id, v_company_id);
  end if;

  return (v_current_balance + greatest(coalesce(p_order_amount, 0), 0)) <= v_limit;
end;
$$;

revoke all on function public.check_customer_credit_limit(uuid, numeric) from public;
revoke execute on function public.check_customer_credit_limit(uuid, numeric) from anon;
grant execute on function public.check_customer_credit_limit(uuid, numeric) to authenticated;

select pg_sleep(0.5);
notify pgrst, 'reload schema';
