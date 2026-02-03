import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';
import path from 'node:path';

const tryLoadEnvFile = (filePath) => {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq <= 0) continue;
      const k = trimmed.slice(0, eq).trim();
      let v = trimmed.slice(eq + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      if (k && process.env[k] == null) process.env[k] = v;
    }
  } catch {
  }
};

if (!process.env.AZTA_SUPABASE_URL && !process.env.VITE_SUPABASE_URL) {
  tryLoadEnvFile(path.join(process.cwd(), '.env.local'));
  tryLoadEnvFile(path.join(process.cwd(), '.env.development.local'));
  tryLoadEnvFile(path.join(process.cwd(), '.env.production'));
}

const SUPABASE_URL = (process.env.AZTA_SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim();
const SUPABASE_KEY = (process.env.AZTA_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '').trim();
const OWNER_EMAIL = (process.env.AZTA_SMOKE_OWNER_EMAIL || 'owner@azta.com').trim();
const OWNER_PASSWORD = (process.env.AZTA_SMOKE_OWNER_PASSWORD || 'Owner@123').trim();

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing AZTA_SUPABASE_URL/AZTA_SUPABASE_ANON_KEY or VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const toIsoDateOnly = (d) => {
  const dt = d instanceof Date ? d : new Date(d);
  return new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate())).toISOString().slice(0, 10);
};

const normalizeUomCode = (raw) => {
  const s = String(raw || '').trim().toLowerCase();
  if (!s) return 'piece';
  if (['pcs', 'pc', 'piece', 'unit', 'each'].includes(s)) return 'piece';
  if (['kg', 'kilogram', 'كيلو', 'كجم'].includes(s)) return 'kg';
  if (['g', 'gram', 'جرام'].includes(s)) return 'g';
  if (['l', 'liter', 'litre', 'لتر'].includes(s)) return 'l';
  return s.replace(/\s+/g, '_').slice(0, 32);
};

const ensureUomId = async (code) => {
  const normalized = normalizeUomCode(code);
  const { data: existing, error: existingErr } = await supabase
    .from('uom')
    .select('id')
    .eq('code', normalized)
    .maybeSingle();
  if (!existingErr && existing?.id) return String(existing.id);

  const { data: inserted, error: insertErr } = await supabase
    .from('uom')
    .insert([{ code: normalized, name: normalized }])
    .select('id')
    .single();
  if (!insertErr && inserted?.id) return String(inserted.id);

  const { data: after, error: afterErr } = await supabase
    .from('uom')
    .select('id')
    .eq('code', normalized)
    .maybeSingle();
  if (afterErr) throw afterErr;
  if (!after?.id) throw insertErr || new Error('تعذر إنشاء وحدة القياس.');
  return String(after.id);
};

const ensureItemUomRow = async (itemId) => {
  const id = String(itemId || '').trim();
  if (!id) throw new Error('معرف الصنف غير صالح.');

  const { data: existingIU, error: existingIUErr } = await supabase
    .from('item_uom')
    .select('id')
    .eq('item_id', id)
    .maybeSingle();
  if (existingIUErr) throw existingIUErr;
  if (existingIU?.id) return;

  const { data: itemRow, error: itemErr } = await supabase
    .from('menu_items')
    .select('id, base_unit, unit_type, data')
    .eq('id', id)
    .maybeSingle();
  if (itemErr) throw itemErr;
  if (!itemRow?.id) throw new Error('الصنف غير موجود.');

  const dataObj = itemRow.data || {};
  const unit = normalizeUomCode(itemRow.base_unit ?? itemRow.unit_type ?? dataObj.baseUnit ?? dataObj.unitType ?? dataObj.base_unit);
  const uomId = await ensureUomId(unit);

  const { error: insertIUErr } = await supabase
    .from('item_uom')
    .insert([{ item_id: id, base_uom_id: uomId, purchase_uom_id: null, sales_uom_id: null }]);
  if (insertIUErr && !/duplicate key|unique/i.test(String(insertIUErr.message || ''))) throw insertIUErr;
};

const resolveAdminScope = async () => {
  try {
    const { data: scopeRows, error: scopeErr } = await supabase.rpc('get_admin_session_scope');
    if (!scopeErr && Array.isArray(scopeRows) && scopeRows.length > 0) {
      const row = scopeRows[0] || {};
      const warehouseId = row.warehouse_id ?? row.warehouseId ?? null;
      const branchId = row.branch_id ?? row.branchId ?? null;
      const companyId = row.company_id ?? row.companyId ?? null;
      return {
        warehouseId: warehouseId ? String(warehouseId) : null,
        branchId: branchId ? String(branchId) : null,
        companyId: companyId ? String(companyId) : null,
      };
    }
  } catch {
  }
  return { warehouseId: null, branchId: null, companyId: null };
};

async function runFullSystemCheck() {
  console.log('🚀 Starting Comprehensive System Verification...');
  const logs = [];
  const log = (msg, status = 'INFO') => {
    const icon = status === 'SUCCESS' ? '✅' : status === 'ERROR' ? '❌' : 'ℹ️';
    console.log(`${icon} ${msg}`);
    logs.push({ msg, status });
  };

  let currentStep = 'start';
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

    log('Running Smoke: Purchase Order → Receive → Approve → Stock → Accounting → Sell...', 'INFO');
    currentStep = 'smoke:sign_in';
    const { data: signInData, error: signInErr } = await supabase.auth.signInWithPassword({
      email: OWNER_EMAIL,
      password: OWNER_PASSWORD,
    });
    if (signInErr || !signInData?.session?.user) {
      throw new Error(`تعذر تسجيل الدخول بحساب المالك: ${signInErr?.message || 'unknown error'}`);
    }

    currentStep = 'smoke:is_owner';
    const { data: isOwner, error: isOwnerErr } = await supabase.rpc('is_owner');
    if (isOwnerErr) throw isOwnerErr;
    if (!isOwner) throw new Error('حساب الدخول ليس مالكاً (owner).');

    currentStep = 'smoke:resolve_scope';
    let scope = await resolveAdminScope();
    let warehouseId = scope.warehouseId;
    if (!warehouseId) {
      const { data: wh, error: whErr } = await supabase.rpc('_resolve_default_admin_warehouse_id');
      if (whErr) throw whErr;
      warehouseId = wh ? String(wh) : null;
    }
    if (!warehouseId) {
      currentStep = 'smoke:ensure_warehouse';
      const { data: existingMain, error: existingMainErr } = await supabase
        .from('warehouses')
        .select('id')
        .eq('code', 'MAIN')
        .maybeSingle();
      if (existingMainErr) throw existingMainErr;
      if (existingMain?.id) {
        warehouseId = String(existingMain.id);
      } else {
        const { data: createdWh, error: createdWhErr } = await supabase
          .from('warehouses')
          .insert([{ code: 'MAIN', name: 'Main Warehouse', type: 'main', is_active: true }])
          .select('id')
          .single();
        if (createdWhErr) throw createdWhErr;
        warehouseId = createdWh?.id ? String(createdWh.id) : null;
      }
      scope = await resolveAdminScope();
    }
    if (!warehouseId) throw new Error('لا يوجد مستودع نشط للاختبار.');

    currentStep = 'smoke:ensure_supplier';
    const { data: supplierRow, error: supplierErr } = await supabase
      .from('suppliers')
      .select('id,name')
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (supplierErr) throw supplierErr;
    let supplierId = supplierRow?.id ? String(supplierRow.id) : null;
    if (!supplierId) {
      const { data: createdSupplier, error: createdSupplierErr } = await supabase
        .from('suppliers')
        .insert([{ name: `SMOKE Supplier ${Date.now()}` }])
        .select('id')
        .single();
      if (createdSupplierErr) throw createdSupplierErr;
      supplierId = createdSupplier?.id ? String(createdSupplier.id) : null;
    }
    if (!supplierId) throw new Error('تعذر إنشاء مورد للاختبار.');

    currentStep = 'smoke:ensure_item';
    let itemId = null;
    let itemCategory = null;
    {
      const { data: itemRows, error: itemErr } = await supabase
        .from('menu_items')
        .select('id,category,unit_type,status')
        .eq('status', 'active')
        .neq('category', 'food')
        .order('created_at', { ascending: true })
        .limit(1);
      if (itemErr) throw itemErr;
      if (Array.isArray(itemRows) && itemRows.length > 0) {
        itemId = String(itemRows[0].id);
        itemCategory = itemRows[0].category == null ? null : String(itemRows[0].category);
      }
    }
    if (!itemId) {
      const { data: itemRows2, error: itemErr2 } = await supabase
      .from('menu_items')
      .select('id,category,unit_type,status')
      .eq('status', 'active')
      .order('created_at', { ascending: true })
      .limit(1);
      if (itemErr2) throw itemErr2;
      if (Array.isArray(itemRows2) && itemRows2.length > 0) {
        itemId = String(itemRows2[0].id);
        itemCategory = itemRows2[0].category == null ? null : String(itemRows2[0].category);
      }
    }
    if (!itemId) {
      const newId = crypto.randomUUID();
      const data = {
        id: newId,
        name: { ar: 'صنف اختبار دخان', en: 'Smoke Item' },
        price: 1000,
        category: 'qat',
        unitType: 'piece',
        status: 'active',
        availableStock: 0,
      };
      const { data: createdItem, error: createdItemErr } = await supabase
        .from('menu_items')
        .insert([{
          id: newId,
          category: 'qat',
          unit_type: 'piece',
          base_unit: 'piece',
          status: 'active',
          name: data.name,
          price: data.price,
          is_food: false,
          expiry_required: false,
          sellable: true,
          data,
        }])
        .select('id,category')
        .single();
      if (createdItemErr) throw createdItemErr;
      itemId = createdItem?.id ? String(createdItem.id) : null;
      itemCategory = createdItem?.category == null ? null : String(createdItem.category);
    }
    if (!itemId) throw new Error('تعذر إنشاء صنف للاختبار.');

    currentStep = 'smoke:ensure_item_uom';
    await ensureItemUomRow(itemId);

    currentStep = 'smoke:stock_before';
    const { data: stockBeforeRow, error: stockBeforeErr } = await supabase
      .from('stock_management')
      .select('available_quantity,avg_cost')
      .eq('item_id', itemId)
      .eq('warehouse_id', warehouseId)
      .maybeSingle();
    if (stockBeforeErr && !/row/i.test(String(stockBeforeErr.message || ''))) throw stockBeforeErr;
    const stockBefore = Number(stockBeforeRow?.available_quantity ?? 0);

    const purchaseDate = toIsoDateOnly(new Date());
    const poQty = 5;
    const poUnitCost = 100;
    const poTotal = poQty * poUnitCost;

    currentStep = 'smoke:create_po';
    const { data: poRow, error: poErr2 } = await supabase
      .from('purchase_orders')
      .insert([{
        supplier_id: supplierId,
        purchase_date: purchaseDate,
        reference_number: `SMOKE-${Date.now()}`,
        currency: 'YER',
        fx_rate: 1,
        total_amount: poTotal,
        items_count: 1,
        created_by: signInData.session.user.id,
        status: 'draft',
        warehouse_id: warehouseId,
        branch_id: scope.branchId ?? undefined,
        company_id: scope.companyId ?? undefined,
        payment_terms: 'cash',
        net_days: 0,
        due_date: purchaseDate,
      }])
      .select()
      .single();
    if (poErr2) throw poErr2;
    const purchaseOrderId = String(poRow.id);

    currentStep = 'smoke:create_po_items';
    const { error: poiErr } = await supabase.from('purchase_items').insert([{
      purchase_order_id: purchaseOrderId,
      item_id: itemId,
      quantity: poQty,
      unit_cost: poUnitCost,
      unit_cost_foreign: poUnitCost,
      total_cost: poTotal,
    }]);
    if (poiErr) throw poiErr;

    currentStep = 'smoke:receive_po';
    const { data: receiptId, error: receiveErr } = await supabase.rpc('receive_purchase_order_partial', {
      p_order_id: purchaseOrderId,
      p_items: [{
        itemId,
        quantity: poQty,
        harvestDate: purchaseDate,
        expiryDate: String(itemCategory || '').toLowerCase() === 'food'
          ? toIsoDateOnly(new Date(Date.now() + 1000 * 60 * 60 * 24 * 30))
          : null
      }],
      p_occurred_at: new Date().toISOString(),
    });
    if (receiveErr) throw receiveErr;
    if (!receiptId) throw new Error('لم يُرجع الاستلام معرف سند الاستلام.');
    const purchaseReceiptId = String(receiptId);

    currentStep = 'smoke:stock_after_receive';
    const { data: stockAfterReceiveRow, error: stockAfterReceiveErr } = await supabase
      .from('stock_management')
      .select('available_quantity')
      .eq('item_id', itemId)
      .eq('warehouse_id', warehouseId)
      .maybeSingle();
    if (stockAfterReceiveErr) throw stockAfterReceiveErr;
    const stockAfterReceive = Number(stockAfterReceiveRow?.available_quantity ?? 0);
    if (stockAfterReceive < stockBefore + poQty - 1e-9) {
      throw new Error(`فشل تحديث المخزون بعد الاستلام. قبل=${stockBefore} بعد=${stockAfterReceive}`);
    }

    const { data: purchaseMoves, error: purchaseMovesErr } = await supabase
      .from('inventory_movements')
      .select('id')
      .eq('reference_table', 'purchase_receipts')
      .eq('reference_id', purchaseReceiptId)
      .eq('movement_type', 'purchase_in')
      .limit(5);
    if (purchaseMovesErr) throw purchaseMovesErr;
    if (!Array.isArray(purchaseMoves) || purchaseMoves.length === 0) throw new Error('لم تُسجل حركة مخزون purchase_in للاستلام.');
    const purchaseMovementId = String(purchaseMoves[0].id);

    const { data: purchaseJe, error: purchaseJeErr } = await supabase
      .from('journal_entries')
      .select('id')
      .eq('source_table', 'inventory_movements')
      .eq('source_id', purchaseMovementId)
      .eq('source_event', 'purchase_in')
      .limit(1)
      .maybeSingle();
    if (purchaseJeErr) throw purchaseJeErr;
    if (!purchaseJe?.id) throw new Error('لم يتم ترحيل حركة الشراء محاسبياً (journal entry غير موجود).');

    const phone = `+967777${String(Math.floor(Math.random() * 900000) + 100000)}`;
    const saleItems = [{ itemId, quantity: 1, weight: 0, selectedAddons: {} }];
    const orderData = {
      id: crypto.randomUUID(),
      userId: signInData.session.user.id,
      orderSource: 'in_store',
      items: saleItems,
      subtotal: 0,
      deliveryFee: 0,
      discountAmount: 0,
      total: 0,
      taxAmount: 0,
      taxRate: 0,
      paymentMethod: 'cash',
      notes: 'Smoke: sell after receive',
      address: 'Smoke Address',
      location: null,
      customerName: 'Smoke Customer',
      phoneNumber: phone,
      deliveryZoneId: null,
    };
    currentStep = 'smoke:create_order';
    const { data: createdOrderRow, error: createdOrderErr } = await supabase
      .from('orders')
      .insert([{
        customer_auth_user_id: signInData.session.user.id,
        status: 'pending',
        invoice_number: null,
        currency: 'YER',
        fx_rate: 1,
        data: orderData,
        delivery_zone_id: null,
        warehouse_id: warehouseId,
        branch_id: scope.branchId ?? undefined,
        company_id: scope.companyId ?? undefined,
      }])
      .select('id,status,data')
      .single();
    if (createdOrderErr) throw createdOrderErr;
    const saleOrderId = String(createdOrderRow?.id || '');
    if (!saleOrderId) throw new Error('فشل إنشاء أمر البيع للاختبار.');

    currentStep = 'smoke:fetch_order';
    const { data: orderRow, error: orderRowErr } = await supabase
      .from('orders')
      .select('id,status,data')
      .eq('id', saleOrderId)
      .maybeSingle();
    if (orderRowErr) throw orderRowErr;
    if (!orderRow?.id) throw new Error('تعذر قراءة أمر البيع بعد إنشائه.');

    currentStep = 'smoke:confirm_delivery';
    const { error: confirmErr } = await supabase.rpc('confirm_order_delivery', {
      p_payload: {
        p_order_id: saleOrderId,
        p_items: saleItems,
        p_updated_data: orderRow.data || {},
        p_warehouse_id: warehouseId,
      }
    });
    if (confirmErr) throw confirmErr;

    currentStep = 'smoke:verify_delivered';
    const { data: deliveredRow, error: deliveredErr } = await supabase
      .from('orders')
      .select('status')
      .eq('id', saleOrderId)
      .maybeSingle();
    if (deliveredErr) throw deliveredErr;
    if (String(deliveredRow?.status || '') !== 'delivered') {
      throw new Error(`لم يتم تحديث حالة أمر البيع إلى delivered. الحالة الحالية=${String(deliveredRow?.status || '')}`);
    }

    currentStep = 'smoke:stock_after_sale';
    const { data: stockAfterSaleRow, error: stockAfterSaleErr } = await supabase
      .from('stock_management')
      .select('available_quantity')
      .eq('item_id', itemId)
      .eq('warehouse_id', warehouseId)
      .maybeSingle();
    if (stockAfterSaleErr) throw stockAfterSaleErr;
    const stockAfterSale = Number(stockAfterSaleRow?.available_quantity ?? 0);
    if (stockAfterSale > stockAfterReceive - 1 + 1e-9) {
      throw new Error(`فشل خصم المخزون بعد البيع. بعد الاستلام=${stockAfterReceive} بعد البيع=${stockAfterSale}`);
    }

    const { data: saleMoves, error: saleMovesErr } = await supabase
      .from('inventory_movements')
      .select('id')
      .eq('reference_table', 'orders')
      .eq('reference_id', saleOrderId)
      .eq('movement_type', 'sale_out')
      .limit(5);
    if (saleMovesErr) throw saleMovesErr;
    if (!Array.isArray(saleMoves) || saleMoves.length === 0) throw new Error('لم تُسجل حركة مخزون sale_out للبيع.');
    const saleMovementId = String(saleMoves[0].id);

    const { data: saleJe, error: saleJeErr } = await supabase
      .from('journal_entries')
      .select('id')
      .eq('source_table', 'inventory_movements')
      .eq('source_id', saleMovementId)
      .eq('source_event', 'sale_out')
      .limit(1)
      .maybeSingle();
    if (saleJeErr) throw saleJeErr;
    if (!saleJe?.id) throw new Error('لم يتم ترحيل حركة البيع محاسبياً (journal entry غير موجود).');

    log(`Smoke OK. PO=${purchaseOrderId} GRN=${purchaseReceiptId} Order=${saleOrderId}`, 'SUCCESS');

  } catch (err) {
    log(`Unexpected Error [${currentStep}]: ${err.message}`, 'ERROR');
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
