import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { getSupabaseClient } from '../supabase';
import { SupplierContract, SupplierEvaluation } from '../types';
import { useToast } from './ToastContext';
import { useAuth } from './AuthContext';

interface SupplierEnhancementContextType {
    contracts: SupplierContract[];
    evaluations: SupplierEvaluation[];
    loading: boolean;
    fetchContracts: () => Promise<void>;
    fetchEvaluations: () => Promise<void>;
    addContract: (contract: Omit<SupplierContract, 'id' | 'createdAt' | 'updatedAt'>) => Promise<void>;
    updateContract: (id: string, updates: Partial<SupplierContract>) => Promise<void>;
    deleteContract: (id: string) => Promise<void>;
    addEvaluation: (evaluation: Omit<SupplierEvaluation, 'id' | 'createdAt' | 'updatedAt' | 'overallScore'>) => Promise<void>;
    updateEvaluation: (id: string, updates: Partial<SupplierEvaluation>) => Promise<void>;
    deleteEvaluation: (id: string) => Promise<void>;
    getExpiringContracts: (daysThreshold?: number) => Promise<any[]>;
}

const SupplierEnhancementContext = createContext<SupplierEnhancementContextType | undefined>(undefined);

export const SupplierEnhancementProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [contracts, setContracts] = useState<SupplierContract[]>([]);
    const [evaluations, setEvaluations] = useState<SupplierEvaluation[]>([]);
    const [loading, setLoading] = useState(true);
    const { showNotification } = useToast();
    const { hasPermission, user } = useAuth();

    const fetchContracts = useCallback(async () => {
        if (!hasPermission('stock.manage')) return;
        try {
            const supabase = getSupabaseClient();
            if (!supabase) return;
            const { data, error } = await supabase
                .from('supplier_contracts')
                .select('*')
                .order('created_at', { ascending: false });

            if (error) throw error;

            setContracts((data || []).map((d: any) => ({
                id: d.id,
                supplierId: d.supplier_id,
                contractNumber: d.contract_number,
                startDate: d.start_date,
                endDate: d.end_date,
                paymentTerms: d.payment_terms,
                paymentTermsCustom: d.payment_terms_custom,
                deliveryLeadTimeDays: d.delivery_lead_time_days,
                minimumOrderAmount: d.minimum_order_amount,
                documentUrl: d.document_url,
                status: d.status,
                notes: d.notes,
                createdAt: d.created_at,
                updatedAt: d.updated_at,
                createdBy: d.created_by
            })));
        } catch (error: any) {
            console.error('Error fetching contracts:', error);
            showNotification('Error fetching contracts', 'error');
        }
    }, [hasPermission, showNotification]);

    const fetchEvaluations = useCallback(async () => {
        if (!hasPermission('stock.manage')) return;
        try {
            const supabase = getSupabaseClient();
            if (!supabase) return;
            const { data, error } = await supabase
                .from('supplier_evaluations')
                .select('*')
                .order('evaluation_date', { ascending: false });

            if (error) throw error;

            setEvaluations((data || []).map((d: any) => ({
                id: d.id,
                supplierId: d.supplier_id,
                evaluationDate: d.evaluation_date,
                periodStart: d.period_start,
                periodEnd: d.period_end,
                qualityScore: d.quality_score,
                timelinessScore: d.timeliness_score,
                pricingScore: d.pricing_score,
                communicationScore: d.communication_score,
                overallScore: d.overall_score,
                notes: d.notes,
                recommendation: d.recommendation,
                createdAt: d.created_at,
                updatedAt: d.updated_at,
                createdBy: d.created_by
            })));
        } catch (error: any) {
            console.error('Error fetching evaluations:', error);
            showNotification('Error fetching evaluations', 'error');
        }
    }, [hasPermission, showNotification]);

    useEffect(() => {
        if (user) {
            fetchContracts();
            fetchEvaluations();
            setLoading(false);
        }
    }, [user, fetchContracts, fetchEvaluations]);

    const addContract = async (contract: Omit<SupplierContract, 'id' | 'createdAt' | 'updatedAt'>) => {
        if (!hasPermission('stock.manage')) {
            showNotification('Permission denied', 'error');
            return;
        }
        try {
            const supabase = getSupabaseClient();
            if (!supabase) return;
            const { error } = await supabase.from('supplier_contracts').insert([{
                supplier_id: contract.supplierId,
                contract_number: contract.contractNumber,
                start_date: contract.startDate,
                end_date: contract.endDate,
                payment_terms: contract.paymentTerms,
                payment_terms_custom: contract.paymentTermsCustom,
                delivery_lead_time_days: contract.deliveryLeadTimeDays,
                minimum_order_amount: contract.minimumOrderAmount,
                document_url: contract.documentUrl,
                status: contract.status,
                notes: contract.notes,
                created_by: user?.id
            }]);

            if (error) throw error;
            showNotification('Contract added successfully', 'success');
            fetchContracts();
        } catch (error: any) {
            console.error('Error adding contract:', error);
            showNotification(error.message, 'error');
        }
    };

    const updateContract = async (id: string, updates: Partial<SupplierContract>) => {
        if (!hasPermission('stock.manage')) {
            showNotification('Permission denied', 'error');
            return;
        }
        try {
            const supabase = getSupabaseClient();
            if (!supabase) return;
            const dbUpdates: any = {};
            if (updates.supplierId) dbUpdates.supplier_id = updates.supplierId;
            if (updates.contractNumber) dbUpdates.contract_number = updates.contractNumber;
            if (updates.startDate) dbUpdates.start_date = updates.startDate;
            if (updates.endDate) dbUpdates.end_date = updates.endDate;
            if (updates.paymentTerms) dbUpdates.payment_terms = updates.paymentTerms;
            if (updates.paymentTermsCustom) dbUpdates.payment_terms_custom = updates.paymentTermsCustom;
            if (updates.deliveryLeadTimeDays) dbUpdates.delivery_lead_time_days = updates.deliveryLeadTimeDays;
            if (updates.minimumOrderAmount) dbUpdates.minimum_order_amount = updates.minimumOrderAmount;
            if (updates.documentUrl) dbUpdates.document_url = updates.documentUrl;
            if (updates.status) dbUpdates.status = updates.status;
            if (updates.notes) dbUpdates.notes = updates.notes;
            dbUpdates.updated_at = new Date().toISOString();

            const { error } = await supabase
                .from('supplier_contracts')
                .update(dbUpdates)
                .eq('id', id);

            if (error) throw error;
            showNotification('Contract updated successfully', 'success');
            fetchContracts();
        } catch (error: any) {
            console.error('Error updating contract:', error);
            showNotification(error.message, 'error');
        }
    };

    const deleteContract = async (id: string) => {
        if (!hasPermission('stock.manage')) {
            showNotification('Permission denied', 'error');
            return;
        }
        try {
            const supabase = getSupabaseClient();
            if (!supabase) return;
            const { error } = await supabase.from('supplier_contracts').delete().eq('id', id);
            if (error) throw error;
            showNotification('Contract deleted successfully', 'success');
            fetchContracts();
        } catch (error: any) {
            console.error('Error deleting contract:', error);
            showNotification(error.message, 'error');
        }
    };

    const addEvaluation = async (evaluation: Omit<SupplierEvaluation, 'id' | 'createdAt' | 'updatedAt' | 'overallScore'>) => {
        if (!hasPermission('stock.manage')) {
            showNotification('Permission denied', 'error');
            return;
        }
        try {
            const supabase = getSupabaseClient();
            if (!supabase) return;
            const { error } = await supabase.from('supplier_evaluations').insert([{
                supplier_id: evaluation.supplierId,
                evaluation_date: evaluation.evaluationDate,
                period_start: evaluation.periodStart,
                period_end: evaluation.periodEnd,
                quality_score: evaluation.qualityScore,
                timeliness_score: evaluation.timelinessScore,
                pricing_score: evaluation.pricingScore,
                communication_score: evaluation.communicationScore,
                notes: evaluation.notes,
                recommendation: evaluation.recommendation,
                created_by: user?.id
            }]);

            if (error) throw error;
            showNotification('Evaluation added successfully', 'success');
            fetchEvaluations();
        } catch (error: any) {
            console.error('Error adding evaluation:', error);
            showNotification(error.message, 'error');
        }
    };

    const updateEvaluation = async (id: string, updates: Partial<SupplierEvaluation>) => {
        if (!hasPermission('stock.manage')) {
            showNotification('Permission denied', 'error');
            return;
        }
        try {
            const supabase = getSupabaseClient();
            if (!supabase) return;
            const dbUpdates: any = {};
            if (updates.supplierId) dbUpdates.supplier_id = updates.supplierId;
            if (updates.evaluationDate) dbUpdates.evaluation_date = updates.evaluationDate;
            if (updates.periodStart) dbUpdates.period_start = updates.periodStart;
            if (updates.periodEnd) dbUpdates.period_end = updates.periodEnd;
            if (updates.qualityScore) dbUpdates.quality_score = updates.qualityScore;
            if (updates.timelinessScore) dbUpdates.timeliness_score = updates.timelinessScore;
            if (updates.pricingScore) dbUpdates.pricing_score = updates.pricingScore;
            if (updates.communicationScore) dbUpdates.communication_score = updates.communicationScore;
            if (updates.notes) dbUpdates.notes = updates.notes;
            if (updates.recommendation) dbUpdates.recommendation = updates.recommendation;
            dbUpdates.updated_at = new Date().toISOString();

            const { error } = await supabase
                .from('supplier_evaluations')
                .update(dbUpdates)
                .eq('id', id);

            if (error) throw error;
            showNotification('Evaluation updated successfully', 'success');
            fetchEvaluations();
        } catch (error: any) {
            console.error('Error updating evaluation:', error);
            showNotification(error.message, 'error');
        }
    };

    const deleteEvaluation = async (id: string) => {
        if (!hasPermission('stock.manage')) {
            showNotification('Permission denied', 'error');
            return;
        }
        try {
            const supabase = getSupabaseClient();
            if (!supabase) return;
            const { error } = await supabase.from('supplier_evaluations').delete().eq('id', id);
            if (error) throw error;
            showNotification('Evaluation deleted successfully', 'success');
            fetchEvaluations();
        } catch (error: any) {
            console.error('Error deleting evaluation:', error);
            showNotification(error.message, 'error');
        }
    };

    const getExpiringContracts = async (daysThreshold: number = 30) => {
        try {
            const supabase = getSupabaseClient();
            if (!supabase) return [];
            const { data, error } = await supabase.rpc('get_expiring_contracts', { days_threshold: daysThreshold });
            if (error) throw error;
            return data;
        } catch (error: any) {
            console.error('Error fetching expiring contracts:', error);
            return [];
        }
    };

    return (
        <SupplierEnhancementContext.Provider value={{
            contracts,
            evaluations,
            loading,
            fetchContracts,
            fetchEvaluations,
            addContract,
            updateContract,
            deleteContract,
            addEvaluation,
            updateEvaluation,
            deleteEvaluation,
            getExpiringContracts
        }}>
            {children}
        </SupplierEnhancementContext.Provider>
    );
};

export const useSupplierEnhancement = () => {
    const context = useContext(SupplierEnhancementContext);
    if (context === undefined) {
        throw new Error('useSupplierEnhancement must be used within a SupplierEnhancementProvider');
    }
    return context;
};
