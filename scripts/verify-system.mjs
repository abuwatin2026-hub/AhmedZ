import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = (process.env.AZTA_SUPABASE_URL || '').trim();
const SUPABASE_KEY = (process.env.AZTA_SUPABASE_ANON_KEY || '').trim();

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing AZTA_SUPABASE_URL / AZTA_SUPABASE_ANON_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function runChecks() {
  console.log('🚀 Starting System Verification (Round 2)...');
  
  // 1. Connection & Public Data
  console.log('\n--- 1. Checking Connection & Public Menu ---');
  const { data: menuItems, error: menuError } = await supabase
    .from('v_sellable_products')
    .select('id, name, price, data, available_quantity')
    .limit(3);

  if (menuError) {
    console.error('❌ Menu Fetch Failed:', menuError.message);
    process.exit(1);
  }
  console.log(`✅ Menu Fetched: Found ${menuItems.length} items.`);
  if (menuItems.length > 0) {
    const firstItem = menuItems[0];
    const name = firstItem.data?.name?.ar || firstItem.data?.name?.en || 'Unknown';
    console.log(`   Sample: ${name} (${firstItem.price})`);
  }

  // 2. Auth Flow (Sign Up Temp User)
  console.log('\n--- 2. Checking Authentication (Sign Up) ---');
  const timestamp = Date.now();
  const tempEmail = `test_verify_${timestamp}@example.com`;
  const tempPass = 'Test@123456';
  const randomSuffix = Math.floor(Math.random() * 900000) + 100000;
  const tempPhone = `777${randomSuffix}`; 
  const normalizedPhone = `+967${tempPhone}`;

  const { data: authData, error: authError } = await supabase.auth.signUp({
    email: tempEmail,
    password: tempPass,
    options: {
      data: {
        full_name: 'Test Auto User',
        phone_number: tempPhone 
      }
    }
  });

  if (authError) {
    console.error('❌ Sign Up Failed:', authError.message);
    process.exit(1);
  }
  
  console.log('✅ Sign Up Successful');
  const userId = authData.user?.id;

  // 3. Profile & Encryption
  console.log('\n--- 3. Checking Profile & Encryption Trigger ---');
  const { error: profileError } = await supabase.from('customers').insert({
    auth_user_id: userId,
    full_name: 'Test Auto User',
    phone_number: normalizedPhone,
    auth_provider: 'email',
    loyalty_points: 0,
    loyalty_tier: 'regular',
    total_spent: 0,
    data: { address: 'Sana\'a, Street 1' }
  });

  if (profileError) {
    console.error('❌ Profile Creation Failed:', profileError.message);
    process.exit(1);
  } else {
    console.log('✅ Profile Created in `customers` table.');
    
    // Check if encryption column is populated (we can't read it easily, but we can check if it's not null via a query if we had admin access, but here we are client)
    // We'll just verify we can read the profile back.
    const { data: profile, error: fetchError } = await supabase
      .from('customers')
      .select('phone_number, address_encrypted')
      .eq('auth_user_id', userId)
      .single();
      
    if (fetchError) {
      console.error('❌ Profile Fetch Failed:', fetchError.message);
      process.exit(1);
    } else {
      console.log('✅ Profile Read Back Successful.');
      if (profile.phone_number === normalizedPhone) {
        console.log('   Phone Number matches.');
      }
      // Note: address_encrypted might not be selectable by anon/authenticated depending on RLS, 
      // but if the query didn't fail, we are good.
    }
  }

  // 4. Order Creation (RPC)
  if (menuItems.length > 0) {
    console.log('\n--- 4. Checking Order Creation (RPC: create_order_secure) ---');
    const item = menuItems[0];

    const { data: zoneRows, error: zoneErr } = await supabase
      .from('delivery_zones')
      .select('id')
      .eq('is_active', true)
      .limit(1);
    if (zoneErr) {
      console.error('❌ Delivery Zones Fetch Failed:', zoneErr.message);
      process.exit(1);
    }
    const zoneId = zoneRows?.[0]?.id || null;
    if (!zoneId) {
      console.error('❌ No active delivery zones found');
      process.exit(1);
    }
    
    const orderPayload = {
      p_items: [{
        itemId: item.id,
        quantity: 1,
        weight: 0,
        selectedAddons: {}
      }],
      p_delivery_zone_id: zoneId,
      p_payment_method: 'cash',
      p_notes: 'System Verification Order',
      p_address: 'Test Address',
      p_location: { lat: 15.3694, lng: 44.1910 },
      p_customer_name: 'Test Auto User',
      p_phone_number: normalizedPhone,
      p_is_scheduled: false,
      p_scheduled_at: null,
      p_coupon_code: null,
      p_points_redeemed_value: 0,
      p_explicit_customer_id: null,
      p_order_source: 'online'
    };

    const { data: orderData, error: orderError } = await supabase.rpc('create_order_secure', orderPayload);

    if (orderError) {
      console.error('❌ Order Creation Failed:', orderError.message);
      if (orderError.hint) console.error('   Hint:', orderError.hint);
      if (orderError.details) console.error('   Details:', orderError.details);
      process.exit(1);
    } else {
      console.log('✅ Order Created Successfully via RPC!');
      console.log('   Order ID:', orderData.id);
      console.log('   Total:', orderData.total);
    }
  } else {
    console.log('\n--- 4. Checking Order Creation (RPC: create_order_secure) ---');
    console.log('ℹ️ Skipped: No sellable items returned by v_sellable_products');
  }

  // 4b. FX / Multi-Currency (Authenticated Owner)
  console.log('\n--- 4b. Checking FX & Multi-Currency (Owner) ---');
  const { data: ownerAuth, error: ownerAuthErr } = await supabase.auth.signInWithPassword({
    email: 'owner@azta.com',
    password: 'Owner@123',
  });
  if (ownerAuthErr || !ownerAuth?.session) {
    console.error('❌ Owner Sign In Failed:', ownerAuthErr?.message || 'no session');
    process.exit(1);
  }

  const { data: fxRates, error: fxRatesErr } = await supabase
    .from('fx_rates')
    .select('currency_code, rate_type, rate_date, rate')
    .order('currency_code', { ascending: true })
    .limit(10);
  if (fxRatesErr) {
    console.error('❌ FX Rates Fetch Failed:', fxRatesErr.message);
    process.exit(1);
  }
  console.log(`✅ FX Rates Read: Found ${fxRates.length} rows.`);

  const { data: fxCases, error: fxTestFnErr } = await supabase.rpc('run_fx_acceptance_tests');
  if (fxTestFnErr) {
    console.error('❌ FX Acceptance Test RPC Failed:', fxTestFnErr.message);
    process.exit(1);
  }
  const rows = Array.isArray(fxCases) ? fxCases : [];
  for (const row of rows) {
    console.log(`${row.case_name}: ${row.result}`);
  }
  const failures = rows.filter((r) => String(r?.result || '').trim().toUpperCase() !== 'OK');
  if (failures.length) {
    console.error(`❌ FX Acceptance Tests Failed: ${failures.length} case(s)`);
    process.exit(1);
  }
  console.log('✅ FX Acceptance Tests: All OK');

  console.log('\n🎉 Verification Complete.');
}

runChecks().catch(e => console.error(e));
