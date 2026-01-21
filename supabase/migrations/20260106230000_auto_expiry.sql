CREATE OR REPLACE FUNCTION process_expired_items()
RETURNS json
LANGUAGE plpgsql
AS $$
DECLARE
    processed_count integer := 0;
    expired_item record;
    wastage_record_id uuid;
BEGIN
    -- Loop through items that are expired (expiry_date < TODAY) AND have stock > 0
    -- AND are not already archived (optional, but good practice)
    FOR expired_item IN 
        SELECT id, name, available_stock, cost_price, unit_type, expiry_date 
        FROM public.menu_items 
        WHERE expiry_date < CURRENT_DATE 
        AND available_stock > 0
    LOOP
        -- 1. Insert into stock_wastage
        INSERT INTO public.stock_wastage (
            item_id,
            quantity,
            unit_type,
            cost_at_time,
            reason,
            notes,
            created_at
        ) VALUES (
            expired_item.id,
            expired_item.available_stock, -- Wastage is the entire remaining stock
            expired_item.unit_type,
            COALESCE(expired_item.cost_price, 0),
            'auto_expired', -- Special reason code for automation
            'Auto-processed expiry detection',
            NOW()
        );

        -- 2. Update item stock to 0
        UPDATE public.menu_items
        SET available_stock = 0
        WHERE id = expired_item.id;

        processed_count := processed_count + 1;
    END LOOP;

    RETURN json_build_object(
        'success', true, 
        'processed_count', processed_count
    );
EXCEPTION WHEN OTHERS THEN
    RETURN json_build_object(
        'success', false, 
        'error', SQLERRM
    );
END;
$$;
