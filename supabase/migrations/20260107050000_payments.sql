create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  direction text not null check (direction in ('in', 'out')),
  method text not null,
  amount numeric not null check (amount > 0),
  currency text not null default 'YER',
  reference_table text,
  reference_id text,
  occurred_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_payments_occurred_at on public.payments(occurred_at desc);
create index if not exists idx_payments_method on public.payments(method);
create index if not exists idx_payments_reference on public.payments(reference_table, reference_id);
create unique index if not exists uq_payments_order_in
on public.payments(reference_id)
where direction = 'in' and reference_table = 'orders';
alter table public.payments enable row level security;
drop policy if exists payments_select_authenticated on public.payments;
create policy payments_select_authenticated
on public.payments
for select
using (auth.role() = 'authenticated');
drop policy if exists payments_admin_write on public.payments;
create policy payments_admin_write
on public.payments
for all
using (public.is_admin())
with check (public.is_admin());
create or replace function public.record_order_payment(
  p_order_id uuid,
  p_amount numeric,
  p_method text,
  p_occurred_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_exists int;
  v_amount numeric;
  v_method text;
  v_occurred_at timestamptz;
  v_payment_id uuid;
begin
  if not public.is_admin() then
    raise exception 'not allowed';
  end if;

  if p_order_id is null then
    raise exception 'p_order_id is required';
  end if;

  v_amount := coalesce(p_amount, 0);
  if v_amount <= 0 then
    select coalesce(nullif((o.data->>'total')::numeric, null), 0)
    into v_amount
    from public.orders o
    where o.id = p_order_id;
  end if;

  if v_amount <= 0 then
    raise exception 'invalid amount';
  end if;

  v_method := nullif(trim(coalesce(p_method, '')), '');
  if v_method is null then
    v_method := 'cash';
  end if;

  v_occurred_at := coalesce(p_occurred_at, now());

  select count(1)
  into v_exists
  from public.payments p
  where p.reference_table = 'orders'
    and p.reference_id = p_order_id::text
    and p.direction = 'in';

  if v_exists > 0 then
    update public.payments
    set amount = v_amount,
        method = v_method,
        occurred_at = v_occurred_at,
        created_by = coalesce(created_by, auth.uid()),
        data = jsonb_set(coalesce(data, '{}'::jsonb), '{orderId}', to_jsonb(p_order_id::text), true)
    where reference_table = 'orders'
      and reference_id = p_order_id::text
      and direction = 'in';
  else
    insert into public.payments(direction, method, amount, currency, reference_table, reference_id, occurred_at, created_by, data)
    values (
      'in',
      v_method,
      v_amount,
      'YER',
      'orders',
      p_order_id::text,
      v_occurred_at,
      auth.uid(),
      jsonb_build_object('orderId', p_order_id::text)
    )
    returning id into v_payment_id;

    perform public.post_payment(v_payment_id);
  end if;
end;
$$;
revoke all on function public.record_order_payment(uuid, numeric, text, timestamptz) from public;
grant execute on function public.record_order_payment(uuid, numeric, text, timestamptz) to anon, authenticated;
