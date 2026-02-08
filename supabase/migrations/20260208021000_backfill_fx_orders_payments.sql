do $$
declare
  v_base text := public.get_base_currency();
begin
  -- Backfill Orders: set currency, fx_rate, base_total using operational FX at the effective order date
  update public.orders o
  set currency = upper(coalesce(nullif(btrim(coalesce(o.currency, '')), ''), nullif(btrim(coalesce(o.data->>'currency', '')), ''), v_base)),
      fx_rate = coalesce(
        o.fx_rate,
        coalesce(
          public.get_fx_rate(
            upper(coalesce(nullif(btrim(coalesce(o.currency, '')), ''), nullif(btrim(coalesce(o.data->>'currency', '')), ''), v_base)),
            (
              coalesce(
                nullif(o.data->'invoiceSnapshot'->>'issuedAt', '')::timestamptz,
                nullif(o.data->>'paidAt', '')::timestamptz,
                nullif(o.data->>'deliveredAt', '')::timestamptz,
                o.created_at
              )::date
            ),
            'operational'
          ),
          1
        )
      ),
      base_total = coalesce(
        o.base_total,
        coalesce(nullif((o.data->>'total')::numeric, null), 0)
        * coalesce(
            o.fx_rate,
            coalesce(
              public.get_fx_rate(
                upper(coalesce(nullif(btrim(coalesce(o.currency, '')), ''), nullif(btrim(coalesce(o.data->>'currency', '')), ''), v_base)),
                (
                  coalesce(
                    nullif(o.data->'invoiceSnapshot'->>'issuedAt', '')::timestamptz,
                    nullif(o.data->>'paidAt', '')::timestamptz,
                    nullif(o.data->>'deliveredAt', '')::timestamptz,
                    o.created_at
                  )::date
                ),
                'operational'
              ),
              1
            )
        )
      )
  where coalesce(o.base_total, 0) = 0
    and coalesce(nullif(o.data->>'total','')::numeric, 0) > 0;

  -- Normalize Orders currency casing
  update public.orders
  set currency = upper(coalesce(nullif(btrim(coalesce(currency, '')), ''), v_base))
  where currency is not null;

  -- Backfill Payments: set currency, fx_rate, base_amount using operational FX at occurred_at
  update public.payments p
  set currency = upper(coalesce(nullif(btrim(coalesce(p.currency, '')), ''), v_base)),
      fx_rate = coalesce(
        p.fx_rate,
        coalesce(public.get_fx_rate(upper(coalesce(nullif(btrim(coalesce(p.currency, '')), ''), v_base)), p.occurred_at::date, 'operational'), 1)
      ),
      base_amount = coalesce(
        p.base_amount,
        coalesce(p.amount, 0) * coalesce(
          p.fx_rate,
          coalesce(public.get_fx_rate(upper(coalesce(nullif(btrim(coalesce(p.currency, '')), ''), v_base)), p.occurred_at::date, 'operational'), 1)
        )
      )
  where coalesce(p.base_amount, 0) = 0
    and coalesce(p.amount, 0) > 0;
end $$;

select pg_sleep(0.5);
notify pgrst, 'reload schema';

