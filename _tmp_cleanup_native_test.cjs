const { Client } = require('pg');
const connectionString = 'postgresql://postgres.pmhivhtaoydfolseelyc:AhmadZangah1%23123455@aws-1-ap-south-1.pooler.supabase.com:5432/postgres';
const client = new Client({ connectionString });

async function run() {
  await client.connect();
  console.log('Connected to Prod DB for Cleanup...');
  
  const testIds = ['a1fbd91a-0000-4000-a000-000000000010'];
  
  const res = await client.query(`SELECT id FROM orders WHERE invoice_number LIKE '%TEST-MULTI%'`);
  for (const r of res.rows) {
    if (!testIds.includes(r.id)) testIds.push(r.id);
  }
  
  for (const id of testIds) {
    console.log('Cleaning Order:', id);
    try {
      await client.query('BEGIN;');
      await client.query("SET session_replication_role = 'replica';"); // Bypass all triggers!

      await client.query(`DELETE FROM order_item_reservations WHERE order_id = '${id}';`);
      await client.query(`DELETE FROM order_item_cogs WHERE order_id = '${id}';`);
      await client.query(`DELETE FROM order_line_items WHERE order_id = '${id}';`);
      await client.query(`DELETE FROM inventory_movements WHERE reference_table='orders' AND reference_id = '${id}';`);
      await client.query(`DELETE FROM payments WHERE reference_table='orders' AND reference_id = '${id}';`);
      
      await client.query(`
        DELETE FROM journal_lines WHERE journal_entry_id IN (
          SELECT id FROM journal_entries WHERE source_table='orders' AND source_id = '${id}'
        );
      `);
      await client.query(`DELETE FROM journal_entries WHERE source_table='orders' AND source_id = '${id}';`);
      
      await client.query(`DELETE FROM orders WHERE id = '${id}';`);

      await client.query("SET session_replication_role = 'origin';");
      await client.query('COMMIT;');
      console.log('✅ Cleaned up', id);
    } catch (e) {
      await client.query('ROLLBACK;');
      await client.query("SET session_replication_role = 'origin';").catch(()=>null);
      console.log('❌ Failed to clean', id, e.message);
    }
  }

  // Find any test party
  const partyRes = await client.query(`SELECT id FROM financial_parties WHERE name LIKE 'عميل دخان%'`);
  for (const r of partyRes.rows) {
     try {
       await client.query('BEGIN;');
       await client.query("SET session_replication_role = 'replica';");
       
       await client.query(`DELETE FROM party_ledger_entries WHERE party_id='${r.id}'`);
       await client.query(`DELETE FROM party_open_items WHERE party_id='${r.id}'`);
       await client.query(`DELETE FROM party_documents WHERE party_id='${r.id}'`);
       await client.query(`DELETE FROM financial_parties WHERE id='${r.id}'`);
       
       await client.query("SET session_replication_role = 'origin';");
       await client.query('COMMIT;');
       console.log('✅ Cleaned Party', r.id);
     } catch(e) {
       await client.query('ROLLBACK;');
       await client.query("SET session_replication_role = 'origin';").catch(()=>null);
     }
  }
  
  await client.end();
}

run();
