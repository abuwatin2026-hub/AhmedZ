set app.allow_ledger_ddl = '1';

do $$
declare
  v_sig text;
begin
  for v_sig in
    select p.oid::regprocedure::text
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'complete_warehouse_transfer',
        'cancel_warehouse_transfer',
        'confirm_order_delivery',
        'confirm_order_delivery_with_credit'
      )
  loop
    execute format('revoke all on function public.%s from anon', v_sig);
    execute format('grant execute on function public.%s to authenticated', v_sig);
    execute format('grant execute on function public.%s to service_role', v_sig);
  end loop;
end $$;

notify pgrst, 'reload schema';
