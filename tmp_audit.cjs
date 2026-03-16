const { createClient } = require('@supabase/supabase-js');
const SUPABASE_URL = 'https://pmhivhtaoydfolseelyc.supabase.co';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBtaGl2aHRhb3lkZm9sc2VlbHljIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAyMjkyNzYsImV4cCI6MjA4NTgwNTI3Nn0.S4y-P0oA26xBCkzyYKWRreetcDd1Qo6Pbd80b7hltec';
const supabase = createClient(SUPABASE_URL, ANON_KEY);

(async () => {
  await supabase.auth.signInWithPassword({ email: 'owner@azta.com', password: 'AhmedZ#123456' });

  const { data: fd } = await supabase.rpc('debug_get_func_def');
  const src = fd || '';
  
  // Extract returns_sales CTE
  const idx = src.indexOf('returns_sales as');
  const end = src.indexOf('returns_cost as');
  if (idx >= 0 && end >= 0) {
    console.log('=== returns_sales CTE ===');
    console.log(src.substring(idx, end));
  }
  
  // Also check what sales_lines looks like for زيت صلالة
  // The sales_lines CTE uses order_item_net and order_totals
  // Let's check if the issue is in sales_lines or returns_sales
  const idxSl = src.indexOf('sales_lines as');
  const idxRb = src.indexOf('returns_base as');
  if (idxSl >= 0) {
    const endSl = idxRb >= 0 ? idxRb : idxSl + 1000;
    console.log('\n=== sales_lines CTE ===');
    console.log(src.substring(idxSl, endSl).substring(0, 800));
  }

  await supabase.auth.signOut();
})();
