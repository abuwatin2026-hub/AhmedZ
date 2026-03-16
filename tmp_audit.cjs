const { createClient } = require('@supabase/supabase-js');
const SUPABASE_URL = 'https://pmhivhtaoydfolseelyc.supabase.co';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBtaGl2aHRhb3lkZm9sc2VlbHljIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAyMjkyNzYsImV4cCI6MjA4NTgwNTI3Nn0.S4y-P0oA26xBCkzyYKWRreetcDd1Qo6Pbd80b7hltec';
const supabase = createClient(SUPABASE_URL, ANON_KEY);

(async () => {
  await supabase.auth.signInWithPassword({ email: 'owner@azta.com', password: 'AhmedZ#123456' });

  const { data: d10 } = await supabase.rpc('get_product_sales_report_v10', {
    p_start_date: '2000-01-01T00:00:00Z', p_end_date: '2100-01-01T23:59:59Z' });

  console.log('=== بعد إصلاح Scale Cap ===\n');
  const sorted = (d10 || []).sort((a, b) => Number(b.total_sales) - Number(a.total_sales));
  
  for (const row of sorted) {
    const name = (row.item_name?.ar || '').substring(0, 40).padEnd(42);
    const qty = Number(row.quantity_sold);
    const sales = Number(row.total_sales);
    const cost = Number(row.total_cost);
    const profit = Number(row.total_profit);
    const margin = sales > 0 ? ((profit/sales)*100).toFixed(0) : '-';
    const perUnit = qty > 0 ? (sales/qty).toFixed(2) : '-';
    
    let flag = '✅';
    if (sales === 0 && qty > 0) flag = '🔴';
    else if (profit < 0) flag = '⚠️';

    console.log(`${flag} ${name} | كمية:${String(qty).padStart(5)} | مبيعات:${String(sales.toFixed(0)).padStart(8)} | م/و:${String(perUnit).padStart(6)} | هامش:${String(margin).padStart(6)}%`);
  }

  await supabase.auth.signOut();
})();
