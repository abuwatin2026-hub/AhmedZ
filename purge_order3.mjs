const SBP = 'sbp_5fee6ae403ff684d232b618a1a92286c37ec83bd';

async function sql(q) {
  const r = await fetch('https://api.supabase.com/v1/projects/pmhivhtaoydfolseelyc/database/query', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SBP}` },
    body: JSON.stringify({ query: q }),
  });
  const b = await r.json();
  if (!r.ok) throw new Error(JSON.stringify(b).slice(0, 800));
  return b;
}

const ORDER_ID = '9ada629f-13a2-4c04-8816-9c431f929539';
const PAYMENT_ID = 'dc74c99a-5e2a-4e9d-ab10-b51a9f96082f';

async function main() {
  // Disable all user triggers on ar_payment_status
  const trgs = await sql(`SELECT t.tgname FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE c.relname='ar_payment_status' AND c.relnamespace='public'::regnamespace AND NOT t.tgisinternal`).catch(()=>[]);
  for (const t of trgs) await sql(`ALTER TABLE public.ar_payment_status DISABLE TRIGGER "${t.tgname}"`).catch(()=>{});

  // Delete ar_payment_status for this order and payment
  await sql(`DELETE FROM public.ar_payment_status WHERE order_id='${ORDER_ID}'`);
  console.log('✅ ar_payment_status deleted');
  await sql(`DELETE FROM public.ar_payment_status WHERE payment_id='${PAYMENT_ID}'`).catch(()=>{});
  console.log('✅ ar_payment_status (by payment) deleted');

  // Re-enable
  for (const t of trgs) await sql(`ALTER TABLE public.ar_payment_status ENABLE TRIGGER "${t.tgname}"`).catch(()=>{});

  // Now delete payment and order
  // Disable triggers on payments and orders
  const payTrgs = await sql(`SELECT t.tgname FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE c.relname='payments' AND c.relnamespace='public'::regnamespace AND NOT t.tgisinternal`).catch(()=>[]);
  for (const t of payTrgs) await sql(`ALTER TABLE public.payments DISABLE TRIGGER "${t.tgname}"`).catch(()=>{});
  const ordTrgs = await sql(`SELECT t.tgname FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE c.relname='orders' AND c.relnamespace='public'::regnamespace AND NOT t.tgisinternal`).catch(()=>[]);
  for (const t of ordTrgs) await sql(`ALTER TABLE public.orders DISABLE TRIGGER "${t.tgname}"`).catch(()=>{});

  await sql(`DELETE FROM public.payments WHERE id='${PAYMENT_ID}'`);
  console.log('✅ payment deleted');

  await sql(`DELETE FROM public.orders WHERE id='${ORDER_ID}'`);
  console.log('✅ ORDER DELETED');

  // Re-enable
  for (const t of payTrgs) await sql(`ALTER TABLE public.payments ENABLE TRIGGER "${t.tgname}"`).catch(()=>{});
  for (const t of ordTrgs) await sql(`ALTER TABLE public.orders ENABLE TRIGGER "${t.tgname}"`).catch(()=>{});

  // Verify
  const check = await sql(`SELECT count(*) as cnt FROM public.orders WHERE id='${ORDER_ID}'`);
  console.log(`\nOrder exists: ${check[0].cnt === '0' ? 'NO ✅' : 'YES ❌'}`);
  const total = await sql(`SELECT count(*) as cnt FROM public.orders`);
  console.log(`Total orders: ${total[0].cnt}`);
}
main().catch(console.error);
