const SBP = 'sbp_7034822f291b12df0a1c95b1130f3a6fe5818dfd';
const BASE = 'https://pmhivhtaoydfolseelyc.supabase.co';
const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBtaGl2aHRhb3lkZm9sc2VlbHljIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAyMjkyNzYsImV4cCI6MjA4NTgwNTI3Nn0.S4y-P0oA26xBCkzyYKWRreetcDd1Qo6Pbd80b7hltec';

async function sql(q) {
  const r = await fetch(`https://api.supabase.com/v1/projects/pmhivhtaoydfolseelyc/database/query`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SBP}` },
    body: JSON.stringify({ query: q }),
  });
  const b = await r.json();
  if (!r.ok) throw new Error(JSON.stringify(b).slice(0, 500));
  return b;
}

async function main() {
  // Read Supabase postgres logs for recent errors
  const logs = await fetch(`https://api.supabase.com/v1/projects/pmhivhtaoydfolseelyc/analytics/endpoints/logs.all?sql=SELECT+id,+timestamp,+event_message,+metadata&order_by=timestamp+DESC&limit=20&project_ref=pmhivhtaoydfolseelyc`, {
    headers: { Authorization: `Bearer ${SBP}` }
  });
  
  if (logs.ok) {
    const data = await logs.json();
    console.log('Recent logs:', JSON.stringify(data).slice(0, 2000));
  } else {
    console.log('Logs endpoint failed, status:', logs.status);
    
    // Try alternate approach: check pg_stat statements for errors
    const pgLogs = await sql(`
      SELECT 
        LEFT(query, 200) as q,
        calls,
        mean_exec_time::int as avg_ms,
        total_exec_time::int as total_ms
      FROM pg_stat_statements 
      WHERE query ILIKE '%process_sales_return%'
      ORDER BY calls DESC
      LIMIT 5
    `).catch(() => []);
    
    console.log('process_sales_return pg_stat:', JSON.stringify(pgLogs).slice(0,500));
  }
  
  // Alternate: Deploy a wrapper that executes process_sales_return steps
  // but wraps EACH major section in try/catch and returns the exact error location
  const draft = await sql(`SELECT id FROM public.sales_returns WHERE status='draft' LIMIT 1`);
  const retId = draft[0]?.id;
  console.log(`\nReturn to test: ${retId}`);
  
  // Create a simpler test: try running process_sales_return via the admin API
  const adminResult = await sql(`
    DO $$
    DECLARE
      v_result text;
    BEGIN
      -- Set auth.uid to a user that has permission
      SET LOCAL role TO authenticated;
      SET LOCAL "request.jwt.claims" TO '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated","aud":"authenticated"}';
      
      -- Try calling
      CALL public.process_sales_return('${retId}'::uuid);
      RAISE NOTICE 'SUCCESS';
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'ERROR: % SQLSTATE=%', SQLERRM, SQLSTATE;
    END;
    $$ LANGUAGE plpgsql;
  `).catch(e => `ERROR: ${e.message.slice(0,300)}`);
  console.log('Admin DO result:', JSON.stringify(adminResult));
  
  // Another approach: use pg_backend_pid and check pg logs
  const errTest = await sql(`
    SELECT 
      jsonb_typeof(im.data) as data_type,
      im.data,
      j.source_table,
      j.source_id
    FROM public.inventory_movements im
    CROSS JOIN public.journal_entries j
    WHERE im.movement_type = 'return_in'
    AND j.source_table = 'sales_returns'
    LIMIT 2
  `).catch(()=>[]);
  console.log('Sample data:', JSON.stringify(errTest).slice(0,300));
}
main().catch(console.error);
