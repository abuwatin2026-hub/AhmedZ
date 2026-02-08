do $$
declare
  v_base text := public.get_base_currency();
begin
  update public.orders o
  set
    currency = upper(coalesce(nullif(btrim(coalesce(o.currency, '')), ''), nullif(btrim(coalesce(o.data->>'currency', '')), ''), v_base)),
    fx_rate = coalesce(
      nullif(o.fx_rate, 0),
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
      case
        when upper(coalesce(nullif(btrim(coalesce(o.currency, '')), ''), nullif(btrim(coalesce(o.data->>'currency', '')), ''), v_base)) = upper(v_base)
          then 1
        else null
      end
    ),
    base_total = coalesce(
      nullif(o.base_total, 0),
      case
        when coalesce(
          nullif(o.fx_rate, 0),
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
          case
            when upper(coalesce(nullif(btrim(coalesce(o.currency, '')), ''), nullif(btrim(coalesce(o.data->>'currency', '')), ''), v_base)) = upper(v_base)
              then 1
            else null
          end
        ) is not null
        then coalesce(nullif((o.data->>'total')::numeric, null), 0)
             * coalesce(
                 nullif(o.fx_rate, 0),
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
                 case
                   when upper(coalesce(nullif(btrim(coalesce(o.currency, '')), ''), nullif(btrim(coalesce(o.data->>'currency', '')), ''), v_base)) = upper(v_base)
                     then 1
                   else null
                 end
               )
        else null
      end
    )
  where coalesce(nullif(o.base_total, 0), 0) = 0
    and coalesce(nullif((o.data->>'total')::numeric, null), 0) > 0;

  update public.orders
  set currency = upper(coalesce(nullif(btrim(coalesce(currency, '')), ''), v_base))
  where currency is not null;

  update public.payments p
  set
    currency = upper(coalesce(nullif(btrim(coalesce(p.currency, '')), ''), v_base)),
    fx_rate = coalesce(
      nullif(p.fx_rate, 0),
      public.get_fx_rate(
        upper(coalesce(nullif(btrim(coalesce(p.currency, '')), ''), v_base)),
        p.occurred_at::date,
        'operational'
      ),
      case
        when upper(coalesce(nullif(btrim(coalesce(p.currency, '')), ''), v_base)) = upper(v_base)
          then 1
        else null
      end
    ),
    base_amount = coalesce(
      nullif(p.base_amount, 0),
      case
        when coalesce(
          nullif(p.fx_rate, 0),
          public.get_fx_rate(
            upper(coalesce(nullif(btrim(coalesce(p.currency, '')), ''), v_base)),
            p.occurred_at::date,
            'operational'
          ),
          case
            when upper(coalesce(nullif(btrim(coalesce(p.currency, '')), ''), v_base)) = upper(v_base)
              then 1
            else null
          end
        ) is not null
        then coalesce(p.amount, 0)
             * coalesce(
                 nullif(p.fx_rate, 0),
                 public.get_fx_rate(
                   upper(coalesce(nullif(btrim(coalesce(p.currency, '')), ''), v_base)),
                   p.occurred_at::date,
                   'operational'
                 ),
                 case
                   when upper(coalesce(nullif(btrim(coalesce(p.currency, '')), ''), v_base)) = upper(v_base)
                     then 1
                   else null
                 end
               )
        else null
      end
    )
  where coalesce(nullif(p.base_amount, 0), 0) = 0
    and coalesce(p.amount, 0) > 0;

  update public.payments
  set currency = upper(coalesce(nullif(btrim(coalesce(currency, '')), ''), v_base))
  where currency is not null;
end $$;

select pg_sleep(0.5);
notify pgrst, 'reload schema';
