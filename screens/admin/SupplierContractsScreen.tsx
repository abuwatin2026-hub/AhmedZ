import React, { useState, useMemo } from 'react';
import { useSupplierEnhancement } from '../../contexts/SupplierEnhancementContext';
import { useSettings } from '../../contexts/SettingsContext';
import { SupplierContract } from '../../types';
import { usePurchases } from '../../contexts/PurchasesContext';
import { Plus, Search, Edit, Trash, X } from '../../components/icons';

const SupplierContractsScreen: React.FC = () => {
    const { t } = useSettings();
    const { contracts, loading, addContract, updateContract, deleteContract } = useSupplierEnhancement();
    const { suppliers } = usePurchases();
    const [searchTerm, setSearchTerm] = useState('');
    const [filterStatus, setFilterStatus] = useState<string>('all');
    const [isAddModalOpen, setIsAddModalOpen] = useState(false);
    const [editingContract, setEditingContract] = useState<SupplierContract | null>(null);

    // Form State
    const [formData, setFormData] = useState<Partial<SupplierContract>>({
        status: 'active',
        paymentTerms: 'net30',
        paymentTermsCustom: '',
        deliveryLeadTimeDays: 0,
        minimumOrderAmount: 0,
        notes: ''
    });

    const filteredContracts = useMemo(() => {
        return contracts.filter(c => {
            const matchesSearch = c.contractNumber?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                suppliers.find(s => s.id === c.supplierId)?.name.toLowerCase().includes(searchTerm.toLowerCase());
            const matchesStatus = filterStatus === 'all' || c.status === filterStatus;
            return matchesSearch && matchesStatus;
        });
    }, [contracts, searchTerm, filterStatus, suppliers]);

    const handleOpenAdd = () => {
        setEditingContract(null);
        setFormData({
            status: 'active',
            paymentTerms: 'net30',
            paymentTermsCustom: '',
            deliveryLeadTimeDays: 0,
            minimumOrderAmount: 0,
            notes: '',
            startDate: new Date().toISOString().split('T')[0],
            endDate: new Date(new Date().setFullYear(new Date().getFullYear() + 1)).toISOString().split('T')[0]
        });
        setIsAddModalOpen(true);
    };

    const handleOpenEdit = (contract: SupplierContract) => {
        setEditingContract(contract);
        setFormData({
            ...contract,
            startDate: contract.startDate.split('T')[0],
            endDate: contract.endDate.split('T')[0]
        });
        setIsAddModalOpen(true);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!formData.supplierId || !formData.startDate || !formData.endDate) return;

        try {
            if (editingContract) {
                await updateContract(editingContract.id, formData);
            } else {
                await addContract(formData as any);
            }
            setIsAddModalOpen(false);
        } catch (error) {
            console.error(error);
        }
    };

    const handleDelete = async (id: string) => {
        if (window.confirm(t('confirmDelete'))) {
            await deleteContract(id);
        }
    };

    const getSupplierName = (id: string) => suppliers.find(s => s.id === id)?.name || 'Unknown';

    if (loading) return <div className="p-8 text-center">Loading...</div>;

    return (
        <div className="p-6">
            <div className="flex justify-between items-center mb-6">
                <h1 className="text-2xl font-bold text-gray-800 dark:text-white">{t('supplierContracts')}</h1>
                <button
                    onClick={handleOpenAdd}
                    className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700"
                >
                    <Plus className="w-5 h-5" />
                    {t('addContract')}
                </button>
            </div>

            <div className="flex gap-4 mb-6">
                <div className="relative flex-1">
                    <Search className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5" />
                    <input
                        type="text"
                        placeholder={t('searchContracts')}
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full pr-10 pl-4 py-2 rounded-lg border border-gray-200 dark:border-gray-700 dark:bg-gray-800"
                    />
                </div>
                <select
                    value={filterStatus}
                    onChange={(e) => setFilterStatus(e.target.value)}
                    className="px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-700 dark:bg-gray-800"
                >
                    <option value="all">{t('allStatuses')}</option>
                    <option value="active">{t('active')}</option>
                    <option value="expired">{t('expired')}</option>
                    <option value="terminated">{t('terminated')}</option>
                    <option value="draft">{t('draft')}</option>
                </select>
            </div>

            <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
                <table className="w-full">
                    <thead className="bg-gray-50 dark:bg-gray-700">
                        <tr>
                            <th className="px-6 py-3 text-right text-sm font-medium text-gray-500 dark:text-gray-300">{t('contractNumber')}</th>
                            <th className="px-6 py-3 text-right text-sm font-medium text-gray-500 dark:text-gray-300">{t('supplier')}</th>
                            <th className="px-6 py-3 text-right text-sm font-medium text-gray-500 dark:text-gray-300">{t('duration')}</th>
                            <th className="px-6 py-3 text-right text-sm font-medium text-gray-500 dark:text-gray-300">{t('paymentTerms')}</th>
                            <th className="px-6 py-3 text-right text-sm font-medium text-gray-500 dark:text-gray-300">{t('status')}</th>
                            <th className="px-6 py-3 text-right text-sm font-medium text-gray-500 dark:text-gray-300">{t('actions')}</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                        {filteredContracts.map((contract) => (
                            <tr key={contract.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                                <td className="px-6 py-4 text-sm font-medium">{contract.contractNumber || '-'}</td>
                                <td className="px-6 py-4 text-sm">{getSupplierName(contract.supplierId)}</td>
                                <td className="px-6 py-4 text-sm">
                                    <div className="flex flex-col">
                                        <span>{contract.startDate.split('T')[0]}</span>
                                        <span className="text-gray-400 text-xs">to {contract.endDate.split('T')[0]}</span>
                                    </div>
                                </td>
                                <td className="px-6 py-4 text-sm">
                                    {contract.paymentTerms === 'custom' ? contract.paymentTermsCustom : contract.paymentTerms}
                                </td>
                                <td className="px-6 py-4 text-sm">
                                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${contract.status === 'active' ? 'bg-green-100 text-green-800' :
                                            contract.status === 'expired' ? 'bg-red-100 text-red-800' :
                                                'bg-gray-100 text-gray-800'
                                        }`}>
                                        {t(contract.status)}
                                    </span>
                                </td>
                                <td className="px-6 py-4 text-sm">
                                    <div className="flex gap-2">
                                        <button onClick={() => handleOpenEdit(contract)} className="p-1 text-blue-600 hover:bg-blue-50 rounded">
                                            <Edit className="w-4 h-4" />
                                        </button>
                                        <button onClick={() => handleDelete(contract.id)} className="p-1 text-red-600 hover:bg-red-50 rounded">
                                            <Trash className="w-4 h-4" />
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {/* Modal */}
            {isAddModalOpen && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
                    <div className="bg-white dark:bg-gray-800 rounded-lg w-full max-w-2xl max-h-[90vh] overflow-y-auto">
                        <div className="p-6 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center">
                            <h2 className="text-xl font-bold">{editingContract ? t('editContract') : t('addContract')}</h2>
                            <button onClick={() => setIsAddModalOpen(false)}><X className="w-6 h-6" /></button>
                        </div>
                        <form onSubmit={handleSubmit} className="p-6 space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium mb-1">{t('supplier')}</label>
                                    <select
                                        required
                                        className="w-full p-2 border rounded dark:bg-gray-700 dark:border-gray-600"
                                        value={formData.supplierId || ''}
                                        onChange={e => setFormData({ ...formData, supplierId: e.target.value })}
                                    >
                                        <option value="">{t('selectSupplier')}</option>
                                        {suppliers.map(s => (
                                            <option key={s.id} value={s.id}>{s.name}</option>
                                        ))}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium mb-1">{t('contractNumber')}</label>
                                    <input
                                        type="text"
                                        className="w-full p-2 border rounded dark:bg-gray-700 dark:border-gray-600"
                                        value={formData.contractNumber || ''}
                                        onChange={e => setFormData({ ...formData, contractNumber: e.target.value })}
                                    />
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium mb-1">{t('startDate')}</label>
                                    <input
                                        type="date"
                                        required
                                        className="w-full p-2 border rounded dark:bg-gray-700 dark:border-gray-600"
                                        value={formData.startDate || ''}
                                        onChange={e => setFormData({ ...formData, startDate: e.target.value })}
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium mb-1">{t('endDate')}</label>
                                    <input
                                        type="date"
                                        required
                                        className="w-full p-2 border rounded dark:bg-gray-700 dark:border-gray-600"
                                        value={formData.endDate || ''}
                                        onChange={e => setFormData({ ...formData, endDate: e.target.value })}
                                    />
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium mb-1">{t('paymentTerms')}</label>
                                    <select
                                        className="w-full p-2 border rounded dark:bg-gray-700 dark:border-gray-600"
                                        value={formData.paymentTerms || 'net30'}
                                        onChange={e => setFormData({ ...formData, paymentTerms: e.target.value as any })}
                                    >
                                        <option value="cash">{t('cash')}</option>
                                        <option value="net15">{t('net15')}</option>
                                        <option value="net30">{t('net30')}</option>
                                        <option value="net45">{t('net45')}</option>
                                        <option value="net60">{t('net60')}</option>
                                        <option value="custom">{t('custom')}</option>
                                    </select>
                                </div>
                                {formData.paymentTerms === 'custom' && (
                                    <div>
                                        <label className="block text-sm font-medium mb-1">{t('customTerms')}</label>
                                        <input
                                            type="text"
                                            className="w-full p-2 border rounded dark:bg-gray-700 dark:border-gray-600"
                                            value={formData.paymentTermsCustom || ''}
                                            onChange={e => setFormData({ ...formData, paymentTermsCustom: e.target.value })}
                                        />
                                    </div>
                                )}
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium mb-1">{t('minOrderAmount')}</label>
                                    <input
                                        type="number"
                                        className="w-full p-2 border rounded dark:bg-gray-700 dark:border-gray-600"
                                        value={formData.minimumOrderAmount || 0}
                                        onChange={e => setFormData({ ...formData, minimumOrderAmount: parseFloat(e.target.value) })}
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium mb-1">{t('leadTimeDays')}</label>
                                    <input
                                        type="number"
                                        className="w-full p-2 border rounded dark:bg-gray-700 dark:border-gray-600"
                                        value={formData.deliveryLeadTimeDays || 0}
                                        onChange={e => setFormData({ ...formData, deliveryLeadTimeDays: parseInt(e.target.value) })}
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="block text-sm font-medium mb-1">{t('status')}</label>
                                <select
                                    className="w-full p-2 border rounded dark:bg-gray-700 dark:border-gray-600"
                                    value={formData.status}
                                    onChange={e => setFormData({ ...formData, status: e.target.value as any })}
                                >
                                    <option value="active">{t('active')}</option>
                                    <option value="expired">{t('expired')}</option>
                                    <option value="terminated">{t('terminated')}</option>
                                    <option value="draft">{t('draft')}</option>
                                </select>
                            </div>

                            <div>
                                <label className="block text-sm font-medium mb-1">{t('notes')}</label>
                                <textarea
                                    className="w-full p-2 border rounded dark:bg-gray-700 dark:border-gray-600"
                                    rows={3}
                                    value={formData.notes || ''}
                                    onChange={e => setFormData({ ...formData, notes: e.target.value })}
                                />
                            </div>

                            <div className="flex justify-end gap-3 pt-4">
                                <button
                                    type="button"
                                    onClick={() => setIsAddModalOpen(false)}
                                    className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg dark:text-gray-300 dark:hover:bg-gray-700"
                                >
                                    {t('cancel')}
                                </button>
                                <button
                                    type="submit"
                                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                                >
                                    {t('save')}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};

export default SupplierContractsScreen;
