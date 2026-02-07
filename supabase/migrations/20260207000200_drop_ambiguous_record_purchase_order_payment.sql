set app.allow_ledger_ddl = '1';

drop function if exists public.record_purchase_order_payment(uuid, numeric, text, timestamptz, jsonb);

