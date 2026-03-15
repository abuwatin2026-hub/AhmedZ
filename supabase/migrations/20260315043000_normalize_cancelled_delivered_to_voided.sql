do $$
begin
  update public.orders o
  set
    status = 'delivered',
    data = jsonb_set(
      jsonb_set(
        coalesce(o.data, '{}'::jsonb),
        '{voidedAt}',
        to_jsonb(coalesce(o.cancelled_at, o.updated_at, now())::text),
        true
      ),
      '{voidReason}',
      to_jsonb(coalesce(nullif(trim(coalesce(o.data->>'cancellationReason','')), ''), 'normalized_from_cancelled_after_delivery')::text),
      true
    ),
    updated_at = now()
  where o.status = 'cancelled'
    and nullif(trim(coalesce(o.data->>'deliveredAt','')), '') is not null
    and nullif(trim(coalesce(o.data->>'voidedAt','')), '') is null;
end;
$$;

notify pgrst, 'reload schema';
