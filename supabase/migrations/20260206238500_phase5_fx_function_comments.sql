comment on function public.post_order_delivery(uuid) is 'GL posting uses base currency only (journal_lines in base); order.base_total is authoritative.';
comment on function public.post_invoice_issued(uuid, timestamptz) is 'GL posting uses base currency only (journal_lines in base); order.base_total is authoritative.';
comment on function public.post_payment(uuid) is 'GL posting uses base currency only (journal_lines in base) and uses stored payments.base_amount; realized FX uses 6200/6201.';
comment on function public.get_fx_rate(text, date, text) is 'FX policy: rate = Base per 1 Foreign Currency. Returned rate is stored direction; no inversion at lookup.';

notify pgrst, 'reload schema';

