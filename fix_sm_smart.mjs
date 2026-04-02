const SBP = 'sbp_5fee6ae403ff684d232b618a1a92286c37ec83bd';
async function sql(q) {
  const r = await fetch('https://api.supabase.com/v1/projects/pmhivhtaoydfolseelyc/database/query',{
    method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${SBP}`},
    body:JSON.stringify({query:q}),
  });
  const b=await r.json();
  if(!r.ok) throw new Error(JSON.stringify(b).slice(0,800));
  return b;
}

async function main(){
  console.log('=== إصلاح stock_management بالخوارزمية الصحيحة ===');
  
  // Step 1: Calculate net per item per warehouse from movements
  // Step 2: For each item where any warehouse is negative:
  //   a. Set negative warehouses to 0
  //   b. Calculate total deficit  
  //   c. Deduct deficit from the warehouse with highest positive balance
  // Step 3: Result: total per item = purchase - sales (correct)
  
  const fixSQL = `
DO $$
DECLARE
  item_rec record;
  wh_rec record;
  v_deficit numeric;
  v_biggest_positive_wh text;
  v_biggest_positive_net numeric;
  v_unit text;
BEGIN
  -- Process each item that has at least one negative warehouse balance
  FOR item_rec IN
    SELECT DISTINCT w.item_id
    FROM (
      SELECT 
        im.item_id::text as item_id,
        im.warehouse_id::text as warehouse_id,
        SUM(CASE 
          WHEN im.movement_type IN ('purchase_in','transfer_in','return_in','adjust_in') THEN im.quantity 
          ELSE -im.quantity 
        END) as net
      FROM public.inventory_movements im
      WHERE im.warehouse_id IS NOT NULL AND im.item_id IS NOT NULL
      GROUP BY im.item_id, im.warehouse_id
    ) w
    WHERE w.net < -0.01
  LOOP
    -- Calculate total deficit for this item (sum of all negative balances)
    SELECT COALESCE(SUM(ABS(w.net)), 0)
    INTO v_deficit
    FROM (
      SELECT 
        im.warehouse_id::text as warehouse_id,
        SUM(CASE 
          WHEN im.movement_type IN ('purchase_in','transfer_in','return_in','adjust_in') THEN im.quantity 
          ELSE -im.quantity 
        END) as net
      FROM public.inventory_movements im
      WHERE im.item_id::text = item_rec.item_id
        AND im.warehouse_id IS NOT NULL
      GROUP BY im.warehouse_id
    ) w
    WHERE w.net < -0.01;

    -- Find the warehouse with the highest positive balance (it absorbed the phantom units)
    SELECT w.warehouse_id, w.net
    INTO v_biggest_positive_wh, v_biggest_positive_net
    FROM (
      SELECT 
        im.warehouse_id::text as warehouse_id,
        SUM(CASE 
          WHEN im.movement_type IN ('purchase_in','transfer_in','return_in','adjust_in') THEN im.quantity 
          ELSE -im.quantity 
        END) as net
      FROM public.inventory_movements im
      WHERE im.item_id::text = item_rec.item_id
        AND im.warehouse_id IS NOT NULL
      GROUP BY im.warehouse_id
    ) w
    WHERE w.net > 0
    ORDER BY w.net DESC
    LIMIT 1;

    IF v_deficit <= 0 OR v_biggest_positive_wh IS NULL THEN
      CONTINUE;
    END IF;

    -- Set all negative warehouses to 0
    UPDATE public.stock_management sm
    SET 
      available_quantity = 0,
      last_updated = now(),
      updated_at = now()
    WHERE sm.item_id = item_rec.item_id
      AND sm.warehouse_id::text IN (
        SELECT w.warehouse_id
        FROM (
          SELECT 
            im.warehouse_id::text as warehouse_id,
            SUM(CASE 
              WHEN im.movement_type IN ('purchase_in','transfer_in','return_in','adjust_in') THEN im.quantity 
              ELSE -im.quantity 
            END) as net
          FROM public.inventory_movements im
          WHERE im.item_id::text = item_rec.item_id
            AND im.warehouse_id IS NOT NULL
          GROUP BY im.warehouse_id
        ) w
        WHERE w.net < -0.01
      );

    -- Deduct the deficit from the warehouse with the highest positive balance
    UPDATE public.stock_management sm
    SET 
      available_quantity = GREATEST(sm.available_quantity - v_deficit, 0),
      last_updated = now(),
      updated_at = now()
    WHERE sm.item_id = item_rec.item_id
      AND sm.warehouse_id::text = v_biggest_positive_wh;

  END LOOP;
END;
$$;
`;

  await sql(fixSQL);
  console.log('✅ تم تطبيق الإصلاح!');

  // Verify
  const checks = [
    { name: 'عصير ميرا', id: '499fb7ad-2155-499f-b5c7-c1df4a41d65c', expected: 500 },
    { name: 'بسكويت أبو برنس', id: '98f406f7-631a-480f-997b-5dc1e3fd09d9', expected: 20 },
  ];

  for (const c of checks) {
    const sm = await sql(`
      SELECT sm.warehouse_id, sm.available_quantity,
        (SELECT w.name::text FROM warehouses w WHERE w.id=sm.warehouse_id) as wh_name
      FROM stock_management sm WHERE sm.item_id='${c.id}'
    `);
    let total = 0;
    console.log(`\n=== ${c.name} (${c.expected} مشترى) ===`);
    sm.forEach(s => {
      const wName = s.wh_name?.match(/"ar":\s*"([^"]+)"/)?.[1] || s.warehouse_id?.slice(0,8);
      total += parseFloat(s.available_quantity);
      console.log(`  ${wName}: ${s.available_quantity}`);
    });
    console.log(`  المجموع: ${total} ${Math.abs(total - c.expected) < 1 ? '✅' : '❌ (فرق='+(total-c.expected)+')'}`);
  }
}
main().catch(console.error);
