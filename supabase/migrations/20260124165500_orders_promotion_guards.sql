create or replace function public.trg_orders_promotion_guards()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_has_promos boolean;
  v_coupon text;
  v_points numeric;
begin
  v_has_promos := (jsonb_typeof(coalesce(new.data->'promotionLines', '[]'::jsonb)) = 'array')
                  and (jsonb_array_length(coalesce(new.data->'promotionLines', '[]'::jsonb)) > 0);
  if not v_has_promos then
    return new;
  end if;

  v_coupon := nullif(btrim(coalesce(new.data->>'appliedCouponCode', new.data->>'couponCode', '')), '');
  if v_coupon is not null then
    raise exception 'promotion_coupon_conflict';
  end if;

  v_points := coalesce(nullif((new.data->>'pointsRedeemedValue')::numeric, null), 0);
  if v_points > 0 then
    raise exception 'promotion_points_conflict';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_orders_promotion_guards on public.orders;
create trigger trg_orders_promotion_guards
before insert or update on public.orders
for each row execute function public.trg_orders_promotion_guards();

