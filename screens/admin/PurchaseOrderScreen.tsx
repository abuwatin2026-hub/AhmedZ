import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { usePurchases } from '../../contexts/PurchasesContext';
import { useMenu } from '../../contexts/MenuContext';
import { useStock } from '../../contexts/StockContext';
import { useAuth } from '../../contexts/AuthContext';
import { useSettings } from '../../contexts/SettingsContext';
import { useToast } from '../../contexts/ToastContext';
import { useWarehouses } from '../../contexts/WarehouseContext';
import { useSessionScope } from '../../contexts/SessionScopeContext';
import { useItemMeta } from '../../contexts/ItemMetaContext';
import * as Icons from '../../components/icons';

import { translateAccountName } from '../../utils/accountUtils';
import CurrencyDualAmount from '../../components/common/CurrencyDualAmount';
import { getBaseCurrencyCode, getSupabaseClient } from '../../supabase';
import { MenuItem } from '../../types';
import { PurchaseOrder } from '../../types';
import { isIsoDate, normalizeIsoDateOnly, toDateInputValue, toDateTimeLocalInputValue } from '../../utils/dateUtils';
import { printContent } from '../../utils/printUtils';
import { renderToString } from 'react-dom/server';
import PrintablePurchaseOrder from '../../components/admin/documents/PrintablePurchaseOrder';
import PrintableGrn, { PrintableGrnData } from '../../components/admin/documents/PrintableGrn';
import { printPaymentVoucherByPaymentId } from '../../utils/vouchers';
import { localizeSupabaseError } from '../../utils/errorUtils';
import { printPurchaseReturnById } from '../../utils/returnsPrint';
import { inferDestinationParentCode, matchesDestinationCurrency } from '../../utils/accountDestinationUtils';

interface OrderItemRow {
    itemId: string;
    quantity: number | string;
    unitCost: number | string;
    uomCode?: string;
    uomQtyInBase?: number;
    productionDate?: string;
    expiryDate?: string;
}

interface ReceiveRow {
    itemId: string;
    itemName: string;
    ordered: number;
    received: number;
    remaining: number;
    receiveNow: number | string;
    uomCode?: string;
    uomQtyInBase?: number;
    productionDate?: string;
    expiryDate?: string;
    previousReturned?: number;
    available?: number;
    transportCost?: number | string;
    supplyTaxCost?: number | string;
}

type ItemUomRow = { code: string; name: string; qtyInBase: number };

const PurchaseOrderScreen: React.FC = () => {
    const location = useLocation();
    const { purchaseOrders, suppliers, createPurchaseOrder, deletePurchaseOrder, cancelPurchaseOrder, recordPurchaseOrderPayment, receivePurchaseOrderPartial, createPurchaseReturn, updatePurchaseOrderInvoiceNumber, getPurchaseReceivedSummary, getPurchaseReturnSummary, loading, error: purchasesError, fetchPurchaseOrders } = usePurchases();
    const { menuItems } = useMenu();
    const { stockItems } = useStock();
    const { user, hasPermission } = useAuth();
    const { settings, language } = useSettings();
    const { groups: itemGroups, getUnitLabel } = useItemMeta();
    const [baseCode, setBaseCode] = useState('—');
    const [poCurrency, setPoCurrency] = useState<string>('');
    const [poFxRate, setPoFxRate] = useState<number>(1);
    const [poFxSource, setPoFxSource] = useState<'base' | 'system' | 'manual' | 'unknown'>('unknown');
    const poCurrencyTouchedRef = useRef(false);
    const poCurrencyInitRef = useRef(false);
    const [currencyOptions, setCurrencyOptions] = useState<string[]>([]);
    const { showNotification } = useToast();
    const { warehouses } = useWarehouses();
    const { scope } = useSessionScope();
    const [itemUomRowsByItemId, setItemUomRowsByItemId] = useState<Record<string, ItemUomRow[]>>({});
    const itemUomLoadingRef = useRef<Set<string>>(new Set());
    const [itemExpiryMetaById, setItemExpiryMetaById] = useState<Record<string, { isFood?: boolean; expiryRequired?: boolean; category?: string }>>({});
    const [receiptPostingByOrderId, setReceiptPostingByOrderId] = useState<Record<string, { receiptId: string; status: string; error: string }>>({});
    const [receiptPostingLoading, setReceiptPostingLoading] = useState(false);
    const canDelete = user?.role === 'owner';
    const canCancel = user?.role === 'owner' || user?.role === 'manager';
    const canRepairReceipt = user?.role === 'owner' || user?.role === 'manager' || hasPermission('stock.manage') || hasPermission('procurement.manage') || hasPermission('accounting.manage');
    const canViewAccounting = hasPermission('accounting.view') || hasPermission('accounting.manage');
    const canManageAccounting = hasPermission('accounting.manage');
    const canManageImports = hasPermission('procurement.manage');
    const canReconcileAll = user?.role === 'owner' || user?.role === 'manager' || hasPermission('stock.manage') || hasPermission('accounting.manage') || hasPermission('procurement.manage');
    const [reconcilingAll, setReconcilingAll] = useState(false);
    const [reportingPartial, setReportingPartial] = useState(false);
    const [finalizingNoShortages, setFinalizingNoShortages] = useState(false);
    const [forcingStatusOnly, setForcingStatusOnly] = useState(false);
    const [repairingPurchaseInJournals, setRepairingPurchaseInJournals] = useState(false);
    const [returnPickerOrder, setReturnPickerOrder] = useState<PurchaseOrder | null>(null);
    const [returnPickerList, setReturnPickerList] = useState<Array<{ id: string; returnedAt: string; reason: string | null; itemCount: number }>>([]);
    const resolveBrandingForWarehouseId = (warehouseId?: string) => {
        const companyName = (settings as any)?.cafeteriaName?.ar || (settings as any)?.cafeteriaName?.en || '';
        const fallback = {
            name: companyName,
            address: settings?.address || '',
            contactNumber: settings?.contactNumber || '',
            logoUrl: settings?.logoUrl || '',
        };
        const wid = String(warehouseId || '').trim();
        const wh = wid ? warehouses.find(w => String(w.id) === wid) : undefined;
        const override = wid ? settings?.branchBranding?.[wid] : undefined;
        return {
            name: (override?.name || fallback.name || '').trim(),
            address: (override?.address || wh?.address || wh?.location || fallback.address || '').trim(),
            contactNumber: (override?.contactNumber || wh?.phone || fallback.contactNumber || '').trim(),
            logoUrl: (override?.logoUrl || fallback.logoUrl || '').trim(),
            branchName: (wh?.name || '').trim(),
        };
    };

    const fetchBranchHeader = async (branchId?: string) => {
        const supabase = getSupabaseClient();
        const bid = String(branchId || '').trim();
        if (!supabase || !bid) return { branchName: '', branchCode: '' };
        try {
            const { data, error } = await supabase.from('branches').select('name,code').eq('id', bid).maybeSingle();
            if (error) throw error;
            return {
                branchName: String((data as any)?.name || ''),
                branchCode: String((data as any)?.code || ''),
            };
        } catch {
            return { branchName: '', branchCode: '' };
        }
    };

    const resolvePurchaseUomByItemId = async (items: any[]) => {
        const out = new Map<string, string>();
        const supabase = getSupabaseClient();
        if (!supabase || !Array.isArray(items) || items.length === 0) return out;
        const pairs = items
            .map((it: any) => ({
                itemId: String(it?.itemId || it?.item_id || '').trim(),
                uomId: String(it?.uomId || it?.uom_id || '').trim(),
            }))
            .filter((x) => x.itemId && x.uomId);
        if (!pairs.length) return out;
        const uomIds = [...new Set(pairs.map((p) => p.uomId))];
        try {
            const { data: uomRows } = await supabase
                .from('uom_units')
                .select('id,code,data')
                .in('id', uomIds);
            const uomLabelById = new Map<string, string>();
            for (const u of ((uomRows || []) as any[])) {
                const uid = String((u as any)?.id || '').trim();
                if (!uid) continue;
                const d: any = (u as any)?.data || {};
                const labelObj: any = d?.label && typeof d.label === 'object'
                    ? d.label
                    : (d?.name && typeof d.name === 'object' ? d.name : {});
                const ar = typeof labelObj?.ar === 'string' ? labelObj.ar.trim() : '';
                const code = String((u as any)?.code || '').trim();
                const fallback = code ? String(getUnitLabel(code as any, 'ar') || code) : '';
                const value = ar || fallback || code;
                if (value) uomLabelById.set(uid, value);
            }
            for (const p of pairs) {
                if (!out.has(p.itemId) && uomLabelById.has(p.uomId)) {
                    out.set(p.itemId, String(uomLabelById.get(p.uomId) || ''));
                }
            }
        } catch {
            return out;
        }
        return out;
    };

    const handlePrintPo = async (order: PurchaseOrder) => {
        const brand = resolveBrandingForWarehouseId(order.warehouseId);
        const branchHdr = await fetchBranchHeader(scope?.branchId);
        const purchaseUomByItemId = await resolvePurchaseUomByItemId(order.items || []);
        const statusLabel = order.status === 'draft'
            ? 'Draft'
            : order.status === 'cancelled'
                ? 'Cancelled'
                : 'Approved';
        const printedBy = (user?.fullName || user?.username || user?.email || '').trim() || null;
        let printNumber = 1;
        const supabase = getSupabaseClient();
        if (supabase) {
            try {
                const { data: pn } = await supabase.rpc('track_document_print', { p_source_table: 'purchase_orders', p_source_id: order.id, p_template: 'PrintablePurchaseOrder' });
                printNumber = Number(pn) || 1;
            } catch { /* fallback */ }
        }
        const content = renderToString(
            <PrintablePurchaseOrder
                order={{
                    ...order,
                    items: (order.items || []).map((it: any) => {
                        const itemId = String(it?.itemId || '').trim();
                        const purchaseUom = purchaseUomByItemId.get(itemId) || '';
                        if (purchaseUom) return { ...it, uomCode: purchaseUom };
                        const existingUom = String(it?.uomCode || it?.uom_code || it?.unit || '').trim();
                        if (existingUom && /[\u0600-\u06FF]/.test(existingUom)) return it;
                        const mi = menuItems.find((m: any) => String(m?.id) === itemId);
                        const unitTypeKey = String((mi as any)?.unitType || (mi as any)?.unit_type || existingUom || '').trim();
                        if (!unitTypeKey) return it;
                        const arLabel = getUnitLabel(unitTypeKey as any, 'ar');
                        const resolved = (arLabel && /[\u0600-\u06FF]/.test(String(arLabel))) ? String(arLabel) : unitTypeKey;
                        return { ...it, uomCode: resolved };
                    }),
                }}
                language="ar"
                brand={{
                    ...brand,
                    branchName: branchHdr.branchName,
                    branchCode: branchHdr.branchCode,
                }}
                documentStatus={statusLabel}
                referenceId={order.id}
                audit={{ printedBy }}
                printNumber={printNumber}
            />
        );
        printContent(content, `أمر شراء #${String(order.poNumber || order.id).slice(-12)}`);
        if (supabase) {
            try {
                await supabase.from('system_audit_logs').insert({
                    action: 'print',
                    module: 'documents',
                    details: `Printed PO ${String(order.poNumber || '').trim() || order.id}`,
                    metadata: {
                        docType: 'po',
                        docNumber: order.poNumber || null,
                        status: statusLabel,
                        sourceTable: 'purchase_orders',
                        sourceId: order.id,
                        template: 'PrintablePurchaseOrder',
                    }
                } as any);
            } catch {
            }
        }
    };

    const handleReconcileAllPurchaseOrders = async () => {
        if (!canReconcileAll) return;
        const confirm = window.confirm('سيتم تنفيذ إصلاح شامل: حساب الكميات الأساسية للأوامر والسندات ثم مصالحة حالة جميع أوامر الشراء.\nهل تريد المتابعة؟');
        if (!confirm) return;
        const supabase = getSupabaseClient();
        if (!supabase) {
            alert('قاعدة البيانات غير متاحة.');
            return;
        }
        setReconcilingAll(true);
        try {
            const { data, error } = await supabase.rpc('reconcile_po_full_fix', { p_limit: 100000 } as any);
            if (error) throw error;
            const obj: any = data as any;
            const n = Number(obj?.ordersReconciled || 0);
            const r = Number(obj?.receiptItemsUpdated || 0);
            const p = Number(obj?.purchaseItemsUpdated || 0);
            const f = Number(obj?.ordersForced || 0);
            showNotification(`تم تحديث أساس السندات=${r}، أساس الأوامر=${p}، مصالحة الأوامر=${n}، إكمال الأوامر=${f}.`, 'success');
            await fetchPurchaseOrders();
        } catch (e) {
            alert(getErrorMessage(e, 'فشل مصالحة أوامر الشراء.'));
        } finally {
            setReconcilingAll(false);
        }
    };

    const handleReportPartialPurchaseOrders = async () => {
        if (!canReconcileAll) return;
        const supabase = getSupabaseClient();
        if (!supabase) {
            alert('قاعدة البيانات غير متاحة.');
            return;
        }
        setReportingPartial(true);
        try {
            const { data, error } = await supabase.rpc('report_partial_purchase_orders', { p_limit: 100000 } as any);
            if (error) throw error;
            const obj: any = data as any;
            const rows = Array.isArray(obj?.rows) ? obj.rows : [];
            const escapeHtml = (input: string) => input.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            const body = rows.map((r: any) => {
                const head = `أمر: ${String(r?.reference || r?.orderId || '')}${r?.supplierName ? ` • المورد: ${String(r.supplierName)}` : ''}`;
                const items = (Array.isArray(r?.items) ? r.items : []).map((it: any) => {
                    const ordered = Number(it?.ordered || 0);
                    const received = Number(it?.received || 0);
                    const remaining = Number(it?.remaining || 0);
                    return `- ${String(it?.itemId || '')}: المطلوب ${ordered}، المستلم ${received}، المتبقي ${remaining}`;
                }).join('\n');
                return `${head}\n${items}`;
            }).join('\n\n');
            const reportText = `تقرير نواقص الاستلام\nعدد الأوامر: ${rows.length}\n\n${body || 'لا توجد نواقص.'}`;
            const w = window.open('', '_blank');
            if (w && w.document) {
                w.document.write(`<pre style="white-space:pre-wrap;font-family:system-ui,Segoe UI,Arial">${escapeHtml(reportText)}</pre>`);
                w.document.close();
            } else {
                alert(reportText);
            }
        } catch (e) {
            alert(getErrorMessage(e, 'فشل إنشاء تقرير النواقص.'));
        } finally {
            setReportingPartial(false);
        }
    };

    const handleFinalizeWithoutShortages = async () => {
        if (!canReconcileAll) return;
        const confirm = window.confirm('سيتم إنهاء جميع أوامر الشراء التي لا توجد لها نواقص وفق تقرير النواقص.\nهل تريد المتابعة؟');
        if (!confirm) return;
        const supabase = getSupabaseClient();
        if (!supabase) {
            alert('قاعدة البيانات غير متاحة.');
            return;
        }
        setFinalizingNoShortages(true);
        try {
            const { data, error } = await supabase.rpc('finalize_purchase_orders_without_shortages', { p_limit: 100000 } as any);
            if (error) throw error;
            const n = Number(data || 0);
            showNotification(`تم إنهاء ${n} أمر شراء بدون نواقص.`, 'success');
            await fetchPurchaseOrders();
        } catch (e) {
            alert(getErrorMessage(e, 'فشل إنهاء أوامر الشراء بدون نواقص.'));
        } finally {
            setFinalizingNoShortages(false);
        }
    };

    const handleForceCompleteStatusOnly = async () => {
        if (!canReconcileAll) return;
        const confirm = window.confirm('سيتم إنهاء حالة الاستلام إلى "مكتمل" لكل أمر لديه سند استلام.\nلن يتم تعديل المخزون أو المحاسبة.\nهل تريد المتابعة؟');
        if (!confirm) return;
        const supabase = getSupabaseClient();
        if (!supabase) {
            alert('قاعدة البيانات غير متاحة.');
            return;
        }
        setForcingStatusOnly(true);
        try {
            const { data, error } = await supabase.rpc('force_complete_purchase_orders_status_only', { p_limit: 100000 } as any);
            if (error) throw error;
            const n = Number(data || 0);
            showNotification(`تم إكمال الحالة لـ ${n} أمر شراء.`, 'success');
            await fetchPurchaseOrders();
        } catch (e) {
            alert(getErrorMessage(e, 'فشل إكمال الحالة.'));
        } finally {
            setForcingStatusOnly(false);
        }
    };

    const handleRepairPurchaseInJournalsFromMovements = async () => {
        if (!canManageAccounting) {
            showNotification('ليس لديك صلاحية تنفيذ إصلاح القيود.', 'error');
            return;
        }
        if (repairingPurchaseInJournals) return;
        const supabase = getSupabaseClient();
        if (!supabase) {
            showNotification('قاعدة البيانات غير متاحة.', 'error');
            return;
        }

        const startDate = window.prompt('أدخل تاريخ البداية (YYYY-MM-DD) أو اتركه فارغاً:', '');
        if (startDate === null) return;
        const endDate = window.prompt('أدخل تاريخ النهاية (YYYY-MM-DD) أو اتركه فارغاً:', '');
        if (endDate === null) return;
        const limitText = window.prompt('حد أقصى لعدد القيود للفحص/الإصلاح:', '500');
        if (limitText === null) return;
        const limit = Math.max(1, Math.min(5000, Number(limitText || 500) || 500));

        const toStartIso = (d: string) => {
            const x = String(d || '').trim();
            if (!x) return null;
            return `${x}T00:00:00Z`;
        };
        const toEndIso = (d: string) => {
            const x = String(d || '').trim();
            if (!x) return null;
            return `${x}T23:59:59Z`;
        };

        const p_start = toStartIso(startDate);
        const p_end = toEndIso(endDate);

        setRepairingPurchaseInJournals(true);
        try {
            const dryRes = await supabase.rpc('repair_purchase_in_journals_from_movements', {
                p_start,
                p_end,
                p_limit: limit,
                p_dry_run: true,
            } as any);
            if ((dryRes as any)?.error) throw (dryRes as any).error;
            const dryRows = Array.isArray((dryRes as any)?.data) ? ((dryRes as any).data as any[]) : [];

            if (dryRows.length === 0) {
                showNotification('لا توجد قيود مشتريات تحتاج إصلاح ضمن النطاق.', 'info');
                return;
            }

            const dryCount = dryRows.filter((r) => String(r?.action || '') === 'dry_run').length;
            const skippedCount = dryRows.filter((r) => String(r?.action || '') === 'skipped_complex').length;
            const preview = dryRows.slice(0, 10).map((r) => {
                const je = String(r?.journal_entry_id || '').slice(0, 8);
                const mv = String(r?.movement_id || '').slice(0, 8);
                const oldC = Number(r?.old_total_cost || 0);
                const newC = Number(r?.new_total_cost || 0);
                const act = String(r?.action || '');
                return `- JE ${je} / MV ${mv} : ${oldC} → ${newC} (${act})`;
            }).join('\n');

            const ok = window.confirm(
                `نتيجة الفحص:\n` +
                `جاهز للإصلاح=${dryCount}\n` +
                `تم تخطيه (قيد مركّب)=${skippedCount}\n\n` +
                `عينة:\n${preview}\n\n` +
                `هل تريد تنفيذ الإصلاح الآن؟`
            );
            if (!ok) return;

            const runRes = await supabase.rpc('repair_purchase_in_journals_from_movements', {
                p_start,
                p_end,
                p_limit: limit,
                p_dry_run: false,
            } as any);
            if ((runRes as any)?.error) throw (runRes as any).error;
            const runRows = Array.isArray((runRes as any)?.data) ? ((runRes as any).data as any[]) : [];
            const fixedCount = runRows.filter((r) => String(r?.action || '') === 'fixed').length;
            const runSkipped = runRows.filter((r) => String(r?.action || '') === 'skipped_complex').length;

            showNotification(`تم إصلاح ${fixedCount} قيد. تم تخطي ${runSkipped} قيد مركب.`, 'success');
        } catch (e) {
            alert(getErrorMessage(e, localizeSupabaseError(e)));
        } finally {
            setRepairingPurchaseInJournals(false);
        }
    };

    const handleRepairPurchaseOrder = async (order: PurchaseOrder) => {
        if (!canRepairReceipt) return;
        const supabase = getSupabaseClient();
        if (!supabase) {
            alert('Supabase غير مهيأ.');
            return;
        }
        const ref = order.poNumber || order.referenceNumber || order.id;
        const ok = window.confirm(`سيتم محاولة إصلاح الاستلام وإدخال المخزون (إن كان هناك سند استلام مكرر/عالق).\nأمر الشراء: ${ref}\nهل تريد المتابعة؟`);
        if (!ok) return;
        try {
            const { data, error } = await supabase.rpc('repair_purchase_order', { p_order_id: order.id } as any);
            if (error) throw error;
            await fetchPurchaseOrders();
            showNotification(`تم تنفيذ الإصلاح: ${typeof data === 'string' ? data : 'تم'}`, 'success');
        } catch (e: any) {
            try {
                await supabase.rpc('reconcile_purchase_order_receipt_status', { p_order_id: order.id } as any);
                await fetchPurchaseOrders();
                showNotification('تمت مصالحة حالة أمر الشراء بناءً على السندات الموجودة.', 'success');
            } catch {
                alert(getErrorMessage(e, 'فشل إصلاح الاستلام.'));
            }
        }
    };

    const handleCreateOrUpdateShipmentFromOrder = async (order: PurchaseOrder) => {
        if (!canManageImports) {
            showNotification('ليس لديك صلاحية إدارة الشحنات.', 'error');
            return;
        }
        const supabase = getSupabaseClient();
        if (!supabase) {
            showNotification('قاعدة البيانات غير متاحة.', 'error');
            return;
        }
        const wid = String(order.warehouseId || '').trim();
        if (!wid) {
            showNotification('اختر مستودعاً لأمر الشراء أولاً.', 'error');
            return;
        }
        const orderRef = String(order.poNumber || order.referenceNumber || order.id);
        setShipmentFromPoBusyId(order.id);
        try {
            const { data: openShipments, error: sErr } = await supabase
                .from('import_shipments')
                .select('id,reference_number,status')
                .eq('destination_warehouse_id', wid)
                .neq('status', 'cancelled')
                .order('created_at', { ascending: false })
                .limit(20);
            if (sErr) throw sErr;
            const list = Array.isArray(openShipments) ? openShipments : [];
            const lines = list.map((s: any, idx: number) => `${idx + 1}) ${String(s.reference_number || s.id)}${s.status ? ` — ${String(s.status)}` : ''}`);
            const hint = lines.length > 0
                ? `اختر رقم شحنة موجودة لإضافة أصناف هذا الأمر، أو اتركه فارغاً لإنشاء شحنة جديدة:\n${lines.join('\n')}`
                : 'لا توجد شحنات مفتوحة لهذا المستودع. اتركه فارغاً لإنشاء شحنة جديدة.';
            const selection = window.prompt(hint, '');
            if (selection === null) return;
            const idx = Number(String(selection).trim());
            let shipmentId = '';
            let shipmentRef = '';
            let shipmentStatus = '';
            if (Number.isFinite(idx) && idx >= 1 && idx <= list.length) {
                const s = list[idx - 1] as any;
                shipmentId = String(s?.id || '');
                shipmentRef = String(s?.reference_number || shipmentId);
                shipmentStatus = String(s?.status || '');
            } else {
                const defRef = `SHP-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${String(order.poNumber || order.id).slice(-6).toUpperCase()}`;
                const ref = window.prompt(`رقم الشحنة/البوليصة (مطلوب): ${orderRef}`, defRef);
                if (ref === null) return;
                const referenceNumber = String(ref).trim();
                if (!referenceNumber) {
                    showNotification('رقم الشحنة مطلوب.', 'error');
                    return;
                }
                const { data: created, error: cErr } = await supabase
                    .from('import_shipments')
                    .insert({
                        reference_number: referenceNumber,
                        supplier_id: order.supplierId || null,
                        status: 'draft',
                        destination_warehouse_id: wid,
                        total_weight_kg: 0,
                        notes: `Created from PO ${orderRef}`,
                    } as any)
                    .select('id,reference_number')
                    .single();
                if (cErr) throw cErr;
                shipmentId = String((created as any)?.id || '');
                shipmentRef = String((created as any)?.reference_number || shipmentId);
            }

            if (!shipmentId) {
                showNotification('تعذر تحديد الشحنة.', 'error');
                return;
            }

            if (shipmentStatus === 'closed') {
                showNotification('هذه الشحنة مغلقة وسيتم فتحها للعرض فقط.', 'info');
                const open = window.confirm(`هذه الشحنة مغلقة: ${shipmentRef}\nهل تريد فتح الشحنة الآن؟`);
                if (open) {
                    window.open(`/admin/import-shipments/${shipmentId}`, '_blank');
                }
                return;
            }

            try {
                const { data: existingLink, error: lSelErr } = await supabase
                    .from('import_shipment_purchase_orders')
                    .select('shipment_id')
                    .eq('shipment_id', shipmentId)
                    .eq('purchase_order_id', order.id)
                    .maybeSingle();
                if (lSelErr) throw lSelErr;
                if (existingLink) {
                    showNotification(`هذا الأمر مرتبط بهذه الشحنة مسبقاً: ${shipmentRef}`, 'info');
                    const open = window.confirm(`هذا الأمر مرتبط بهذه الشحنة مسبقاً: ${shipmentRef}\nهل تريد فتح الشحنة الآن؟`);
                    if (open) window.open(`/admin/import-shipments/${shipmentId}`, '_blank');
                    return;
                }
                const { error: lInsErr } = await supabase
                    .from('import_shipment_purchase_orders')
                    .insert({ shipment_id: shipmentId, purchase_order_id: order.id } as any);
                if (lInsErr) throw lInsErr;
            } catch (e: any) {
                const msg = localizeSupabaseError(e) || 'تعذر ربط أمر الشراء بهذه الشحنة.';
                showNotification(msg, 'error');
                return;
            }

            const { data: existingItems, error: eErr } = await supabase
                .from('import_shipments_items')
                .select('item_id,quantity,unit_price_fob,currency')
                .eq('shipment_id', shipmentId);
            if (eErr) throw eErr;
            const existing = new Map<string, { quantity: number; unitPrice: number; currency: string }>();
            for (const row of (Array.isArray(existingItems) ? existingItems : [])) {
                const key = String((row as any)?.item_id || '');
                if (!key) continue;
                existing.set(key, {
                    quantity: Number((row as any)?.quantity || 0),
                    unitPrice: Number((row as any)?.unit_price_fob || 0),
                    currency: String((row as any)?.currency || ''),
                });
            }

            const currency = String(order.currency || '').toUpperCase() || (baseCode && baseCode !== '—' ? baseCode : 'USD');
            const payload = (order.items || [])
                .filter((it: any) => Number(it?.quantity || 0) > 0)
                .map((it: any) => {
                    const itemId = String(it?.itemId || '').trim();
                    const qty = Number(it?.quantity || 0);
                    const unitCost = Number(it?.unitCost || 0);
                    const prev = existing.get(itemId);
                    const nextQty = (prev?.quantity || 0) + qty;
                    const nextUnit = (prev?.unitPrice && prev.unitPrice > 0) ? prev.unitPrice : Math.max(0, unitCost);
                    const nextCur = (prev?.currency && String(prev.currency).trim()) ? String(prev.currency).trim().toUpperCase() : currency;
                    return {
                        shipment_id: shipmentId,
                        item_id: itemId,
                        quantity: nextQty,
                        unit_price_fob: nextUnit,
                        currency: nextCur,
                        notes: prev ? (undefined as any) : `from PO ${orderRef}`,
                    };
                })
                .filter((r: any) => r.item_id && Number(r.quantity || 0) > 0);

            if (payload.length === 0) {
                showNotification('لا توجد أصناف لإضافتها للشحنة.', 'info');
                return;
            }

            const { error: uErr } = await supabase
                .from('import_shipments_items')
                .upsert(payload as any, { onConflict: 'shipment_id,item_id' });
            if (uErr) throw uErr;

            showNotification(`تم تحديث الشحنة: ${shipmentRef}`, 'success');
            const open = window.confirm(`تم تحديث الشحنة: ${shipmentRef}\nهل تريد فتح الشحنة الآن؟`);
            if (open) {
                window.open(`/admin/import-shipments/${shipmentId}`, '_blank');
            }
        } catch (e: any) {
            const msg = localizeSupabaseError(e) || 'فشل إنشاء/تحديث الشحنة من أمر الشراء.';
            showNotification(msg, 'error');
        } finally {
            setShipmentFromPoBusyId('');
        }
    };

    const handlePrintGrn = async (receiptId: string, po: PurchaseOrder) => {
        const supabase = getSupabaseClient();
        if (!supabase) throw new Error('قاعدة البيانات غير متاحة.');
        const { data: receipt, error: rErr } = await supabase
            .from('purchase_receipts')
            .select('id,grn_number,received_at,notes,branch_id,warehouse_id,approval_status,requires_approval')
            .eq('id', receiptId)
            .maybeSingle();
        if (rErr) throw rErr;
        const branchId = String((receipt as any)?.branch_id || scope?.branchId || '');
        const brand = resolveBrandingForWarehouseId(String((receipt as any)?.warehouse_id || po.warehouseId || ''));
        const branchHdr = await fetchBranchHeader(branchId);
        const { data: batchRows, error: bErr } = await supabase
            .from('batches')
            .select('item_id,quantity_received,unit_cost,production_date,expiry_date,menu_items(name)')
            .eq('receipt_id', receiptId)
            .order('created_at', { ascending: true });
        if (bErr) throw bErr;
        const { data: receiptItemRows, error: riErr } = await supabase
            .from('purchase_receipt_items')
            .select('item_id,quantity,unit_cost,total_cost,menu_items(name)')
            .eq('receipt_id', receiptId)
            .order('created_at', { ascending: true });
        if (riErr) throw riErr;
        const receiptItemByItemId = new Map<string, { quantity: number; unitCost: number; totalCost: number; itemName: string }>();
        (Array.isArray(receiptItemRows) ? receiptItemRows : []).forEach((r: any) => {
            const itemId = String(r?.item_id || '').trim();
            if (!itemId) return;
            const quantity = Number(r?.quantity || 0) || 0;
            const unitCost = Number(r?.unit_cost || 0) || 0;
            const totalCost = Number(r?.total_cost || 0) || 0;
            const itemName = String(r?.menu_items?.name?.ar || r?.menu_items?.name?.en || itemId);
            const prev = receiptItemByItemId.get(itemId);
            if (!prev) {
                receiptItemByItemId.set(itemId, { quantity, unitCost, totalCost, itemName });
                return;
            }
            const nextQty = prev.quantity + quantity;
            const nextTotal = prev.totalCost + totalCost;
            const nextUnit = nextQty > 0 ? (nextTotal / nextQty) : prev.unitCost;
            receiptItemByItemId.set(itemId, { quantity: nextQty, unitCost: nextUnit, totalCost: nextTotal, itemName: prev.itemName || itemName });
        });
        const items = (Array.isArray(batchRows) ? batchRows : []).map((b: any) => ({
            itemId: String(b.item_id),
            itemName: String(b?.menu_items?.name?.ar || b?.menu_items?.name?.en || b.item_id),
            quantity: Number(b.quantity_received || 0),
            unitCost: Number(b.unit_cost || 0),
            productionDate: b.production_date ? String(b.production_date) : null,
            expiryDate: b.expiry_date ? String(b.expiry_date) : null,
            totalCost: Number(b.quantity_received || 0) * Number(b.unit_cost || 0),
        })).filter((x: any) => Number(x.quantity || 0) > 0);
        const hasMeaningfulBatchCost = items.some((it: any) => Number(it.unitCost || 0) > 0);
        const normalizedItems = hasMeaningfulBatchCost
            ? items.map((it: any) => {
                const fallback = receiptItemByItemId.get(String(it.itemId || '').trim());
                const unitCost = (Number(it.unitCost || 0) > 0) ? Number(it.unitCost || 0) : (Number(fallback?.unitCost || 0) || 0);
                const qty = Number(it.quantity || 0) || 0;
                return {
                    ...it,
                    itemName: it.itemName || fallback?.itemName || it.itemId,
                    unitCost,
                    totalCost: Number(it.totalCost ?? (qty * unitCost)),
                };
            })
            : (Array.from(receiptItemByItemId.entries()).map(([itemId, r]) => ({
                itemId,
                itemName: r.itemName || itemId,
                quantity: Number(r.quantity || 0) || 0,
                unitCost: Number(r.unitCost || 0) || 0,
                productionDate: null,
                expiryDate: null,
                totalCost: Number(r.totalCost || ((Number(r.quantity || 0) || 0) * (Number(r.unitCost || 0) || 0))),
            }))).filter((x: any) => Number(x.quantity || 0) > 0);

        // Map uomCode from PO items to GRN items by itemId
        const poUomByItemId = await resolvePurchaseUomByItemId(po.items || []);
        for (const poItem of (po.items || [])) {
            const itemId = String((poItem as any)?.itemId || '').trim();
            const uomCode = String((poItem as any)?.uomCode || (poItem as any)?.uom_code || (poItem as any)?.unit || (poItem as any)?.uom || '').trim();
            if (itemId && uomCode && !poUomByItemId.has(itemId)) poUomByItemId.set(itemId, uomCode);
        }
        const grnItems = normalizedItems.map((it: any) => {
            const rawUom = poUomByItemId.get(String(it.itemId || '').trim()) || '';
            let resolvedUom = rawUom;
            if (!resolvedUom || !/[\u0600-\u06FF]/.test(resolvedUom)) {
                const itemId = String(it.itemId || '').trim();
                const mi = menuItems.find((m: any) => String(m?.id) === itemId);
                const unitTypeKey = String((mi as any)?.unitType || (mi as any)?.unit_type || resolvedUom || '').trim();
                if (unitTypeKey) {
                    const arLabel = getUnitLabel(unitTypeKey as any, 'ar');
                    resolvedUom = (arLabel && /[\u0600-\u06FF]/.test(String(arLabel))) ? String(arLabel) : unitTypeKey;
                }
            }
            return { ...it, uomCode: resolvedUom };
        });

        const grn: PrintableGrnData = {
            grnNumber: String((receipt as any)?.grn_number || `GRN-${receiptId.slice(-6).toUpperCase()}`),
            documentStatus: 'Approved',
            referenceId: receiptId,
            receivedAt: String((receipt as any)?.received_at || new Date().toISOString()),
            purchaseOrderNumber: po.poNumber || undefined,
            supplierName: po.supplierName || undefined,
            warehouseName: po.warehouseName || undefined,
            notes: (receipt as any)?.notes ?? null,
            items: grnItems,
            currency: String(po.currency || ''),
        };

        const printedBy = (user?.fullName || user?.username || user?.email || '').trim() || null;
        let printNumber = 1;
        try {
            const { data: pn } = await supabase.rpc('track_document_print', { p_source_table: 'purchase_receipts', p_source_id: receiptId, p_template: 'PrintableGrn' });
            printNumber = Number(pn) || 1;
        } catch { /* fallback */ }
        const content = renderToString(
            <PrintableGrn
                data={grn}
                language="ar"
                brand={{
                    ...brand,
                    branchName: branchHdr.branchName,
                    branchCode: branchHdr.branchCode,
                }}
                audit={{ printedBy }}
                printNumber={printNumber}
            />
        );
        printContent(content, `GRN #${grn.grnNumber}`);
        try {
            await supabase.from('system_audit_logs').insert({
                action: 'print',
                module: 'documents',
                details: `Printed GRN ${grn.grnNumber}`,
                metadata: {
                    docType: 'grn',
                    docNumber: grn.grnNumber,
                    status: 'Approved',
                    sourceTable: 'purchase_receipts',
                    sourceId: receiptId,
                    template: 'PrintableGrn',
                    purchaseOrderId: po.id,
                    purchaseOrderNumber: po.poNumber || null,
                }
            } as any);
        } catch {
        }
    };

    const getLatestReceiptForOrder = async (orderId: string) => {
        const supabase = getSupabaseClient();
        if (!supabase) return null;
        const { data, error } = await supabase
            .from('purchase_receipts')
            .select('id,grn_number,received_at,posting_status,posting_error')
            .eq('purchase_order_id', orderId)
            .order('received_at', { ascending: false })
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
        if (error) throw error;
        if (!data?.id) return null;
        return {
            id: String((data as any).id),
            grnNumber: String((data as any).grn_number || ''),
            receivedAt: String((data as any).received_at || ''),
            postingStatus: String((data as any).posting_status || ''),
            postingError: String((data as any).posting_error || ''),
        };
    };

    const getAllPurchaseReturnsForOrder = async (orderId: string) => {
        const supabase = getSupabaseClient();
        if (!supabase) return [];
        const { data, error } = await supabase
            .from('purchase_returns')
            .select('id,returned_at,reason,created_at,purchase_return_items(id)')
            .eq('purchase_order_id', orderId)
            .order('returned_at', { ascending: false, nullsFirst: false })
            .order('created_at', { ascending: false });
        if (error) throw error;
        return (Array.isArray(data) ? data : []).map((r: any) => ({
            id: String(r.id),
            returnedAt: String(r.returned_at || r.created_at || ''),
            reason: r.reason ? String(r.reason) : null,
            itemCount: Array.isArray(r.purchase_return_items) ? r.purchase_return_items.length : 0,
        }));
    };

    const openReturnPrintPicker = async (order: PurchaseOrder) => {
        setReturnPickerOrder(order);
        try {
            const list = await getAllPurchaseReturnsForOrder(order.id);
            if (list.length === 0) {
                showNotification('لا يوجد مرتجعات لهذا الأمر.', 'info');
                setReturnPickerOrder(null);
                return;
            }
            if (list.length === 1) {
                // Only one return — print directly without modal
                await handlePrintSelectedReturn(order, list[0].id);
                setReturnPickerOrder(null);
                return;
            }
            setReturnPickerList(list);
        } catch (e) {
            showNotification(getErrorMessage(e, 'تعذر جلب المرتجعات'), 'error');
            setReturnPickerOrder(null);
        }
    };

    const handlePrintSelectedReturn = async (order: PurchaseOrder, returnId: string) => {
        const brand = resolveBrandingForWarehouseId(order.warehouseId);
        const branchHdr = await fetchBranchHeader(scope?.branchId);
        const printedBy = (user?.fullName || user?.username || user?.email || '').trim() || null;
        await printPurchaseReturnById(
            returnId,
            { ...brand, branchName: branchHdr.branchName, branchCode: branchHdr.branchCode },
            baseCode,
            { printedBy }
        );
    };

    const loadLatestReceiptPostingForOrders = async (orderIds: string[]) => {
        const supabase = getSupabaseClient();
        if (!supabase) return {} as Record<string, { receiptId: string; status: string; error: string }>;
        const ids = Array.from(new Set(orderIds.map((x) => String(x || '').trim()).filter(Boolean)));
        const chunks: string[][] = [];
        for (let i = 0; i < ids.length; i += 200) chunks.push(ids.slice(i, i + 200));
        const rows: any[] = [];
        for (const c of chunks) {
            const { data, error } = await supabase
                .from('purchase_receipts')
                .select('id,purchase_order_id,posting_status,posting_error,received_at,created_at')
                .in('purchase_order_id', c);
            if (error) throw error;
            if (Array.isArray(data)) rows.push(...data);
        }
        const bestByOrder = new Map<string, any>();
        const score = (r: any) => {
            const receivedAt = Date.parse(String(r?.received_at || ''));
            const createdAt = Date.parse(String(r?.created_at || ''));
            const a = Number.isFinite(receivedAt) ? receivedAt : 0;
            const b = Number.isFinite(createdAt) ? createdAt : 0;
            return a * 1000 + b;
        };
        for (const r of rows) {
            const oid = String(r?.purchase_order_id || '').trim();
            if (!oid) continue;
            const prev = bestByOrder.get(oid);
            if (!prev || score(r) > score(prev)) bestByOrder.set(oid, r);
        }
        const out: Record<string, { receiptId: string; status: string; error: string }> = {};
        for (const [oid, r] of bestByOrder.entries()) {
            out[oid] = {
                receiptId: String(r?.id || ''),
                status: String(r?.posting_status || ''),
                error: String(r?.posting_error || ''),
            };
        }
        return out;
    };

    useEffect(() => {
        void getBaseCurrencyCode().then((c) => {
            if (!c) return;
            setBaseCode(c);
        });
    }, []);

    useEffect(() => {
        let active = true;
        const ids = (purchaseOrders || [])
            .filter((o: any) => (o?.items || []).some((it: any) => Number(it?.receivedQuantity || 0) > 0))
            .map((o: any) => String(o?.id || '').trim())
            .filter(Boolean);
        if (ids.length === 0) {
            setReceiptPostingByOrderId({});
            return () => { active = false; };
        }
        setReceiptPostingLoading(true);
        void (async () => {
            try {
                const map = await loadLatestReceiptPostingForOrders(ids);
                if (active) setReceiptPostingByOrderId(map);
            } catch {
                if (active) setReceiptPostingByOrderId({});
            } finally {
                if (active) setReceiptPostingLoading(false);
            }
        })();
        return () => { active = false; };
    }, [purchaseOrders]);

    useEffect(() => {
        let active = true;
        const loadCurrencies = async () => {
            try {
                const supabase = getSupabaseClient();
                if (!supabase) return;
                const { data, error } = await supabase.from('currencies').select('code').order('code', { ascending: true });
                if (error) throw error;
                const codes = (Array.isArray(data) ? data : []).map((r: any) => String(r.code || '').toUpperCase()).filter(Boolean);
                if (active) setCurrencyOptions(codes);
            } catch {
                if (active) setCurrencyOptions([]);
            }
        };
        void loadCurrencies();
        return () => { active = false; };
    }, []);

    const getErrorMessage = (error: unknown, fallback: string) => {
        if (error instanceof Error && error.message) return error.message;
        return fallback;
    };

    const formatPurchaseDate = (value: unknown) => {
        if (typeof value !== 'string') return '-';
        if (isIsoDate(value)) {
            return new Date(`${value}T00:00:00`).toLocaleDateString('ar-EG-u-nu-latn');
        }
        const d = new Date(value);
        if (isNaN(d.getTime())) return value;
        return d.toLocaleDateString('ar-EG-u-nu-latn');
    };

    const addDaysToYmd = (ymd: string, days: number) => {
        const safe = normalizeIsoDateOnly(ymd) || toDateInputValue();
        const dt = new Date(`${safe}T00:00:00`);
        dt.setDate(dt.getDate() + Math.max(0, Number(days) || 0));
        const yyyy = dt.getFullYear();
        const mm = String(dt.getMonth() + 1).padStart(2, '0');
        const dd = String(dt.getDate()).padStart(2, '0');
        return `${yyyy}-${mm}-${dd}`;
    };

    const activeMenuItems = useMemo(() => {
        return (menuItems || []).filter(i => i && i.status === 'active');
    }, [menuItems]);

    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
    const [isReceiveModalOpen, setIsReceiveModalOpen] = useState(false);
    const [isReturnModalOpen, setIsReturnModalOpen] = useState(false);
    const [supplierId, setSupplierId] = useState('');
    const [purchaseDate, setPurchaseDate] = useState(toDateInputValue());
    const [supplierInvoiceNumber, setSupplierInvoiceNumber] = useState<string>('');
    const [warehouseId, setWarehouseId] = useState<string>('');
    const [paymentTerms, setPaymentTerms] = useState<'cash' | 'credit'>('cash');
    const [netDays, setNetDays] = useState<number>(0);
    const [poNotes, setPoNotes] = useState<string>('');

    // ── UX Filters & Search ──
    const [searchQuery, setSearchQuery] = useState('');
    const [statusFilter, setStatusFilter] = useState('all');
    const [paymentFilter, setPaymentFilter] = useState('all');
    const [isAdvancedActionsOpen, setIsAdvancedActionsOpen] = useState(false);
    const [openRowDropdownId, setOpenRowDropdownId] = useState<string | null>(null);

    const filteredPurchaseOrders = useMemo(() => {
        return purchaseOrders.filter((order) => {
            let matchSearch = true;
            if (searchQuery.trim()) {
                const q = searchQuery.toLowerCase();
                const num = (order.poNumber || `PO-${order.id.slice(-6).toUpperCase()}`).toLowerCase();
                const ref = (order.referenceNumber || '').toLowerCase();
                const sup = (order.supplierName || '').toLowerCase();
                matchSearch = num.includes(q) || ref.includes(q) || sup.includes(q);
            }

            let matchStatus = true;
            if (statusFilter !== 'all') {
                const eps = 0.000000001;
                const items = Array.isArray(order.items) ? order.items : [];
                const hasReceived = order.status === 'completed' || items.some((it: any) => Number(it?.receivedQuantity || 0) > 0);
                const fullyReceived = order.status === 'completed' || (items.length > 0 && items.every((it: any) => (Number(it?.receivedQuantity || 0) + eps) >= Number(it?.qtyBase ?? it?.quantity ?? 0)));

                if (statusFilter === 'draft') matchStatus = order.status === 'draft' && !hasReceived;
                else if (statusFilter === 'partial') matchStatus = hasReceived && !fullyReceived;
                else if (statusFilter === 'received') matchStatus = fullyReceived;
                else if (statusFilter === 'cancelled') matchStatus = order.status === 'cancelled';
            }

            let matchPayment = true;
            if (paymentFilter !== 'all') {
                const total = Number(order.totalAmount || 0);
                const paid = Number(order.paidAmount || 0);
                const remaining = total - paid;

                if (paymentFilter === 'unpaid') matchPayment = remaining > 0.000000001 && paid <= 0;
                else if (paymentFilter === 'partial') matchPayment = remaining > 0.000000001 && paid > 0;
                else if (paymentFilter === 'paid') matchPayment = remaining <= 0.000000001 && total > 0;
            }

            return matchSearch && matchStatus && matchPayment;
        });
    }, [purchaseOrders, searchQuery, statusFilter, paymentFilter]);

    const [dueDate, setDueDate] = useState<string>(toDateInputValue());
    const [orderItems, setOrderItems] = useState<OrderItemRow[]>([]);
    const [receiveOnCreate, setReceiveOnCreate] = useState(true);
    const [quickAddCode, setQuickAddCode] = useState<string>('');
    const [quickAddName, setQuickAddName] = useState<string>('');
    const [quickAddQuantity, setQuickAddQuantity] = useState<number | string>(1);
    const [quickAddUnitCost, setQuickAddUnitCost] = useState<number | string>(0);
    const [bulkLinesText, setBulkLinesText] = useState<string>('');
    const [paymentOrder, setPaymentOrder] = useState<PurchaseOrder | null>(null);
    const [paymentAmount, setPaymentAmount] = useState<number>(0);
    const [paymentMethod, setPaymentMethod] = useState<string>('cash');
    const [paymentOccurredAt, setPaymentOccurredAt] = useState<string>(toDateTimeLocalInputValue());
    const [paymentReferenceNumber, setPaymentReferenceNumber] = useState<string>('');
    const [paymentSenderName, setPaymentSenderName] = useState<string>('');
    const [paymentSenderPhone, setPaymentSenderPhone] = useState<string>('');
    const [paymentDeclaredAmount, setPaymentDeclaredAmount] = useState<number>(0);
    const [paymentAmountConfirmed, setPaymentAmountConfirmed] = useState<boolean>(false);
    const [paymentIdempotencyKey, setPaymentIdempotencyKey] = useState<string>('');
    const [paymentAdvancedAccounting, setPaymentAdvancedAccounting] = useState(false);
    const [paymentOverrideAccountId, setPaymentOverrideAccountId] = useState<string>('');
    const [paymentDestinationAccountId, setPaymentDestinationAccountId] = useState<string>('');
    const [accounts, setAccounts] = useState<{ id: string; code: string; name: string; nameAr: string }[]>([]);
    const [accountsError, setAccountsError] = useState<string>('');
    const [receiveOrder, setReceiveOrder] = useState<PurchaseOrder | null>(null);
    const [receiveRows, setReceiveRows] = useState<ReceiveRow[]>([]);
    const [receiveOccurredAt, setReceiveOccurredAt] = useState<string>(toDateTimeLocalInputValue());
    const [receiveShipmentId, setReceiveShipmentId] = useState<string>('');
    const [receiveShipments, setReceiveShipments] = useState<Array<{ id: string; referenceNumber: string; status: string }>>([]);
    const [receiveShipmentsLoading, setReceiveShipmentsLoading] = useState<boolean>(false);
    const [shipmentFromPoBusyId, setShipmentFromPoBusyId] = useState<string>('');
    const [isReceivingPartial, setIsReceivingPartial] = useState<boolean>(false);
    const [focusedPoId, setFocusedPoId] = useState<string>('');
    const focusedPoScrolledRef = useRef<string>('');
    const [returnOrder, setReturnOrder] = useState<PurchaseOrder | null>(null);
    const [returnRows, setReturnRows] = useState<ReceiveRow[]>([]);
    const [returnOccurredAt, setReturnOccurredAt] = useState<string>(toDateTimeLocalInputValue());
    const [returnReason, setReturnReason] = useState<string>('');
    const [isCreatingReturn, setIsCreatingReturn] = useState<boolean>(false);
    const createReturnInFlightRef = useRef(false);
    const [returnStatusByOrderId, setReturnStatusByOrderId] = useState<Record<string, { isFull: boolean; receivedQty: number; returnedQty: number }>>({});
    const [formErrors, setFormErrors] = useState<string[]>([]);

    useEffect(() => {
        const orderIds = Array.from(new Set((purchaseOrders || []).map((o: any) => String(o?.id || '').trim()).filter(Boolean)));
        if (!orderIds.length) {
            setReturnStatusByOrderId({});
            return;
        }
        let cancelled = false;
        void (async () => {
            try {
                const next: Record<string, { isFull: boolean; receivedQty: number; returnedQty: number }> = {};
                await Promise.all(orderIds.map(async (oid) => {
                    const [receivedSummary, returnedSummary] = await Promise.all([
                        getPurchaseReceivedSummary(oid),
                        getPurchaseReturnSummary(oid),
                    ]);
                    const receiptQty = Object.values(receivedSummary || {}).reduce((s, v) => s + (Number(v) || 0), 0);
                    const returnQty = Object.values(returnedSummary || {}).reduce((s, v) => s + (Number(v) || 0), 0);
                    next[oid] = {
                        isFull: receiptQty > 0 && (returnQty + 1e-9) >= receiptQty,
                        receivedQty: receiptQty,
                        returnedQty: returnQty,
                    };
                }));
                if (!cancelled) setReturnStatusByOrderId(next);
            } catch {
                if (!cancelled) setReturnStatusByOrderId({});
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [purchaseOrders]);

    useEffect(() => {
        const supabase = getSupabaseClient();
        if (!supabase) return;
        const ids = Array.from(new Set(orderItems.map((r) => String(r.itemId || '').trim()).filter(Boolean)));
        if (!ids.length) return;

        for (const id of ids) {
            if (itemUomRowsByItemId[id]) continue;
            if (itemUomLoadingRef.current.has(id)) continue;
            itemUomLoadingRef.current.add(id);

            (async () => {
                try {
                    const { data, error } = await supabase.rpc('list_item_uom_units', { p_item_id: id } as any);
                    if (error) throw error;
                    const rows = Array.isArray(data) ? data : [];
                    const normalized: ItemUomRow[] = rows
                        .filter((r: any) => Boolean(r?.is_active))
                        .map((r: any) => ({
                            code: String(r?.uom_code || '').trim(),
                            name: String(r?.uom_name || '').trim(),
                            qtyInBase: Number(r?.qty_in_base || 0) || 0,
                        }))
                        .filter((r: ItemUomRow) => r.code && r.qtyInBase > 0);
                    setItemUomRowsByItemId((prev) => ({ ...prev, [id]: normalized }));
                } catch {
                    setItemUomRowsByItemId((prev) => ({ ...prev, [id]: [] }));
                } finally {
                    itemUomLoadingRef.current.delete(id);
                }
            })();
        }
    }, [orderItems, itemUomRowsByItemId]);

    useEffect(() => {
        const supabase = getSupabaseClient();
        if (!supabase) return;
        const ids = Array.from(new Set([
            ...orderItems.map((r) => String(r.itemId || '').trim()),
            ...receiveRows.map((r) => String((r as any)?.itemId || '').trim()),
            ...returnRows.map((r) => String((r as any)?.itemId || '').trim()),
        ].filter(Boolean)));
        const missing = ids.filter((id) => !(id in itemExpiryMetaById));
        if (!missing.length) return;

        let cancelled = false;
        void (async () => {
            try {
                const { data, error } = await supabase
                    .from('menu_items')
                    .select('id,is_food,expiry_required,category')
                    .in('id', missing);
                if (cancelled) return;
                if (error) throw error;
                const rows = Array.isArray(data) ? data : [];
                const mapped: Record<string, { isFood?: boolean; expiryRequired?: boolean; category?: string }> = {};
                for (const r of rows as any[]) {
                    const id = String((r as any)?.id || '').trim();
                    if (!id) continue;
                    mapped[id] = {
                        isFood: Boolean((r as any)?.is_food),
                        expiryRequired: Boolean((r as any)?.expiry_required),
                        category: typeof (r as any)?.category === 'string' ? String((r as any).category) : undefined,
                    };
                }
                setItemExpiryMetaById((prev) => ({ ...prev, ...mapped }));
            } catch {
                const fallback: Record<string, { isFood?: boolean; expiryRequired?: boolean; category?: string }> = {};
                for (const id of missing) fallback[id] = {};
                setItemExpiryMetaById((prev) => ({ ...prev, ...fallback }));
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [orderItems, receiveRows, returnRows, itemExpiryMetaById]);

    useEffect(() => {
        if (!isModalOpen) return;
        poCurrencyTouchedRef.current = false;
        poCurrencyInitRef.current = false;
    }, [isModalOpen]);

    useEffect(() => {
        if (!isModalOpen) return;
        if (poCurrencyTouchedRef.current) return;
        if (poCurrencyInitRef.current) return;
        const supplier = suppliers.find(s => s.id === supplierId);
        const preferred = String((supplier as any)?.preferredCurrency || '').trim().toUpperCase();
        const nextCurrency = preferred || baseCode || '';
        if (nextCurrency && nextCurrency !== poCurrency) {
            setPoCurrency(nextCurrency);
        }
        poCurrencyInitRef.current = true;
    }, [baseCode, isModalOpen, poCurrency, supplierId, suppliers]);

    useEffect(() => {
        if (!isModalOpen) return;
        const code = String(poCurrency || '').trim().toUpperCase();
        if (!code) return;
        if (baseCode && code === baseCode) {
            setPoFxRate(1);
            setPoFxSource('base');
            return;
        }
        const supabase = getSupabaseClient();
        if (!supabase) {
            setPoFxRate(0);
            setPoFxSource('unknown');
            return;
        }
        let cancelled = false;
        void (async () => {
            try {
                const onDate = normalizeIsoDateOnly(purchaseDate) || toDateInputValue();
                let rate = Number.NaN;
                if (cancelled) return;
                if (!Number.isFinite(rate) || rate <= 0) {
                    try {
                        const { data: v, error: fxErr } = await supabase.rpc('get_fx_rate', {
                            p_currency: code,
                            p_date: onDate,
                            p_rate_type: 'accounting',
                        });
                        if (!fxErr) {
                            const r = Number(v);
                            if (Number.isFinite(r) && r > 0) rate = r;
                        }
                    } catch {
                    }
                }
                if (cancelled) return;
                if (!Number.isFinite(rate) || rate <= 0) {
                    try {
                        const { data: v2, error: fxErr2 } = await supabase.rpc('get_fx_rate', {
                            p_currency: code,
                            p_date: onDate,
                            p_rate_type: 'operational',
                        });
                        if (!fxErr2) {
                            const r2 = Number(v2);
                            if (Number.isFinite(r2) && r2 > 0) rate = r2;
                        }
                    } catch {
                    }
                }

                if (cancelled) return;
                if (!Number.isFinite(rate) || rate <= 0) {
                    setPoFxRate(0);
                    setPoFxSource('unknown');
                    return;
                }
                setPoFxRate(rate);
                setPoFxSource('system');
            } catch {
                if (cancelled) return;
                setPoFxRate(0);
                setPoFxSource('unknown');
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [baseCode, isModalOpen, poCurrency, purchaseDate]);

    // Helper to add a new row
    const addRow = () => {
        setOrderItems([...orderItems, { itemId: '', quantity: 1, unitCost: 0, uomCode: '', uomQtyInBase: 1, productionDate: '', expiryDate: '' }]);
    };

    // Helper to update a row
    const getShelfLifeDays = (itemId: string): number | null => {
        const item = getItemById(itemId) || (menuItems || []).find((i) => i && i.id === itemId);
        const days = (item as any)?.shelf_life_days ?? (item as any)?.shelfLifeDays;
        return (typeof days === 'number' && days > 0) ? days : null;
    };
    const autoFillExpiry = (productionDate: string, itemId: string): string => {
        if (!productionDate) return '';
        const days = getShelfLifeDays(itemId);
        if (!days) return '';
        const d = new Date(productionDate);
        if (isNaN(d.getTime())) return '';
        d.setDate(d.getDate() + days);
        return d.toISOString().slice(0, 10);
    };
    const updateRow = (index: number, field: keyof OrderItemRow, value: any) => {
        const newRows = [...orderItems];
        const next = { ...newRows[index], [field]: value } as any;
        if (field === 'itemId') {
            const it = String(value || '').trim() ? getItemById(String(value || '').trim()) : undefined;
            const baseCode = String(it?.unitType || 'piece');
            next.uomCode = baseCode;
            next.uomQtyInBase = 1;
        }
        // Auto-fill expiry when production date is entered
        if (field === 'productionDate' && value) {
            const calcExpiry = autoFillExpiry(String(value), next.itemId);
            if (calcExpiry && !next.expiryDate) {
                next.expiryDate = calcExpiry;
            }
        }
        newRows[index] = next;
        setOrderItems(newRows);
    };

    // Helper to remove a row
    const removeRow = (index: number) => {
        const newRows = orderItems.filter((_, i) => i !== index);
        setOrderItems(newRows);
    };

    const calculateTotal = () => {
        return orderItems.reduce((sum, item) => sum + (Number(item.quantity) * Number(item.unitCost)), 0);
    };

    const getItemById = (id: string) => activeMenuItems.find(i => i.id === id);
    const isFoodCategoryValue = (categoryValue: unknown) => {
        const raw = String(categoryValue || '').trim();
        if (!raw) return false;
        const compact = raw
            .toLowerCase()
            .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
            .replace(/\s+/g, '')
            .replace(/[-_]/g, '');
        if (compact === 'food') return true;
        if (compact === 'grocery' || compact === 'groceries') return true;
        if (compact === 'موادغذائية') return true;
        if (compact.includes('غذ')) return true;
        if (compact.includes('food')) return true;
        if (compact.includes('grocery')) return true;
        // If key is auto-generated (cat_xxx), lookup the category name from definitions
        if (raw.startsWith('cat_')) {
            try {
                // Sync check from cached categories in the page
                const el = document.querySelector('[data-categories]');
                if (el) {
                    const cats = JSON.parse(el.getAttribute('data-categories') || '[]');
                    const cat = cats.find((c: any) => c.key === raw);
                    if (cat) return isFoodCategoryValue(cat.name?.ar || cat.name?.en || '');
                }
            } catch { }
        }
        return false;
    };
    const isFoodItem = (itemId: string) => {
        const cached = itemExpiryMetaById[String(itemId || '').trim()];
        if (cached && (cached.isFood || cached.expiryRequired)) return true;
        if (cached?.category && isFoodCategoryValue(cached.category)) return true;
        const item = getItemById(itemId) || (menuItems || []).find((i) => i && i.id === itemId);
        const flagged = Boolean((item as any)?.isFood ?? (item as any)?.is_food ?? (item as any)?.expiryRequired ?? (item as any)?.expiry_required);
        if (flagged) return true;
        if (isFoodCategoryValue((item as any)?.category ?? (item as any)?.data?.category)) return true;
        const groupKeyRaw =
            String((item as any)?.group || (item as any)?.groupKey || (item as any)?.group_key || (item as any)?.data?.group || '').trim();
        if (!groupKeyRaw) return false;
        const groupKey = groupKeyRaw.toLowerCase();
        const matches = (itemGroups || []).filter((g: any) => String(g?.key || '').trim().toLowerCase() === groupKey);
        if (matches.some((m: any) => isFoodCategoryValue(m?.categoryKey))) return true;
        if (matches.length === 1) return isFoodCategoryValue(matches[0]?.categoryKey);
        return false;
    };
    const getQuantityStep = (itemId: string) => {
        const unit = getItemById(itemId)?.unitType;
        return unit === 'kg' || unit === 'gram' ? 0.5 : 1;
    };

    const getUomOptionsForItem = (itemId: string) => {
        const it = itemId ? getItemById(itemId) : undefined;
        const baseUom = String(it?.unitType || 'piece');
        const baseLabel = (() => {
            try {
                const lbl = getUnitLabel(baseUom as any, language as any);
                return String(lbl || baseUom);
            } catch {
                return baseUom;
            }
        })();
        const baseLower = baseUom.toLowerCase();
        const options: Array<{ code: string; label: string; qtyInBase: number }> = [
            { code: baseUom, label: baseLabel, qtyInBase: 1 },
        ];
        const uomRows = itemId ? (itemUomRowsByItemId[String(itemId)] || []) : [];
        for (const u of uomRows) {
            const code = String((u as any)?.code || '').trim();
            const qtyInBase = Number((u as any)?.qtyInBase || 0) || 0;
            if (!code || qtyInBase <= 0) continue;
            const codeLower = code.toLowerCase();
            if (codeLower === baseLower) continue;
            const nameRaw = String((u as any)?.name || '').trim();
            const displayName = nameRaw || String(getUnitLabel(code as any, language as any) || code);
            const label = qtyInBase === 1 ? displayName : `${displayName} (${qtyInBase} ${baseLabel})`;
            options.push({ code, label, qtyInBase });
        }
        if (options.length === 1) {
            const packSize = Number((it as any)?.packSize || 0);
            const cartonSize = Number((it as any)?.cartonSize || 0);
            if (packSize > 0) options.push({ code: 'pack', label: `${getUnitLabel('pack' as any, language as any) || 'pack'} (${packSize} ${baseLabel})`, qtyInBase: packSize });
            if (cartonSize > 0) options.push({ code: 'carton', label: `${getUnitLabel('carton' as any, language as any) || 'carton'} (${cartonSize} ${baseLabel})`, qtyInBase: cartonSize });
        }
        return options;
    };

    const normalizeCode = (value: unknown) => String(value || '').trim();

    const findItemByCode = (codeRaw: string) => {
        const code = normalizeCode(codeRaw);
        if (!code) return null;
        const codeLower = code.toLowerCase();
        return (activeMenuItems || []).find((m) => {
            const id = String(m.id || '').trim();
            const barcode = String((m as any).barcode || '').trim();
            return id.toLowerCase() === codeLower || barcode.toLowerCase() === codeLower;
        }) || null;
    };

    const appendOrderItem = (itemId: string, quantity: number | string, unitCost: number | string) => {
        const step = getQuantityStep(itemId);
        const q = Math.max(step, Number(quantity) || 0);
        const c = Math.max(0, Number(unitCost) || 0);
        const it = getItemById(itemId);
        const baseUom = String(it?.unitType || 'piece');
        setOrderItems((prev) => {
            const idx = prev.findIndex((r) => r.itemId === itemId && Number(r.unitCost || 0) === c);
            if (idx === -1) {
                return [...prev, { itemId, quantity: q, unitCost: c, uomCode: baseUom, uomQtyInBase: 1, productionDate: '', expiryDate: '' }];
            }
            const next = [...prev];
            const row = next[idx];
            next[idx] = { ...row, quantity: Number(row.quantity || 0) + q };
            return next;
        });
    };

    const handleQuickAdd = () => {
        const item = findItemByCode(quickAddCode);
        if (!item) {
            showNotification('لم يتم العثور على صنف بهذا الباركود/الكود.', 'error');
            return;
        }
        appendOrderItem(item.id, quickAddQuantity, quickAddUnitCost);
        setQuickAddCode('');
    };

    const quickAddNameMatches = useMemo(() => {
        const needle = quickAddName.trim().toLowerCase();
        if (!needle) return [];
        const scored: Array<{ item: MenuItem; score: number }> = [];
        for (const item of activeMenuItems) {
            const ar = String(item?.name?.ar || '').toLowerCase();
            const en = String(item?.name?.en || '').toLowerCase();
            const id = String(item?.id || '').toLowerCase();
            const barcode = String((item as any)?.barcode || '').toLowerCase();
            const hay = [ar, en, id, barcode].filter(Boolean);
            const hit = hay.some((h) => h.includes(needle));
            if (!hit) continue;
            const starts = hay.some((h) => h.startsWith(needle));
            const score = (starts ? 0 : 1) + (ar.includes(needle) ? 0 : 1) + (en.includes(needle) ? 0 : 1);
            scored.push({ item, score });
        }
        scored.sort((a, b) => a.score - b.score);
        return scored.slice(0, 8).map(s => s.item);
    }, [activeMenuItems, quickAddName]);

    const handleQuickAddByName = (itemId?: string) => {
        const chosen = itemId
            ? activeMenuItems.find(i => i.id === itemId)
            : (quickAddNameMatches[0] || null);
        if (!chosen) {
            showNotification('أدخل اسم الصنف واختره من القائمة.', 'error');
            return;
        }
        appendOrderItem(chosen.id, quickAddQuantity, quickAddUnitCost);
        setQuickAddName('');
    };

    const parseBulkNumber = (value: string) => {
        const v = String(value || '').trim().replace(/,/g, '.');
        const n = Number(v);
        return Number.isFinite(n) ? n : NaN;
    };

    const handleBulkAdd = () => {
        const raw = String(bulkLinesText || '').trim();
        if (!raw) return;
        const lines = raw.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
        let added = 0;
        const missing: string[] = [];
        let invalidCount = 0;

        for (const line of lines) {
            const parts = line.split(/[\t,;|]+/g).map(p => p.trim()).filter(Boolean);
            if (parts.length < 2) {
                invalidCount += 1;
                continue;
            }
            const code = parts[0];
            const quantity = parseBulkNumber(parts[1]);
            const unitCost = parts.length >= 3 ? parseBulkNumber(parts[2]) : 0;
            if (!Number.isFinite(quantity) || quantity <= 0) {
                invalidCount += 1;
                continue;
            }
            if (parts.length >= 3 && (!Number.isFinite(unitCost) || unitCost < 0)) {
                invalidCount += 1;
                continue;
            }
            const item = findItemByCode(code);
            if (!item) {
                missing.push(code);
                continue;
            }
            appendOrderItem(item.id, quantity, Number.isFinite(unitCost) ? unitCost : 0);
            added += 1;
        }

        if (added > 0) showNotification(`تمت إضافة ${added} سطر من الإدخال السريع.`, 'success');
        if (missing.length > 0) {
            const sample = missing.slice(0, 6).join('، ');
            showNotification(`تعذر العثور على ${missing.length} كود: ${sample}${missing.length > 6 ? '…' : ''}`, 'info');
        }
        if (invalidCount > 0) showNotification(`تم تجاهل ${invalidCount} سطر غير صالح.`, 'info');
    };

    const lowStockSuggestions = useMemo(() => {
        try {
            return stockItems
                .filter(s => (s.availableQuantity - (s as any).reservedQuantity) <= ((s as any).lowStockThreshold ?? 5))
                .map(s => {
                    const item = getItemById(s.itemId);
                    const available = s.availableQuantity - (s as any).reservedQuantity;
                    const threshold = (s as any).lowStockThreshold ?? 5;
                    let recommended = Math.max(0, threshold - available);
                    const step = (item?.unitType === 'kg' || item?.unitType === 'gram') ? 0.5 : 1;
                    if (step === 0.5) {
                        recommended = Math.max(step, Math.round(recommended / step) * step);
                    } else {
                        recommended = Math.max(step, Math.ceil(recommended));
                    }
                    return { item, available, threshold, recommended, step };
                })
                .filter(s => s.item)
                .slice(0, 8);
        } catch {
            return [];
        }
    }, [stockItems, menuItems]);

    const addRowForItem = (itemId: string, qty: number) => {
        const step = getQuantityStep(itemId);
        const quantity = Math.max(step, qty || step);
        const it = getItemById(itemId);
        const baseUom = String(it?.unitType || 'piece');
        setOrderItems(prev => [...prev, { itemId, quantity, unitCost: 0, uomCode: baseUom, uomQtyInBase: 1, productionDate: '', expiryDate: '' }]);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            const invoiceRef = typeof supplierInvoiceNumber === 'string' ? supplierInvoiceNumber.trim() : '';
            const termsAtSubmit = paymentTerms;
            const errors: string[] = [];
            if (!supplierId) errors.push('المورد مطلوب');
            if (!purchaseDate) errors.push('تاريخ الشراء مطلوب');
            if (!warehouseId) errors.push('المستودع مطلوب');
            const normalizedPoCurrency = String(poCurrency || '').trim().toUpperCase();
            const normalizedBase = String(baseCode || '').trim().toUpperCase();
            if (!normalizedPoCurrency) errors.push('عملة أمر الشراء مطلوبة');
            if (!Number.isFinite(Number(poFxRate)) || Number(poFxRate) <= 0) errors.push('سعر الصرف مطلوب ويجب أن يكون أكبر من صفر');
            if (normalizedPoCurrency && normalizedBase && normalizedBase !== '—' && normalizedPoCurrency !== normalizedBase && poFxSource === 'unknown') {
                errors.push('لا يوجد سعر صرف لهذه العملة في النظام لهذا التاريخ. الرجاء إضافة السعر من شاشة أسعار الصرف، فالإدخال اليدوي غير مسموح.');
            }
            if (paymentTerms === 'credit' && !dueDate) errors.push('تاريخ الاستحقاق مطلوب للفواتير الآجلة');
            if (orderItems.length === 0) errors.push('أضف صنف واحد على الأقل');
            const normalizedItems = orderItems.map((row) => ({
                ...row,
                productionDate: normalizeIsoDateOnly(row.productionDate || ''),
                expiryDate: normalizeIsoDateOnly(row.expiryDate || ''),
            }));
            let submitExpiryMetaById = itemExpiryMetaById;
            if (receiveOnCreate) {
                const supabase = getSupabaseClient();
                const ids = Array.from(new Set(normalizedItems.map((r) => String(r.itemId || '').trim()).filter(Boolean)));
                const missing = ids.filter((id) => !(id in submitExpiryMetaById));
                if (supabase && missing.length > 0) {
                    try {
                        const { data, error } = await supabase
                            .from('menu_items')
                            .select('id,is_food,expiry_required,category')
                            .in('id', missing);
                        if (!error) {
                            const rows = Array.isArray(data) ? data : [];
                            const mapped: Record<string, { isFood?: boolean; expiryRequired?: boolean; category?: string }> = {};
                            for (const r of rows as any[]) {
                                const id = String((r as any)?.id || '').trim();
                                if (!id) continue;
                                mapped[id] = {
                                    isFood: Boolean((r as any)?.is_food),
                                    expiryRequired: Boolean((r as any)?.expiry_required),
                                    category: typeof (r as any)?.category === 'string' ? String((r as any).category) : undefined,
                                };
                            }
                            submitExpiryMetaById = { ...submitExpiryMetaById, ...mapped };
                            setItemExpiryMetaById((prev) => ({ ...prev, ...mapped }));
                        }
                    } catch {
                    }
                }
            }
            normalizedItems.forEach((row, idx) => {
                const rowNo = idx + 1;
                if (!row.itemId) errors.push(`سطر ${rowNo}: الصنف مطلوب`);
                if (!Number.isFinite(Number(row.quantity)) || Number(row.quantity) <= 0) errors.push(`سطر ${rowNo}: الكمية مطلوبة`);
                if (!Number.isFinite(Number(row.unitCost)) || Number(row.unitCost) < 0) errors.push(`سطر ${rowNo}: سعر الشراء مطلوب`);
                const item = row.itemId ? getItemById(row.itemId) : null;
                const exp = typeof row.expiryDate === 'string' ? row.expiryDate.trim() : '';
                const hv = typeof row.productionDate === 'string' ? row.productionDate.trim() : '';
                const cached = submitExpiryMetaById[String(row.itemId || '').trim()];
                const expiryRequired =
                    Boolean(cached?.expiryRequired || cached?.isFood) ||
                    isFoodItem(String(row.itemId || '').trim());
                if (receiveOnCreate && expiryRequired) {
                    const nm = item ? item.name.ar : (row.itemId || `سطر ${rowNo}`);
                    if (!exp) errors.push(`سطر ${rowNo}: تاريخ الانتهاء مطلوب للصنف (${nm})`);
                    else if (!isIsoDate(exp)) errors.push(`سطر ${rowNo}: صيغة تاريخ الانتهاء غير صحيحة (YYYY-MM-DD) للصنف (${nm})`);
                }
                if (hv && !isIsoDate(hv)) {
                    const nm = item ? item.name.ar : (row.itemId || `سطر ${rowNo}`);
                    errors.push(`سطر ${rowNo}: صيغة تاريخ الإنتاج غير صحيحة (YYYY-MM-DD) للصنف (${nm})`);
                }
            });
            if (errors.length > 0) {
                setFormErrors(errors);
                return;
            }
            const validItems = normalizedItems.filter(i => i.itemId && Number(i.quantity) > 0).map(i => ({
                ...i,
                quantity: Number(i.quantity),
                unitCost: Number(i.unitCost),
                uomCode: String((i as any).uomCode || '').trim(),
                uomQtyInBase: Number((i as any).uomQtyInBase || 1) || 1,
            }));
            const createdTotalAmount = validItems.reduce((sum, it) => sum + (Number(it.quantity || 0) * Number(it.unitCost || 0)), 0);
            const createdId = await createPurchaseOrder(
                supplierId,
                purchaseDate,
                normalizedPoCurrency,
                validItems,
                receiveOnCreate,
                invoiceRef || undefined,
                warehouseId,
                termsAtSubmit,
                netDays,
                dueDate,
                poNotes.trim() || undefined
            );
            setIsModalOpen(false);
            if (termsAtSubmit === 'cash') {
                const supplierName = suppliers.find(s => s.id === supplierId)?.name || '';
                const nowIso = new Date().toISOString();
                openPaymentModal({
                    id: createdId,
                    supplierId,
                    supplierName,
                    status: 'draft',
                    referenceNumber: invoiceRef || undefined,
                    currency: normalizedPoCurrency,
                    fxRate: poFxRate,
                    totalAmount: createdTotalAmount,
                    paidAmount: 0,
                    purchaseDate,
                    itemsCount: validItems.length,
                    warehouseId,
                    paymentTerms: termsAtSubmit,
                    netDays: 0,
                    dueDate: purchaseDate,
                    createdBy: user!.id,
                    createdAt: nowIso,
                    updatedAt: nowIso,
                } as PurchaseOrder);
            }
            // Reset form
            setSupplierId('');
            setSupplierInvoiceNumber('');
            setPaymentTerms('cash');
            setPoNotes('');
            setNetDays(0);
            setDueDate(toDateInputValue());
            setOrderItems([]);
            setPoCurrency('');
            setPoFxRate(1);
            setPoFxSource('unknown');
            setFormErrors([]);
        } catch (error) {
            console.error(error);
            const message = error instanceof Error ? error.message : 'فشل إنشاء أمر الشراء.';
            try {
                const raw = String(message || '').toLowerCase();
                if (/(missing|required|الحقول المطلوبة ناقصة)/i.test(raw)) {
                    const hints: string[] = [
                        `تفاصيل الخطأ: ${message}`,
                        'تحقق من اختيار المورد',
                        'تحقق من إدخال تاريخ الشراء',
                        'تحقق من أن لكل سطر: الصنف والكمية وسعر الشراء',
                    ];
                    if (receiveOnCreate) {
                        hints.push('للأصناف الغذائية عند الاستلام الآن: تاريخ الانتهاء بصيغة YYYY-MM-DD');
                    }
                    setFormErrors(hints);
                    return;
                }
            } catch {
            }
            alert(message);
        }
    };

    const openReceiveModal = (order: PurchaseOrder) => {
        const eps = 0.000000001;
        const fullyReceived = order.status === 'completed'
            || ((order.items || []).length > 0
                && (order.items || []).every((it: any) => (Number(it?.receivedQuantity || 0) + eps) >= Number(it?.qtyBase ?? it?.quantity ?? 0)));
        if (fullyReceived) {
            showNotification('هذا الأمر مستلم بالكامل ولا توجد كميات متبقية للاستلام.', 'info');
            return;
        }
        const rows: ReceiveRow[] = (order.items || []).map((it: any) => {
            const ordered = Number(it.qtyBase ?? it.quantity ?? 0);
            const received = Number(it.receivedQuantity || 0);
            const remaining = Math.max(0, ordered - received);
            const base = getItemById(it.itemId);
            const isFood = isFoodItem(it.itemId);
            return {
                itemId: it.itemId,
                itemName: it.itemName || it.itemId,
                ordered,
                received,
                remaining,
                receiveNow: remaining,
                uomCode: String(base?.unitType || 'piece'),
                productionDate: isFood ? (base?.productionDate || (base as any)?.harvestDate || '') : '',
                expiryDate: isFood ? (base?.expiryDate || '') : '',
                transportCost: Number(base?.transportCost || 0),
                supplyTaxCost: Number(base?.supplyTaxCost || 0),
            };
        });
        setReceiveOrder(order);
        setReceiveRows(rows);
        setReceiveOccurredAt(toDateTimeLocalInputValue());
        setReceiveShipmentId('');
        setReceiveShipments([]);
        setIsReceiveModalOpen(true);
        void (async () => {
            const supabase = getSupabaseClient();
            const wid = String(order.warehouseId || '').trim();
            if (!supabase || !wid) return;
            setReceiveShipmentsLoading(true);
            try {
                let linkedShipments: Array<any> = [];
                try {
                    const { data: links, error: lErr } = await supabase
                        .from('import_shipment_purchase_orders')
                        .select('shipment_id, shipment:import_shipments(id,reference_number,status,destination_warehouse_id)')
                        .eq('purchase_order_id', order.id);
                    if (!lErr) {
                        linkedShipments = (Array.isArray(links) ? links : [])
                            .map((r: any) => r?.shipment)
                            .filter((s: any) => s && String(s.destination_warehouse_id || '') === wid && String(s.status || '') !== 'cancelled' && String(s.status || '') !== 'closed');
                    }
                } catch {
                    linkedShipments = [];
                }

                const { data, error } = await supabase
                    .from('import_shipments')
                    .select('id,reference_number,status,destination_warehouse_id')
                    .eq('destination_warehouse_id', wid)
                    .not('status', 'in', '("cancelled","closed")')
                    .order('created_at', { ascending: false })
                    .limit(50);
                if (error) return;
                const rows = Array.isArray(data) ? data : [];
                const seen = new Set<string>();
                const merged: Array<any> = [];
                for (const s of linkedShipments) {
                    const sid = String(s?.id || '');
                    if (!sid || seen.has(sid)) continue;
                    seen.add(sid);
                    merged.push({ ...s, __poLinked: true });
                }
                for (const s of rows) {
                    const sid = String((s as any)?.id || '');
                    if (!sid || seen.has(sid)) continue;
                    seen.add(sid);
                    merged.push({ ...(s as any), __poLinked: false });
                }
                const list = merged.map((r: any) => ({
                    id: String(r.id),
                    referenceNumber: String(r.reference_number || r.id),
                    status: String(r.status || ''),
                    poLinked: Boolean(r.__poLinked),
                })).filter(x => x.id);
                setReceiveShipments(list);
                const preferred = list.filter((s: any) => Boolean(s.poLinked));
                if (preferred.length === 1) setReceiveShipmentId(String(preferred[0].id));
            } finally {
                setReceiveShipmentsLoading(false);
            }
        })();
    };

    useEffect(() => {
        const params = new URLSearchParams(String(location.search || ''));
        const focusPoId = String(params.get('focusPoId') || '').trim();
        if (!focusPoId) {
            setFocusedPoId('');
            focusedPoScrolledRef.current = '';
            return;
        }
        setFocusedPoId(focusPoId);
    }, [location.search]);

    useEffect(() => {
        const id = String(focusedPoId || '').trim();
        if (!id) return;
        if (focusedPoScrolledRef.current === id) return;
        const exists = (purchaseOrders || []).some((o: any) => String(o?.id || '') === id);
        if (!exists) return;
        focusedPoScrolledRef.current = id;
        const el = document.getElementById(`po-${id}`);
        if (el && typeof (el as any).scrollIntoView === 'function') {
            (el as any).scrollIntoView({ block: 'center', behavior: 'smooth' });
        }
    }, [focusedPoId, purchaseOrders]);

    const showCreateDates = useMemo(() => {
        if (!receiveOnCreate) return false;
        return orderItems.some((r) => r.itemId && isFoodItem(r.itemId));
    }, [isFoodItem, orderItems, receiveOnCreate]);

    const showReceiveDates = useMemo(() => {
        return receiveRows.some((r) => r.itemId && isFoodItem(r.itemId));
    }, [isFoodItem, receiveRows]);

    const updateReceiveRow = (index: number, value: number | string) => {
        const next = [...receiveRows];
        const row = next[index];
        let nextVal = value;
        const num = Number(value);
        if (Number.isFinite(num)) {
            if (num > row.remaining) nextVal = row.remaining;
            else if (num < 0) nextVal = 0;
        }
        next[index] = { ...row, receiveNow: nextVal };
        setReceiveRows(next);
    };
    const updateReceiveProduction = (index: number, value: string) => {
        const next = [...receiveRows];
        const row = next[index];
        const updated = { ...row, productionDate: value || '' };
        // Auto-fill expiry date from shelf_life_days if not already set
        if (value && row.itemId) {
            const calcExpiry = autoFillExpiry(value, row.itemId);
            if (calcExpiry && !row.expiryDate) {
                updated.expiryDate = calcExpiry;
            }
        }
        next[index] = updated;
        setReceiveRows(next);
    };
    const updateReceiveExpiry = (index: number, value: string) => {
        const next = [...receiveRows];
        next[index] = { ...next[index], expiryDate: value || '' };
        setReceiveRows(next);
    };
    const updateReceiveTransport = (index: number, value: number | string) => {
        const next = [...receiveRows];
        next[index] = { ...next[index], transportCost: value };
        setReceiveRows(next);
    };
    const updateReceiveSupplyTax = (index: number, value: number | string) => {
        const next = [...receiveRows];
        next[index] = { ...next[index], supplyTaxCost: value };
        setReceiveRows(next);
    };

    const handleReceivePartial = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!receiveOrder) return;
        if (isReceivingPartial) return;
        setIsReceivingPartial(true);
        try {
            if (receiveShipmentId) {
                const supabase = getSupabaseClient();
                if (supabase) {
                    const shipmentId = String(receiveShipmentId).trim();
                    const { count: totalLinks } = await supabase
                        .from('import_shipment_purchase_orders')
                        .select('shipment_id', { count: 'exact', head: true })
                        .eq('shipment_id', shipmentId);
                    if (Number(totalLinks || 0) > 0) {
                        const { data: poLink } = await supabase
                            .from('import_shipment_purchase_orders')
                            .select('shipment_id')
                            .eq('shipment_id', shipmentId)
                            .eq('purchase_order_id', receiveOrder.id)
                            .maybeSingle();
                        if (!poLink) {
                            showNotification('هذه الشحنة مقيدة بأوامر شراء أخرى. اربط أمر الشراء بالشحنة أولاً من زر (شحنة) ثم أعد الاستلام.', 'error');
                            return;
                        }
                    }
                }
            }
            const normalizedRows = receiveRows.map((r) => ({
                ...r,
                productionDate: normalizeIsoDateOnly(r.productionDate || ''),
                expiryDate: normalizeIsoDateOnly(r.expiryDate || ''),
            }));
            for (const r of normalizedRows) {
                if (Number(r.receiveNow) <= 0) continue;
                const item = getItemById(r.itemId);
                const isFood = isFoodItem(r.itemId);
                if (item && isFood) {
                    // Mandatory production date for food items
                    const prod = typeof r.productionDate === 'string' ? r.productionDate.trim() : '';
                    if (!prod) {
                        const nm = String(item?.name?.ar || item?.name?.en || r.itemName || r.itemId);
                        alert(`يرجى إدخال تاريخ الإنتاج للصنف الغذائي: ${nm}`);
                        return;
                    }
                    const exp = typeof r.expiryDate === 'string' ? r.expiryDate.trim() : '';
                    if (!exp) {
                        const nm = String(item?.name?.ar || item?.name?.en || r.itemName || r.itemId);
                        alert(`يرجى إدخال تاريخ الانتهاء للصنف الغذائي: ${nm}`);
                        return;
                    }
                    if (!isIsoDate(exp)) {
                        const nm = String(item?.name?.ar || item?.name?.en || r.itemName || r.itemId);
                        alert(`صيغة تاريخ الانتهاء غير صحيحة (YYYY-MM-DD) للصنف: ${nm}`);
                        return;
                    }
                }
                const hv = typeof r.productionDate === 'string' ? r.productionDate.trim() : '';
                if (hv && !isIsoDate(hv)) {
                    const nm = item ? (item.name?.ar || item.name?.en || r.itemName || r.itemId) : (r.itemName || r.itemId);
                    alert(`صيغة تاريخ الإنتاج غير صحيحة (YYYY-MM-DD) للصنف: ${nm}`);
                    return;
                }
            }
            const items = normalizedRows
                .filter(r => Number(r.receiveNow) > 0)
                .map(r => ({
                    itemId: r.itemId,
                    quantity: Number(r.receiveNow),
                    uomCode: String((r as any).uomCode || '').trim().toLowerCase() || undefined,
                    productionDate: r.productionDate || undefined,
                    expiryDate: r.expiryDate || undefined,
                    transportCost: Number(r.transportCost || 0),
                    supplyTaxCost: Number(r.supplyTaxCost || 0),
                    importShipmentId: receiveShipmentId ? receiveShipmentId : undefined,
                }));
            if (items.length === 0) {
                alert('الرجاء إدخال كمية للاستلام.');
                return;
            }
            const receiptId = await receivePurchaseOrderPartial(receiveOrder.id, items, receiveOccurredAt);
            if (receiptId) {
                const ok = window.confirm('تم الاستلام بنجاح. هل تريد طباعة إشعار الاستلام (GRN) الآن؟');
                if (ok) {
                    try {
                        await handlePrintGrn(String(receiptId), receiveOrder);
                    } catch (e2) {
                        alert(getErrorMessage(e2, 'تعذر طباعة إشعار الاستلام.'));
                    }
                }
                if (hasPermission('accounting.manage')) {
                    const doPost = window.confirm('هل تريد ترحيل القيود المحاسبية لهذا الاستلام الآن؟');
                    if (doPost) {
                        try {
                            const supabase = getSupabaseClient();
                            if (supabase) {
                                const res = await supabase.rpc('post_purchase_receipt', { p_receipt_id: String(receiptId) } as any);
                                if ((res as any)?.error) throw (res as any).error;
                                const st = String((res as any)?.data?.status || '');
                                if (st === 'failed') {
                                    const details = String((res as any)?.data?.error || '');
                                    alert(`فشل ترحيل القيود:\n${details || 'غير معروف'}`);
                                } else {
                                    showNotification('تم ترحيل القيود المحاسبية للاستلام.', 'success');
                                    await fetchPurchaseOrders();
                                }
                            }
                        } catch (e3) {
                            alert(getErrorMessage(e3, localizeSupabaseError(e3)));
                        }
                    }
                } else {
                    showNotification('تم تسجيل الاستلام. ترحيل القيود المحاسبية قد يكون معلقاً حسب الصلاحيات.', 'info');
                }
            }
            setIsReceiveModalOpen(false);
            setReceiveOrder(null);
            setReceiveRows([]);
        } catch (error) {
            console.error(error);
            alert(getErrorMessage(error, 'فشل استلام المخزون.'));
        } finally {
            setIsReceivingPartial(false);
        }
    };

    const openReturnModal = async (order: PurchaseOrder) => {
        const receivedSummary = await getPurchaseReceivedSummary(order.id);
        const summary = await getPurchaseReturnSummary(order.id);
        const rows: ReceiveRow[] = (order.items || []).map((it: any) => {
            const ordered = Number(it.qtyBase ?? it.quantity ?? 0);
            const received = Number(receivedSummary[it.itemId] ?? it.receivedQuantity ?? 0);
            const prev = Number(summary[it.itemId] || 0);
            const remaining = Math.max(0, received - prev);
            const stock = stockItems.find(s => s.itemId === it.itemId);
            const available = stock ? Math.max(0, (stock as any).availableQuantity - (stock as any).reservedQuantity) : 0;
            const base = getItemById(it.itemId);
            const baseUom = String(base?.unitType || 'piece');
            return {
                itemId: it.itemId,
                itemName: it.itemName || it.itemId,
                ordered,
                received,
                previousReturned: prev,
                remaining,
                receiveNow: remaining > 0 ? 0 : 0,
                available,
                uomCode: baseUom,
                uomQtyInBase: 1,
            };
        });
        setReturnOrder(order);
        setReturnRows(rows);
        setReturnOccurredAt(toDateTimeLocalInputValue());
        setReturnReason('');
        setIsReturnModalOpen(true);
    };

    const updateReturnRow = (index: number, value: number | string) => {
        const next = [...returnRows];
        const row = next[index];
        let nextVal = value;
        const num = Number(value);
        if (Number.isFinite(num)) {
            const qtyInBase = Math.max(1, Number((row as any).uomQtyInBase || 1) || 1);
            const maxBase = Math.max(0, Math.min(Number(row.remaining || 0), Number(row.available || 0) || 0));
            const maxUom = qtyInBase > 0 ? (maxBase / qtyInBase) : 0;
            if (num > maxUom) nextVal = maxUom;
            else if (num < 0) nextVal = 0;
        }
        next[index] = { ...row, receiveNow: nextVal };
        setReturnRows(next);
    };

    const updateReturnUom = (index: number, code: string) => {
        const next = [...returnRows];
        const row = next[index];
        const options = getUomOptionsForItem(row.itemId);
        const found = options.find(o => o.code === code) || options[0];
        const qtyInBase = Math.max(1, Number(found?.qtyInBase || 1) || 1);
        const num = Number(row.receiveNow);
        const maxBase = Math.max(0, Math.min(Number(row.remaining || 0), Number(row.available || 0) || 0));
        const maxUom = qtyInBase > 0 ? (maxBase / qtyInBase) : 0;
        const nextReceiveNow = Number.isFinite(num) ? Math.min(Math.max(0, num), maxUom) : row.receiveNow;
        next[index] = { ...row, uomCode: found.code, uomQtyInBase: qtyInBase, receiveNow: nextReceiveNow };
        setReturnRows(next);
    };

    const handleCreateReturn = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!returnOrder) return;
        if (createReturnInFlightRef.current) return;
        createReturnInFlightRef.current = true;
        setIsCreatingReturn(true);
        try {
            const items = returnRows
                .map((r) => {
                    const qtyInBase = Math.max(1, Number((r as any).uomQtyInBase || 1) || 1);
                    const qty = Number(r.receiveNow) || 0;
                    const baseQty = qtyInBase > 0 ? (qty * qtyInBase) : 0;
                    return { itemId: r.itemId, quantity: baseQty };
                })
                .filter(r => Number(r.quantity) > 0);
            if (items.length === 0) {
                alert('الرجاء إدخال كمية للمرتجع.');
                return;
            }
            const returnId = await createPurchaseReturn(returnOrder.id, items, returnReason, returnOccurredAt);
            showNotification('تم تسجيل المرتجع بنجاح.', 'success', 3500);
            try {
                const brand = resolveBrandingForWarehouseId(returnOrder.warehouseId);
                const branchHdr = await fetchBranchHeader(scope?.branchId);
                const printedBy = (user?.fullName || user?.username || user?.email || '').trim() || null;
                await printPurchaseReturnById(returnId, { ...brand, branchName: branchHdr.branchName, branchCode: branchHdr.branchCode }, baseCode, { printedBy });
            } catch {
            }
            setIsReturnModalOpen(false);
            setReturnOrder(null);
            setReturnRows([]);
        } catch (error) {
            console.error(error);
            let message = getErrorMessage(error, 'فشل تسجيل المرتجع.');
            const lower = typeof message === 'string' ? message.toLowerCase() : '';
            if (lower.includes('return exceeds received')) {
                message = 'الكمية المرتجعة تتجاوز المستلمة لأحد الأصناف.';
            } else if (lower.includes('insufficient stock for return')) {
                message = 'المخزون الحالي لا يكفي لإتمام المرتجع لأحد الأصناف.';
            }
            alert(message);
        } finally {
            setIsCreatingReturn(false);
            createReturnInFlightRef.current = false;
        }
    };

    const availablePaymentMethods = useMemo(() => {
        const enabled = Object.entries(settings.paymentMethods || {})
            .filter(([, isEnabled]) => Boolean(isEnabled))
            .map(([key]) => key);
        return enabled;
    }, [settings.paymentMethods]);

    useEffect(() => {
        if (!canViewAccounting) return;
        if (!isPaymentModalOpen) return;
        if (accounts.length > 0) return;
        const run = async () => {
            const supabase = getSupabaseClient();
            if (!supabase) return;
            setAccountsError('');
            try {
                const { data, error } = await supabase
                    .from('chart_of_accounts')
                    .select('id,code,name,account_type,is_active')
                    .eq('is_active', true)
                    .order('code', { ascending: true });
                if (error) {
                    const { data: rpcData, error: rpcError } = await supabase.rpc('list_active_accounts');
                    if (rpcError) throw rpcError;
                    const list = Array.isArray(rpcData) ? rpcData : [];
                    setAccounts(list.map((r: any) => ({
                        id: String(r?.id || ''),
                        code: String(r?.code || ''),
                        name: String(r?.name || ''),
                        nameAr: translateAccountName(String(r?.name || '')),
                    })).filter((r: any) => Boolean(r.id)));
                    return;
                }
                const list = Array.isArray(data) ? data : [];
                setAccounts(list.map((r: any) => ({
                    id: String(r?.id || ''),
                    code: String(r?.code || ''),
                    name: String(r?.name || ''),
                    nameAr: translateAccountName(String(r?.name || '')),
                })).filter((r: any) => Boolean(r.id)));
            } catch (e) {
                setAccounts([]);
                setAccountsError(localizeSupabaseError(e));
            }
        };
        void run();
    }, [accounts.length, canViewAccounting, isPaymentModalOpen]);

    const getPaymentMethodLabel = (method: string) => {
        if (method === 'cash') return 'نقدًا';
        if (method === 'kuraimi') return 'حسابات بنكية';
        if (method === 'network') return 'حوالات';
        return method;
    };

    const availablePurchaseDestinations = useMemo(() => {
        const currency = String((paymentOrder as any)?.currency || baseCode || '').trim().toUpperCase();
        if (!currency) return [] as Array<{ id: string; code: string; name: string; nameAr: string; parentCode: string }>;
        return (accounts || [])
            .map((a: any) => {
                const code = String(a?.code || '').trim().toUpperCase();
                const parentCode = inferDestinationParentCode(code, String((a as any)?.parentCode || '')) || '';
                return { ...a, code, parentCode };
            })
            .filter((a: any) => Boolean(a.parentCode) && matchesDestinationCurrency(String(a.code || ''), String(a.name || ''), currency));
    }, [accounts, baseCode, paymentOrder]);

    const openPaymentModal = (order: PurchaseOrder) => {
        const remaining = Math.max(0, Number(order.totalAmount || 0) - Number(order.paidAmount || 0));
        setPaymentOrder(order);
        setPaymentAmount(remaining);
        const nextMethod = availablePaymentMethods.length > 0 ? availablePaymentMethods[0] : '';
        setPaymentMethod(nextMethod);
        setPaymentOccurredAt(toDateTimeLocalInputValue());
        setPaymentReferenceNumber('');
        setPaymentSenderName('');
        setPaymentSenderPhone('');
        setPaymentDeclaredAmount(remaining);
        setPaymentAmountConfirmed(false);
        setPaymentIdempotencyKey(typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
        setPaymentAdvancedAccounting(false);
        setPaymentOverrideAccountId('');
        const parentCodeFilter = nextMethod === 'kuraimi' ? '1020' : nextMethod === 'network' ? '1030' : '';
        const defaultDest = parentCodeFilter ? availablePurchaseDestinations.find(a => a.parentCode === parentCodeFilter)?.id : '';
        setPaymentDestinationAccountId(defaultDest || '');
        setIsPaymentModalOpen(true);
    };

    const handleRecordPayment = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!paymentOrder) return;
        try {
            const total = Number(paymentOrder.totalAmount || 0);
            const paid = Number(paymentOrder.paidAmount || 0);
            const remaining = Math.max(0, total - paid);
            const amount = Number(paymentAmount || 0);
            const needsReference = paymentMethod === 'kuraimi' || paymentMethod === 'network';

            if (amount <= 0) {
                alert('الرجاء إدخال مبلغ صحيح.');
                return;
            }
            if (amount > remaining + 1e-9) {
                alert('المبلغ أكبر من المتبقي على أمر الشراء.');
                return;
            }
            if (!paymentMethod || (availablePaymentMethods.length > 0 && !availablePaymentMethods.includes(paymentMethod))) {
                alert('الرجاء اختيار طريقة دفع صحيحة.');
                return;
            }
            if (needsReference) {
                const neededParent = paymentMethod === 'kuraimi' ? '1020' : '1030';
                const availableForMethod = availablePurchaseDestinations.filter(a => a.parentCode === neededParent);
                if (availableForMethod.length > 0 && !String(paymentDestinationAccountId || '').trim()) {
                    alert('يرجى اختيار الحساب البنكي / شركة الصرافة.');
                    return;
                }
                if (!paymentReferenceNumber.trim()) {
                    alert(paymentMethod === 'kuraimi' ? 'يرجى إدخال رقم الإيداع.' : 'يرجى إدخال رقم الحوالة.');
                    return;
                }
                if (!paymentSenderName.trim()) {
                    alert(paymentMethod === 'kuraimi' ? 'يرجى إدخال اسم المودِع.' : 'يرجى إدخال اسم المرسل.');
                    return;
                }
                const declared = Number(paymentDeclaredAmount) || 0;
                if (declared <= 0) {
                    alert('يرجى إدخال مبلغ العملية.');
                    return;
                }
                if (Math.abs(declared - amount) > 0.0001) {
                    alert('المبلغ المُدخل لا يطابق مبلغ الدفعة.');
                    return;
                }
                if (!paymentAmountConfirmed) {
                    alert('يرجى تأكيد مطابقة المبلغ قبل تسجيل الدفعة.');
                    return;
                }
            }

            const payloadData: Record<string, unknown> = needsReference
                ? {
                    idempotencyKey: paymentIdempotencyKey,
                    paymentProofType: 'ref_number',
                    paymentProof: paymentReferenceNumber.trim(),
                    paymentReferenceNumber: paymentReferenceNumber.trim(),
                    paymentSenderName: paymentSenderName.trim(),
                    paymentSenderPhone: paymentSenderPhone.trim() || null,
                    paymentDeclaredAmount: Number(paymentDeclaredAmount) || 0,
                    paymentAmountConfirmed: Boolean(paymentAmountConfirmed),
                    destinationAccountId: String(paymentDestinationAccountId || '').trim() || undefined,
                }
                : { idempotencyKey: paymentIdempotencyKey };

            if (paymentAdvancedAccounting && canManageAccounting) {
                const override = String(paymentOverrideAccountId || '').trim();
                if (override) payloadData.overrideAccountId = override;
            }

            const paymentId = await recordPurchaseOrderPayment(
                paymentOrder.id,
                amount,
                paymentMethod,
                paymentOccurredAt,
                payloadData
            );

            if (paymentId) {
                const ok = window.confirm('تم تسجيل الدفعة بنجاح. هل تريد طباعة سند الصرف الآن؟');
                if (ok) {
                    try {
                        const brand = resolveBrandingForWarehouseId(paymentOrder.warehouseId);
                        const branchHdr = await fetchBranchHeader(scope?.branchId);
                        await printPaymentVoucherByPaymentId(paymentId, { ...brand, branchName: branchHdr.branchName, branchCode: branchHdr.branchCode });
                    } catch (e2) {
                        alert(getErrorMessage(e2, 'تعذر طباعة سند الصرف.'));
                    }
                }
            }

            setIsPaymentModalOpen(false);
            setPaymentOrder(null);
            setPaymentAdvancedAccounting(false);
            setPaymentOverrideAccountId('');
            setPaymentDestinationAccountId('');
        } catch (error) {
            console.error(error);
            alert(getErrorMessage(error, 'فشل تسجيل الدفعة.'));
        }
    };

    if (loading) return <div className="p-8 text-center">Loading...</div>;

    return (
        <div className="p-6 max-w-7xl mx-auto">
            <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 mb-6">
                <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-l from-primary-600 to-gold-500">
                    أوامر الشراء (المخزون)
                </h1>
                <div className="flex items-center gap-2">
                    {canReconcileAll && (
                        <div className="relative">
                            <button
                                onClick={() => setIsAdvancedActionsOpen(!isAdvancedActionsOpen)}
                                className="bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200 px-3 py-2 rounded-lg flex items-center gap-2 hover:bg-gray-200 dark:hover:bg-gray-700 shadow-sm border border-gray-200 dark:border-gray-700 transition"
                            >
                                <Icons.SettingsIcon className="w-5 h-5" />
                                <span className="hidden sm:inline">إجراءات متقدمة</span>
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" /></svg>
                            </button>
                            {isAdvancedActionsOpen && (
                                <div className="absolute left-0 mt-2 w-56 bg-white dark:bg-gray-800 rounded-xl shadow-xl border border-gray-100 dark:border-gray-700 z-50 overflow-hidden animate-in fade-in slide-in-from-top-2">
                                    <div className="py-1">
                                        <button
                                            onClick={() => { setIsAdvancedActionsOpen(false); void handleReconcileAllPurchaseOrders(); }}
                                            disabled={reconcilingAll}
                                            className="w-full text-right px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700/50 disabled:opacity-50 flex items-center gap-2"
                                        >
                                            <Icons.SettingsIcon className="w-4 h-4 text-gray-400" />
                                            {reconcilingAll ? 'جاري المصالحة...' : 'مصالحة الأوامر'}
                                        </button>
                                        {canManageAccounting ? (
                                            <button
                                                onClick={() => { setIsAdvancedActionsOpen(false); void handleRepairPurchaseInJournalsFromMovements(); }}
                                                disabled={repairingPurchaseInJournals}
                                                className="w-full text-right px-4 py-2 text-sm text-purple-600 dark:text-purple-400 hover:bg-purple-50 dark:hover:bg-purple-900/20 disabled:opacity-50 flex items-center gap-2 border-t border-gray-50 dark:border-gray-700/50"
                                            >
                                                <Icons.SettingsIcon className="w-4 h-4 opacity-70" />
                                                {repairingPurchaseInJournals ? 'جاري إصلاح القيود...' : 'إصلاح قيود المشتريات'}
                                            </button>
                                        ) : null}
                                        <button
                                            onClick={() => { setIsAdvancedActionsOpen(false); void handleReportPartialPurchaseOrders(); }}
                                            disabled={reportingPartial}
                                            className="w-full text-right px-4 py-2 text-sm text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 disabled:opacity-50 flex items-center gap-2 border-t border-gray-50 dark:border-gray-700/50"
                                        >
                                            <Icons.PrinterIcon className="w-4 h-4 opacity-70" />
                                            {reportingPartial ? 'جاري إنشاء التقرير...' : 'تقرير النواقص'}
                                        </button>
                                        <button
                                            onClick={() => { setIsAdvancedActionsOpen(false); void handleFinalizeWithoutShortages(); }}
                                            disabled={finalizingNoShortages}
                                            className="w-full text-right px-4 py-2 text-sm text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 disabled:opacity-50 flex items-center gap-2"
                                        >
                                            <Icons.CheckIcon className="w-4 h-4 opacity-70" />
                                            {finalizingNoShortages ? 'جاري الإنهاء...' : 'إنهاء بدون نواقص'}
                                        </button>
                                        <button
                                            onClick={() => { setIsAdvancedActionsOpen(false); void handleForceCompleteStatusOnly(); }}
                                            disabled={forcingStatusOnly}
                                            className="w-full text-right px-4 py-2 text-sm text-orange-600 dark:text-orange-400 hover:bg-orange-50 dark:hover:bg-orange-900/20 disabled:opacity-50 flex items-center gap-2"
                                        >
                                            <Icons.CheckIcon className="w-4 h-4 opacity-70" />
                                            {forcingStatusOnly ? 'جاري الإكمال...' : 'إكمال الحالة فقط'}
                                        </button>
                                    </div>
                                </div>
                            )}
                            {isAdvancedActionsOpen && (
                                <div className="fixed inset-0 z-40" onClick={() => setIsAdvancedActionsOpen(false)}></div>
                            )}
                        </div>
                    )}
                    <button
                        onClick={() => {
                            setIsModalOpen(true);
                            setSupplierInvoiceNumber('');
                            setPoNotes('');
                            setWarehouseId(String(scope?.warehouseId || warehouses.find(w => w.isActive)?.id || ''));
                            setPurchaseDate(toDateInputValue());
                            setPaymentTerms('cash');
                            setNetDays(0);
                            setDueDate(toDateInputValue());
                            setQuickAddCode('');
                            setQuickAddQuantity(1);
                            setQuickAddUnitCost(0);
                            setBulkLinesText('');
                            setOrderItems([]);
                            addRow();
                        }}
                        className="bg-primary-500 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-primary-600 shadow-lg"
                    >
                        <Icons.PlusIcon className="w-5 h-5" />
                        <span>أمر شراء جديد</span>
                    </button>
                </div>
            </div>

            {purchasesError ? (
                <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-right text-sm text-red-700 flex items-center justify-between gap-3">
                    <div className="flex-1">{purchasesError}</div>
                    <button
                        type="button"
                        onClick={() => fetchPurchaseOrders().catch((e) => alert(getErrorMessage(e, 'فشل تحديث القائمة.')))}
                        className="px-3 py-1.5 rounded-lg bg-red-600 text-white hover:bg-red-700"
                    >
                        تحديث
                    </button>
                </div>
            ) : null}

            {/* ── Search & Filters Bar ── */}
            <div className="bg-white dark:bg-gray-800 text-sm p-4 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 mb-6 flex flex-col md:flex-row gap-4 items-center">
                <div className="relative flex-1 w-full">
                    <Icons.Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <input
                        type="text"
                        placeholder="ابحث برقم الأمر، المورد، أو فاتورة المورد..."
                        className="w-full bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg pr-10 pl-4 py-2 focus:ring-2 focus:ring-primary-500 focus:border-transparent dark:text-gray-200 transaction"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                    />
                </div>
                <div className="flex gap-3 w-full md:w-auto">
                    <select
                        className="flex-1 md:w-40 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-gray-700 dark:text-gray-300 focus:ring-2 focus:ring-primary-500"
                        value={statusFilter}
                        onChange={(e) => setStatusFilter(e.target.value)}
                    >
                        <option value="all">كل الحالات</option>
                        <option value="draft">مسودة / غير مستلم</option>
                        <option value="partial">مستلم جزئياً</option>
                        <option value="received">مستلم بالكامل</option>
                        <option value="cancelled">ملغي</option>
                    </select>
                    <select
                        className="flex-1 md:w-40 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-gray-700 dark:text-gray-300 focus:ring-2 focus:ring-primary-500"
                        value={paymentFilter}
                        onChange={(e) => setPaymentFilter(e.target.value)}
                    >
                        <option value="all">كل الدفعات</option>
                        <option value="unpaid">غير مسدد</option>
                        <option value="partial">مسدد جزئياً</option>
                        <option value="paid">مسدد بالكامل</option>
                    </select>
                </div>
            </div>

            {/* List of Orders */}
            <div className="md:hidden space-y-3">
                {filteredPurchaseOrders.length === 0 ? (
                    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-100 dark:border-gray-700 p-6 text-center text-gray-500">
                        لا توجد أوامر شراء مطابقة للبحث.
                    </div>
                ) : (
                    filteredPurchaseOrders.map((order) => {
                        const eps = 0.000000001;
                        const total = Number(order.totalAmount || 0);
                        const paid = Number(order.paidAmount || 0);
                        const remainingRaw = total - paid;
                        const remaining = Math.max(0, remainingRaw);
                        const credit = Math.max(0, -remainingRaw);
                        const currencyCode = String(order.currency || '').toUpperCase() || '—';
                        const totalQty = (order.items || []).reduce((sum: number, it: any) => sum + Number(it?.quantity || 0), 0);
                        const linesCount = Number(order.itemsCount ?? (order.items || []).length ?? 0);
                        const canPay = order.status !== 'cancelled' && remainingRaw > 0;
                        const hasReceived = order.status === 'completed'
                            || (order.items || []).some((it: any) => Number(it?.receivedQuantity || 0) > 0);
                        const fullyReceived = order.status === 'completed'
                            || ((order.items || []).length > 0
                                && (order.items || []).every((it: any) => (Number(it?.receivedQuantity || 0) + eps) >= Number(it?.qtyBase ?? it?.quantity ?? 0)));
                        const receiptPosting = receiptPostingByOrderId[order.id];
                        const isReceiptPosted = String(receiptPosting?.status || '') === 'posted';
                        const canPurge = canDelete && order.status === 'draft' && paid <= 0 && !hasReceived;
                        const canCancelOrder = canCancel && order.status === 'draft' && paid <= 0 && !hasReceived;
                        const statusClass = order.status === 'cancelled'
                            ? 'bg-rose-50 text-rose-700 border border-rose-200'
                            : fullyReceived
                                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                : hasReceived
                                    ? 'bg-amber-50 text-amber-700 border border-amber-200'
                                    : 'bg-gray-50 text-gray-700 border border-gray-200';
                        const statusLabel = order.status === 'cancelled'
                            ? 'ملغي'
                            : fullyReceived
                                ? 'مستلم بالكامل'
                                : hasReceived
                                    ? 'مستلم جزئيًا'
                                    : order.status === 'draft'
                                        ? 'مسودة'
                                        : 'غير مستلم';

                        const paymentBadge = (() => {
                            if (credit > 0) return { label: `رصيد لك: ${credit.toFixed(2)} ${currencyCode}`, className: 'bg-blue-50 text-blue-700' };
                            if (total > 0 && remainingRaw <= 0.000000001) return { label: 'مسدد بالكامل', className: 'bg-green-100 text-green-700' };
                            if (paid > 0) return { label: 'مسدد جزئياً', className: 'bg-yellow-100 text-yellow-700' };
                            return { label: 'غير مسدد', className: 'bg-gray-100 text-gray-700' };
                        })();
                        const inferredTerms: 'cash' | 'credit' = (order.paymentTerms === 'credit' || (!order.paymentTerms && remainingRaw > 0)) ? 'credit' : 'cash';
                        const termsLabel = inferredTerms === 'credit' ? 'أجل' : 'نقد';
                        const dueLabel = order.dueDate ? formatPurchaseDate(order.dueDate) : '-';

                        return (
                            <div
                                key={order.id}
                                id={`po-${order.id}`}
                                className={[
                                    'bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-100 dark:border-gray-700 p-4',
                                    focusedPoId === order.id ? 'ring-2 ring-indigo-400 border-indigo-200' : ''
                                ].join(' ')}
                            >
                                <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                        <div className="text-sm text-gray-500 dark:text-gray-400">رقم أمر الشراء</div>
                                        <div className="font-mono text-sm dark:text-gray-200 break-all">{order.poNumber || `PO-${order.id.slice(-6).toUpperCase()}`}</div>
                                        <div className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">فاتورة المورد: <span className="font-mono dark:text-gray-300">{order.referenceNumber || 'بدون'}</span></div>
                                    </div>
                                    <div className="flex flex-col items-end gap-1">
                                        <span className={['px-2 py-1 rounded-full text-xs font-bold whitespace-nowrap', statusClass].join(' ')}>
                                            {`الاستلام: ${statusLabel}`}
                                        </span>
                                        <span className={['px-2 py-1 rounded-full text-xs font-bold whitespace-nowrap', paymentBadge.className].join(' ')}>
                                            {`الدفع: ${paymentBadge.label}`}
                                        </span>
                                    </div>
                                    {order.hasReturns ? (
                                        <span className="px-2 py-1 rounded-full text-xs font-bold whitespace-nowrap bg-blue-100 text-blue-700">
                                            {returnStatusByOrderId[order.id]?.isFull ? 'مرتجع كلي' : 'مرتجع جزئي'}
                                        </span>
                                    ) : null}
                                </div>

                                <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                                    <div>
                                        <div className="text-gray-500 dark:text-gray-400">المورد</div>
                                        <div className="font-medium dark:text-white break-words">{order.supplierName || '-'}</div>
                                    </div>
                                    <div>
                                        <div className="text-gray-500 dark:text-gray-400">التاريخ</div>
                                        <div className="dark:text-gray-200">{formatPurchaseDate(order.purchaseDate)}</div>
                                    </div>
                                    <div>
                                        <div className="text-gray-500 dark:text-gray-400">النوع</div>
                                        <div className="dark:text-gray-200">{termsLabel}</div>
                                    </div>
                                    <div>
                                        <div className="text-gray-500 dark:text-gray-400">الاستحقاق</div>
                                        <div className="dark:text-gray-200">{dueLabel}</div>
                                    </div>
                                    <div>
                                        <div className="text-gray-500 dark:text-gray-400">الإجمالي</div>
                                        <CurrencyDualAmount
                                            amount={Number(total) || 0}
                                            currencyCode={String(order.currency || '').toUpperCase()}
                                            baseAmount={(order as any).baseTotal != null ? Number((order as any).baseTotal) : undefined}
                                            fxRate={(order as any).fxRate != null ? Number((order as any).fxRate) : undefined}
                                            compact
                                        />
                                    </div>
                                    <div>
                                        <div className="text-gray-500 dark:text-gray-400">المتبقي</div>
                                        <CurrencyDualAmount amount={Number(remaining) || 0} currencyCode={String(order.currency || '').toUpperCase()} compact />
                                    </div>
                                    <div>
                                        <div className="text-gray-500 dark:text-gray-400">عدد الأصناف (سطور)</div>
                                        <div className="font-mono dark:text-gray-200">{linesCount}</div>
                                    </div>
                                    <div>
                                        <div className="text-gray-500 dark:text-gray-400">إجمالي الكميات</div>
                                        <div className="font-mono dark:text-gray-200">{totalQty}</div>
                                    </div>
                                    {credit > 0 ? (
                                        <div className="col-span-2">
                                            <div className="text-gray-500 dark:text-gray-400">رصيد لك لدى المورد</div>
                                            <CurrencyDualAmount amount={Number(credit) || 0} currencyCode={String(order.currency || '').toUpperCase()} compact />
                                        </div>
                                    ) : null}
                                </div>

                                <div className="mt-4 flex flex-wrap gap-2 justify-end">
                                    <button
                                        type="button"
                                        onClick={() => openReceiveModal(order)}
                                        disabled={order.status === 'cancelled' || order.status === 'completed' || fullyReceived}
                                        className="px-3 py-2 rounded-lg text-sm font-semibold bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        {fullyReceived ? 'مستلم بالكامل' : 'استلام'}
                                    </button>
                                    {hasReceived ? (
                                        <button
                                            type="button"
                                            onClick={() => {
                                                void (async () => {
                                                    try {
                                                        const latest = await getLatestReceiptForOrder(order.id);
                                                        if (!latest?.id) {
                                                            showNotification('لا يوجد إشعار استلام مرتبط بهذا الأمر.', 'info');
                                                            return;
                                                        }
                                                        await handlePrintGrn(latest.id, order);
                                                    } catch (e) {
                                                        alert(getErrorMessage(e, 'تعذر طباعة إشعار الاستلام.'));
                                                    }
                                                })();
                                            }}
                                            className="px-3 py-2 rounded-lg text-sm font-semibold bg-gray-900 text-white hover:bg-black disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                            طباعة الاستلام
                                        </button>
                                    ) : null}
                                    {hasReceived && hasPermission('accounting.manage') ? (
                                        <button
                                            type="button"
                                            onClick={() => {
                                                void (async () => {
                                                    try {
                                                        const latest = await getLatestReceiptForOrder(order.id);
                                                        if (!latest?.id) {
                                                            showNotification('لا يوجد استلام لترحيل قيوده.', 'info');
                                                            return;
                                                        }
                                                        if (latest.postingStatus === 'posted') {
                                                            showNotification('قيود هذا الاستلام مُرحّلة بالفعل.', 'info');
                                                            return;
                                                        }
                                                        const supabase = getSupabaseClient();
                                                        if (!supabase) throw new Error('قاعدة البيانات غير متاحة.');
                                                        const { data, error } = await supabase.rpc('post_purchase_receipt', { p_receipt_id: latest.id } as any);
                                                        if (error) throw error;
                                                        const st = String((data as any)?.status || '');
                                                        if (st === 'failed') {
                                                            const details = String((data as any)?.error || latest.postingError || '');
                                                            alert(`فشل ترحيل القيود:\n${details || 'غير معروف'}`);
                                                            setReceiptPostingByOrderId((prev) => ({
                                                                ...prev,
                                                                [order.id]: { receiptId: latest.id, status: 'failed', error: details },
                                                            }));
                                                        } else {
                                                            showNotification('تم ترحيل القيود المحاسبية للاستلام.', 'success');
                                                            setReceiptPostingByOrderId((prev) => ({
                                                                ...prev,
                                                                [order.id]: { receiptId: latest.id, status: 'posted', error: '' },
                                                            }));
                                                            await fetchPurchaseOrders();
                                                        }
                                                    } catch (e) {
                                                        alert(getErrorMessage(e, localizeSupabaseError(e)));
                                                    }
                                                })();
                                            }}
                                            disabled={receiptPostingLoading || isReceiptPosted}
                                            className="px-3 py-2 rounded-lg text-sm font-semibold bg-indigo-700 text-white hover:bg-indigo-800 disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                            {isReceiptPosted ? 'تم ترحيل القيود' : 'ترحيل القيود'}
                                        </button>
                                    ) : null}
                                    {canManageImports ? (
                                        <button
                                            type="button"
                                            onClick={() => { void handleCreateOrUpdateShipmentFromOrder(order); }}
                                            disabled={shipmentFromPoBusyId === order.id || order.status === 'cancelled'}
                                            className="px-3 py-2 rounded-lg text-sm font-semibold bg-emerald-700 text-white hover:bg-emerald-800 disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                            شحنة
                                        </button>
                                    ) : null}
                                    {canRepairReceipt ? (
                                        <button
                                            type="button"
                                            onClick={() => handleRepairPurchaseOrder(order)}
                                            disabled={order.status === 'cancelled'}
                                            className="px-3 py-2 rounded-lg text-sm font-semibold bg-gray-800 text-white hover:bg-gray-900 disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                            إصلاح الاستلام
                                        </button>
                                    ) : null}
                                    <button
                                        type="button"
                                        onClick={() => openReturnModal(order)}
                                        disabled={order.status === 'cancelled'}
                                        className="px-3 py-2 rounded-lg text-sm font-semibold bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        مرتجع
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => openPaymentModal(order)}
                                        disabled={!canPay}
                                        className="px-3 py-2 rounded-lg text-sm font-semibold bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        {order.hasReturns ? 'تسجيل دفعة (بعد المرتجع)' : 'تسجيل دفعة'}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            const ref = order.poNumber || order.referenceNumber || order.id;
                                            const current = order.referenceNumber || '';
                                            const next = window.prompt(`رقم فاتورة المورد (يمكن تركه فارغًا): ${ref}`, current);
                                            if (next === null) return;
                                            updatePurchaseOrderInvoiceNumber(order.id, next)
                                                .catch((e) => alert(getErrorMessage(e, 'فشل تحديث رقم فاتورة المورد.')));
                                        }}
                                        disabled={order.status === 'cancelled'}
                                        className="px-3 py-2 rounded-lg text-sm font-semibold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        فاتورة المورد
                                    </button>
                                    {canCancelOrder ? (
                                        <button
                                            type="button"
                                            onClick={() => {
                                                const ref = order.poNumber || order.referenceNumber || order.id;
                                                const reason = window.prompt(`سبب الإلغاء (اختياري): ${ref}`) ?? '';
                                                const ok = window.confirm(`سيتم إلغاء أمر الشراء: ${ref}\nهل أنت متأكد؟`);
                                                if (!ok) return;
                                                cancelPurchaseOrder(order.id, reason)
                                                    .catch((e) => alert(getErrorMessage(e, 'فشل إلغاء أمر الشراء.')));
                                            }}
                                            className="px-3 py-2 rounded-lg text-sm font-semibold bg-orange-600 text-white hover:bg-orange-700"
                                        >
                                            إلغاء
                                        </button>
                                    ) : null}
                                    {canPurge ? (
                                        <button
                                            type="button"
                                            onClick={() => {
                                                const ref = order.poNumber || order.referenceNumber || order.id;
                                                const ok = window.confirm(`سيتم حذف أمر الشراء نهائياً: ${ref}\nهل أنت متأكد؟`);
                                                if (!ok) return;
                                                deletePurchaseOrder(order.id)
                                                    .catch((e) => alert(getErrorMessage(e, 'فشل حذف أمر الشراء.')));
                                            }}
                                            className="px-3 py-2 rounded-lg text-sm font-semibold bg-gray-900 text-white hover:bg-black"
                                        >
                                            حذف
                                        </button>
                                    ) : null}
                                </div>
                            </div>
                        );
                    })
                )}
            </div>

            <div className="hidden md:block bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-100 dark:border-gray-700 overflow-x-auto pb-48">
                <table className="min-w-[1400px] w-full text-right" style={{ borderCollapse: 'separate', borderSpacing: 0 }}>
                    <thead className="bg-gray-50 dark:bg-gray-700/50">
                        <tr>
                            <th className="p-4 text-sm font-semibold text-gray-600 dark:text-gray-300">الأمر / الفاتورة</th>
                            <th className="p-4 text-sm font-semibold text-gray-600 dark:text-gray-300">المورد</th>
                            <th className="p-4 text-sm font-semibold text-gray-600 dark:text-gray-300">المستودع</th>
                            <th className="p-4 text-sm font-semibold text-gray-600 dark:text-gray-300">النوع</th>
                            <th className="p-4 text-sm font-semibold text-gray-600 dark:text-gray-300">التاريخ / الاستحقاق</th>
                            <th className="p-4 text-sm font-semibold text-gray-600 dark:text-gray-300">الأصناف (سطور/كمية)</th>
                            <th className="p-4 text-sm font-semibold text-gray-600 dark:text-gray-300">الإجمالي</th>
                            <th className="p-4 text-sm font-semibold text-gray-600 dark:text-gray-300">المدفوع</th>
                            <th className="p-4 text-sm font-semibold text-gray-600 dark:text-gray-300">المتبقي</th>
                            <th className="p-4 text-sm font-semibold text-gray-600 dark:text-gray-300">الاستلام / الدفع</th>
                            <th className="p-4 text-sm font-semibold text-gray-600 dark:text-gray-300">إجراء</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                        {filteredPurchaseOrders.length === 0 ? (
                            <tr><td colSpan={11} className="p-8 text-center text-gray-500">لا توجد أوامر شراء مطابقة للبحث.</td></tr>
                        ) : (
                            filteredPurchaseOrders.map((order) => (
                                (() => {
                                    const eps = 0.000000001;
                                    const items = Array.isArray(order.items) ? order.items : [];
                                    const total = Number(order.totalAmount || 0);
                                    const paid = Number(order.paidAmount || 0);
                                    const remainingRaw = total - paid;
                                    const remaining = Math.max(0, remainingRaw);
                                    const credit = Math.max(0, -remainingRaw);
                                    const currencyCode = String(order.currency || '').toUpperCase() || '—';
                                    const totalQty = items.reduce((sum: number, it: any) => sum + Number(it?.quantity || 0), 0);
                                    const canPay = order.status !== 'cancelled' && remainingRaw > 0;
                                    const hasReceived = order.status === 'completed' || items.some((it: any) => Number(it?.receivedQuantity || 0) > 0);
                                    const receiptPosting = receiptPostingByOrderId[order.id];
                                    const isReceiptPosted = String(receiptPosting?.status || '') === 'posted';
                                    const fullyReceived = order.status === 'completed'
                                        || (items.length > 0 && items.every((it: any) => (Number(it?.receivedQuantity || 0) + eps) >= Number(it?.qtyBase ?? it?.quantity ?? 0)));
                                    const canPurge = canDelete && order.status === 'draft' && paid <= 0 && !hasReceived;
                                    const canCancelOrder = canCancel && order.status === 'draft' && paid <= 0 && !hasReceived;
                                    const paymentBadge = (() => {
                                        if (credit > 0) return { label: `رصيد لك: ${credit.toFixed(2)} ${currencyCode}`, className: 'bg-blue-50 text-blue-700' };
                                        if (total > 0 && remainingRaw <= 0.000000001) return { label: 'مسدد بالكامل', className: 'bg-green-100 text-green-700' };
                                        if (paid > 0) return { label: 'مسدد جزئياً', className: 'bg-yellow-100 text-yellow-700' };
                                        return { label: 'غير مسدد', className: 'bg-gray-100 text-gray-700' };
                                    })();
                                    const inferredTerms: 'cash' | 'credit' = (order.paymentTerms === 'credit' || (!order.paymentTerms && remainingRaw > 0)) ? 'credit' : 'cash';
                                    const termsLabel = inferredTerms === 'credit' ? 'أجل' : 'نقد';
                                    const dueLabel = order.dueDate ? formatPurchaseDate(order.dueDate) : '-';
                                    return (
                                        <tr
                                            key={order.id}
                                            id={`po-${order.id}`}
                                            className={[
                                                'hover:bg-gray-50 dark:hover:bg-gray-700/30',
                                                focusedPoId === order.id ? 'bg-indigo-50/60 dark:bg-indigo-900/10' : '',
                                                openRowDropdownId === order.id ? 'relative z-[999]' : 'relative z-0'
                                            ].join(' ')}
                                        >
                                            <td className="p-4">
                                                <div className="font-mono text-sm dark:text-gray-300 font-bold">{order.poNumber || `PO-${order.id.slice(-6).toUpperCase()}`}</div>
                                                <div className="text-xs text-gray-500 font-mono mt-0.5">{order.referenceNumber ? `فاتورة: ${order.referenceNumber}` : 'بلا فاتورة'}</div>
                                            </td>
                                            <td className="p-4 font-medium dark:text-white">{order.supplierName}</td>
                                            <td className="p-4 text-sm dark:text-gray-300">{order.warehouseName || '-'}</td>
                                            <td className="p-4 text-sm dark:text-gray-300">
                                                <span className={`px-2 py-1 rounded-full text-xs font-semibold ${inferredTerms === 'credit' ? 'bg-amber-100 text-amber-900 border border-amber-200' : 'bg-emerald-100 text-emerald-900 border border-emerald-200'}`}>
                                                    {termsLabel}
                                                </span>
                                            </td>
                                            <td className="p-4 text-sm dark:text-gray-300">
                                                <div>{formatPurchaseDate(order.purchaseDate)}</div>
                                                {inferredTerms === 'credit' && <div className="text-xs text-amber-600 dark:text-amber-400 mt-0.5">يُستحق: {dueLabel}</div>}
                                            </td>
                                            <td className="p-4 text-sm dark:text-gray-300 font-mono">{Number(order.itemsCount ?? 0)} / {totalQty}</td>
                                            <td className="p-4 font-bold text-primary-600 dark:text-primary-400">
                                                {(() => {
                                                    const code = currencyCode;
                                                    const fmt = (n: number) => { try { return n.toLocaleString('ar-EG-u-nu-latn', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); } catch { return n.toFixed(2); } };
                                                    const totalCur = fmt(Number(order.totalAmount || 0));
                                                    const totalBase = fmt(Number(order.baseTotal || 0));
                                                    const rate = Number(order.fxRate || 0);
                                                    return (
                                                        <div className="space-y-1">
                                                            <div>{totalCur} <span className="text-xs">{code || '—'}</span></div>
                                                            <div className="text-xs text-gray-600 dark:text-gray-300">{`FX=${rate > 0 ? rate.toFixed(6) : '—'} • ${totalBase} ${baseCode || '—'}`}</div>
                                                        </div>
                                                    );
                                                })()}
                                            </td>
                                            <td className="p-4 text-sm dark:text-gray-300">
                                                <CurrencyDualAmount amount={paid} currencyCode={currencyCode} compact />
                                            </td>
                                            <td className="p-4 text-sm dark:text-gray-300">
                                                <CurrencyDualAmount amount={remaining} currencyCode={currencyCode} compact />
                                            </td>
                                            <td className="p-4">
                                                <div className="flex flex-col items-start gap-1">
                                                    <span className={[
                                                        'px-2 py-1 rounded-full text-xs font-bold',
                                                        order.status === 'cancelled' ? 'bg-red-100 text-red-700'
                                                            : fullyReceived ? 'bg-green-100 text-green-700'
                                                                : hasReceived ? 'bg-yellow-100 text-yellow-700'
                                                                    : 'bg-gray-100 text-gray-700'
                                                    ].join(' ')}>
                                                        {order.status === 'cancelled'
                                                            ? 'الاستلام: ملغي'
                                                            : fullyReceived
                                                                ? 'الاستلام: مستلم بالكامل'
                                                                : hasReceived
                                                                    ? 'الاستلام: مستلم جزئيًا'
                                                                    : order.status === 'draft'
                                                                        ? 'الاستلام: مسودة'
                                                                        : 'الاستلام: غير مستلم'}
                                                    </span>
                                                    <span className={['px-2 py-1 rounded-full text-xs font-bold', paymentBadge.className].join(' ')}>
                                                        {`الدفع: ${paymentBadge.label}`}
                                                    </span>
                                                </div>
                                                {order.hasReturns ? (
                                                    <span className="ml-2 px-2 py-1 rounded-full text-xs font-bold bg-blue-100 text-blue-700">
                                                        {returnStatusByOrderId[order.id]?.isFull ? 'مرتجع كلي' : 'مرتجع جزئي'}
                                                    </span>
                                                ) : null}
                                            </td>
                                            <td className="p-4 relative" style={{ zIndex: openRowDropdownId === order.id ? 9999 : 0 }}>
                                                <div className="relative flex justify-end w-full">
                                                    <button
                                                        onClick={() => setOpenRowDropdownId(openRowDropdownId === order.id ? null : order.id)}
                                                        className="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                                                    >
                                                        <svg className="w-5 h-5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
                                                        </svg>
                                                    </button>

                                                    {openRowDropdownId === order.id && (
                                                        <>
                                                            <div className="fixed inset-0 z-40" onClick={() => setOpenRowDropdownId(null)}></div>
                                                            <div className="absolute left-0 top-10 mt-2 w-56 bg-white dark:bg-gray-800 rounded-xl shadow-[0_10px_40px_-10px_rgba(0,0,0,0.3)] border border-gray-200 dark:border-gray-600 z-50 py-1 origin-top-left transition-all">
                                                                <div className="px-3 py-2 text-xs font-medium text-gray-500 bg-gray-50 dark:bg-gray-900/50 uppercase tracking-wide">الإجراءات</div>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => { setOpenRowDropdownId(null); openReceiveModal(order); }}
                                                                    disabled={order.status === 'cancelled' || order.status === 'completed' || fullyReceived}
                                                                    className="w-full text-right px-4 py-2 text-sm text-green-700 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/20 disabled:opacity-50"
                                                                >
                                                                    {fullyReceived ? 'مستلم بالكامل' : 'استلام'}
                                                                </button>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => { setOpenRowDropdownId(null); openPaymentModal(order); }}
                                                                    disabled={!canPay}
                                                                    className="w-full text-right px-4 py-2 text-sm text-primary-700 dark:text-primary-400 hover:bg-primary-50 dark:hover:bg-primary-900/20 disabled:opacity-50"
                                                                >
                                                                    {order.hasReturns ? 'تسجيل دفعة (بعد المرتجع)' : 'تسجيل دفعة'}
                                                                </button>
                                                                <div className="h-px bg-gray-100 dark:bg-gray-700 my-1"></div>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => { setOpenRowDropdownId(null); void handlePrintPo(order); }}
                                                                    disabled={order.status === 'cancelled'}
                                                                    className="w-full text-right px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/50 disabled:opacity-50"
                                                                >
                                                                    طباعة PO
                                                                </button>
                                                                {hasReceived && (
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => {
                                                                            setOpenRowDropdownId(null);
                                                                            void (async () => {
                                                                                try {
                                                                                    const latest = await getLatestReceiptForOrder(order.id);
                                                                                    if (!latest?.id) return showNotification('لا يوجد إشعار استلام مرتبط بهذا الأمر.', 'info');
                                                                                    await handlePrintGrn(latest.id, order);
                                                                                } catch (e) { alert(getErrorMessage(e, 'تعذر طباعة إشعار الاستلام.')); }
                                                                            })();
                                                                        }}
                                                                        className="w-full text-right px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/50 disabled:opacity-50"
                                                                    >
                                                                        طباعة الاستلام
                                                                    </button>
                                                                )}
                                                                {hasReceived && hasPermission('accounting.manage') && (
                                                                    <button
                                                                        type="button"
                                                                        disabled={receiptPostingLoading || isReceiptPosted}
                                                                        onClick={() => {
                                                                            setOpenRowDropdownId(null);
                                                                            void (async () => {
                                                                                try {
                                                                                    const latest = await getLatestReceiptForOrder(order.id);
                                                                                    if (!latest?.id) return showNotification('لا يوجد استلام لترحيل قيوده.', 'info');
                                                                                    if (latest.postingStatus === 'posted') return showNotification('قيود هذا الاستلام مُرحّلة بالفعل.', 'info');
                                                                                    const supabase = getSupabaseClient();
                                                                                    if (!supabase) throw new Error('قاعدة البيانات غير متاحة.');
                                                                                    const { data, error } = await supabase.rpc('post_purchase_receipt', { p_receipt_id: latest.id } as any);
                                                                                    if (error) throw error;
                                                                                    const st = String((data as any)?.status || '');
                                                                                    if (st === 'failed') {
                                                                                        const details = String((data as any)?.error || latest.postingError || '');
                                                                                        alert(`فشل ترحيل القيود:\n${details || 'غير معروف'}`);
                                                                                        setReceiptPostingByOrderId((prev) => ({ ...prev, [order.id]: { receiptId: latest.id, status: 'failed', error: details } }));
                                                                                    } else {
                                                                                        showNotification('تم ترحيل القيود المحاسبية للاستلام.', 'success');
                                                                                        setReceiptPostingByOrderId((prev) => ({ ...prev, [order.id]: { receiptId: latest.id, status: 'posted', error: '' } }));
                                                                                        await fetchPurchaseOrders();
                                                                                    }
                                                                                } catch (e) { alert(getErrorMessage(e, localizeSupabaseError(e))); }
                                                                            })();
                                                                        }}
                                                                        className="w-full text-right px-4 py-2 text-sm text-indigo-700 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 disabled:opacity-50"
                                                                    >
                                                                        {isReceiptPosted ? 'تم ترحيل القيود' : 'ترحيل القيود'}
                                                                    </button>
                                                                )}
                                                                <button
                                                                    type="button"
                                                                    onClick={() => { setOpenRowDropdownId(null); openReturnModal(order); }}
                                                                    disabled={order.status === 'cancelled'}
                                                                    className="w-full text-right px-4 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50"
                                                                >
                                                                    مرتجع
                                                                </button>
                                                                {order.hasReturns && (
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => {
                                                                            setOpenRowDropdownId(null);
                                                                            void (async () => {
                                                                                try {
                                                                                    await openReturnPrintPicker(order);
                                                                                } catch (e) {
                                                                                    alert(getErrorMessage(e, 'تعذر جلب سندات مرتجع المشتريات.'));
                                                                                }
                                                                            })();
                                                                        }}
                                                                        className="w-full text-right px-4 py-2 text-sm text-rose-700 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-900/20 disabled:opacity-50"
                                                                    >
                                                                        طباعة سند مرتجع
                                                                    </button>
                                                                )}
                                                                {canManageImports && (
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => { setOpenRowDropdownId(null); void handleCreateOrUpdateShipmentFromOrder(order); }}
                                                                        disabled={shipmentFromPoBusyId === order.id || order.status === 'cancelled'}
                                                                        className="w-full text-right px-4 py-2 text-sm text-teal-600 dark:text-teal-400 hover:bg-teal-50 dark:hover:bg-teal-900/20 disabled:opacity-50"
                                                                    >
                                                                        شحنة
                                                                    </button>
                                                                )}
                                                                <div className="h-px bg-gray-100 dark:bg-gray-700 my-1"></div>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => {
                                                                        setOpenRowDropdownId(null);
                                                                        const ref = order.poNumber || order.referenceNumber || order.id;
                                                                        const next = window.prompt(`رقم فاتورة المورد (يمكن تركه فارغًا): ${ref}`, order.referenceNumber || '');
                                                                        if (next === null) return;
                                                                        updatePurchaseOrderInvoiceNumber(order.id, next).catch((e) => alert(getErrorMessage(e, 'فشل تحديث رقم فاتورة المورد.')));
                                                                    }}
                                                                    disabled={order.status === 'cancelled'}
                                                                    className="w-full text-right px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/50 disabled:opacity-50"
                                                                >
                                                                    تعديل رقم الفاتورة
                                                                </button>
                                                                {canCancelOrder && (
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => {
                                                                            setOpenRowDropdownId(null);
                                                                            const ref = order.poNumber || order.referenceNumber || order.id;
                                                                            const reason = window.prompt(`سبب الإلغاء (اختياري): ${ref}`) ?? '';
                                                                            if (!window.confirm(`سيتم إلغاء أمر الشراء: ${ref}\nهل أنت متأكد؟`)) return;
                                                                            cancelPurchaseOrder(order.id, reason).catch((e) => alert(getErrorMessage(e, 'فشل إلغاء أمر الشراء.')));
                                                                        }}
                                                                        className="w-full text-right px-4 py-2 text-sm text-orange-600 dark:text-orange-400 hover:bg-orange-50 dark:hover:bg-orange-900/20"
                                                                    >
                                                                        إلغاء الأمر
                                                                    </button>
                                                                )}
                                                                {canPurge && (
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => {
                                                                            setOpenRowDropdownId(null);
                                                                            const ref = order.poNumber || order.referenceNumber || order.id;
                                                                            if (!window.confirm(`سيتم حذف أمر الشراء نهائياً: ${ref}\nهل أنت متأكد؟`)) return;
                                                                            deletePurchaseOrder(order.id).catch((e) => alert(getErrorMessage(e, 'فشل حذف أمر الشراء.')));
                                                                        }}
                                                                        className="w-full text-right px-4 py-2 text-sm font-semibold text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-900/20"
                                                                    >
                                                                        حذف نهائي
                                                                    </button>
                                                                )}
                                                                {canRepairReceipt && (
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => { setOpenRowDropdownId(null); handleRepairPurchaseOrder(order); }}
                                                                        disabled={order.status === 'cancelled'}
                                                                        className="w-full text-right px-4 py-2 text-sm text-purple-600 dark:text-purple-400 hover:bg-purple-50 dark:hover:bg-purple-900/20 border-t border-gray-100 dark:border-gray-700"
                                                                    >
                                                                        إصلاح الاستلام
                                                                    </button>
                                                                )}
                                                            </div>
                                                        </>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })()
                            ))
                        )}
                    </tbody>
                </table>
            </div>

            {/* Create Modal */}
            {isModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                    <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-4xl max-h-[min(90dvh,calc(100dvh-2rem))] overflow-hidden flex flex-col animate-in fade-in zoom-in duration-200">
                        <div className="p-4 bg-gray-50 dark:bg-gray-700/50 border-b dark:border-gray-700 flex justify-between items-center flex-shrink-0">
                            <h2 className="text-xl font-bold dark:text-white">إضافة أمر شراء / استلام مخزون</h2>
                            <button onClick={() => setIsModalOpen(false)} className="p-1 rounded-full hover:bg-gray-200 dark:hover:bg-gray-600"><Icons.XIcon className="w-6 h-6" /></button>
                        </div>

                        <form onSubmit={handleSubmit} className="flex-1 flex flex-col overflow-hidden">
                            <div className="p-6 overflow-y-auto flex-1 space-y-6">
                                {formErrors.length > 0 && (
                                    <div className="sticky top-0 z-10 mb-2 rounded-lg border border-red-200 bg-red-50 p-3 text-right text-sm text-red-700">
                                        <div className="font-semibold mb-1">يرجى تصحيح العناصر التالية:</div>
                                        <ul className="space-y-1 list-disc pr-5">
                                            {formErrors.slice(0, 12).map((msg, i) => (
                                                <li key={i}>{msg}</li>
                                            ))}
                                        </ul>
                                        {formErrors.length > 12 ? (
                                            <div className="mt-1">+ {formErrors.length - 12} أخرى</div>
                                        ) : null}
                                    </div>
                                )}
                                {/* Header Info */}
                                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                                    <div>
                                        <label className="block text-sm font-medium mb-1 dark:text-gray-300">المورد</label>
                                        <select
                                            className="w-full p-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                                            value={supplierId}
                                            required
                                            onChange={(e) => setSupplierId(e.target.value)}
                                        >
                                            <option value="">اختر المورد...</option>
                                            {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium mb-1 dark:text-gray-300">المستودع</label>
                                        <select
                                            className="w-full p-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                                            value={warehouseId}
                                            required
                                            onChange={(e) => setWarehouseId(e.target.value)}
                                        >
                                            <option value="">اختر المستودع...</option>
                                            {warehouses.filter(w => w.isActive).map(w => (
                                                <option key={w.id} value={w.id}>{w.name}</option>
                                            ))}
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium mb-1 dark:text-gray-300">تاريخ الشراء</label>
                                        <input
                                            type="date"
                                            className="w-full p-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                                            value={purchaseDate}
                                            required
                                            onChange={(e) => {
                                                const next = e.target.value;
                                                setPurchaseDate(next);
                                                const base = normalizeIsoDateOnly(next) || toDateInputValue();
                                                if (paymentTerms === 'credit') {
                                                    setDueDate(addDaysToYmd(base, netDays));
                                                } else {
                                                    setDueDate(base);
                                                }
                                            }}
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium mb-1 dark:text-gray-300">رقم فاتورة المورد (اختياري)</label>
                                        <input
                                            type="text"
                                            className="w-full p-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                                            value={supplierInvoiceNumber}
                                            placeholder="يمكن إدخاله لاحقًا"
                                            onChange={(e) => setSupplierInvoiceNumber(e.target.value)}
                                        />
                                    </div>
                                    <div className="md:col-span-2">
                                        <label className="block text-sm font-medium mb-1 dark:text-gray-300">ملاحظات / بيان الفاتورة (اختياري)</label>
                                        <textarea
                                            className="w-full p-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 dark:text-white resize-none"
                                            rows={2}
                                            value={poNotes}
                                            placeholder="أضف ملاحظات أو بيان يظهر في الفاتورة المطبوعة..."
                                            onChange={(e) => setPoNotes(e.target.value)}
                                        />
                                    </div>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                    <div>
                                        <label className="block text-sm font-medium mb-1 dark:text-gray-300">نوع الفاتورة</label>
                                        <select
                                            className="w-full p-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                                            value={paymentTerms}
                                            onChange={(e) => {
                                                const next = (e.target.value === 'credit' ? 'credit' : 'cash') as 'cash' | 'credit';
                                                setPaymentTerms(next);
                                                const base = normalizeIsoDateOnly(purchaseDate) || toDateInputValue();
                                                if (next === 'credit') {
                                                    const days = Math.max(0, Number(netDays) || 0) || 30;
                                                    setNetDays(days);
                                                    setDueDate(addDaysToYmd(base, days));
                                                } else {
                                                    setNetDays(0);
                                                    setDueDate(base);
                                                }
                                            }}
                                        >
                                            <option value="cash">نقد</option>
                                            <option value="credit">أجل</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium mb-1 dark:text-gray-300">عدد أيام الأجل</label>
                                        <input
                                            type="number"
                                            min={0}
                                            className="w-full p-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                                            value={paymentTerms === 'credit' ? netDays : 0}
                                            disabled={paymentTerms !== 'credit'}
                                            onChange={(e) => {
                                                const days = Math.max(0, Number(e.target.value) || 0);
                                                setNetDays(days);
                                                const base = normalizeIsoDateOnly(purchaseDate) || toDateInputValue();
                                                setDueDate(addDaysToYmd(base, days));
                                            }}
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium mb-1 dark:text-gray-300">تاريخ الاستحقاق</label>
                                        <input
                                            type="date"
                                            className="w-full p-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                                            value={dueDate}
                                            disabled={paymentTerms !== 'credit'}
                                            onChange={(e) => setDueDate(e.target.value)}
                                        />
                                    </div>
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                                    <div>
                                        <label className="block text-sm font-medium mb-1 dark:text-gray-300">عملة أمر الشراء</label>
                                        <select
                                            className="w-full p-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 dark:text-white font-mono"
                                            value={poCurrency}
                                            required
                                            onChange={(e) => {
                                                const code = String(e.target.value || '').trim().toUpperCase();
                                                poCurrencyTouchedRef.current = true;
                                                setPoCurrency(code);
                                                setPoFxRate(0);
                                                setPoFxSource('unknown');
                                                if (baseCode && code === baseCode) {
                                                    setPoFxRate(1);
                                                    setPoFxSource('base');
                                                }
                                            }}
                                        >
                                            <option value="">اختر عملة...</option>
                                            {(currencyOptions.length ? currencyOptions : [baseCode]).map((c) => (
                                                <option key={c} value={c}>{c}{baseCode && c === baseCode ? ' (أساسية)' : ''}</option>
                                            ))}
                                        </select>
                                    </div>
                                    <div>
                                        <div className="flex items-center justify-between mb-1">
                                            <label className="block text-sm font-medium dark:text-gray-300">سعر الصرف (محاسبي)</label>
                                            <span className="text-[11px] text-gray-500 dark:text-gray-400">
                                                {poFxSource === 'base' ? 'أساسي' : poFxSource === 'system' ? 'نظام' : poFxSource === 'manual' ? 'يدوي' : 'غير معروف'}
                                            </span>
                                        </div>
                                        <input
                                            type="number"
                                            min="0"
                                            step="0.000001"
                                            className="w-full p-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 dark:text-white font-mono"
                                            value={Number(poFxRate) || 0}
                                            readOnly
                                            disabled
                                        />
                                    </div>
                                    <div className="md:col-span-2 flex items-end">
                                        <div className="text-xs text-gray-600 dark:text-gray-300">
                                            يتم تثبيت العملة وسعر الصرف تلقائيًا بعد إكمال أمر الشراء.
                                        </div>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2">
                                    <input
                                        id="receiveOnCreate"
                                        type="checkbox"
                                        checked={receiveOnCreate}
                                        onChange={(e) => setReceiveOnCreate(e.target.checked)}
                                    />
                                    <label htmlFor="receiveOnCreate" className="text-sm font-medium dark:text-gray-300">
                                        استلام المخزون الآن
                                    </label>
                                </div>

                                <div className="bg-gray-50 dark:bg-gray-700/30 border dark:border-gray-700 rounded-xl p-4 space-y-3">
                                    <div className="font-bold dark:text-gray-100">إدخال سريع</div>
                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                        <div>
                                            <label className="block text-sm font-medium mb-1 dark:text-gray-300">باركود/كود الصنف</label>
                                            <input
                                                type="text"
                                                value={quickAddCode}
                                                onChange={(e) => setQuickAddCode(e.target.value)}
                                                onKeyDown={(e) => {
                                                    if (e.key === 'Enter') {
                                                        e.preventDefault();
                                                        handleQuickAdd();
                                                    }
                                                }}
                                                className="w-full p-2 border rounded-lg dark:bg-gray-800 dark:border-gray-600 dark:text-white font-mono"
                                                placeholder="امسح الباركود ثم Enter"
                                            />
                                        </div>
                                        <div className="md:col-span-2">
                                            <label className="block text-sm font-medium mb-1 dark:text-gray-300">بحث باسم الصنف</label>
                                            <div className="relative">
                                                <input
                                                    type="text"
                                                    value={quickAddName}
                                                    onChange={(e) => setQuickAddName(e.target.value)}
                                                    onKeyDown={(e) => {
                                                        if (e.key === 'Enter') {
                                                            e.preventDefault();
                                                            handleQuickAddByName();
                                                        }
                                                    }}
                                                    className="w-full p-2 border rounded-lg dark:bg-gray-800 dark:border-gray-600 dark:text-white"
                                                    placeholder="اكتب اسم الصنف ثم Enter"
                                                />
                                                {quickAddName.trim() && quickAddNameMatches.length > 0 ? (
                                                    <div className="absolute z-10 mt-1 w-full max-h-56 overflow-auto rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-lg">
                                                        {quickAddNameMatches.map((it) => {
                                                            const label = it.name?.ar || it.name?.en || it.id;
                                                            const stock = typeof (it as any).availableStock === 'number' ? Number((it as any).availableStock) : null;
                                                            return (
                                                                <button
                                                                    key={it.id}
                                                                    type="button"
                                                                    onClick={() => handleQuickAddByName(it.id)}
                                                                    className="w-full text-right px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-700 flex items-center justify-between gap-3"
                                                                >
                                                                    <span className="min-w-0 truncate">{label}</span>
                                                                    <span className="text-xs text-gray-500 dark:text-gray-400 font-mono" dir="ltr">
                                                                        {stock === null ? '' : `حالي: ${stock}`}
                                                                    </span>
                                                                </button>
                                                            );
                                                        })}
                                                    </div>
                                                ) : null}
                                            </div>
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium mb-1 dark:text-gray-300">الكمية</label>
                                            <input
                                                type="number"
                                                value={quickAddQuantity}
                                                min={0}
                                                step="0.01"
                                                onChange={(e) => setQuickAddQuantity(e.target.value)}
                                                className="w-full p-2 border rounded-lg dark:bg-gray-800 dark:border-gray-600 dark:text-white font-mono"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium mb-1 dark:text-gray-300">سعر الشراء (للوحدة) <span className="font-mono">{poCurrency || '—'}</span></label>
                                            <input
                                                type="number"
                                                value={quickAddUnitCost}
                                                min={0}
                                                step="0.01"
                                                onChange={(e) => setQuickAddUnitCost(e.target.value)}
                                                className="w-full p-2 border rounded-lg dark:bg-gray-800 dark:border-gray-600 dark:text-white font-mono"
                                            />
                                        </div>
                                    </div>
                                    <div className="flex items-center justify-end gap-2">
                                        <button
                                            type="button"
                                            onClick={handleQuickAdd}
                                            className="px-4 py-2 rounded-lg bg-primary-600 text-white font-semibold hover:bg-primary-700"
                                        >
                                            إضافة (كود)
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => handleQuickAddByName()}
                                            className="px-4 py-2 rounded-lg bg-gray-900 text-white font-semibold hover:bg-black"
                                            disabled={!quickAddName.trim() || quickAddNameMatches.length === 0}
                                        >
                                            إضافة (اسم)
                                        </button>
                                    </div>
                                    <div className="grid grid-cols-1 gap-2">
                                        <label className="block text-sm font-medium dark:text-gray-300">لصق من إكسل/CSV (كود, كمية, سعر)</label>
                                        <textarea
                                            value={bulkLinesText}
                                            onChange={(e) => setBulkLinesText(e.target.value)}
                                            className="w-full p-2 border rounded-lg dark:bg-gray-800 dark:border-gray-600 dark:text-white font-mono text-sm min-h-[100px]"
                                            placeholder={"مثال:\n1234567890123\t10\t120\nITEM-001,5,80"}
                                        />
                                        <div className="flex items-center justify-end gap-2">
                                            <button
                                                type="button"
                                                onClick={handleBulkAdd}
                                                className="px-4 py-2 rounded-lg bg-gray-900 text-white font-semibold hover:bg-black"
                                            >
                                                إضافة من النص
                                            </button>
                                        </div>
                                    </div>
                                </div>

                                {/* Items Table */}
                                <div>
                                    <div className="flex justify-between items-center mb-2">
                                        <h3 className="font-bold dark:text-gray-200">الأصناف</h3>
                                        <button type="button" onClick={addRow} className="text-sm text-primary-600 hover:text-primary-700 font-semibold">+ إضافة صنف</button>
                                    </div>
                                    <div className="border rounded-lg overflow-hidden dark:border-gray-700">
                                        <div className="overflow-x-auto">
                                            <table className="min-w-[720px] w-full text-right text-sm">
                                                <thead className="bg-gray-50 dark:bg-gray-700">
                                                    <tr>
                                                        <th className="p-2 sm:p-3 w-1/2">الصنف</th>
                                                        <th className="p-2 sm:p-3 w-24">الكمية</th>
                                                        <th className="p-2 sm:p-3 w-40">الوحدة</th>
                                                        <th className="p-2 sm:p-3 w-32">{`سعر الشراء (للوحدة)${poCurrency ? ` (${poCurrency})` : ''}`}</th>
                                                        <th className="p-2 sm:p-3 w-32">الإجمالي</th>
                                                        {showCreateDates ? (
                                                            <>
                                                                <th className="p-2 sm:p-3 w-40">تاريخ الإنتاج</th>
                                                                <th className="p-2 sm:p-3 w-40">تاريخ الانتهاء</th>
                                                            </>
                                                        ) : null}
                                                        <th className="p-2 sm:p-3 w-10"></th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                                                    {orderItems.map((row, index) => (
                                                        <tr key={index}>
                                                            <td className="p-2 sm:p-2">
                                                                <select
                                                                    className="w-full p-1 border rounded"
                                                                    value={row.itemId}
                                                                    required
                                                                    onChange={(e) => updateRow(index, 'itemId', e.target.value)}
                                                                >
                                                                    <option value="">اختر صنف...</option>
                                                                    {activeMenuItems.map((item: MenuItem) => (
                                                                        <option key={item.id} value={item.id}>{item.name.ar} (الحالي: {item.availableStock})</option>
                                                                    ))}
                                                                </select>
                                                            </td>
                                                            <td className="p-2 sm:p-2">
                                                                <input
                                                                    type="number"
                                                                    min={getQuantityStep(row.itemId)}
                                                                    step={getQuantityStep(row.itemId)}
                                                                    required
                                                                    className="w-full p-1 border rounded text-center font-mono"
                                                                    value={row.quantity}
                                                                    onChange={(e) => updateRow(index, 'quantity', e.target.value)}
                                                                />
                                                            </td>
                                                            <td className="p-2 sm:p-2">
                                                                {(() => {
                                                                    const it = row.itemId ? getItemById(row.itemId) : undefined;
                                                                    const baseUom = String(it?.unitType || 'piece');
                                                                    const baseLabel = (() => {
                                                                        try {
                                                                            const lbl = getUnitLabel(baseUom as any, language as any);
                                                                            return String(lbl || baseUom);
                                                                        } catch {
                                                                            return baseUom;
                                                                        }
                                                                    })();
                                                                    const baseLower = baseUom.toLowerCase();
                                                                    const options: Array<{ code: string; label: string; qtyInBase: number }> = [
                                                                        { code: baseUom, label: baseLabel, qtyInBase: 1 },
                                                                    ];
                                                                    const uomRows = row.itemId ? (itemUomRowsByItemId[String(row.itemId)] || []) : [];
                                                                    for (const u of uomRows) {
                                                                        const code = String((u as any)?.code || '').trim();
                                                                        const qtyInBase = Number((u as any)?.qtyInBase || 0) || 0;
                                                                        if (!code || qtyInBase <= 0) continue;
                                                                        const codeLower = code.toLowerCase();
                                                                        if (codeLower === baseLower) continue;
                                                                        const nameRaw = String((u as any)?.name || '').trim();
                                                                        const displayName = nameRaw || String(getUnitLabel(code as any, language as any) || code);
                                                                        const label = qtyInBase === 1 ? displayName : `${displayName} (${qtyInBase} ${baseLabel})`;
                                                                        options.push({ code, label, qtyInBase });
                                                                    }
                                                                    if (options.length === 1) {
                                                                        const packSize = Number((it as any)?.packSize || 0);
                                                                        const cartonSize = Number((it as any)?.cartonSize || 0);
                                                                        if (packSize > 0) options.push({ code: 'pack', label: `${getUnitLabel('pack' as any, language as any) || 'pack'} (${packSize} ${baseLabel})`, qtyInBase: packSize });
                                                                        if (cartonSize > 0) options.push({ code: 'carton', label: `${getUnitLabel('carton' as any, language as any) || 'carton'} (${cartonSize} ${baseLabel})`, qtyInBase: cartonSize });
                                                                    }
                                                                    const current = String((row as any).uomCode || baseUom);
                                                                    const safeCurrent = options.some((o) => String(o.code) === current) ? current : baseUom;
                                                                    return (
                                                                        <select
                                                                            className="w-full p-1 border rounded font-mono"
                                                                            value={safeCurrent}
                                                                            disabled={!row.itemId}
                                                                            onChange={(e) => {
                                                                                const code = String(e.target.value || '').trim();
                                                                                const found = options.find(o => o.code === code) || options[0];
                                                                                const next = [...orderItems];
                                                                                next[index] = { ...next[index], uomCode: found.code, uomQtyInBase: found.qtyInBase };
                                                                                setOrderItems(next);
                                                                            }}
                                                                        >
                                                                            {options.map((o) => (
                                                                                <option key={o.code} value={o.code}>{o.label}</option>
                                                                            ))}
                                                                        </select>
                                                                    );
                                                                })()}
                                                            </td>
                                                            <td className="p-2 sm:p-2">
                                                                <input
                                                                    type="number"
                                                                    min="0"
                                                                    step="0.01"
                                                                    required
                                                                    className="w-full p-1 border rounded text-center font-mono"
                                                                    value={row.unitCost}
                                                                    onChange={(e) => updateRow(index, 'unitCost', e.target.value)}
                                                                />
                                                            </td>
                                                            <td className="p-2 sm:p-2 font-mono font-bold text-gray-700">
                                                                <CurrencyDualAmount amount={Number(Number(row.quantity) * Number(row.unitCost)) || 0} currencyCode={poCurrency} compact />
                                                            </td>
                                                            {showCreateDates ? (
                                                                <>
                                                                    {isFoodItem(row.itemId) ? (
                                                                        <>
                                                                            <td className="p-2 sm:p-2">
                                                                                <input
                                                                                    type="date"
                                                                                    value={row.productionDate || ''}
                                                                                    onChange={(e) => updateRow(index, 'productionDate', e.target.value)}
                                                                                    className="w-full p-1 border rounded"
                                                                                />
                                                                            </td>
                                                                            <td className="p-2 sm:p-2">
                                                                                <input
                                                                                    type="date"
                                                                                    value={row.expiryDate || ''}
                                                                                    onChange={(e) => updateRow(index, 'expiryDate', e.target.value)}
                                                                                    className="w-full p-1 border rounded"
                                                                                    required
                                                                                />
                                                                            </td>
                                                                        </>
                                                                    ) : (
                                                                        <>
                                                                            <td className="p-2 sm:p-2 text-center text-gray-400">—</td>
                                                                            <td className="p-2 sm:p-2 text-center text-gray-400">—</td>
                                                                        </>
                                                                    )}
                                                                </>
                                                            ) : null}
                                                            <td className="p-2 sm:p-2 text-center">
                                                                <button
                                                                    type="button"
                                                                    onClick={() => removeRow(index)}
                                                                    className="text-red-500 hover:text-red-700"
                                                                >
                                                                    <Icons.TrashIcon className="w-4 h-4" />
                                                                </button>
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Footer */}
                            <div className="p-4 bg-gray-50 dark:bg-gray-700/50 border-t dark:border-gray-700 flex justify-between items-center flex-shrink-0">
                                <div className="text-xl font-bold dark:text-white">
                                    الإجمالي الكلي:{' '}
                                    <span className="text-primary-600">
                                        <CurrencyDualAmount amount={Number(calculateTotal()) || 0} currencyCode={poCurrency} compact />
                                    </span>
                                </div>
                                <button
                                    type="submit"
                                    disabled={loading}
                                    className="bg-green-600 text-white px-8 py-3 rounded-xl font-bold hover:bg-green-700 shadow-lg"
                                >
                                    {loading ? 'جاري الحفظ...' : (receiveOnCreate ? 'حفظ واستلام المخزون' : 'حفظ فقط')}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Reorder Suggestions */}
            {isModalOpen && (
                <div className="fixed inset-x-0 top-[5rem] z-40 mx-auto max-w-4xl px-4">
                    {lowStockSuggestions.length > 0 && (
                        <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-700 rounded-xl p-4 shadow">
                            <div className="font-bold mb-2 dark:text-yellow-100">توصيات إعادة الطلب (مخزون منخفض)</div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                {lowStockSuggestions.map(s => (
                                    <div key={s.item!.id} className="flex items-center justify-between gap-3 bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700 p-3">
                                        <div className="flex-1">
                                            <div className="font-semibold dark:text-gray-100">{s.item!.name.ar}</div>
                                            <div className="text-xs text-gray-600 dark:text-gray-400">
                                                المتاح: {s.available} — الحد الأدنى: {s.threshold}
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <div className="text-xs dark:text-gray-300">المقترح: {s.recommended}</div>
                                            <button
                                                type="button"
                                                onClick={() => addRowForItem(s.item!.id, s.recommended)}
                                                className="px-3 py-1 bg-primary-600 text-white rounded hover:bg-primary-700 text-sm"
                                            >
                                                إضافة
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            )}

            {isPaymentModalOpen && paymentOrder && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                    <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col animate-in fade-in zoom-in duration-200">
                        <div className="p-4 bg-gray-50 dark:bg-gray-700/50 border-b dark:border-gray-700 flex justify-between items-center">
                            <h2 className="text-xl font-bold dark:text-white">تسجيل دفعة للمورد</h2>
                            <button
                                type="button"
                                onClick={() => { setIsPaymentModalOpen(false); setPaymentOrder(null); }}
                                className="p-1 rounded-full hover:bg-gray-200 dark:hover:bg-gray-600"
                            >
                                <Icons.XIcon className="w-6 h-6" />
                            </button>
                        </div>
                        <form onSubmit={handleRecordPayment} className="p-6 space-y-4">
                            <div className="text-sm dark:text-gray-300">
                                {paymentOrder.supplierName} — {paymentOrder.referenceNumber || paymentOrder.id}
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium mb-1 dark:text-gray-300">المبلغ</label>
                                    <input
                                        type="number"
                                        min="0"
                                        step="0.01"
                                        required
                                        value={paymentAmount}
                                        onChange={(e) => setPaymentAmount(parseFloat(e.target.value))}
                                        className="w-full p-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 dark:text-white text-center font-mono"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium mb-1 dark:text-gray-300">طريقة الدفع</label>
                                    <select
                                        value={paymentMethod}
                                        onChange={(e) => {
                                            const next = e.target.value;
                                            setPaymentMethod(next);
                                            if (next === 'cash') {
                                                setPaymentReferenceNumber('');
                                                setPaymentSenderName('');
                                                setPaymentSenderPhone('');
                                                setPaymentDeclaredAmount(0);
                                                setPaymentAmountConfirmed(false);
                                                setPaymentDestinationAccountId('');
                                            } else {
                                                setPaymentReferenceNumber('');
                                                setPaymentSenderName('');
                                                setPaymentSenderPhone('');
                                                setPaymentDeclaredAmount(Number(paymentAmount) || 0);
                                                setPaymentAmountConfirmed(false);
                                                const parentCodeFilter = next === 'kuraimi' ? '1020' : next === 'network' ? '1030' : '';
                                                const defaultDest = parentCodeFilter ? availablePurchaseDestinations.find(a => a.parentCode === parentCodeFilter)?.id : '';
                                                setPaymentDestinationAccountId(defaultDest || '');
                                            }
                                        }}
                                        className="w-full p-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                                    >
                                        {availablePaymentMethods.length === 0 ? (
                                            <option value="">لا توجد طرق دفع مفعّلة</option>
                                        ) : (
                                            availablePaymentMethods.map((method) => (
                                                <option key={method} value={method}>{getPaymentMethodLabel(method)}</option>
                                            ))
                                        )}
                                    </select>
                                </div>
                            </div>
                            {(paymentMethod === 'kuraimi' || paymentMethod === 'network') && (
                                <div className="space-y-3 rounded-lg border border-gray-200 dark:border-gray-600 p-3">
                                    <div className="text-sm font-semibold dark:text-gray-200">
                                        {paymentMethod === 'kuraimi' ? 'بيانات الإيداع البنكي' : 'بيانات الحوالة'}
                                    </div>
                                    <div className="grid grid-cols-1 gap-3">
                                        <div>
                                            <label className="block text-sm font-medium mb-1 dark:text-gray-300">الحساب المالي الوجهة</label>
                                            <select
                                                value={paymentDestinationAccountId}
                                                onChange={(e) => setPaymentDestinationAccountId(e.target.value)}
                                                className="w-full p-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                                                required={availablePurchaseDestinations.some(a => a.parentCode === (paymentMethod === 'kuraimi' ? '1020' : '1030'))}
                                            >
                                                <option value="">(افتراضي)</option>
                                                {availablePurchaseDestinations
                                                    .filter(a => paymentMethod === 'kuraimi' ? a.parentCode === '1020' : a.parentCode === '1030')
                                                    .map(a => {
                                                        const dispName = a.nameAr !== a.name ? `${a.nameAr} (${a.name})` : a.nameAr;
                                                        return <option key={a.id} value={a.id}>{a.code} - {dispName}</option>;
                                                    })}
                                            </select>
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium mb-1 dark:text-gray-300">
                                                {paymentMethod === 'kuraimi' ? 'رقم الإيداع' : 'رقم الحوالة'}
                                            </label>
                                            <input
                                                type="text"
                                                value={paymentReferenceNumber}
                                                onChange={(e) => setPaymentReferenceNumber(e.target.value)}
                                                placeholder={paymentMethod === 'kuraimi' ? 'مثال: DEP-12345' : 'مثال: TRX-12345'}
                                                className="w-full p-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                                                required
                                            />
                                        </div>
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                            <div>
                                                <label className="block text-sm font-medium mb-1 dark:text-gray-300">
                                                    {paymentMethod === 'kuraimi' ? 'اسم المودِع' : 'اسم المرسل'}
                                                </label>
                                                <input
                                                    type="text"
                                                    value={paymentSenderName}
                                                    onChange={(e) => setPaymentSenderName(e.target.value)}
                                                    className="w-full p-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                                                    required
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-sm font-medium mb-1 dark:text-gray-300">
                                                    {paymentMethod === 'kuraimi' ? 'رقم هاتف المودِع (اختياري)' : 'رقم هاتف المرسل (اختياري)'}
                                                </label>
                                                <input
                                                    type="tel"
                                                    value={paymentSenderPhone}
                                                    onChange={(e) => setPaymentSenderPhone(e.target.value)}
                                                    className="w-full p-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                                                />
                                            </div>
                                        </div>
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                            <div>
                                                <label className="block text-sm font-medium mb-1 dark:text-gray-300">مبلغ العملية</label>
                                                <input
                                                    type="number"
                                                    min="0"
                                                    step="0.01"
                                                    value={paymentDeclaredAmount}
                                                    onChange={(e) => setPaymentDeclaredAmount(parseFloat(e.target.value))}
                                                    className="w-full p-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 dark:text-white text-center font-mono"
                                                    required
                                                />
                                            </div>
                                            <div className="flex items-end">
                                                <label className="flex items-center gap-2 text-sm font-medium dark:text-gray-300">
                                                    <input
                                                        type="checkbox"
                                                        checked={paymentAmountConfirmed}
                                                        onChange={(e) => setPaymentAmountConfirmed(e.target.checked)}
                                                    />
                                                    تأكيد مطابقة المبلغ
                                                </label>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}
                            <div>
                                <label className="block text-sm font-medium mb-1 dark:text-gray-300">وقت الدفع</label>
                                <input
                                    type="datetime-local"
                                    value={paymentOccurredAt}
                                    onChange={(e) => setPaymentOccurredAt(e.target.value)}
                                    className="w-full p-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                                />
                            </div>
                            {canViewAccounting && (
                                <div className="space-y-2 rounded-lg border border-gray-200 dark:border-gray-600 p-3">
                                    <label className="flex items-center gap-2 text-sm font-medium dark:text-gray-300">
                                        <input
                                            type="checkbox"
                                            checked={paymentAdvancedAccounting}
                                            onChange={(e) => setPaymentAdvancedAccounting(e.target.checked)}
                                        />
                                        إعدادات محاسبية متقدمة
                                    </label>
                                    {paymentAdvancedAccounting && (
                                        <div>
                                            <label className="block text-sm font-medium mb-1 dark:text-gray-300">الحساب المحاسبي البديل (Advanced)</label>
                                            <select
                                                value={paymentOverrideAccountId}
                                                onChange={(e) => setPaymentOverrideAccountId(e.target.value)}
                                                disabled={!canManageAccounting}
                                                className="w-full p-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 dark:text-white disabled:opacity-60"
                                            >
                                                <option value="">-- اختياري (الحساب المعياري) --</option>
                                                {accounts.map(acc => {
                                                    const dispName = acc.nameAr !== acc.name ? `${acc.nameAr} (${acc.name})` : acc.nameAr;
                                                    return (
                                                        <option key={acc.id} value={acc.id}>{acc.code} - {dispName}</option>
                                                    );
                                                })}
                                            </select>
                                            {accountsError && (
                                                <div className="mt-1 text-xs text-red-600">{accountsError}</div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            )}
                            <div className="flex justify-end gap-2 pt-2">
                                <button
                                    type="button"
                                    onClick={() => { setIsPaymentModalOpen(false); setPaymentOrder(null); }}
                                    className="px-4 py-2 bg-gray-200 rounded hover:bg-gray-300 text-gray-800"
                                >
                                    إلغاء
                                </button>
                                <button
                                    type="submit"
                                    className="px-4 py-2 bg-primary-600 text-white rounded hover:bg-primary-700"
                                >
                                    تسجيل الدفع
                                </button>
                            </div>
                        </form>
                    </div>
                </div >
            )}

            {
                isReceiveModalOpen && receiveOrder && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-3xl max-h-[min(90dvh,calc(100dvh-2rem))] overflow-hidden flex flex-col animate-in fade-in zoom-in duration-200">
                            <div className="p-4 bg-gray-50 dark:bg-gray-700/50 border-b dark:border-gray-700 flex justify-between items-center flex-shrink-0">
                                <h2 className="text-xl font-bold dark:text-white">استلام مخزون (جزئي)</h2>
                                <button
                                    type="button"
                                    onClick={() => {
                                        if (isReceivingPartial) return;
                                        setIsReceiveModalOpen(false);
                                        setReceiveOrder(null);
                                        setReceiveRows([]);
                                    }}
                                    disabled={isReceivingPartial}
                                    className="p-1 rounded-full hover:bg-gray-200 dark:hover:bg-gray-600"
                                >
                                    <Icons.XIcon className="w-6 h-6" />
                                </button>
                            </div>
                            <form onSubmit={handleReceivePartial} className="flex-1 flex flex-col overflow-hidden">
                                <div className="p-6 space-y-4 overflow-y-auto flex-1">
                                    <div className="text-sm dark:text-gray-300">
                                        {receiveOrder.supplierName} — {receiveOrder.referenceNumber || receiveOrder.id}
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium mb-1 dark:text-gray-300">وقت الاستلام</label>
                                        <input
                                            type="datetime-local"
                                            value={receiveOccurredAt}
                                            onChange={(e) => setReceiveOccurredAt(e.target.value)}
                                            className="w-full p-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium mb-1 dark:text-gray-300">الشحنة (اختياري)</label>
                                        <select
                                            value={receiveShipmentId}
                                            onChange={(e) => setReceiveShipmentId(e.target.value)}
                                            disabled={receiveShipmentsLoading || receiveShipments.length === 0}
                                            className="w-full p-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                                        >
                                            <option value="">بدون شحنة</option>
                                            {receiveShipments.map((s) => (
                                                <option key={s.id} value={s.id}>
                                                    {s.referenceNumber}{s.status ? ` — ${s.status}` : ''}{typeof (s as any).poLinked === 'boolean' ? ((s as any).poLinked ? ' — مرتبط بهذا الأمر' : ' — غير مرتبط بهذا الأمر') : ''}
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                    <div className="border rounded-lg overflow-hidden dark:border-gray-700">
                                        <div className="overflow-x-auto">
                                            <table className="min-w-[1200px] w-full text-right text-sm">
                                                <thead className="bg-gray-50 dark:bg-gray-700">
                                                    <tr>
                                                        <th className="p-2 sm:p-3">الصنف</th>
                                                        <th className="p-2 sm:p-3 w-24">المطلوب</th>
                                                        <th className="p-2 sm:p-3 w-24">المستلم</th>
                                                        <th className="p-2 sm:p-3 w-24">المتبقي</th>
                                                        <th className="p-2 sm:p-3 w-32">استلام الآن</th>
                                                        {showReceiveDates ? (
                                                            <>
                                                                <th className="p-2 sm:p-3 w-40">تاريخ الإنتاج</th>
                                                                <th className="p-2 sm:p-3 w-40">تاريخ الانتهاء</th>
                                                            </>
                                                        ) : null}
                                                        <th className="p-2 sm:p-3 w-32">تكلفة النقل/وحدة</th>
                                                        <th className="p-2 sm:p-3 w-32">ضريبة المورد/وحدة</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                                                    {receiveRows.map((r, idx) => (
                                                        <tr key={r.itemId}>
                                                            <td className="p-2 sm:p-2 dark:text-gray-200">{r.itemName}</td>
                                                            <td className="p-2 sm:p-2 text-center font-mono">{r.ordered}</td>
                                                            <td className="p-2 sm:p-2 text-center font-mono">{r.received}</td>
                                                            <td className="p-2 sm:p-2 text-center font-mono">{r.remaining}</td>
                                                            <td className="p-2 sm:p-2">
                                                                <input
                                                                    type="number"
                                                                    min={0}
                                                                    step={getQuantityStep(r.itemId)}
                                                                    value={r.receiveNow}
                                                                    onChange={(e) => updateReceiveRow(idx, e.target.value)}
                                                                    className="w-full p-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 dark:text-white text-center font-mono"
                                                                />
                                                            </td>
                                                            {showReceiveDates ? (
                                                                isFoodItem(r.itemId) ? (
                                                                    <>
                                                                        <td className="p-2 sm:p-2">
                                                                            <input
                                                                                type="date"
                                                                                value={r.productionDate || ''}
                                                                                onChange={(e) => updateReceiveProduction(idx, e.target.value)}
                                                                                className="w-full p-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                                                                            />
                                                                        </td>
                                                                        <td className="p-2 sm:p-2">
                                                                            <input
                                                                                type="date"
                                                                                value={r.expiryDate || ''}
                                                                                onChange={(e) => updateReceiveExpiry(idx, e.target.value)}
                                                                                className="w-full p-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                                                                                required={Boolean(r.receiveNow) && Number(r.receiveNow) > 0}
                                                                            />
                                                                        </td>
                                                                    </>
                                                                ) : (
                                                                    <>
                                                                        <td className="p-2 sm:p-2 text-center text-gray-400">—</td>
                                                                        <td className="p-2 sm:p-2 text-center text-gray-400">—</td>
                                                                    </>
                                                                )
                                                            ) : null}
                                                            <td className="p-2 sm:p-2">
                                                                <input
                                                                    type="number"
                                                                    min={0}
                                                                    step="0.01"
                                                                    value={r.transportCost || 0}
                                                                    onChange={(e) => updateReceiveTransport(idx, e.target.value)}
                                                                    className="w-full p-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 dark:text-white text-center font-mono"
                                                                />
                                                            </td>
                                                            <td className="p-2 sm:p-2">
                                                                <input
                                                                    type="number"
                                                                    min={0}
                                                                    step="0.01"
                                                                    value={r.supplyTaxCost || 0}
                                                                    onChange={(e) => updateReceiveSupplyTax(idx, e.target.value)}
                                                                    className="w-full p-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 dark:text-white text-center font-mono"
                                                                />
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>
                                </div>
                                <div className="p-6 pt-3 border-t dark:border-gray-700 bg-white dark:bg-gray-800 flex justify-end gap-2 flex-shrink-0">
                                    <button
                                        type="button"
                                        onClick={() => {
                                            if (isReceivingPartial) return;
                                            setIsReceiveModalOpen(false);
                                            setReceiveOrder(null);
                                            setReceiveRows([]);
                                        }}
                                        disabled={isReceivingPartial}
                                        className="px-4 py-2 bg-gray-200 rounded hover:bg-gray-300 text-gray-800"
                                    >
                                        إلغاء
                                    </button>
                                    <button
                                        type="submit"
                                        disabled={isReceivingPartial}
                                        className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700"
                                    >
                                        {isReceivingPartial ? 'جاري الاستلام...' : 'تأكيد الاستلام'}
                                    </button>
                                </div>
                            </form>
                        </div>
                    </div>
                )
            }

            {
                isReturnModalOpen && returnOrder && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-4xl max-h-[min(90dvh,calc(100dvh-2rem))] overflow-hidden flex flex-col animate-in fade-in zoom-in duration-200">
                            <div className="p-4 bg-gray-50 dark:bg-gray-700/50 border-b dark:border-gray-700 flex justify-between items-center flex-shrink-0">
                                <h2 className="text-xl font-bold dark:text-white">مرتجع إلى المورد</h2>
                                <button
                                    type="button"
                                    onClick={() => {
                                        if (isCreatingReturn) return;
                                        setIsReturnModalOpen(false);
                                        setReturnOrder(null);
                                        setReturnRows([]);
                                    }}
                                    disabled={isCreatingReturn}
                                    className="p-1 rounded-full hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    <Icons.XIcon className="w-6 h-6" />
                                </button>
                            </div>
                            <form onSubmit={handleCreateReturn} className="flex-1 flex flex-col overflow-hidden">
                                <div className="p-6 space-y-4 overflow-y-auto flex-1">
                                    <div className="text-sm dark:text-gray-300">
                                        {returnOrder.supplierName} — {returnOrder.referenceNumber || returnOrder.id.slice(-6)}
                                    </div>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-sm font-medium mb-1 dark:text-gray-300">وقت المرتجع</label>
                                            <input
                                                type="datetime-local"
                                                value={returnOccurredAt}
                                                onChange={(e) => setReturnOccurredAt(e.target.value)}
                                                className="w-full p-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium mb-1 dark:text-gray-300">سبب المرتجع</label>
                                            <input
                                                type="text"
                                                value={returnReason}
                                                onChange={(e) => setReturnReason(e.target.value)}
                                                className="w-full p-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                                            />
                                        </div>
                                    </div>
                                    <div className="border rounded-lg overflow-hidden dark:border-gray-700">
                                        <div className="overflow-x-auto">
                                            <table className="min-w-[720px] w-full text-right text-sm">
                                                <thead className="bg-gray-50 dark:bg-gray-700">
                                                    <tr>
                                                        <th className="p-2 sm:p-3">الصنف</th>
                                                        <th className="p-2 sm:p-3 w-24">المستلم</th>
                                                        <th className="p-2 sm:p-3 w-24">مرتجع سابق</th>
                                                        <th className="p-2 sm:p-3 w-24">المتبقي</th>
                                                        <th className="p-2 sm:p-3 w-24">المتاح حالياً</th>
                                                        <th className="p-2 sm:p-3 w-40">الوحدة</th>
                                                        <th className="p-2 sm:p-3 w-24">مرتجع الآن</th>
                                                        <th className="p-2 sm:p-3 w-24">يعادل</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                                                    {returnRows.map((r, idx) => (
                                                        <tr key={r.itemId}>
                                                            <td className="p-2 sm:p-2 dark:text-gray-200">{r.itemName}</td>
                                                            <td className="p-2 sm:p-2 text-center font-mono">{r.received}</td>
                                                            <td className="p-2 sm:p-2 text-center font-mono">{r.previousReturned || 0}</td>
                                                            <td className="p-2 sm:p-2 text-center font-mono">{r.remaining}</td>
                                                            <td className="p-2 sm:p-2 text-center font-mono">{Number(r.available || 0)}</td>
                                                            <td className="p-2 sm:p-2">
                                                                {(() => {
                                                                    const options = getUomOptionsForItem(r.itemId);
                                                                    const current = String((r as any).uomCode || options[0]?.code || '');
                                                                    const safeCurrent = options.some((o) => String(o.code) === current) ? current : String(options[0]?.code || '');
                                                                    return (
                                                                        <select
                                                                            className="w-full p-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 dark:text-white font-mono"
                                                                            value={safeCurrent}
                                                                            disabled={!r.itemId}
                                                                            onChange={(e) => updateReturnUom(idx, String(e.target.value || ''))}
                                                                        >
                                                                            {options.map((o) => (
                                                                                <option key={o.code} value={o.code}>{o.label}</option>
                                                                            ))}
                                                                        </select>
                                                                    );
                                                                })()}
                                                            </td>
                                                            <td className="p-2 sm:p-2">
                                                                <input
                                                                    type="number"
                                                                    min={0}
                                                                    step={(Number((r as any).uomQtyInBase || 1) || 1) > 1 ? 1 : getQuantityStep(r.itemId)}
                                                                    value={r.receiveNow}
                                                                    onChange={(e) => updateReturnRow(idx, e.target.value)}
                                                                    className="w-full p-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 dark:text-white text-center font-mono"
                                                                />
                                                            </td>
                                                            <td className="p-2 sm:p-2 text-center font-mono">
                                                                {(() => {
                                                                    const qtyInBase = Math.max(1, Number((r as any).uomQtyInBase || 1) || 1);
                                                                    const qty = Number(r.receiveNow) || 0;
                                                                    const baseQty = qtyInBase > 0 ? (qty * qtyInBase) : 0;
                                                                    return Number.isFinite(baseQty) ? baseQty : 0;
                                                                })()}
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>
                                </div>
                                <div className="p-6 pt-3 border-t dark:border-gray-700 bg-white dark:bg-gray-800 flex justify-end gap-2 flex-shrink-0">
                                    <button
                                        type="button"
                                        onClick={() => {
                                            if (isCreatingReturn) return;
                                            setIsReturnModalOpen(false);
                                            setReturnOrder(null);
                                            setReturnRows([]);
                                        }}
                                        disabled={isCreatingReturn}
                                        className="px-4 py-2 bg-gray-200 rounded hover:bg-gray-300 text-gray-800 disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        إلغاء
                                    </button>
                                    <button
                                        type="submit"
                                        disabled={isCreatingReturn}
                                        className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        {isCreatingReturn ? 'جاري تسجيل المرتجع...' : 'تسجيل المرتجع'}
                                    </button>
                                </div>
                            </form>
                        </div>
                    </div>
                )
            }
            {/* ▬▬▬ RETURN PRINT PICKER MODAL ▬▬▬ */}
            {returnPickerOrder && returnPickerList.length > 1 && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4" onClick={() => { setReturnPickerOrder(null); setReturnPickerList([]); }}>
                    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl max-w-lg w-full max-h-[80vh] overflow-hidden" onClick={e => e.stopPropagation()}>
                        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
                            <h3 className="text-lg font-bold text-gray-900 dark:text-white">اختر سند مرتجع للطباعة</h3>
                            <button type="button" onClick={() => { setReturnPickerOrder(null); setReturnPickerList([]); }} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-xl font-bold">✕</button>
                        </div>
                        <div className="px-6 py-2 text-xs text-gray-500 dark:text-gray-400 border-b border-gray-100 dark:border-gray-700">
                            أمر الشراء: <span className="font-mono font-bold text-gray-700 dark:text-gray-300">{String(returnPickerOrder.id || '').slice(-8).toUpperCase()}</span>
                            {' • '}{returnPickerList.length} مرتجع
                        </div>
                        <div className="overflow-y-auto max-h-[55vh] divide-y divide-gray-100 dark:divide-gray-700">
                            {returnPickerList.map((ret, idx) => (
                                <div key={ret.id} className="px-6 py-3 hover:bg-gray-50 dark:hover:bg-gray-700/50 flex items-center justify-between gap-4 transition-colors">
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 mb-0.5">
                                            <span className="bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-300 text-xs font-bold px-2 py-0.5 rounded-full">#{idx + 1}</span>
                                            <span className="font-mono text-xs text-gray-500 dark:text-gray-400" dir="ltr">{String(ret.id).slice(-8).toUpperCase()}</span>
                                        </div>
                                        <div className="text-sm text-gray-700 dark:text-gray-300 flex items-center gap-3 flex-wrap">
                                            <span className="flex items-center gap-1">
                                                <span className="text-gray-400">📅</span>
                                                <span dir="ltr" className="font-mono text-xs">{new Date(ret.returnedAt).toLocaleDateString('en-GB')} {new Date(ret.returnedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>
                                            </span>
                                            <span className="text-gray-400 text-xs">{ret.itemCount} صنف</span>
                                        </div>
                                        {ret.reason && <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 truncate">السبب: {ret.reason}</div>}
                                    </div>
                                    <button
                                        type="button"
                                        onClick={async () => {
                                            try {
                                                await handlePrintSelectedReturn(returnPickerOrder!, ret.id);
                                            } catch (e) {
                                                alert(getErrorMessage(e, 'تعذر الطباعة'));
                                            }
                                        }}
                                        className="px-4 py-2 bg-blue-950 text-white rounded-lg hover:bg-blue-900 text-sm font-bold whitespace-nowrap flex-shrink-0 transition-colors"
                                    >
                                        🖨️ طباعة
                                    </button>
                                </div>
                            ))}
                        </div>
                        <div className="px-6 py-3 border-t border-gray-200 dark:border-gray-700 flex justify-end">
                            <button type="button" onClick={() => { setReturnPickerOrder(null); setReturnPickerList([]); }} className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors">إغلاق</button>
                        </div>
                    </div>
                </div>
            )}
        </div >
    );
};

export default PurchaseOrderScreen;
