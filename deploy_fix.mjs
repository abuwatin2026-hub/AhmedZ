const SBP = 'sbp_5fee6ae403ff684d232b618a1a92286c37ec83bd';
const fs = await import('fs');
const sql_text = fs.readFileSync('./supabase/migrations/20260322031000_fix_warehouse_transfer_stock_management.sql', 'utf8');

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
  console.log('Deploying migration...');
  await sql(sql_text);
  console.log('✅ Migration deployed!');

  // Verify after fix
  console.log('\n=== التحقق بعد الإصلاح: عصير ميرا ===');
  const miridId = '499fb7ad-2155-499f-b5c7-c1df4a41d65c';
  const sm1 = await sql(`
    SELECT sm.warehouse_id, sm.available_quantity,
      (SELECT w.name::text FROM warehouses w WHERE w.id=sm.warehouse_id) as wh_name
    FROM stock_management sm WHERE sm.item_id='${miridId}'
  `);
  let total1 = 0;
  sm1.forEach(s=>{
    const wName = s.wh_name?.match(/"ar":\s*"([^"]+)"/)?.[1] || s.warehouse_id?.slice(0,8);
    total1 += parseFloat(s.available_quantity);
    console.log(`  ${wName}: ${s.available_quantity}`);
  });
  console.log(`  المجموع: ${total1} (المتوقع: 500)`);
  console.log(`  ${Math.abs(total1-500)<1?'✅ صحيح!':'❌ لا يزال خاطئ'}`);

  console.log('\n=== التحقق بعد الإصلاح: بسكويت أبو برنس ===');
  const princeId = '98f406f7-631a-480f-997b-5dc1e3fd09d9';
  const sm2 = await sql(`
    SELECT sm.warehouse_id, sm.available_quantity,
      (SELECT w.name::text FROM warehouses w WHERE w.id=sm.warehouse_id) as wh_name
    FROM stock_management sm WHERE sm.item_id='${princeId}'
  `);
  let total2 = 0;
  sm2.forEach(s=>{
    const wName = s.wh_name?.match(/"ar":\s*"([^"]+)"/)?.[1] || s.warehouse_id?.slice(0,8);
    total2 += parseFloat(s.available_quantity);
    console.log(`  ${wName}: ${s.available_quantity}`);
  });
  console.log(`  المجموع: ${total2} (المتوقع: 20)`);
  console.log(`  ${Math.abs(total2-20)<1?'✅ صحيح!':'❌ لا يزال خاطئ'}`);
}
main().catch(console.error);
