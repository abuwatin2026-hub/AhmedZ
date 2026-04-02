import React, { useState, useMemo, useEffect } from 'react';
import { useWarehouses } from '../../contexts/WarehouseContext';
import { useMenu } from '../../contexts/MenuContext';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { useSettings } from '../../contexts/SettingsContext';
import { useSessionScope } from '../../contexts/SessionScopeContext';
import { useItemMeta } from '../../contexts/ItemMetaContext';
import { getSupabaseClient } from '../../supabase';
import { printContent } from '../../utils/printUtils';
import { renderToString } from 'react-dom/server';
import PrintableWarehouseTransfer, { PrintableWarehouseTransferData } from '../../components/admin/documents/PrintableWarehouseTransfer';
import * as Icons from '../../components/icons';
import type { WarehouseTransfer } from '../../types';
import { toYmdLocal } from '../../utils/dateUtils';

const WarehouseTransfersScreen: React.FC = () => {
    const { warehouses, transfers, createTransfer, completeTransfer, cancelTransfer, getWarehouseStock } = useWarehouses();
    const { menuItems } = useMenu();
    const { hasPermission, user } = useAuth();
    const { showNotification } = useToast();
    const { settings } = useSettings();
    const { scope } = useSessionScope();
    const { getUnitLabel } = useItemMeta();

    const [showModal, setShowModal] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [filterStatus, setFilterStatus] = useState<string>('all');
    const [filterWarehouseId, setFilterWarehouseId] = useState<string>('');
    const [itemSearchTerm, setItemSearchTerm] = useState('');
    const [warehouseStockByItem, setWarehouseStockByItem] = useState<Record<string, { available: number; avgCost: number }>>({});
    const [itemUomUnits, setItemUomUnits] = useState<Record<string, Array<{ uomId: string; uomCode: string; uomName: string; qtyInBase: number }>>>({});
    const [loadingWarehouseStock, setLoadingWarehouseStock] = useState(false);
    const baseCurrencyCode = String((settings as any)?.baseCurrency || 'SAR').toUpperCase();
    const operationalCurrencies = useMemo(() => {
        const list = Array.isArray((settings as any)?.operationalCurrencies) ? (settings as any).operationalCurrencies : [];
        const set = new Set<string>([baseCurrencyCode, ...list.map((c: any) => String(c || '').toUpperCase()).filter(Boolean)]);
        return [...set];
    }, [settings, baseCurrencyCode]);
    const [costViewCurrency, setCostViewCurrency] = useState(baseCurrencyCode);
    const [costViewRate, setCostViewRate] = useState(1);
    const [verifyingTransferId, setVerifyingTransferId] = useState<string | null>(null);
    const [completingTransferId, setCompletingTransferId] = useState<string | null>(null);
    const [verificationByTransferId, setVerificationByTransferId] = useState<Record<string, {
        checkedAt: string;
        allOk: boolean;
        rows: Array<{
            itemId: string;
            unit: string;
            requestedQty: number;
            transferredQty: number;
            movedOut: number;
            movedIn: number;
            ok: boolean;
        }>;
    }>>({});

    // Form state
    const [formData, setFormData] = useState({
        from_warehouse_id: '',
        to_warehouse_id: '',
        transfer_date: toYmdLocal(new Date()),
        shipping_cost: 0,
        notes: '',
        items: [] as Array<{ itemId: string; quantity: number; notes: string; uomId?: string }>,
    });

    const canManage = hasPermission('stock.manage');
    const scopeWarehouseName = useMemo(() => {
        const wid = String(scope?.warehouseId || '').trim();
        if (!wid) return '—';
        const w = warehouses.find((x: any) => String((x as any)?.id || '') === wid);
        return String((w as any)?.name || (w as any)?.code || '—');
    }, [scope?.warehouseId, warehouses]);

    useEffect(() => {
        setCostViewCurrency(baseCurrencyCode);
        setCostViewRate(1);
    }, [baseCurrencyCode, showModal]);

    useEffect(() => {
        if (filterWarehouseId) return;
        const wid = String(scope?.warehouseId || '').trim();
        if (wid) setFilterWarehouseId(wid);
    }, [filterWarehouseId, scope?.warehouseId]);

    useEffect(() => {
        let cancelled = false;
        const run = async () => {
            if (!showModal || !formData.from_warehouse_id) {
                setWarehouseStockByItem({});
                return;
            }
            setLoadingWarehouseStock(true);
            try {
                const rows = await getWarehouseStock(formData.from_warehouse_id);
                if (cancelled) return;
                const next: Record<string, { available: number; avgCost: number }> = {};
                for (const row of (Array.isArray(rows) ? rows : [])) {
                    const itemId = String((row as any)?.item_id || (row as any)?.menu_items?.id || '').trim();
                    if (!itemId) continue;
                    next[itemId] = {
                        available: Number((row as any)?.available_quantity ?? 0) || 0,
                        avgCost: Number((row as any)?.avg_cost ?? 0) || 0,
                    };
                }
                setWarehouseStockByItem(next);
            } catch {
                if (!cancelled) setWarehouseStockByItem({});
            } finally {
                if (!cancelled) setLoadingWarehouseStock(false);
            }
        };
        void run();
        return () => { cancelled = true; };
    }, [showModal, formData.from_warehouse_id, getWarehouseStock]);

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

    const handlePrintTransfer = async (transfer: WarehouseTransfer) => {
        const supabase = getSupabaseClient();
        if (!supabase) {
            showNotification('قاعدة البيانات غير متاحة', 'error');
            return;
        }
        try {
            const { data: items, error } = await supabase
                .from('warehouse_transfer_items')
                .select('item_id,quantity,notes,menu_items(name,unit)')
                .eq('transfer_id', transfer.id)
                .order('created_at', { ascending: true });
            if (error) throw error;

            // Resolve unit: prefer stock_management.unit, fallback menu_items.unit, fallback menuItems context
            const resolveUnit = (r: any) => {
                const miUnit = String(r?.menu_items?.unit || '').trim();
                if (miUnit) return miUnit;
                const ctxItem = menuItems.find(mi => String(mi.id) === String(r.item_id));
                return String((ctxItem as any)?.unit || '').trim() || null;
            };

            const list = (Array.isArray(items) ? items : []).map((r: any) => ({
                itemId: String(r.item_id),
                itemName: String(r?.menu_items?.name?.ar || r?.menu_items?.name?.en || r.item_id),
                quantity: Number(r.quantity || 0),
                unit: resolveUnit(r),
                notes: r.notes ?? null,
            })).filter((x: any) => x.quantity > 0);

            const data: PrintableWarehouseTransferData = {
                transferNumber: String(transfer.transferNumber || ''),
                documentStatus: transfer.status === 'completed' ? 'Approved' : transfer.status === 'cancelled' ? 'Cancelled' : 'Draft',
                referenceId: String(transfer.id || ''),
                transferDate: String(transfer.transferDate || transfer.createdAt || ''),
                status: getStatusLabel(transfer.status),
                fromWarehouseName: String(transfer.fromWarehouseName || ''),
                toWarehouseName: String(transfer.toWarehouseName || ''),
                notes: transfer.notes ?? null,
                items: list,
            };

            const brand = resolveBrandingForWarehouseId(String(transfer.fromWarehouseId || ''));
            const branchHdr = await fetchBranchHeader(scope?.branchId);
            const printedBy = (user?.fullName || user?.username || user?.email || '').trim() || null;
            let printNumber = 1;
            try {
                const { data: pn } = await supabase.rpc('track_document_print', { p_source_table: 'warehouse_transfers', p_source_id: transfer.id, p_template: 'PrintableWarehouseTransfer' });
                printNumber = Number(pn) || 1;
            } catch { /* fallback */ }
            const content = renderToString(
                <PrintableWarehouseTransfer
                    data={data}
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
            printContent(content, `تحويل مخزني #${data.transferNumber}`);
            try {
                await supabase.from('system_audit_logs').insert({
                    action: 'print',
                    module: 'documents',
                    details: `Printed transfer ${data.transferNumber}`,
                    metadata: {
                        docType: 'transfer',
                        docNumber: data.transferNumber,
                        status: data.documentStatus,
                        sourceTable: 'warehouse_transfers',
                        sourceId: transfer.id,
                        template: 'PrintableWarehouseTransfer',
                    }
                } as any);
            } catch {
            }
        } catch (e: any) {
            showNotification(String(e?.message || 'تعذر طباعة التحويل'), 'error');
        }
    };

    // Filter transfers
    const filteredTransfers = useMemo(() => {
        return transfers.filter(transfer => {
            const matchesSearch =
                transfer.transferNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
                transfer.fromWarehouseName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                transfer.toWarehouseName?.toLowerCase().includes(searchTerm.toLowerCase());
            const matchesStatus = filterStatus === 'all' || transfer.status === filterStatus;
            const wid = String(filterWarehouseId || '').trim();
            const matchesWarehouse = !wid || String(transfer.fromWarehouseId || '') === wid || String(transfer.toWarehouseId || '') === wid;

            return matchesSearch && matchesStatus && matchesWarehouse;
        });
    }, [transfers, searchTerm, filterStatus, filterWarehouseId]);

    const openAddModal = () => {
        setFormData({
            from_warehouse_id: '',
            to_warehouse_id: '',
            transfer_date: toYmdLocal(new Date()),
            shipping_cost: 0,
            notes: '',
            items: [],
        });
        setItemSearchTerm('');
        setWarehouseStockByItem({});
        setItemUomUnits({});
        setShowModal(true);
    };

    const loadItemUoms = async (itemId: string) => {
        const id = String(itemId || '').trim();
        if (!id || itemUomUnits[id]) return;
        const supabase = getSupabaseClient();
        if (!supabase) return;
        try {
            const { data, error } = await supabase.rpc('list_item_uom_units', { p_item_id: id });
            if (error) throw error;
            const rows = (Array.isArray(data) ? data : []).map((r: any) => ({
                uomId: String(r?.uom_id || ''),
                uomCode: String(r?.uom_code || ''),
                uomName: String(r?.uom_name || ''),
                qtyInBase: Number(r?.qty_in_base || 1) || 1,
            })).filter((x: any) => x.uomId);
            setItemUomUnits((prev) => ({ ...prev, [id]: rows.length ? rows : [{ uomId: '', uomCode: 'base', uomName: 'Base', qtyInBase: 1 }] }));
        } catch {
            setItemUomUnits((prev) => ({ ...prev, [id]: [{ uomId: '', uomCode: 'base', uomName: 'Base', qtyInBase: 1 }] }));
        }
    };

    const selectedItemIds = useMemo(() => new Set(formData.items.map(i => i.itemId).filter(Boolean)), [formData.items]);
    const normalizedItemSearch = itemSearchTerm.trim().toLowerCase();
    const searchableItems = useMemo(() => {
        return menuItems.filter(mi => {
            if ((mi as any)?.status && String((mi as any)?.status) !== 'active') return false;
            const id = String(mi.id || '');
            const nameAr = String(mi?.name?.ar || '');
            const nameEn = String(mi?.name?.en || '');
            const barcode = String((mi as any)?.barcode || '');
            const sku = String((mi as any)?.sku || (mi as any)?.code || '');
            const hay = `${id} ${nameAr} ${nameEn} ${barcode} ${sku}`.toLowerCase();
            const matchesSearch = !normalizedItemSearch || hay.includes(normalizedItemSearch);
            if (!matchesSearch) return false;
            if (!formData.from_warehouse_id) return true;
            const available = Number(warehouseStockByItem[id]?.available || 0);
            if (normalizedItemSearch) return true;
            return available > 0 || selectedItemIds.has(id);
        });
    }, [menuItems, normalizedItemSearch, formData.from_warehouse_id, warehouseStockByItem, selectedItemIds]);

    const quickSearchItems = useMemo(() => searchableItems.slice(0, 8), [searchableItems]);

    const getItemLabel = (itemId: string) => {
        const found = menuItems.find(mi => String(mi.id) === String(itemId));
        if (!found) return itemId;
        return String(found?.name?.ar || found?.name?.en || found?.id || itemId);
    };

    const getUnitLabelAr = (rawUnit?: string) => {
        const byMeta = getUnitLabel(String(rawUnit || '').trim() as any, 'ar');
        if (byMeta && byMeta !== String(rawUnit || '').trim()) return byMeta;
        const u = String(rawUnit || '').trim().toLowerCase();
        const map: Record<string, string> = {
            piece: 'قطعة',
            pcs: 'قطعة',
            unit: 'وحدة',
            box: 'صندوق',
            carton: 'كرتون',
            pack: 'عبوة',
            bottle: 'زجاجة',
            can: 'علبة',
            bag: 'كيس',
            tray: 'صينية',
            kg: 'كجم',
            g: 'جم',
            gram: 'جم',
            liter: 'لتر',
            litre: 'لتر',
            l: 'لتر',
            ml: 'مل',
        };
        return map[u] || rawUnit || 'وحدة';
    };

    const addItem = () => {
        setFormData({
            ...formData,
            items: [...formData.items, { itemId: '', quantity: 0, notes: '', uomId: '' }],
        });
    };

    const addFirstSearchResult = () => {
        const first = (() => {
            if (!formData.from_warehouse_id) return searchableItems[0];
            const withStock = searchableItems.find((mi) => Number(warehouseStockByItem[String(mi.id)]?.available || 0) > 0);
            return withStock || searchableItems[0];
        })();
        if (!first) {
            showNotification('لا توجد نتيجة مطابقة للبحث', 'error');
            return;
        }
        if (selectedItemIds.has(String(first.id))) {
            showNotification('الصنف مضاف مسبقًا في القائمة', 'error');
            return;
        }
        setFormData({
            ...formData,
            items: [...formData.items, { itemId: String(first.id), quantity: 1, notes: '', uomId: '' }],
        });
        void loadItemUoms(String(first.id));
    };

    const updateItem = (index: number, field: string, value: any) => {
        if (field === 'itemId') {
            const duplicateAt = formData.items.findIndex((x, i) => i !== index && String(x.itemId) === String(value));
            if (duplicateAt >= 0) {
                showNotification('الصنف موجود مسبقًا في سطر آخر', 'error');
                return;
            }
        }
        const newItems = [...formData.items];
        newItems[index] = { ...newItems[index], [field]: value };
        if (field === 'itemId') {
            newItems[index].uomId = '';
            void loadItemUoms(String(value || ''));
        }
        setFormData({ ...formData, items: newItems });
    };

    const getUomFactor = (itemId: string, uomId?: string) => {
        const list = itemUomUnits[String(itemId)] || [];
        if (!uomId) {
            const base = list.find((u) => Math.abs(Number(u.qtyInBase || 1) - 1) < 1e-9);
            return Number(base?.qtyInBase || 1) || 1;
        }
        const found = list.find((u) => String(u.uomId) === String(uomId));
        return Number(found?.qtyInBase || 1) || 1;
    };
    const getQtyBase = (item: { itemId: string; quantity: number; uomId?: string }) => {
        return Number(item.quantity || 0) * getUomFactor(item.itemId, item.uomId);
    };

    const removeItem = (index: number) => {
        setFormData({
            ...formData,
            items: formData.items.filter((_, i) => i !== index),
        });
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!formData.from_warehouse_id || !formData.to_warehouse_id) {
            showNotification('يرجى اختيار المخازن', 'error');
            return;
        }

        if (formData.from_warehouse_id === formData.to_warehouse_id) {
            showNotification('لا يمكن النقل من وإلى نفس المخزن', 'error');
            return;
        }

        if (formData.items.length === 0) {
            showNotification('يرجى إضافة أصناف للنقل', 'error');
            return;
        }

        const invalidItems = formData.items.filter(item => !item.itemId || item.quantity <= 0);
        if (invalidItems.length > 0) {
            showNotification('يرجى التحقق من الأصناف والكميات', 'error');
            return;
        }

        const unique = new Set(formData.items.map(x => String(x.itemId)));
        if (unique.size !== formData.items.length) {
            showNotification('يوجد صنف مكرر، يرجى دمج الكميات في سطر واحد', 'error');
            return;
        }

        if (costViewCurrency !== baseCurrencyCode && Number(costViewRate || 0) <= 0) {
            showNotification('يرجى إدخال معامل تحويل صحيح لعملة تكلفة النقل', 'error');
            return;
        }

        try {
            await createTransfer(
                formData.from_warehouse_id,
                formData.to_warehouse_id,
                formData.transfer_date,
                formData.items.map((x) => ({ itemId: x.itemId, quantity: x.quantity, notes: x.notes, uomId: x.uomId })),
                formData.notes,
                formData.shipping_cost > 0 ? formData.shipping_cost : undefined,
                costViewCurrency,
                costViewCurrency === baseCurrencyCode ? 1 : Number(costViewRate || 0)
            );
            showNotification('تم إنشاء عملية النقل بنجاح', 'success');
            setShowModal(false);
        } catch (error: any) {
            showNotification(error.message || 'حدث خطأ', 'error');
        }
    };

    const handleComplete = async (transfer: WarehouseTransfer) => {
        if (completingTransferId) return; // منع الضغط المزدوج
        if (!confirm(`هل أنت متأكد من إتمام عملية النقل "${transfer.transferNumber}"؟`)) {
            return;
        }

        setCompletingTransferId(transfer.id);
        try {
            await completeTransfer(transfer.id);
            showNotification('تم إتمام عملية النقل بنجاح', 'success');
        } catch (error: any) {
            showNotification(error.message || 'حدث خطأ', 'error');
        } finally {
            setCompletingTransferId(null);
        }
    };

    const handleCancel = async (transfer: WarehouseTransfer) => {
        const reason = prompt('سبب الإلغاء (اختياري):');
        if (reason === null) return;

        try {
            await cancelTransfer(transfer.id, reason);
            showNotification('تم إلغاء عملية النقل', 'success');
        } catch (error: any) {
            showNotification(error.message || 'حدث خطأ', 'error');
        }
    };

    const handleVerifyTransfer = async (transfer: WarehouseTransfer) => {
        const supabase = getSupabaseClient();
        if (!supabase) {
            showNotification('قاعدة البيانات غير متاحة', 'error');
            return;
        }
        setVerifyingTransferId(transfer.id);
        try {
            const { data: itemRows, error: itemErr } = await supabase
                .from('warehouse_transfer_items')
                .select('item_id,quantity,transferred_quantity,menu_items(unit_type,base_unit,data)')
                .eq('transfer_id', transfer.id);
            if (itemErr) throw itemErr;

            const { data: movementRows, error: movementErr } = await supabase
                .from('inventory_movements')
                .select('item_id,movement_type,quantity')
                .eq('reference_table', 'warehouse_transfers')
                .eq('reference_id', transfer.id)
                .in('movement_type', ['transfer_out', 'transfer_in']);
            if (movementErr) throw movementErr;

            const movementByItem: Record<string, { movedOut: number; movedIn: number }> = {};
            for (const row of (Array.isArray(movementRows) ? movementRows : [])) {
                const itemId = String((row as any)?.item_id || '').trim();
                if (!itemId) continue;
                if (!movementByItem[itemId]) movementByItem[itemId] = { movedOut: 0, movedIn: 0 };
                const qty = Number((row as any)?.quantity || 0) || 0;
                const type = String((row as any)?.movement_type || '');
                if (type === 'transfer_out') movementByItem[itemId].movedOut += qty;
                if (type === 'transfer_in') movementByItem[itemId].movedIn += qty;
            }

            const rows = (Array.isArray(itemRows) ? itemRows : []).map((r: any) => {
                const itemId = String(r?.item_id || '');
                const itemFromContext = menuItems.find((mi) => String(mi.id) === itemId) as any;
                const unit = String(
                    r?.menu_items?.unit_type
                    || r?.menu_items?.base_unit
                    || r?.menu_items?.data?.unitType
                    || itemFromContext?.unitType
                    || itemFromContext?.baseUnit
                    || 'piece'
                ).trim();
                const requestedQty = Number(r?.quantity || 0) || 0;
                const transferredQty = Number(r?.transferred_quantity || 0) || 0;
                const movedOut = Number(movementByItem[itemId]?.movedOut || 0);
                const movedIn = Number(movementByItem[itemId]?.movedIn || 0);
                const ok = Math.abs(movedOut - transferredQty) < 1e-6 && Math.abs(movedIn - transferredQty) < 1e-6;
                return { itemId, unit, requestedQty, transferredQty, movedOut, movedIn, ok };
            });

            const allOk = rows.length > 0 && rows.every((r) => r.ok);
            setVerificationByTransferId((prev) => ({
                ...prev,
                [transfer.id]: {
                    checkedAt: new Date().toISOString(),
                    allOk,
                    rows,
                },
            }));
            if (allOk) {
                showNotification('تم التحقق بنجاح: كميات الأصناف متطابقة', 'success');
            } else {
                showNotification('نتيجة التحقق: توجد فروقات في بعض الأصناف', 'error');
            }
        } catch (e: any) {
            showNotification(String(e?.message || 'تعذر التحقق من النقل'), 'error');
        } finally {
            setVerifyingTransferId(null);
        }
    };

    const getStatusLabel = (status: string) => {
        const labels: Record<string, string> = {
            pending: 'قيد الانتظار',
            in_transit: 'قيد النقل',
            completed: 'مكتمل',
            cancelled: 'ملغي',
        };
        return labels[status] || status;
    };

    const getStatusColor = (status: string) => {
        const colors: Record<string, string> = {
            pending: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
            in_transit: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
            completed: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
            cancelled: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
        };
        return colors[status] || 'bg-gray-100 text-gray-800';
    };

    const estimatedBaseCost = useMemo(() => {
        const itemsCost = formData.items.reduce((sum, item) => {
            const avg = Number(warehouseStockByItem[item.itemId]?.avgCost || 0);
            const qty = getQtyBase(item);
            return sum + (avg * qty);
        }, 0);
        return itemsCost + Number(formData.shipping_cost || 0);
    }, [formData.items, formData.shipping_cost, warehouseStockByItem, itemUomUnits]);

    const estimatedDisplayCost = useMemo(() => {
        const rate = costViewCurrency === baseCurrencyCode ? 1 : Math.max(0, Number(costViewRate || 0));
        return estimatedBaseCost * rate;
    }, [estimatedBaseCost, costViewCurrency, costViewRate, baseCurrencyCode]);

    return (
        <div className="p-6">
            {/* Header */}
            <div className="mb-6">
                <h1 className="text-2xl font-bold mb-2">نقل البضائع بين المخازن</h1>
                <p className="text-gray-600 dark:text-gray-400">
                    إدارة عمليات نقل البضائع بين المخازن المختلفة
                </p>
            </div>
            <div className="mb-6 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg px-4 py-3 text-sm text-amber-800 dark:text-amber-200">
                النطاق التشغيلي الحالي مرتبط بالمستودع النشط: <span className="font-bold">{scopeWarehouseName}</span> — يمكنك عرض كل التحويلات أو تخصيص العرض لمستودع محدد من الفلتر.
            </div>

            {/* Filters and Actions */}
            <div className="mb-6 flex flex-col md:flex-row gap-4">
                {/* Search */}
                <div className="flex-1">
                    <div className="relative">
                        <Icons.Search className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                        <input
                            type="text"
                            placeholder="بحث برقم النقل أو المخزن..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full pr-10 pl-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800"
                        />
                    </div>
                </div>

                {/* Status Filter */}
                <select
                    value={filterStatus}
                    onChange={(e) => setFilterStatus(e.target.value)}
                    className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800"
                >
                    <option value="all">جميع الحالات</option>
                    <option value="pending">قيد الانتظار</option>
                    <option value="in_transit">قيد النقل</option>
                    <option value="completed">مكتمل</option>
                    <option value="cancelled">ملغي</option>
                </select>
                <select
                    value={filterWarehouseId}
                    onChange={(e) => setFilterWarehouseId(String(e.target.value || ''))}
                    className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800"
                >
                    <option value="">كل المستودعات</option>
                    {warehouses.map((w: any) => (
                        <option key={String(w.id)} value={String(w.id)}>{String(w.name || w.code || w.id)}</option>
                    ))}
                </select>

                {/* Add Button */}
                {canManage && (
                    <button
                        onClick={openAddModal}
                        className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-2 whitespace-nowrap"
                    >
                        <Icons.Plus className="w-5 h-5" />
                        نقل جديد
                    </button>
                )}
            </div>

            {/* Stats */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
                <div className="bg-white dark:bg-gray-800 p-4 rounded-lg border border-gray-200 dark:border-gray-700">
                    <div className="text-sm text-gray-600 dark:text-gray-400 mb-1">إجمالي العمليات</div>
                    <div className="text-2xl font-bold">{transfers.length}</div>
                </div>
                <div className="bg-white dark:bg-gray-800 p-4 rounded-lg border border-gray-200 dark:border-gray-700">
                    <div className="text-sm text-gray-600 dark:text-gray-400 mb-1">قيد الانتظار</div>
                    <div className="text-2xl font-bold text-yellow-600">
                        {transfers.filter(t => t.status === 'pending').length}
                    </div>
                </div>
                <div className="bg-white dark:bg-gray-800 p-4 rounded-lg border border-gray-200 dark:border-gray-700">
                    <div className="text-sm text-gray-600 dark:text-gray-400 mb-1">مكتمل</div>
                    <div className="text-2xl font-bold text-green-600">
                        {transfers.filter(t => t.status === 'completed').length}
                    </div>
                </div>
                <div className="bg-white dark:bg-gray-800 p-4 rounded-lg border border-gray-200 dark:border-gray-700">
                    <div className="text-sm text-gray-600 dark:text-gray-400 mb-1">ملغي</div>
                    <div className="text-2xl font-bold text-red-600">
                        {transfers.filter(t => t.status === 'cancelled').length}
                    </div>
                </div>
            </div>

            {/* Transfers List */}
            {filteredTransfers.length === 0 ? (
                <div className="text-center py-12 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
                    <Icons.Package className="w-16 h-16 mx-auto text-gray-400 mb-4" />
                    <p className="text-gray-600 dark:text-gray-400">لا توجد عمليات نقل</p>
                </div>
            ) : (
                <div className="space-y-4">
                    {filteredTransfers.map((transfer) => (
                        <div
                            key={transfer.id}
                            className="bg-white dark:bg-gray-800 p-6 rounded-lg border border-gray-200 dark:border-gray-700"
                        >
                            {/* Header */}
                            <div className="flex items-start justify-between mb-4">
                                <div>
                                    <div className="flex items-center gap-2 mb-1">
                                        <h3 className="text-lg font-bold">{transfer.transferNumber}</h3>
                                        <span className={`text-xs px-2 py-1 rounded ${getStatusColor(transfer.status)}`}>
                                            {getStatusLabel(transfer.status)}
                                        </span>
                                    </div>
                                    <p className="text-sm text-gray-600 dark:text-gray-400">
                                        {new Date(transfer.transferDate).toLocaleDateString('ar-EG-u-nu-latn')}
                                    </p>
                                </div>
                                <div className="flex items-center gap-2">
                                    <button
                                        type="button"
                                        onClick={() => { void handlePrintTransfer(transfer); }}
                                        className="px-3 py-2 bg-gray-900 text-white rounded-lg hover:bg-black text-sm font-semibold"
                                    >
                                        طباعة
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => { void handleVerifyTransfer(transfer); }}
                                        disabled={verifyingTransferId === transfer.id || transfer.status !== 'completed'}
                                        className="px-3 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        {verifyingTransferId === transfer.id ? 'جاري التحقق...' : 'تحقق من النقل'}
                                    </button>
                                </div>
                            </div>

                            {/* Transfer Info */}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                                <div className="flex items-center gap-2">
                                    <Icons.ArrowRight className="w-5 h-5 text-gray-400" />
                                    <div>
                                        <div className="text-xs text-gray-500">من</div>
                                        <div className="font-medium">{transfer.fromWarehouseName}</div>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2">
                                    <Icons.ArrowLeft className="w-5 h-5 text-gray-400" />
                                    <div>
                                        <div className="text-xs text-gray-500">إلى</div>
                                        <div className="font-medium">{transfer.toWarehouseName}</div>
                                    </div>
                                </div>
                            </div>

                            {Number(transfer.shippingCost || 0) > 0 && (
                                <div className="mb-4">
                                    <span className="inline-flex items-center gap-1 px-2 py-1 bg-purple-50 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300 rounded text-sm font-medium">
                                        <Icons.DollarSign className="w-4 h-4" />
                                        تكلفة الشحن/النقل: {Number(transfer.shippingCostForeign || transfer.shippingCost || 0).toLocaleString('en-US')} {String(transfer.shippingCostCurrency || baseCurrencyCode)} ({Number(transfer.shippingCostBase || transfer.shippingCost || 0).toLocaleString('en-US')} {baseCurrencyCode})
                                    </span>
                                </div>
                            )}

                            {/* Notes */}
                            {transfer.notes && (
                                <div className="mb-4 p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
                                    <div className="text-xs text-gray-500 mb-1">ملاحظات</div>
                                    <div className="text-sm">{transfer.notes}</div>
                                </div>
                            )}

                            {verificationByTransferId[transfer.id] && (
                                <div className={`mb-4 p-3 rounded-lg border ${verificationByTransferId[transfer.id].allOk ? 'bg-green-50 border-green-200 dark:bg-green-900/20 dark:border-green-800' : 'bg-amber-50 border-amber-200 dark:bg-amber-900/20 dark:border-amber-800'}`}>
                                    <div className="flex items-center justify-between mb-2">
                                        <div className="text-sm font-semibold">
                                            {verificationByTransferId[transfer.id].allOk ? 'نتيجة التحقق: متطابق' : 'نتيجة التحقق: يوجد فروقات'}
                                        </div>
                                        <div className="text-xs text-gray-600 dark:text-gray-300">
                                            {new Date(verificationByTransferId[transfer.id].checkedAt).toLocaleString('ar-EG-u-nu-latn')}
                                        </div>
                                    </div>
                                    <div className="overflow-x-auto">
                                        <table className="w-full text-xs">
                                            <thead>
                                                <tr className="text-right text-gray-600 dark:text-gray-300">
                                                    <th className="py-1">الصنف</th>
                                                    <th className="py-1">الوحدة</th>
                                                    <th className="py-1">الكمية المطلوبة</th>
                                                    <th className="py-1">الكمية المنقولة</th>
                                                    <th className="py-1">حركة خروج</th>
                                                    <th className="py-1">حركة دخول</th>
                                                    <th className="py-1">الحالة</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {verificationByTransferId[transfer.id].rows.map((row, idx) => (
                                                    <tr key={`${transfer.id}-${row.itemId}-${idx}`} className="border-t border-gray-200 dark:border-gray-700">
                                                        <td className="py-1">{getItemLabel(row.itemId)}</td>
                                                        <td className="py-1">{getUnitLabelAr(row.unit)}</td>
                                                        <td className="py-1">{row.requestedQty.toLocaleString('en-US')}</td>
                                                        <td className="py-1">{row.transferredQty.toLocaleString('en-US')}</td>
                                                        <td className="py-1">{row.movedOut.toLocaleString('en-US')}</td>
                                                        <td className="py-1">{row.movedIn.toLocaleString('en-US')}</td>
                                                        <td className={`py-1 font-semibold ${row.ok ? 'text-green-700 dark:text-green-300' : 'text-red-700 dark:text-red-300'}`}>{row.ok ? 'مطابق' : 'غير مطابق'}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            )}

                            {/* Actions */}
                            {canManage && transfer.status === 'pending' && (
                                <div className="flex gap-2 pt-4 border-t border-gray-200 dark:border-gray-700">
                                    <button
                                        onClick={() => handleComplete(transfer)}
                                        disabled={completingTransferId === transfer.id}
                                        className="flex-1 px-4 py-2 bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400 rounded-lg hover:bg-green-100 dark:hover:bg-green-900/30 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        <Icons.Check className="w-4 h-4" />
                                        {completingTransferId === transfer.id ? 'جاري الإتمام...' : 'إتمام النقل'}
                                    </button>
                                    <button
                                        onClick={() => handleCancel(transfer)}
                                        className="px-4 py-2 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/30 flex items-center gap-2"
                                    >
                                        <Icons.X className="w-4 h-4" />
                                        إلغاء
                                    </button>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}

            {/* Add Modal */}
            {showModal && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                    <div className="bg-white dark:bg-gray-800 rounded-lg max-w-4xl w-full max-h-[90vh] overflow-y-auto">
                        <div className="p-6">
                            <h2 className="text-xl font-bold mb-4">نقل بضائع جديد</h2>

                            <form onSubmit={handleSubmit} className="space-y-4">
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                    {/* From Warehouse */}
                                    <div>
                                        <label className="block text-sm font-medium mb-1">
                                            من المخزن <span className="text-red-500">*</span>
                                        </label>
                                        <select
                                            value={formData.from_warehouse_id}
                                            onChange={(e) => setFormData({ ...formData, from_warehouse_id: e.target.value })}
                                            className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700"
                                            required
                                        >
                                            <option value="">اختر المخزن</option>
                                            {warehouses.filter(w => w.isActive).map(w => (
                                                <option key={w.id} value={w.id}>{w.name}</option>
                                            ))}
                                        </select>
                                    </div>

                                    {/* To Warehouse */}
                                    <div>
                                        <label className="block text-sm font-medium mb-1">
                                            إلى المخزن <span className="text-red-500">*</span>
                                        </label>
                                        <select
                                            value={formData.to_warehouse_id}
                                            onChange={(e) => setFormData({ ...formData, to_warehouse_id: e.target.value })}
                                            className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700"
                                            required
                                        >
                                            <option value="">اختر المخزن</option>
                                            {warehouses.filter(w => w.isActive && w.id !== formData.from_warehouse_id).map(w => (
                                                <option key={w.id} value={w.id}>{w.name}</option>
                                            ))}
                                        </select>
                                    </div>

                                    {/* Date */}
                                    <div>
                                        <label className="block text-sm font-medium mb-1">
                                            التاريخ <span className="text-red-500">*</span>
                                        </label>
                                        <input
                                            type="date"
                                            value={formData.transfer_date}
                                            onChange={(e) => setFormData({ ...formData, transfer_date: e.target.value })}
                                            className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700"
                                            required
                                        />
                                    </div>
                                </div>

                                {/* Shipping Cost & Notes */}
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-sm font-medium mb-1">تكلفة الشحن/النقل (اختياري) — {costViewCurrency}</label>
                                        <input
                                            type="number"
                                            value={formData.shipping_cost || ''}
                                            onChange={(e) => setFormData({ ...formData, shipping_cost: parseFloat(e.target.value) || 0 })}
                                            className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700"
                                            min="0"
                                            step="0.01"
                                            placeholder="0.00"
                                        />
                                        <div className="mt-1 text-xs text-gray-500">
                                            سيتم حفظ تكلفة النقل بعملة {costViewCurrency} مع تحويل تلقائي لعملة الأساس {baseCurrencyCode}.
                                        </div>
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium mb-1">ملاحظات</label>
                                        <textarea
                                            value={formData.notes}
                                            onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                                            className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700"
                                            rows={2}
                                        />
                                    </div>
                                </div>

                                {/* Items */}
                                <div>
                                    <div className="flex items-center justify-between mb-2">
                                        <label className="block text-sm font-medium">
                                            الأصناف <span className="text-red-500">*</span>
                                        </label>
                                        <div className="flex items-center gap-3">
                                            {loadingWarehouseStock && (
                                                <span className="text-xs text-gray-500">جاري تحميل رصيد المخزن المصدر...</span>
                                            )}
                                            <button
                                                type="button"
                                                onClick={addItem}
                                                className="text-sm text-blue-600 hover:text-blue-700 flex items-center gap-1"
                                            >
                                                <Icons.Plus className="w-4 h-4" />
                                                إضافة صنف
                                            </button>
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mb-3">
                                        <div className="md:col-span-2 relative">
                                            <Icons.Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                                            <input
                                                type="text"
                                                value={itemSearchTerm}
                                                onChange={(e) => setItemSearchTerm(e.target.value)}
                                                className="w-full pr-9 pl-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700"
                                                placeholder="بحث سريع عن الصنف (الاسم/الباركود/المعرف)"
                                            />
                                            {normalizedItemSearch && (
                                                <div className="absolute top-full left-0 right-0 mt-1 z-20 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg overflow-hidden">
                                                    {quickSearchItems.length > 0 ? (
                                                        <div className="max-h-64 overflow-y-auto">
                                                            {quickSearchItems.map((mi) => {
                                                                const id = String(mi.id);
                                                                const label = String(mi?.name?.ar || mi?.name?.en || mi.id);
                                                                const available = Number(warehouseStockByItem[id]?.available || 0);
                                                                const alreadyAdded = selectedItemIds.has(id);
                                                                return (
                                                                    <button
                                                                        key={id}
                                                                        type="button"
                                                                        onClick={() => {
                                                                            if (alreadyAdded) return;
                                                                            setFormData({
                                                                                ...formData,
                                                                                items: [...formData.items, { itemId: id, quantity: 1, notes: '', uomId: '' }],
                                                                            });
                                                                            void loadItemUoms(id);
                                                                        }}
                                                                        disabled={alreadyAdded}
                                                                        className="w-full px-3 py-2 text-right hover:bg-blue-50 dark:hover:bg-blue-900/20 disabled:opacity-50 disabled:cursor-not-allowed border-b border-gray-100 dark:border-gray-700 last:border-b-0"
                                                                    >
                                                                        <div className="text-sm font-medium dark:text-white">{label}</div>
                                                                        <div className="text-xs text-gray-500">
                                                                            {formData.from_warehouse_id ? `الرصيد المتاح: ${available.toLocaleString('en-US')}` : 'اختر المخزن المصدر لعرض الرصيد'}
                                                                            {alreadyAdded ? ' — مضاف' : ''}
                                                                        </div>
                                                                    </button>
                                                                );
                                                            })}
                                                        </div>
                                                    ) : (
                                                        <div className="px-3 py-2 text-xs text-gray-500">لا توجد نتائج مطابقة</div>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                        <button
                                            type="button"
                                            onClick={addFirstSearchResult}
                                            className="px-3 py-2 border border-blue-200 text-blue-700 dark:border-blue-700 dark:text-blue-300 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/20"
                                        >
                                            إضافة أول نتيجة
                                        </button>
                                    </div>

                                    <div className="space-y-2">
                                        {formData.items.map((item, index) => (
                                            <div key={index} className="p-2 border border-gray-200 dark:border-gray-700 rounded-lg">
                                                <div className="flex gap-2">
                                                    <select
                                                        value={item.itemId}
                                                        onChange={(e) => updateItem(index, 'itemId', e.target.value)}
                                                        className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700"
                                                        required
                                                    >
                                                        <option value="">اختر الصنف</option>
                                                        {searchableItems.map(mi => (
                                                            <option key={mi.id} value={mi.id}>{String(mi?.name?.ar || mi?.name?.en || mi.id)}</option>
                                                        ))}
                                                    </select>
                                                    <select
                                                        value={item.uomId || ''}
                                                        onChange={(e) => updateItem(index, 'uomId', e.target.value)}
                                                        className="w-32 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700"
                                                        disabled={!item.itemId}
                                                    >
                                                        <option value="">الوحدة</option>
                                                        {(itemUomUnits[item.itemId] || []).map((u) => (
                                                            <option key={u.uomId || `${item.itemId}-${u.uomCode}`} value={u.uomId}>{u.uomCode || u.uomName}</option>
                                                        ))}
                                                    </select>
                                                    <input
                                                        type="number"
                                                        value={item.quantity}
                                                        onChange={(e) => updateItem(index, 'quantity', parseFloat(e.target.value))}
                                                        placeholder="الكمية (بوحدة الإدخال)"
                                                        className="w-32 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700"
                                                        min="0.01"
                                                        step="0.01"
                                                        required
                                                    />
                                                    <button
                                                        type="button"
                                                        onClick={() => removeItem(index)}
                                                        className="px-3 py-2 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/30"
                                                    >
                                                        <Icons.Trash className="w-4 h-4" />
                                                    </button>
                                                </div>
                                                {item.itemId && (
                                                    <div className="mt-2 text-xs text-gray-600 dark:text-gray-300 flex flex-wrap gap-3">
                                                        <span>الرصيد المتاح: {Number(warehouseStockByItem[item.itemId]?.available || 0).toLocaleString('en-US')}</span>
                                                        <span>متوسط التكلفة: {Number(warehouseStockByItem[item.itemId]?.avgCost || 0).toLocaleString('en-US')} {baseCurrencyCode}</span>
                                                        <span>كمية الأساس: {getQtyBase(item).toLocaleString('en-US')}</span>
                                                        <span>تكلفة تقديرية للسطر: {(getQtyBase(item) * Number(warehouseStockByItem[item.itemId]?.avgCost || 0)).toLocaleString('en-US')} {baseCurrencyCode}</span>
                                                        <span className="text-gray-500">الصنف: {getItemLabel(item.itemId)}</span>
                                                    </div>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                <div className="p-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/20">
                                    <div className="flex items-center justify-between mb-2">
                                        <div className="text-sm font-semibold">ملخص تكلفة النقل (تقديري)</div>
                                        <div className="text-xs text-gray-500">المرجع: متوسط تكلفة المخزن المصدر + تكلفة الشحن</div>
                                    </div>
                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
                                        <div>
                                            <label className="block text-xs text-gray-600 mb-1">عملة العرض</label>
                                            <select
                                                value={costViewCurrency}
                                                onChange={(e) => {
                                                    const v = String(e.target.value || '').toUpperCase();
                                                    setCostViewCurrency(v || baseCurrencyCode);
                                                    if (v === baseCurrencyCode) setCostViewRate(1);
                                                }}
                                                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700"
                                            >
                                                {operationalCurrencies.map((c) => (
                                                    <option key={c} value={c}>{c}</option>
                                                ))}
                                            </select>
                                        </div>
                                        <div>
                                            <label className="block text-xs text-gray-600 mb-1">معامل التحويل (1 {baseCurrencyCode} = ? {costViewCurrency})</label>
                                            <input
                                                type="number"
                                                value={costViewCurrency === baseCurrencyCode ? 1 : costViewRate}
                                                onChange={(e) => setCostViewRate(parseFloat(e.target.value) || 0)}
                                                min="0.000001"
                                                step="0.000001"
                                                disabled={costViewCurrency === baseCurrencyCode}
                                                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 disabled:opacity-60"
                                            />
                                        </div>
                                        <div className="text-sm">
                                            <div>الإجمالي التقديري ({baseCurrencyCode}): <span className="font-bold">{estimatedBaseCost.toLocaleString('en-US')}</span></div>
                                            <div>الإجمالي التقديري ({costViewCurrency}): <span className="font-bold">{estimatedDisplayCost.toLocaleString('en-US')}</span></div>
                                        </div>
                                    </div>
                                </div>

                                {/* Actions */}
                                <div className="flex gap-3 pt-4">
                                    <button
                                        type="submit"
                                        className="flex-1 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                                    >
                                        إنشاء عملية النقل
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setShowModal(false)}
                                        className="px-6 py-2 bg-gray-200 dark:bg-gray-700 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600"
                                    >
                                        إلغاء
                                    </button>
                                </div>
                            </form>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default WarehouseTransfersScreen;
