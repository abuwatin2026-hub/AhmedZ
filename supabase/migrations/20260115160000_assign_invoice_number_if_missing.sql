-- Assign invoice number via sequence if missing, and return it
create or replace function public.assign_invoice_number_if_missing(
  p_order_id uuid
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_num text;
begin
  if not public.is_staff() then
    raise exception 'not allowed';
  end if;

  select invoice_number into v_num from public.orders where id = p_order_id for update;
  if v_num is null or length(trim(v_num)) = 0 then
    v_num := public.generate_invoice_number();
    update public.orders
    set invoice_number = v_num,
        updated_at = now()
    where id = p_order_id;
  end if;
  return v_num;
end;
$$;

revoke all on function public.assign_invoice_number_if_missing(uuid) from public;
revoke execute on function public.assign_invoice_number_if_missing(uuid) from anon;
grant execute on function public.assign_invoice_number_if_missing(uuid) to authenticated;
