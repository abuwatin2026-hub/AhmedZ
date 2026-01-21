create or replace function public.log_menu_item_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old_price numeric;
  v_new_price numeric;
  v_old_cost numeric;
  v_new_cost numeric;
  v_item_name_ar text;
begin
  if tg_op = 'UPDATE' then
    v_old_price := coalesce(nullif(old.data->>'price', '')::numeric, 0);
    v_new_price := coalesce(nullif(new.data->>'price', '')::numeric, 0);
    v_old_cost := coalesce(nullif(old.data->>'costPrice', '')::numeric, 0);
    v_new_cost := coalesce(nullif(new.data->>'costPrice', '')::numeric, 0);
    v_item_name_ar := coalesce(new.data->'name'->>'ar', new.data->'name'->>'en', new.id);

    if v_old_price is distinct from v_new_price then
      insert into public.system_audit_logs(action, module, details, performed_by, performed_at, metadata)
      values (
        'price_change',
        'menu_items',
        concat('Price changed for item "', v_item_name_ar, '" (', new.id, ') from ', coalesce(v_old_price::text, 'NULL'), ' to ', coalesce(v_new_price::text, 'NULL')),
        auth.uid(),
        now(),
        jsonb_build_object(
          'item_id', new.id,
          'item_name', new.data->'name',
          'old_price', v_old_price,
          'new_price', v_new_price,
          'change_amount', coalesce(v_new_price, 0) - coalesce(v_old_price, 0)
        )
      );
    end if;

    if v_old_cost is distinct from v_new_cost then
      insert into public.system_audit_logs(action, module, details, performed_by, performed_at, metadata)
      values (
        'cost_change',
        'menu_items',
        concat('Cost price changed for item "', v_item_name_ar, '" (', new.id, ') from ', coalesce(v_old_cost::text, 'NULL'), ' to ', coalesce(v_new_cost::text, 'NULL')),
        auth.uid(),
        now(),
        jsonb_build_object(
          'item_id', new.id,
          'item_name', new.data->'name',
          'old_cost', v_old_cost,
          'new_cost', v_new_cost
        )
      );
    end if;

    if (old.data->>'status') is distinct from (new.data->>'status') then
      insert into public.system_audit_logs(action, module, details, performed_by, performed_at, metadata)
      values (
        'status_change',
        'menu_items',
        concat('Status changed for item "', v_item_name_ar, '" (', new.id, ') from ', old.data->>'status', ' to ', new.data->>'status'),
        auth.uid(),
        now(),
        jsonb_build_object(
          'item_id', new.id,
          'item_name', new.data->'name',
          'old_status', old.data->>'status',
          'new_status', new.data->>'status'
        )
      );
    end if;
  elsif tg_op = 'DELETE' then
    v_item_name_ar := coalesce(old.data->'name'->>'ar', old.data->'name'->>'en', old.id);
    insert into public.system_audit_logs(action, module, details, performed_by, performed_at, metadata)
    values (
      'delete',
      'menu_items',
      concat('Deleted item "', v_item_name_ar, '" (', old.id, ')'),
      auth.uid(),
      now(),
      jsonb_build_object(
        'item_id', old.id,
        'item_name', old.data->'name',
        'item_data', old.data
      )
    );
  end if;

  return coalesce(new, old);
end;
$$;
drop trigger if exists trg_menu_items_audit on public.menu_items;
create trigger trg_menu_items_audit
after update or delete on public.menu_items
for each row execute function public.log_menu_item_changes();
