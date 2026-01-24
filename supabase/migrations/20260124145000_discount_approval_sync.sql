revoke execute on function public.create_approval_request(text, text, text, numeric, jsonb) from anon;
grant execute on function public.create_approval_request(text, text, text, numeric, jsonb) to authenticated;

revoke execute on function public.approve_approval_step(uuid, int) from anon;
grant execute on function public.approve_approval_step(uuid, int) to authenticated;

revoke execute on function public.reject_approval_request(uuid) from anon;
grant execute on function public.reject_approval_request(uuid) to authenticated;

create or replace function public.trg_sync_discount_approval_to_order()
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
     and new.target_table = 'orders'
     and new.status is distinct from old.status then
    update public.orders
    set
      discount_requires_approval = true,
      discount_approval_status = new.status,
      discount_approval_request_id = new.id
    where id::text = new.target_id;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_sync_discount_approval_to_order on public.approval_requests;
create trigger trg_sync_discount_approval_to_order
after update on public.approval_requests
for each row execute function public.trg_sync_discount_approval_to_order();
