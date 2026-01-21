DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'orders' AND column_name = 'delivery_zone_id') THEN
        ALTER TABLE public.orders ADD COLUMN delivery_zone_id uuid;
    END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_orders_delivery_zone_id ON public.orders(delivery_zone_id);
UPDATE public.orders
SET delivery_zone_id = (data->>'deliveryZoneId')::uuid
WHERE delivery_zone_id IS NULL
  AND (data ? 'deliveryZoneId')
  AND (data->>'deliveryZoneId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
