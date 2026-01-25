create or replace function public.get_active_promotions(
  p_customer_id uuid default null,
  p_warehouse_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_customer_id uuid;
  v_now timestamptz := now();
  v_result jsonb := '[]'::jsonb;
  v_promo record;
begin
  v_actor := auth.uid();
  v_customer_id := coalesce(p_customer_id, v_actor);

  for v_promo in
    select p.*
    from public.promotions p
    where p.is_active = true
      and p.approval_status = 'approved'
      and v_now >= p.start_at
      and v_now <= p.end_at
    order by p.end_at asc, p.created_at desc
  loop
    v_result := v_result || public._compute_promotion_price_only(v_promo.id, v_customer_id, 1);
  end loop;

  return v_result;
end;
$$;

revoke all on function public.get_active_promotions(uuid, uuid) from public;
grant execute on function public.get_active_promotions(uuid, uuid) to anon, authenticated;

