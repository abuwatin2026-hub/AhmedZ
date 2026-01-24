create or replace function public.get_promotions_admin()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  if not public.is_admin() then
    raise exception 'not allowed';
  end if;

  select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb)
  into v_result
  from (
    select
      p.id,
      p.name,
      p.start_at,
      p.end_at,
      p.is_active,
      p.discount_mode,
      p.fixed_total,
      p.percent_off,
      p.display_original_total,
      p.max_uses,
      p.stack_policy,
      p.exclusive_with_coupon,
      p.requires_approval,
      p.approval_status,
      p.approval_request_id,
      p.data,
      p.created_by,
      p.created_at,
      p.updated_at,
      coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', pi.id,
          'itemId', pi.item_id,
          'quantity', pi.quantity,
          'sortOrder', pi.sort_order
        ) order by pi.sort_order asc, pi.created_at asc, pi.id asc)
        from public.promotion_items pi
        where pi.promotion_id = p.id
      ), '[]'::jsonb) as items
    from public.promotions p
    order by p.created_at desc, p.id desc
  ) t;

  return v_result;
end;
$$;

revoke all on function public.get_promotions_admin() from public;
grant execute on function public.get_promotions_admin() to authenticated;

create or replace function public.upsert_promotion(
  p_promotion jsonb,
  p_items jsonb,
  p_activate boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_promo_id uuid;
  v_name text;
  v_start_at timestamptz;
  v_end_at timestamptz;
  v_is_active boolean;
  v_discount_mode text;
  v_fixed_total numeric;
  v_percent_off numeric;
  v_display_original_total numeric;
  v_max_uses int;
  v_exclusive_with_coupon boolean;
  v_item jsonb;
  v_item_id text;
  v_qty numeric;
  v_sort int;
  v_snapshot jsonb;
  v_promo_expense numeric;
  v_requires_approval boolean;
  v_req_id uuid;
begin
  v_actor := auth.uid();
  if v_actor is null then
    raise exception 'not authenticated';
  end if;
  if not public.is_admin() then
    raise exception 'not allowed';
  end if;

  if p_promotion is null then
    raise exception 'p_promotion is required';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'p_items must be a json array';
  end if;

  v_promo_id := public._uuid_or_null(p_promotion->>'id');
  v_name := nullif(btrim(coalesce(p_promotion->>'name','')), '');
  v_start_at := nullif(p_promotion->>'startAt','')::timestamptz;
  v_end_at := nullif(p_promotion->>'endAt','')::timestamptz;
  v_discount_mode := nullif(btrim(coalesce(p_promotion->>'discountMode','')), '');
  v_fixed_total := nullif((p_promotion->>'fixedTotal')::numeric, null);
  v_percent_off := nullif((p_promotion->>'percentOff')::numeric, null);
  v_display_original_total := nullif((p_promotion->>'displayOriginalTotal')::numeric, null);
  v_max_uses := nullif((p_promotion->>'maxUses')::int, null);
  v_exclusive_with_coupon := coalesce((p_promotion->>'exclusiveWithCoupon')::boolean, true);

  if v_name is null then
    raise exception 'name is required';
  end if;
  if v_start_at is null or v_end_at is null then
    raise exception 'startAt/endAt are required';
  end if;
  if v_start_at >= v_end_at then
    raise exception 'startAt must be before endAt';
  end if;
  if v_discount_mode not in ('fixed_total','percent_off') then
    raise exception 'invalid discountMode';
  end if;
  if v_discount_mode = 'fixed_total' then
    if v_fixed_total is null or v_fixed_total <= 0 then
      raise exception 'fixedTotal must be positive';
    end if;
    v_percent_off := null;
  else
    if v_percent_off is null or v_percent_off <= 0 or v_percent_off > 100 then
      raise exception 'percentOff must be between 0 and 100';
    end if;
    v_fixed_total := null;
  end if;

  if v_promo_id is null then
    insert into public.promotions(
      name, start_at, end_at, is_active,
      discount_mode, fixed_total, percent_off,
      display_original_total, max_uses, exclusive_with_coupon,
      created_by, data
    )
    values (
      v_name, v_start_at, v_end_at, false,
      v_discount_mode, v_fixed_total, v_percent_off,
      v_display_original_total, v_max_uses, v_exclusive_with_coupon,
      v_actor, coalesce(p_promotion->'data', '{}'::jsonb)
    )
    returning id into v_promo_id;
  else
    update public.promotions
    set
      name = v_name,
      start_at = v_start_at,
      end_at = v_end_at,
      discount_mode = v_discount_mode,
      fixed_total = v_fixed_total,
      percent_off = v_percent_off,
      display_original_total = v_display_original_total,
      max_uses = v_max_uses,
      exclusive_with_coupon = v_exclusive_with_coupon,
      data = coalesce(p_promotion->'data', data),
      updated_at = now()
    where id = v_promo_id;

    if not found then
      raise exception 'promotion_not_found';
    end if;
  end if;

  delete from public.promotion_items where promotion_id = v_promo_id;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_item_id := nullif(btrim(coalesce(v_item->>'itemId','')), '');
    v_qty := coalesce(nullif((v_item->>'quantity')::numeric, null), 0);
    v_sort := coalesce(nullif((v_item->>'sortOrder')::int, null), 0);
    if v_item_id is null then
      raise exception 'itemId is required';
    end if;
    if v_qty <= 0 then
      raise exception 'quantity must be positive';
    end if;

    insert into public.promotion_items(promotion_id, item_id, quantity, sort_order)
    values (v_promo_id, v_item_id, v_qty, v_sort);
  end loop;

  if coalesce(p_activate, false) then
    v_snapshot := public._compute_promotion_snapshot(v_promo_id, null, null, 1, null, false);
    v_promo_expense := coalesce(nullif((v_snapshot->>'promotionExpense')::numeric, null), 0);
    v_requires_approval := public.approval_required('discount', v_promo_expense);

    if v_requires_approval then
      v_req_id := public.create_approval_request(
        'promotions',
        v_promo_id::text,
        'discount',
        v_promo_expense,
        jsonb_build_object(
          'promotionId', v_promo_id::text,
          'name', v_name,
          'promotionExpense', v_promo_expense,
          'snapshot', v_snapshot
        )
      );

      update public.promotions
      set
        requires_approval = true,
        approval_status = 'pending',
        approval_request_id = v_req_id,
        is_active = false,
        updated_at = now()
      where id = v_promo_id;
    else
      update public.promotions
      set
        requires_approval = false,
        approval_status = 'approved',
        approval_request_id = null,
        is_active = true,
        updated_at = now()
      where id = v_promo_id;
    end if;
  end if;

  return jsonb_build_object(
    'promotionId', v_promo_id::text,
    'approvalRequestId', case when v_req_id is null then null else v_req_id::text end,
    'approvalStatus', (select p.approval_status from public.promotions p where p.id = v_promo_id),
    'isActive', (select p.is_active from public.promotions p where p.id = v_promo_id)
  );
end;
$$;

revoke all on function public.upsert_promotion(jsonb, jsonb, boolean) from public;
grant execute on function public.upsert_promotion(jsonb, jsonb, boolean) to authenticated;

create or replace function public.deactivate_promotion(p_promotion_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'not allowed';
  end if;
  if p_promotion_id is null then
    raise exception 'p_promotion_id is required';
  end if;
  update public.promotions
  set is_active = false,
      updated_at = now()
  where id = p_promotion_id;
  if not found then
    raise exception 'promotion_not_found';
  end if;
end;
$$;

revoke all on function public.deactivate_promotion(uuid) from public;
grant execute on function public.deactivate_promotion(uuid) to authenticated;

create or replace function public.trg_sync_discount_approval_to_promotion()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op <> 'UPDATE' then
    return new;
  end if;

  if new.request_type = 'discount'
     and new.target_table = 'promotions'
     and new.status is distinct from old.status then
    update public.promotions
    set
      requires_approval = true,
      approval_status = new.status,
      approval_request_id = new.id,
      updated_at = now()
    where id::text = new.target_id;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_sync_discount_approval_to_promotion on public.approval_requests;
create trigger trg_sync_discount_approval_to_promotion
after update on public.approval_requests
for each row execute function public.trg_sync_discount_approval_to_promotion();

