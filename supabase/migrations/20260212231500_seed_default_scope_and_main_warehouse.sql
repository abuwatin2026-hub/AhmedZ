do $$
declare
  v_company_id uuid;
  v_branch_id uuid;
  v_warehouse_id uuid;
begin
  select id into v_company_id
  from public.companies
  where is_active = true
  order by created_at asc
  limit 1;

  if v_company_id is null then
    insert into public.companies(name, is_active)
    values ('Default Company', true)
    returning id into v_company_id;
  end if;

  select id into v_branch_id
  from public.branches
  where company_id = v_company_id
    and is_active = true
  order by created_at asc
  limit 1;

  if v_branch_id is null then
    insert into public.branches(company_id, code, name, is_active)
    values (v_company_id, 'MAIN', 'Main Branch', true)
    returning id into v_branch_id;
  end if;

  select id into v_warehouse_id
  from public.warehouses
  where is_active = true
    and upper(coalesce(code, '')) = 'MAIN'
  order by created_at asc
  limit 1;

  if v_warehouse_id is null then
    insert into public.warehouses(code, name, type, is_active, company_id, branch_id)
    values ('MAIN', 'Main Warehouse', 'main', true, v_company_id, v_branch_id)
    returning id into v_warehouse_id;
  end if;

  update public.warehouses
  set company_id = coalesce(company_id, v_company_id),
      branch_id = coalesce(branch_id, v_branch_id)
  where is_active = true;

  update public.admin_users
  set company_id = coalesce(company_id, v_company_id),
      branch_id = coalesce(branch_id, v_branch_id),
      warehouse_id = coalesce(warehouse_id, v_warehouse_id);
end $$;

notify pgrst, 'reload schema';
