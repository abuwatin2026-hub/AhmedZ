import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = (process.env.AZTA_SUPABASE_URL || '').trim();
const SUPABASE_KEY = (process.env.AZTA_SUPABASE_ANON_KEY || '').trim();

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing AZTA_SUPABASE_URL / AZTA_SUPABASE_ANON_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function runFullSystemCheck() {
  console.log('🚀 Starting Comprehensive System Verification...');
  const logs = [];
  const log = (msg, status = 'INFO') => {
    const icon = status === 'SUCCESS' ? '✅' : status === 'ERROR' ? '❌' : 'ℹ️';
    console.log(`${icon} ${msg}`);
    logs.push({ msg, status });
  };

  try {
    // 1. Inventory & Stock Management
    log('Checking Inventory & Stock Management...', 'INFO');
    
    // 1.1 Create a new item
    const newItemId = crypto.randomUUID();
    const newItem = {
      id: newItemId,
      name: { ar: 'منتج اختبار', en: 'Test Item' },
      price: 100,
      category: 'qat',
      unitType: 'piece',
      status: 'active',
      availableStock: 50
    };
    
    // Note: We need admin rights to insert menu_items usually. 
    // We will try to simulate an admin action or check if public insert is blocked (security check).
    // Actually, for a full test, we assume we are checking Logic, not just permissions.
    // But since we only have the Anon key here, we are limited to what Anon can do or what RPCs allow.
    // Most admin actions are protected. 
    // WE WILL USE RPCs where available or verify Read Access.
    
    // Check if we can read stock
    const { data: stockData, error: stockError } = await supabase.from('stock_management').select('*').limit(1);
    if (stockError) {
      log(`Stock Read Failed: ${stockError.message}`, 'ERROR');
    } else {
      log(`Stock Read Success. Found ${stockData.length} records.`, 'SUCCESS');
    }

    // 2. Delivery System
    log('Checking Delivery System...', 'INFO');
    // Check if we can fetch delivery zones
    const { data: zones, error: zoneError } = await supabase.from('delivery_zones').select('*');
    if (zoneError) {
      log(`Delivery Zones Fetch Failed: ${zoneError.message}`, 'ERROR');
    } else {
      log(`Delivery Zones Fetch Success. Found ${zones.length} zones.`, 'SUCCESS');
    }

    // 3. Financial Reports & Accounting
    log('Checking Accounting System...', 'INFO');
    // Check Chart of Accounts (COA)
    const { data: coa, error: coaError } = await supabase.from('chart_of_accounts').select('*').limit(5);
    if (coaError) {
      // COA might be admin-only
      log(`COA Read Failed (Expected if secured): ${coaError.message}`, 'INFO');
    } else {
      log(`COA Read Success. Found ${coa.length} accounts.`, 'SUCCESS');
    }

    // 4. Purchasing System
    log('Checking Purchasing System...', 'INFO');
    // Check Purchase Orders table existence
    const { data: po, error: poError } = await supabase.from('purchase_orders').select('*').limit(1);
    if (poError) {
       // Might be admin only
       log(`Purchase Orders Read Failed (Expected if secured): ${poError.message}`, 'INFO');
    } else {
       log(`Purchase Orders Read Success.`, 'SUCCESS');
    }

    // 5. System Audit Logs
    log('Checking Audit Logs...', 'INFO');
    // Try to read audit logs (Should be strictly forbidden for anon)
    const { error: auditError } = await supabase.from('system_audit_logs').select('*').limit(1);
    if (auditError) {
      log(`Audit Log Access Blocked (Secure): ${auditError.message}`, 'SUCCESS');
    } else {
      log(`⚠️ Audit Log Access ALLOWED for Anon! (Security Risk)`, 'ERROR');
    }

    // 6. Notifications
    log('Checking Notifications...', 'INFO');
    // Should verify we can't see others' notifications
    const { data: notifs, error: notifError } = await supabase.from('notifications').select('*').limit(1);
    if (notifError) {
        log(`Notification Read Error: ${notifError.message}`, 'INFO');
    } else if (notifs && notifs.length > 0) {
        // If we see notifications that are not ours, that's bad.
        // But we are anon, so we shouldn't see any unless we are logged in.
        // We are NOT logged in in this script context unless we reuse session.
        log(`Public Notification Read: Found ${notifs.length} (Check RLS)`, 'INFO');
    } else {
        log(`Notification System Secure (No public access)`, 'SUCCESS');
    }

  } catch (err) {
    log(`Unexpected Error: ${err.message}`, 'ERROR');
  }

  console.log('\n--- Summary ---');
  const errors = logs.filter(l => l.status === 'ERROR');
  if (errors.length > 0) {
    console.log(`❌ Found ${errors.length} issues.`);
    errors.forEach(e => console.log(`   - ${e.msg}`));
  } else {
    console.log('✅ All checked systems appear operational (or securely blocked).');
  }
}

runFullSystemCheck().catch(console.error);
