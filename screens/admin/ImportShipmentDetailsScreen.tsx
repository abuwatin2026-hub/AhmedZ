import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useImport } from '../../contexts/ImportContext';
import { useMenu } from '../../contexts/MenuContext';
import { ImportShipment, ImportShipmentItem, ImportExpense } from '../../types';
import { Plus, X, DollarSign, ArrowLeft } from '../../components/icons';

const ImportShipmentDetailsScreen: React.FC = () => {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const { getShipmentDetails, updateShipment, addShipmentItem, deleteShipmentItem, addExpense, deleteExpense, calculateLandedCost } = useImport();
    const { menuItems } = useMenu();

    const [shipment, setShipment] = useState<ImportShipment | null>(null);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState<'items' | 'expenses'>('items');

    // Form states for adding items
    const [showItemForm, setShowItemForm] = useState(false);
    const [newItem, setNewItem] = useState({
        itemId: '',
        quantity: 0,
        unitPriceFob: 0,
        currency: 'USD',
        expiryDate: '',
        notes: ''
    });

    // Form states for adding expenses
    const [showExpenseForm, setShowExpenseForm] = useState(false);
    const [newExpense, setNewExpense] = useState({
        expenseType: 'shipping' as ImportExpense['expenseType'],
        amount: 0,
        currency: 'YER',
        exchangeRate: 1,
        description: '',
        invoiceNumber: '',
        paidAt: ''
    });

    useEffect(() => {
        loadShipment();
    }, [id]);

    const loadShipment = async () => {
        if (!id) return;
        setLoading(true);
        const data = await getShipmentDetails(id);
        setShipment(data);
        setLoading(false);
    };

    const handleAddItem = async () => {
        if (!id || !newItem.itemId || newItem.quantity <= 0) return;

        await addShipmentItem({
            shipmentId: id,
            itemId: newItem.itemId,
            quantity: newItem.quantity,
            unitPriceFob: newItem.unitPriceFob,
            currency: newItem.currency,
            expiryDate: newItem.expiryDate || undefined,
            notes: newItem.notes || undefined
        });

        setShowItemForm(false);
        setNewItem({ itemId: '', quantity: 0, unitPriceFob: 0, currency: 'USD', expiryDate: '', notes: '' });
        loadShipment();
    };

    const handleDeleteItem = async (itemId: string) => {
        if (window.confirm('هل أنت متأكد من حذف هذا الصنف؟')) {
            await deleteShipmentItem(itemId);
            loadShipment();
        }
    };

    const handleAddExpense = async () => {
        if (!id || newExpense.amount <= 0) return;

        await addExpense({
            shipmentId: id,
            expenseType: newExpense.expenseType,
            amount: newExpense.amount,
            currency: newExpense.currency,
            exchangeRate: newExpense.exchangeRate,
            description: newExpense.description || undefined,
            invoiceNumber: newExpense.invoiceNumber || undefined,
            paidAt: newExpense.paidAt || undefined
        });

        setShowExpenseForm(false);
        setNewExpense({ expenseType: 'shipping', amount: 0, currency: 'YER', exchangeRate: 1, description: '', invoiceNumber: '', paidAt: '' });
        loadShipment();
    };

    const handleDeleteExpense = async (expenseId: string) => {
        if (window.confirm('هل أنت متأكد من حذف هذا المصروف؟')) {
            await deleteExpense(expenseId);
            loadShipment();
        }
    };

    const handleCalculateCost = async () => {
        if (!id) return;
        await calculateLandedCost(id);
        loadShipment();
    };

    const handleUpdateStatus = async (status: ImportShipment['status']) => {
        if (!id) return;
        await updateShipment(id, { status });
        loadShipment();
    };

    const getExpenseTypeLabel = (type: ImportExpense['expenseType']) => {
        const labels: Record<ImportExpense['expenseType'], string> = {
            shipping: 'شحن',
            customs: 'جمارك',
            insurance: 'تأمين',
            clearance: 'تخليص',
            transport: 'نقل',
            other: 'أخرى'
        };
        return labels[type];
    };

    const calculateTotals = () => {
        if (!shipment) return { itemsTotal: 0, expensesTotal: 0, grandTotal: 0 };

        const itemsTotal = shipment.items?.reduce((sum, item) => sum + (item.quantity * item.unitPriceFob), 0) || 0;
        const expensesTotal = shipment.expenses?.reduce((sum, exp) => sum + (exp.amount * exp.exchangeRate), 0) || 0;

        return { itemsTotal, expensesTotal, grandTotal: itemsTotal + expensesTotal };
    };

    if (loading) {
        return <div className="flex items-center justify-center min-h-screen">جاري التحميل...</div>;
    }

    if (!shipment) {
        return <div className="p-6">الشحنة غير موجودة</div>;
    }

    const totals = calculateTotals();

    return (
        <div className="p-6 max-w-7xl mx-auto">
            {/* Header */}
            <div className="mb-6">
                <button
                    onClick={() => navigate('/admin/import-shipments')}
                    className="flex items-center gap-2 text-blue-600 hover:underline mb-4"
                >
                    <ArrowLeft className="w-4 h-4" />
                    العودة للشحنات
                </button>

                <div className="flex justify-between items-start">
                    <div>
                        <h1 className="text-3xl font-bold mb-2">{shipment.referenceNumber}</h1>
                        <p className="text-gray-600">
                            {shipment.originCountry && `من: ${shipment.originCountry}`}
                        </p>
                    </div>

                    <div className="flex gap-2">
                        <select
                            value={shipment.status}
                            onChange={(e) => handleUpdateStatus(e.target.value as ImportShipment['status'])}
                            className="px-4 py-2 border rounded-lg"
                        >
                            <option value="draft">مسودة</option>
                            <option value="ordered">تم الطلب</option>
                            <option value="shipped">قيد الشحن</option>
                            <option value="at_customs">في الجمارك</option>
                            <option value="cleared">تم التخليص</option>
                            <option value="delivered">تم التسليم</option>
                            <option value="cancelled">ملغي</option>
                        </select>

                        <button
                            onClick={handleCalculateCost}
                            className="bg-green-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-green-700"
                        >
                            <DollarSign className="w-5 h-5" />
                            احتساب التكلفة
                        </button>
                    </div>
                </div>
            </div>

            {/* Summary Cards */}
            <div className="grid grid-cols-3 gap-4 mb-6">
                <div className="bg-blue-50 p-4 rounded-lg">
                    <div className="text-sm text-gray-600">قيمة البضائع (FOB)</div>
                    <div className="text-2xl font-bold">{totals.itemsTotal.toFixed(2)}</div>
                </div>
                <div className="bg-orange-50 p-4 rounded-lg">
                    <div className="text-sm text-gray-600">المصاريف الإضافية</div>
                    <div className="text-2xl font-bold">{totals.expensesTotal.toFixed(2)}</div>
                </div>
                <div className="bg-green-50 p-4 rounded-lg">
                    <div className="text-sm text-gray-600">الإجمالي</div>
                    <div className="text-2xl font-bold">{totals.grandTotal.toFixed(2)}</div>
                </div>
            </div>

            {/* Tabs */}
            <div className="border-b mb-6">
                <div className="flex gap-4">
                    <button
                        onClick={() => setActiveTab('items')}
                        className={`pb-2 px-4 ${activeTab === 'items' ? 'border-b-2 border-blue-600 text-blue-600 font-semibold' : 'text-gray-600'}`}
                    >
                        الأصناف ({shipment.items?.length || 0})
                    </button>
                    <button
                        onClick={() => setActiveTab('expenses')}
                        className={`pb-2 px-4 ${activeTab === 'expenses' ? 'border-b-2 border-blue-600 text-blue-600 font-semibold' : 'text-gray-600'}`}
                    >
                        المصاريف ({shipment.expenses?.length || 0})
                    </button>
                </div>
            </div>

            {/* Items Tab */}
            {activeTab === 'items' && (
                <div>
                    <div className="flex justify-between items-center mb-4">
                        <h2 className="text-xl font-semibold">أصناف الشحنة</h2>
                        <button
                            onClick={() => setShowItemForm(!showItemForm)}
                            className="bg-blue-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-blue-700"
                        >
                            <Plus className="w-5 h-5" />
                            إضافة صنف
                        </button>
                    </div>

                    {showItemForm && (
                        <div className="bg-gray-50 p-4 rounded-lg mb-4">
                            <div className="grid grid-cols-2 gap-4 mb-4">
                                <div>
                                    <label className="block text-sm font-medium mb-1">الصنف</label>
                                    <select
                                        value={newItem.itemId}
                                        onChange={(e) => setNewItem({ ...newItem, itemId: e.target.value })}
                                        className="w-full px-3 py-2 border rounded-lg"
                                    >
                                        <option value="">اختر صنف</option>
                                        {menuItems.map((item: any) => (
                                            <option key={item.id} value={item.id}>{item.name.ar}</option>
                                        ))}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium mb-1">الكمية</label>
                                    <input
                                        type="number"
                                        value={newItem.quantity}
                                        onChange={(e) => setNewItem({ ...newItem, quantity: Number(e.target.value) })}
                                        className="w-full px-3 py-2 border rounded-lg"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium mb-1">سعر الوحدة (FOB)</label>
                                    <input
                                        type="number"
                                        step="0.01"
                                        value={newItem.unitPriceFob}
                                        onChange={(e) => setNewItem({ ...newItem, unitPriceFob: Number(e.target.value) })}
                                        className="w-full px-3 py-2 border rounded-lg"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium mb-1">العملة</label>
                                    <select
                                        value={newItem.currency}
                                        onChange={(e) => setNewItem({ ...newItem, currency: e.target.value })}
                                        className="w-full px-3 py-2 border rounded-lg"
                                    >
                                        <option value="USD">USD</option>
                                        <option value="EUR">EUR</option>
                                        <option value="YER">YER</option>
                                    </select>
                                </div>
                            </div>
                            <div className="flex gap-2">
                                <button
                                    onClick={handleAddItem}
                                    className="bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700"
                                >
                                    حفظ
                                </button>
                                <button
                                    onClick={() => setShowItemForm(false)}
                                    className="bg-gray-300 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-400"
                                >
                                    إلغاء
                                </button>
                            </div>
                        </div>
                    )}

                    <div className="space-y-2">
                        {shipment.items?.map((item: ImportShipmentItem) => {
                            const menuItem = menuItems.find((m: any) => m.id === item.itemId);
                            return (
                                <div key={item.id} className="bg-white border rounded-lg p-4 flex justify-between items-center">
                                    <div className="flex-1">
                                        <div className="font-semibold">{menuItem?.name.ar || item.itemId}</div>
                                        <div className="text-sm text-gray-600">
                                            الكمية: {item.quantity} | السعر: {item.unitPriceFob} {item.currency}
                                            {item.landingCostPerUnit && ` | التكلفة النهائية: ${item.landingCostPerUnit.toFixed(2)}`}
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => handleDeleteItem(item.id)}
                                        className="text-red-600 hover:text-red-800"
                                    >
                                        <X className="w-5 h-5" />
                                    </button>
                                </div>
                            );
                        })}
                        {(!shipment.items || shipment.items.length === 0) && (
                            <div className="text-center py-8 text-gray-500">لا توجد أصناف</div>
                        )}
                    </div>
                </div>
            )}

            {/* Expenses Tab */}
            {activeTab === 'expenses' && (
                <div>
                    <div className="flex justify-between items-center mb-4">
                        <h2 className="text-xl font-semibold">مصاريف الشحنة</h2>
                        <button
                            onClick={() => setShowExpenseForm(!showExpenseForm)}
                            className="bg-blue-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-blue-700"
                        >
                            <Plus className="w-5 h-5" />
                            إضافة مصروف
                        </button>
                    </div>

                    {showExpenseForm && (
                        <div className="bg-gray-50 p-4 rounded-lg mb-4">
                            <div className="grid grid-cols-2 gap-4 mb-4">
                                <div>
                                    <label className="block text-sm font-medium mb-1">نوع المصروف</label>
                                    <select
                                        value={newExpense.expenseType}
                                        onChange={(e) => setNewExpense({ ...newExpense, expenseType: e.target.value as ImportExpense['expenseType'] })}
                                        className="w-full px-3 py-2 border rounded-lg"
                                    >
                                        <option value="shipping">شحن</option>
                                        <option value="customs">جمارك</option>
                                        <option value="insurance">تأمين</option>
                                        <option value="clearance">تخليص</option>
                                        <option value="transport">نقل</option>
                                        <option value="other">أخرى</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium mb-1">المبلغ</label>
                                    <input
                                        type="number"
                                        step="0.01"
                                        value={newExpense.amount}
                                        onChange={(e) => setNewExpense({ ...newExpense, amount: Number(e.target.value) })}
                                        className="w-full px-3 py-2 border rounded-lg"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium mb-1">العملة</label>
                                    <select
                                        value={newExpense.currency}
                                        onChange={(e) => setNewExpense({ ...newExpense, currency: e.target.value })}
                                        className="w-full px-3 py-2 border rounded-lg"
                                    >
                                        <option value="YER">YER</option>
                                        <option value="USD">USD</option>
                                        <option value="EUR">EUR</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium mb-1">سعر الصرف</label>
                                    <input
                                        type="number"
                                        step="0.01"
                                        value={newExpense.exchangeRate}
                                        onChange={(e) => setNewExpense({ ...newExpense, exchangeRate: Number(e.target.value) })}
                                        className="w-full px-3 py-2 border rounded-lg"
                                    />
                                </div>
                                <div className="col-span-2">
                                    <label className="block text-sm font-medium mb-1">الوصف</label>
                                    <input
                                        type="text"
                                        value={newExpense.description}
                                        onChange={(e) => setNewExpense({ ...newExpense, description: e.target.value })}
                                        className="w-full px-3 py-2 border rounded-lg"
                                    />
                                </div>
                            </div>
                            <div className="flex gap-2">
                                <button
                                    onClick={handleAddExpense}
                                    className="bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700"
                                >
                                    حفظ
                                </button>
                                <button
                                    onClick={() => setShowExpenseForm(false)}
                                    className="bg-gray-300 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-400"
                                >
                                    إلغاء
                                </button>
                            </div>
                        </div>
                    )}

                    <div className="space-y-2">
                        {shipment.expenses?.map((expense: ImportExpense) => (
                            <div key={expense.id} className="bg-white border rounded-lg p-4 flex justify-between items-center">
                                <div className="flex-1">
                                    <div className="font-semibold">{getExpenseTypeLabel(expense.expenseType)}</div>
                                    <div className="text-sm text-gray-600">
                                        {expense.amount} {expense.currency} × {expense.exchangeRate} = {(expense.amount * expense.exchangeRate).toFixed(2)}
                                        {expense.description && ` | ${expense.description}`}
                                    </div>
                                </div>
                                <button
                                    onClick={() => handleDeleteExpense(expense.id)}
                                    className="text-red-600 hover:text-red-800"
                                >
                                    <X className="w-5 h-5" />
                                </button>
                            </div>
                        ))}
                        {(!shipment.expenses || shipment.expenses.length === 0) && (
                            <div className="text-center py-8 text-gray-500">لا توجد مصاريف</div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

export default ImportShipmentDetailsScreen;
