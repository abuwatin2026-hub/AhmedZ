-- إضافة دور جديد: cashier، وتحديث القيود والسياسات ذات الصلة
-- هذه الترحيلات آمنة لإعادة التشغيل (idempotent) قدر الإمكان

-- 1) تحديث قيد الدور في جدول admin_users
ALTER TABLE public.admin_users DROP CONSTRAINT IF EXISTS admin_users_role_check;
ALTER TABLE public.admin_users 
  ADD CONSTRAINT admin_users_role_check 
  CHECK (role IN ('owner','manager','employee','cashier','delivery'));

-- 2) تحديث سياسة عرض الطلبات لتشمل دور cashier
DROP POLICY IF EXISTS orders_select_permissions ON public.orders;
CREATE POLICY orders_select_permissions
ON public.orders
FOR SELECT
USING (
  -- 1. الزبون يرى طلباته الخاصة
  (auth.role() = 'authenticated' and customer_auth_user_id = auth.uid())
  OR
  -- 2. المالك/المدير/الموظف/الكاشير يرون كل الطلبات
  (exists (
    select 1 from public.admin_users au 
    where au.auth_user_id = auth.uid() 
      and au.is_active = true 
      and au.role in ('owner', 'manager', 'employee', 'cashier')
  ))
  OR
  -- 3. المندوب يرى الطلبات المسندة إليه فقط
  (exists (
    select 1 from public.admin_users au 
    where au.auth_user_id = auth.uid() 
      and au.is_active = true 
      and au.role = 'delivery'
  ) AND ((data->>'assignedDeliveryUserId') = auth.uid()::text))
);

-- 3) تحديث سياسة عرض أحداث الطلبات بما يتوافق مع سياسة الطلبات
DROP POLICY IF EXISTS order_events_select_permissions ON public.order_events;
CREATE POLICY order_events_select_permissions
ON public.order_events
FOR SELECT
USING (
  exists (
    select 1 from public.orders o
    where o.id = order_events.order_id
    and (
        -- الزبون يرى أحداث طلبه
        (o.customer_auth_user_id = auth.uid())
        OR
        -- المالك/المدير/الموظف/الكاشير يرون كل الأحداث
        (exists (
            select 1 from public.admin_users au 
            where au.auth_user_id = auth.uid() 
              and au.is_active = true 
              and au.role in ('owner', 'manager', 'employee', 'cashier')
        ))
        OR
        -- المندوب يرى أحداث الطلبات المسندة إليه فقط
        (exists (
            select 1 from public.admin_users au 
            where au.auth_user_id = auth.uid() 
              and au.is_active = true 
              and au.role = 'delivery'
        ) AND ((o.data->>'assignedDeliveryUserId') = auth.uid()::text))
    )
  )
);

-- 4) تقييد إنشاء ورديات النقد (cash_shifts) ليقتصر على دور الكاشير
DROP POLICY IF EXISTS "Cashiers can insert their shifts" ON public.cash_shifts;
CREATE POLICY "Cashiers can insert their shifts" ON public.cash_shifts
    FOR INSERT
    WITH CHECK (
      auth.uid() = cashier_id
      AND exists (
        select 1
        from public.admin_users au
        where au.auth_user_id = auth.uid()
          and au.is_active = true
          and (au.role = 'cashier' OR public.has_admin_permission('cashShifts.open'))
      )
    );

-- 5) السماح بإغلاق الوردية لمن لديه صلاحية الإدارة حتى لو لم يكن مالك/مدير
create or replace function public.close_cash_shift(
  p_shift_id uuid,
  p_end_amount numeric,
  p_notes text
)
returns public.cash_shifts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shift public.cash_shifts%rowtype;
  v_expected numeric;
  v_end numeric;
  v_actor_role text;
begin
  if auth.uid() is null then
    raise exception 'not allowed';
  end if;

  if p_shift_id is null then
    raise exception 'p_shift_id is required';
  end if;

  select au.role
  into v_actor_role
  from public.admin_users au
  where au.auth_user_id = auth.uid()
    and au.is_active = true;

  if v_actor_role is null then
    raise exception 'not allowed';
  end if;

  select *
  into v_shift
  from public.cash_shifts s
  where s.id = p_shift_id
  for update;

  if not found then
    raise exception 'cash shift not found';
  end if;

  if auth.uid() <> v_shift.cashier_id and (v_actor_role not in ('owner', 'manager') and not public.has_admin_permission('cashShifts.manage')) then
    raise exception 'not allowed';
  end if;

  if coalesce(v_shift.status, 'open') <> 'open' then
    return v_shift;
  end if;

  v_end := coalesce(p_end_amount, 0);
  if v_end < 0 then
    raise exception 'invalid end amount';
  end if;

  v_expected := public.calculate_cash_shift_expected(p_shift_id);

  update public.cash_shifts
  set closed_at = now(),
      end_amount = v_end,
      expected_amount = v_expected,
      difference = v_end - v_expected,
      status = 'closed',
      notes = nullif(coalesce(p_notes, ''), '')
  where id = p_shift_id
  returning * into v_shift;

  perform public.post_cash_shift_close(p_shift_id);

  return v_shift;
end;
$$;

revoke all on function public.close_cash_shift(uuid, numeric, text) from public;
grant execute on function public.close_cash_shift(uuid, numeric, text) to anon, authenticated;
