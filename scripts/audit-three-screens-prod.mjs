import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

const loadEnv = (filePath) => {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const i = t.indexOf('=');
      if (i <= 0) continue;
      const k = t.slice(0, i).trim();
      let v = t.slice(i + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if (!process.env[k]) process.env[k] = v;
    }
  } catch {}
};

loadEnv(path.join(process.cwd(), '.env.local'));
loadEnv(path.join(process.cwd(), '.env.development.local'));
loadEnv(path.join(process.cwd(), '.env.production'));

const url = String(process.env.AZTA_SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim();
const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.AZTA_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '').trim();
if (!url || !key) throw new Error('Missing Supabase URL/key');

const supabase = createClient(url, key);
const now = new Date();
const start = new Date(Date.now() - 30 * 24 * 3600 * 1000);
const round2 = (n) => Math.round((Number(n || 0)) * 100) / 100;

const callRpc = async (name, args) => {
  const { data, error } = await supabase.rpc(name, args);
  if (error) return { ok: false, error: { code: error.code, message: error.message, details: error.details } };
  return { ok: true, data };
};

const getDashboardKpi = async () => {
  const argsPrimary = { p_start_date: start.toISOString(), p_end_date: now.toISOString(), p_zone_id: null, p_invoice_only: false, p_warehouse_id: null };
  const argsFallback = { p_start_date: start.toISOString(), p_end_date: now.toISOString(), p_zone_id: null, p_invoice_only: false };
  const errors = [];
  for (const name of ['get_dashboard_kpi_v4', 'get_dashboard_kpi_v3', 'get_dashboard_kpi_v2']) {
    let r = await callRpc(name, argsPrimary);
    if (!r.ok) r = await callRpc(name, argsFallback);
    if (r.ok) return { ok: true, source: name, data: r.data, errors };
    errors.push({ name, error: r.error });
  }
  return { ok: false, source: null, data: null, errors };
};

const main = async () => {
  const adminEmail = String(process.env.ADMIN_EMAIL || '').trim();
  const adminPassword = String(process.env.ADMIN_PASSWORD || '').trim();
  let authStatus = { attempted: false, ok: false, error: null };
  if (adminEmail && adminPassword) {
    authStatus.attempted = true;
    const { error } = await supabase.auth.signInWithPassword({ email: adminEmail, password: adminPassword });
    if (error) {
      authStatus.error = { code: error.code, message: error.message };
    } else {
      authStatus.ok = true;
    }
  }

  const dashboard = await getDashboardKpi();
  const salesSummary = await callRpc('get_sales_report_summary', {
    p_start_date: start.toISOString(),
    p_end_date: now.toISOString(),
    p_zone_id: null,
    p_invoice_only: false,
  });

  const productV10 = await callRpc('get_product_sales_report_v10', {
    p_start_date: start.toISOString(),
    p_end_date: now.toISOString(),
    p_zone_id: null,
    p_invoice_only: false,
  });
  const product = productV10.ok
    ? { ok: true, source: 'get_product_sales_report_v10', data: productV10.data, error: null }
    : await callRpc('get_product_sales_report_v9', {
      p_start_date: start.toISOString(),
      p_end_date: now.toISOString(),
      p_zone_id: null,
      p_invoice_only: false,
    }).then((r) => ({ source: 'get_product_sales_report_v9', ...r }));

  let salesByCurrency = await callRpc('get_sales_by_currency', {
    p_start_date: start.toISOString(),
    p_end_date: now.toISOString(),
    p_zone_id: null,
    p_invoice_only: false,
    p_warehouse_id: null,
  });
  if (!salesByCurrency.ok) {
    salesByCurrency = await callRpc('get_sales_by_currency', {
      p_start_date: start.toISOString(),
      p_end_date: now.toISOString(),
      p_zone_id: null,
      p_invoice_only: false,
    });
  }

  const consistency = await callRpc('get_sales_consistency_daily', {
    p_start_date: start.toISOString(),
    p_end_date: now.toISOString(),
    p_zone_id: null,
    p_invoice_only: false,
    p_warehouse_id: null,
  });

  const s = salesSummary.ok ? salesSummary.data : {};
  const salesNetSubtotal = round2(Number(s?.gross_subtotal || 0) - Number(s?.discounts || 0) - Number(s?.returns || 0));
  const dashboardSales = dashboard?.data?.sales || {};
  const dashboardNetSales = round2(Number(dashboardSales?.total_sales_accrual || dashboardSales?.total_sales || 0) - Number(dashboardSales?.returns_total ?? dashboardSales?.returns ?? 0));
  const dashboardCogs = round2(Number(dashboardSales?.cogs || 0));
  const rows = Array.isArray(product?.data) ? product.data : [];
  const productNetSales = round2(rows.reduce((a, r) => a + Number(r?.total_sales || 0), 0));
  const productCogs = round2(rows.reduce((a, r) => a + Number(r?.total_cost || 0), 0));

  const currencyRows = Array.isArray(salesByCurrency?.data) ? salesByCurrency.data : [];
  const nonBaseCurrencies = currencyRows.filter((r) => String(r?.currency || '').toUpperCase() !== 'SAR');
  const consistencyRows = Array.isArray(consistency?.data) ? consistency.data : [];
  const consistencyMismatches = consistencyRows.filter((r) => Math.abs(Number(r?.diff || 0)) > 0.01).length;
  const fxDiag = { checked_orders: 0, non_base_orders: 0, mismatched_base_total: 0, sample: [] };
  const ordersRes = await supabase
    .from('orders')
    .select('id,status,currency,fx_rate,base_total,data,created_at')
    .eq('status', 'delivered')
    .gte('created_at', start.toISOString())
    .lte('created_at', now.toISOString())
    .order('created_at', { ascending: false })
    .limit(300);
  if (!ordersRes.error) {
    const rowsOrd = Array.isArray(ordersRes.data) ? ordersRes.data : [];
    fxDiag.checked_orders = rowsOrd.length;
    for (const r of rowsOrd) {
      const c = String(r?.currency || '').toUpperCase();
      if (!c || c === 'SAR') continue;
      fxDiag.non_base_orders += 1;
      const total = Number(r?.data?.total ?? 0) || 0;
      const fx = Number(r?.fx_rate ?? 1) || 1;
      const base = Number(r?.base_total ?? 0) || 0;
      const computed = total * fx;
      if (Math.abs(base - computed) > 0.01) {
        fxDiag.mismatched_base_total += 1;
        if (fxDiag.sample.length < 10) {
          fxDiag.sample.push({ id: String(r?.id || ''), currency: c, total, fx_rate: fx, base_total: base, computed_base: computed });
        }
      }
    }
  }

  const report = {
    timestamp: new Date().toISOString(),
    period: { start: start.toISOString(), end: now.toISOString() },
    auth: authStatus,
    rpc_status: {
      dashboard_source: dashboard.source,
      dashboard_ok: dashboard.ok,
      sales_summary_ok: salesSummary.ok,
      product_source: product.source,
      product_ok: product.ok,
      sales_by_currency_ok: salesByCurrency.ok,
      sales_consistency_ok: consistency.ok,
    },
    values: {
      dashboard_net_sales: dashboardNetSales,
      dashboard_cogs: dashboardCogs,
      sales_net_subtotal: salesNetSubtotal,
      sales_cogs: round2(Number(s?.cogs || 0)),
      product_net_sales: productNetSales,
      product_cogs: productCogs,
    },
    diffs: {
      dashboard_vs_sales_net: round2(dashboardNetSales - salesNetSubtotal),
      dashboard_vs_product_net: round2(dashboardNetSales - productNetSales),
      sales_vs_product_net: round2(salesNetSubtotal - productNetSales),
      dashboard_vs_sales_cogs: round2(dashboardCogs - Number(s?.cogs || 0)),
      dashboard_vs_product_cogs: round2(dashboardCogs - productCogs),
      sales_vs_product_cogs: round2(Number(s?.cogs || 0) - productCogs),
    },
    multicurrency: {
      sales_by_currency_rows: currencyRows.length,
      non_base_currency_rows: nonBaseCurrencies.length,
      sales_consistency_rows: consistencyRows.length,
      sales_consistency_mismatches: consistencyMismatches,
      sales_by_currency_sample: currencyRows.slice(0, 10),
      fx_orders_diag: fxDiag,
    },
    verdict: {
      sales_vs_product_net_equal: Math.abs(salesNetSubtotal - productNetSales) <= 0.01,
      sales_vs_product_cogs_equal: Math.abs(Number(s?.cogs || 0) - productCogs) <= 0.01,
      dashboard_vs_sales_net_equal: Math.abs(dashboardNetSales - salesNetSubtotal) <= 0.01,
      dashboard_vs_sales_cogs_equal: Math.abs(dashboardCogs - Number(s?.cogs || 0)) <= 0.01,
      multicurrency_fx_orders_clean: fxDiag.mismatched_base_total === 0,
    },
    errors: {
      dashboard: dashboard.ok ? null : dashboard.errors,
      sales_summary: salesSummary.ok ? null : salesSummary.error,
      product: product?.ok ? null : product?.error,
      sales_by_currency: salesByCurrency.ok ? null : salesByCurrency.error,
      sales_consistency: consistency.ok ? null : consistency.error,
    },
  };

  const outPath = path.join(process.cwd(), 'backups', 'three_screens_prod_audit.json');
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');
  console.log(outPath);
  console.log(JSON.stringify(report, null, 2));
};

main().catch((e) => {
  console.error(String(e?.message || e));
  process.exit(1);
});
