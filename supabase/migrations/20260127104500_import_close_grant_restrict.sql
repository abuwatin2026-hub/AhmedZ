-- Restrict EXECUTE privileges for import shipment close function to service_role
do $$
begin
  -- Safely adjust privileges without redefining the function
  revoke all on function public.trg_close_import_shipment() from public;
  revoke execute on function public.trg_close_import_shipment() from anon;
  revoke execute on function public.trg_close_import_shipment() from authenticated;
  grant execute on function public.trg_close_import_shipment() to service_role;
exception
  when undefined_function then
    -- Function may not exist yet on some environments; ignore
    null;
end $$;
