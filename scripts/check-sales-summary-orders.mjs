import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = (process.env.AZTA_SUPABASE_URL || '').trim();
const SUPABASE_KEY = (process.env.AZTA_SUPABASE_ANON_KEY || '').trim();

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing AZTA_SUPABASE_URL / AZTA_SUPABASE_ANON_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const start = new Date(0);
const end = new Date();

const payloadSummary = {
  p_start_date: start.toISOString(),
  p_end_date: end.toISOString(),
  p_zone_id: null,
  p_invoice_only: false,
};

const payloadOrders = {
  p_start_date: start.toISOString(),
  p_end_date: end.toISOString(),
  p_zone_id: null,
  p_invoice_only: false,
  p_search: null,
  p_limit: 20000,
  p_offset: 0,
};

const run = async () => {
  const { data: summary, error: sErr } = await supabase.rpc('get_sales_report_summary', payloadSummary);
  if (sErr) {
    console.error('Summary RPC error:', sErr);
    process.exit(1);
  }
  const { data: orders, error: oErr } = await supabase.rpc('get_sales_report_orders', payloadOrders);
  if (oErr) {
    console.error('Orders RPC error:', oErr);
    process.exit(1);
  }
  const sCount = Number(summary?.total_orders || 0);
  const oCount = Array.isArray(orders) ? orders.length : 0;
  console.log('summary.total_orders =', sCount);
  console.log('orders.length       =', oCount);
  console.log('difference          =', sCount - oCount);
};

run().catch(err => {
  console.error(err);
  process.exit(1);
});
