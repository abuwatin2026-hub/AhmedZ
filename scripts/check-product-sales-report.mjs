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

const payload = {
  p_start_date: start.toISOString(),
  p_end_date: end.toISOString(),
};

const run = async () => {
  const zoneId = null;
  const { data: summary, error: sErr } = await supabase.rpc('get_sales_report_summary', {
    ...payload,
    p_zone_id: zoneId,
    p_invoice_only: false,
  });
  if (sErr) {
    console.error('Summary RPC error:', sErr);
    process.exit(1);
  }
  console.log('note: product report is computed from raw rows in the client UI');
  const totalCollected = Number(summary?.total_collected || 0);
  const grossSubtotal = Number(summary?.gross_subtotal || 0);
  const discounts = Number(summary?.discounts || 0);
  const tax = Number(summary?.tax || 0);
  const deliveryFees = Number(summary?.delivery_fees || 0);
  const returns = Number(summary?.returns || 0);
  const cogs = Number(summary?.cogs || 0);

  const derivedTotal = grossSubtotal - discounts + tax + deliveryFees;
  const derivedGrossMinusReturns = grossSubtotal - returns;
  const derivedNetSubtotal = grossSubtotal - discounts - returns;

  const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

  console.log('sales.total_collected    =', totalCollected);
  console.log('sales.gross_subtotal     =', grossSubtotal);
  console.log('sales.discounts          =', discounts);
  console.log('sales.tax                =', tax);
  console.log('sales.delivery_fees      =', deliveryFees);
  console.log('sales.returns            =', returns);
  console.log('sales.cogs               =', cogs);

  console.log('derived.total            =', round2(derivedTotal), 'diff=', round2(totalCollected - derivedTotal));
  console.log('derived.gross_minus_returns =', round2(derivedGrossMinusReturns));
  console.log('derived.net_subtotal        =', round2(derivedNetSubtotal));

  const { data: rows, error: rErr } = await supabase.rpc('get_product_sales_report_v9', {
    ...payload,
    p_zone_id: zoneId,
    p_invoice_only: false,
  });
  if (rErr) {
    console.error('Product v9 RPC error:', rErr);
    process.exit(1);
  }
  const netSalesSum = (Array.isArray(rows) ? rows : []).reduce((s, r) => s + (Number(r?.total_sales) || 0), 0);
  const netCostSum = (Array.isArray(rows) ? rows : []).reduce((s, r) => s + (Number(r?.total_cost) || 0), 0);
  console.log('product.net_sales_sum    =', round2(netSalesSum), 'expected =', round2(derivedNetSubtotal), 'diff=', round2(netSalesSum - derivedNetSubtotal));
  console.log('product.net_cost_sum     =', round2(netCostSum), 'expected =', round2(cogs), 'diff=', round2(netCostSum - cogs));
};

run().catch(err => {
  console.error(err);
  process.exit(1);
});
