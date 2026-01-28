import React, { useState, useMemo } from 'react';
import { useSupplierEnhancement } from '../../contexts/SupplierEnhancementContext';
import { useSettings } from '../../contexts/SettingsContext';
import { SupplierEvaluation } from '../../types';
import { usePurchases } from '../../contexts/PurchasesContext';
import { Plus, Search, X } from '../../components/icons';
import { normalizeIsoDateOnly, toYmdLocal } from '../../utils/dateUtils';

const SupplierEvaluationsScreen: React.FC = () => {
    const { t } = useSettings();
    const { evaluations, loading, addEvaluation, updateEvaluation, deleteEvaluation } = useSupplierEnhancement();
    const { suppliers } = usePurchases();
    const [searchTerm, setSearchTerm] = useState('');
    const [isAddModalOpen, setIsAddModalOpen] = useState(false);
    const [editingEvaluation, setEditingEvaluation] = useState<SupplierEvaluation | null>(null);

    // Form State
    const [formData, setFormData] = useState<Partial<SupplierEvaluation>>({
        qualityScore: 3,
        timelinessScore: 3,
        pricingScore: 3,
        communicationScore: 3,
        notes: '',
        recommendation: 'maintain'
    });

    const filteredEvaluations = useMemo(() => {
        return evaluations.filter(e => {
            return suppliers.find(s => s.id === e.supplierId)?.name.toLowerCase().includes(searchTerm.toLowerCase());
        });
    }, [evaluations, searchTerm, suppliers]);

    const handleOpenAdd = () => {
        setEditingEvaluation(null);
        setFormData({
            qualityScore: 3,
            timelinessScore: 3,
            pricingScore: 3,
            communicationScore: 3,
            notes: '',
            recommendation: 'maintain',
            evaluationDate: toYmdLocal(new Date())
        });
        setIsAddModalOpen(true);
    };

    const handleOpenEdit = (evaluation: SupplierEvaluation) => {
        setEditingEvaluation(evaluation);
        setFormData({
            ...evaluation,
            evaluationDate: normalizeIsoDateOnly(evaluation.evaluationDate)
        });
        setIsAddModalOpen(true);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!formData.supplierId || !formData.evaluationDate) return;

        try {
            if (editingEvaluation) {
                await updateEvaluation(editingEvaluation.id, formData);
            } else {
                await addEvaluation(formData as any);
            }
            setIsAddModalOpen(false);
        } catch (error) {
            console.error(error);
        }
    };

    const handleDelete = async (id: string) => {
        if (window.confirm(t('confirmDelete'))) {
            await deleteEvaluation(id);
        }
    };

    const getSupplierName = (id: string) => suppliers.find(s => s.id === id)?.name || t('unknown');

    const renderStars = (score: number) => {
        return (
            <div className="flex text-yellow-500">
                {[1, 2, 3, 4, 5].map(i => (
                    <span key={i} className={i <= score ? 'fill-current' : 'text-gray-300'}>★</span>
                ))}
            </div>
        );
    };

    const getScoreColor = (score: number) => {
        if (score >= 4) return 'bg-green-100 text-green-800';
        if (score >= 3) return 'bg-yellow-100 text-yellow-800';
        return 'bg-red-100 text-red-800';
    };

    if (loading) return <div className="p-8 text-center">{t('loading')}</div>;

    return (
        <div className="p-6">
            <div className="flex justify-between items-center mb-6">
                <h1 className="text-2xl font-bold text-gray-800 dark:text-white">{t('supplierEvaluations')}</h1>
                <button
                    onClick={handleOpenAdd}
                    className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700"
                >
                    <Plus className="w-5 h-5" />
                    {t('addEvaluation')}
                </button>
            </div>

            <div className="flex gap-4 mb-6">
                <div className="relative flex-1">
                    <Search className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5" />
                    <input
                        type="text"
                        placeholder={t('searchSuppliers')}
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full pr-10 pl-4 py-2 rounded-lg border border-gray-200 dark:border-gray-700 dark:bg-gray-800"
                    />
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {filteredEvaluations.map((evaluation) => (
                    <div key={evaluation.id} className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 border border-gray-100 dark:border-gray-700">
                        <div className="flex justify-between items-start mb-4">
                            <div>
                                <h3 className="font-bold text-lg">{getSupplierName(evaluation.supplierId)}</h3>
                                <div className="text-sm text-gray-500">{normalizeIsoDateOnly(evaluation.evaluationDate)}</div>
                            </div>
                            <div className={`px-2 py-1 rounded-full text-sm font-bold ${getScoreColor(evaluation.overallScore)}`}>
                                {evaluation.overallScore.toFixed(1)} / 5.0
                            </div>
                        </div>

                        <div className="space-y-2 mb-4">
                            <div className="flex justify-between text-sm">
                                <span>{t('quality')}</span>
                                {renderStars(evaluation.qualityScore || 0)}
                            </div>
                            <div className="flex justify-between text-sm">
                                <span>{t('timeliness')}</span>
                                {renderStars(evaluation.timelinessScore || 0)}
                            </div>
                            <div className="flex justify-between text-sm">
                                <span>{t('pricing')}</span>
                                {renderStars(evaluation.pricingScore || 0)}
                            </div>
                            <div className="flex justify-between text-sm">
                                <span>{t('communication')}</span>
                                {renderStars(evaluation.communicationScore || 0)}
                            </div>
                        </div>

                        <div className="text-sm text-gray-600 mb-4 bg-gray-50 dark:bg-gray-900 p-2 rounded">
                            <span className="font-semibold">{t('recommendation')}: </span>
                            <span>{t(evaluation.recommendation || 'maintain')}</span>
                        </div>

                        <div className="flex justify-end gap-2 text-sm">
                            <button onClick={() => handleOpenEdit(evaluation)} className="text-blue-600 hover:text-blue-800">{t('edit')}</button>
                            <button onClick={() => handleDelete(evaluation.id)} className="text-red-600 hover:text-red-800">{t('delete')}</button>
                        </div>
                    </div>
                ))}
            </div>

            {/* Modal */}
            {isAddModalOpen && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
                    <div className="bg-white dark:bg-gray-800 rounded-lg w-full max-w-lg max-h-[90vh] overflow-y-auto">
                        <div className="p-6 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center">
                            <h2 className="text-xl font-bold">{editingEvaluation ? t('editEvaluation') : t('addEvaluation')}</h2>
                            <button onClick={() => setIsAddModalOpen(false)}><X className="w-6 h-6" /></button>
                        </div>
                        <form onSubmit={handleSubmit} className="p-6 space-y-4">
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

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium mb-1">{t('date')}</label>
                                    <input
                                        type="date"
                                        required
                                        className="w-full p-2 border rounded dark:bg-gray-700 dark:border-gray-600"
                                        value={formData.evaluationDate || ''}
                                        onChange={e => setFormData({ ...formData, evaluationDate: e.target.value })}
                                    />
                                </div>
                            </div>

                            {[
                                { key: 'qualityScore', label: t('quality') },
                                { key: 'timelinessScore', label: t('timeliness') },
                                { key: 'pricingScore', label: t('pricing') },
                                { key: 'communicationScore', label: t('communication') }
                            ].map((field) => (
                                <div key={field.key} className="flex items-center justify-between">
                                    <label className="text-sm font-medium">{field.label}</label>
                                    <div className="flex gap-2">
                                        {[1, 2, 3, 4, 5].map(val => (
                                            <button
                                                type="button"
                                                key={val}
                                                onClick={() => setFormData({ ...formData, [field.key]: val })}
                                                className={`w-8 h-8 rounded-full ${(formData[field.key as keyof SupplierEvaluation] as number) >= val
                                                        ? 'bg-yellow-400 text-white'
                                                        : 'bg-gray-200 text-gray-400'
                                                    }`}
                                            >
                                                {val}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            ))}

                            <div>
                                <label className="block text-sm font-medium mb-1">{t('recommendation')}</label>
                                <select
                                    className="w-full p-2 border rounded dark:bg-gray-700 dark:border-gray-600"
                                    value={formData.recommendation || 'maintain'}
                                    onChange={e => setFormData({ ...formData, recommendation: e.target.value as any })}
                                >
                                    <option value="maintain">{t('maintain')}</option>
                                    <option value="improve">{t('improve')}</option>
                                    <option value="terminate">{t('terminate')}</option>
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

export default SupplierEvaluationsScreen;
