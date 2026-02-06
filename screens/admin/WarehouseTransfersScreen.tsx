import React, { useState, useMemo } from 'react';
import { useWarehouses } from '../../contexts/WarehouseContext';
import { useMenu } from '../../contexts/MenuContext';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { useSettings } from '../../contexts/SettingsContext';
import { useSessionScope } from '../../contexts/SessionScopeContext';
import { getSupabaseClient } from '../../supabase';
import { printContent } from '../../utils/printUtils';
import { renderToString } from 'react-dom/server';
import PrintableWarehouseTransfer, { PrintableWarehouseTransferData } from '../../components/admin/documents/PrintableWarehouseTransfer';
import * as Icons from '../../components/icons';
import type { WarehouseTransfer } from '../../types';
import { toYmdLocal } from '../../utils/dateUtils';

const WarehouseTransfersScreen: React.FC = () => {
    const { warehouses, transfers, createTransfer, completeTransfer, cancelTransfer } = useWarehouses();
    const { menuItems } = useMenu();
    const { hasPermission } = useAuth();
    const { showNotification } = useToast();
    const { settings } = useSettings();
    const { scope } = useSessionScope();

    const [showModal, setShowModal] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [filterStatus, setFilterStatus] = useState<string>('all');

    // Form state
    const [formData, setFormData] = useState({
        from_warehouse_id: '',
        to_warehouse_id: '',
        transfer_date: toYmdLocal(new Date()),
        notes: '',
        items: [] as Array<{ itemId: string; quantity: number; notes: string }>,
    });

    const canManage = hasPermission('stock.manage');

    const resolveBrandingForWarehouseId = (warehouseId?: string) => {
        const fallback = {
            name: (settings as any)?.cafeteriaName?.ar || (settings as any)?.cafeteriaName?.en || '',
            address: settings?.address || '',
            contactNumber: settings?.contactNumber || '',
            logoUrl: settings?.logoUrl || '',
        };
        const wid = String(warehouseId || '').trim();
        const wh = wid ? warehouses.find(w => String(w.id) === wid) : undefined;
        const override = wid ? settings?.branchBranding?.[wid] : undefined;
        return {
            name: (override?.name || wh?.name || fallback.name || '').trim(),
            address: (override?.address || wh?.address || wh?.location || fallback.address || '').trim(),
            contactNumber: (override?.contactNumber || wh?.phone || fallback.contactNumber || '').trim(),
            logoUrl: (override?.logoUrl || fallback.logoUrl || '').trim(),
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
                .select('item_id,quantity,notes,menu_items(name)')
                .eq('transfer_id', transfer.id)
                .order('created_at', { ascending: true });
            if (error) throw error;
            const list = (Array.isArray(items) ? items : []).map((r: any) => ({
                itemId: String(r.item_id),
                itemName: String(r?.menu_items?.name?.ar || r?.menu_items?.name?.en || r.item_id),
                quantity: Number(r.quantity || 0),
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
            const content = renderToString(
                <PrintableWarehouseTransfer
                    data={data}
                    language="ar"
                    brand={{
                        ...brand,
                        branchName: branchHdr.branchName,
                        branchCode: branchHdr.branchCode,
                    }}
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

            return matchesSearch && matchesStatus;
        });
    }, [transfers, searchTerm, filterStatus]);

    const openAddModal = () => {
        setFormData({
            from_warehouse_id: '',
            to_warehouse_id: '',
            transfer_date: toYmdLocal(new Date()),
            notes: '',
            items: [],
        });
        setShowModal(true);
    };

    const addItem = () => {
        setFormData({
            ...formData,
            items: [...formData.items, { itemId: '', quantity: 0, notes: '' }],
        });
    };

    const updateItem = (index: number, field: string, value: any) => {
        const newItems = [...formData.items];
        newItems[index] = { ...newItems[index], [field]: value };
        setFormData({ ...formData, items: newItems });
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

        try {
            await createTransfer(
                formData.from_warehouse_id,
                formData.to_warehouse_id,
                formData.transfer_date,
                formData.items,
                formData.notes
            );
            showNotification('تم إنشاء عملية النقل بنجاح', 'success');
            setShowModal(false);
        } catch (error: any) {
            showNotification(error.message || 'حدث خطأ', 'error');
        }
    };

    const handleComplete = async (transfer: WarehouseTransfer) => {
        if (!confirm(`هل أنت متأكد من إتمام عملية النقل "${transfer.transferNumber}"؟`)) {
            return;
        }

        try {
            await completeTransfer(transfer.id);
            showNotification('تم إتمام عملية النقل بنجاح', 'success');
        } catch (error: any) {
            showNotification(error.message || 'حدث خطأ', 'error');
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

    return (
        <div className="p-6">
            {/* Header */}
            <div className="mb-6">
                <h1 className="text-2xl font-bold mb-2">نقل البضائع بين المخازن</h1>
                <p className="text-gray-600 dark:text-gray-400">
                    إدارة عمليات نقل البضائع بين المخازن المختلفة
                </p>
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

                            {/* Notes */}
                            {transfer.notes && (
                                <div className="mb-4 p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
                                    <div className="text-xs text-gray-500 mb-1">ملاحظات</div>
                                    <div className="text-sm">{transfer.notes}</div>
                                </div>
                            )}

                            {/* Actions */}
                            {canManage && transfer.status === 'pending' && (
                                <div className="flex gap-2 pt-4 border-t border-gray-200 dark:border-gray-700">
                                    <button
                                        onClick={() => handleComplete(transfer)}
                                        className="flex-1 px-4 py-2 bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400 rounded-lg hover:bg-green-100 dark:hover:bg-green-900/30 flex items-center justify-center gap-2"
                                    >
                                        <Icons.Check className="w-4 h-4" />
                                        إتمام النقل
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

                                {/* Notes */}
                                <div>
                                    <label className="block text-sm font-medium mb-1">ملاحظات</label>
                                    <textarea
                                        value={formData.notes}
                                        onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                                        className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700"
                                        rows={2}
                                    />
                                </div>

                                {/* Items */}
                                <div>
                                    <div className="flex items-center justify-between mb-2">
                                        <label className="block text-sm font-medium">
                                            الأصناف <span className="text-red-500">*</span>
                                        </label>
                                        <button
                                            type="button"
                                            onClick={addItem}
                                            className="text-sm text-blue-600 hover:text-blue-700 flex items-center gap-1"
                                        >
                                            <Icons.Plus className="w-4 h-4" />
                                            إضافة صنف
                                        </button>
                                    </div>

                                    <div className="space-y-2">
                                        {formData.items.map((item, index) => (
                                            <div key={index} className="flex gap-2">
                                                <select
                                                    value={item.itemId}
                                                    onChange={(e) => updateItem(index, 'itemId', e.target.value)}
                                                    className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700"
                                                    required
                                                >
                                                    <option value="">اختر الصنف</option>
                                                    {menuItems.map(mi => (
                                                        <option key={mi.id} value={mi.id}>{mi.name.ar}</option>
                                                    ))}
                                                </select>
                                                <input
                                                    type="number"
                                                    value={item.quantity}
                                                    onChange={(e) => updateItem(index, 'quantity', parseFloat(e.target.value))}
                                                    placeholder="الكمية"
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
                                        ))}
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
