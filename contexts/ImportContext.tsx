import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { getSupabaseClient } from '../supabase';
import { ImportShipment, ImportShipmentItem, ImportExpense } from '../types';
import { useToast } from './ToastContext';
import { useAuth } from './AuthContext';
import { localizeSupabaseError } from '../utils/errorUtils';

interface ImportContextType {
    shipments: ImportShipment[];
    loading: boolean;
    fetchShipments: () => Promise<void>;
    getShipmentDetails: (id: string) => Promise<ImportShipment | null>;
    addShipment: (shipment: Omit<ImportShipment, 'id' | 'createdAt' | 'updatedAt'>) => Promise<ImportShipment | null>;
    updateShipment: (id: string, updates: Partial<ImportShipment>) => Promise<void>;
    deleteShipment: (id: string) => Promise<void>;
    addShipmentItem: (item: Omit<ImportShipmentItem, 'id' | 'createdAt' | 'updatedAt'>) => Promise<void>;
    deleteShipmentItem: (id: string) => Promise<void>;
    addExpense: (expense: Omit<ImportExpense, 'id' | 'createdAt' | 'updatedAt'>) => Promise<void>;
    deleteExpense: (id: string) => Promise<void>;
    calculateLandedCost: (shipmentId: string) => Promise<void>;
}

const ImportContext = createContext<ImportContextType | undefined>(undefined);

export const ImportProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [shipments, setShipments] = useState<ImportShipment[]>([]);
    const [loading, setLoading] = useState(true);
    const { showNotification } = useToast();
    const { hasPermission, user } = useAuth();
    const supabase = getSupabaseClient();
    const isUuid = (value: unknown) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value ?? '').trim());

    const fetchShipments = useCallback(async () => {
        const canViewShipments = hasPermission('shipments.view') || hasPermission('procurement.manage') || hasPermission('import.close') || hasPermission('stock.manage');
        if (!supabase || !canViewShipments) {
            setLoading(false);
            return;
        }
        setLoading(true);
        try {
            const pageSize = 1000;
            const maxPages = 500;
            const mapped: ImportShipment[] = [];
            for (let page = 0; page < maxPages; page++) {
                const offset = page * pageSize;
                const { data, error } = await supabase
                    .from('import_shipments')
                    .select('*')
                    .order('created_at', { ascending: false })
                    .order('id', { ascending: false })
                    .range(offset, offset + pageSize - 1);

                if (error) throw error;
                const rows = Array.isArray(data) ? data : [];
                for (const d of rows) {
                    mapped.push({
                        id: (d as any).id,
                        referenceNumber: (d as any).reference_number,
                        supplierId: (d as any).supplier_id,
                        status: (d as any).status,
                        originCountry: (d as any).origin_country,
                        destinationWarehouseId: (d as any).destination_warehouse_id,
                        shippingCarrier: (d as any).shipping_carrier,
                        trackingNumber: (d as any).tracking_number,
                        departureDate: (d as any).departure_date,
                        expectedArrivalDate: (d as any).expected_arrival_date,
                        actualArrivalDate: (d as any).actual_arrival_date,
                        totalWeightKg: (d as any).total_weight_kg,
                        notes: (d as any).notes,
                        createdAt: (d as any).created_at,
                        updatedAt: (d as any).updated_at,
                        createdBy: (d as any).created_by
                    });
                }
                if (rows.length < pageSize) break;
            }
            setShipments(mapped);
        } catch (error: any) {
            console.error('Error fetching shipments:', error);
            showNotification(localizeSupabaseError(error) || 'تعذر تحميل الشحنات.', 'error');
        } finally {
            setLoading(false);
        }
    }, [hasPermission, showNotification, supabase]);

    const getShipmentDetails = async (id: string) => {
        if (!supabase) return null;
        try {
            const key = String(id || '').trim();
            if (!key) throw new Error('معرف الشحنة غير صالح.');
            const query = supabase
                .from('import_shipments')
                .select('*');
            const { data, error } = await (isUuid(key) ? query.eq('id', key) : query.eq('reference_number', key)).single();

            if (error) throw error;

            const shipmentId = String((data as any)?.id || '');
            const { data: items } = await supabase.from('import_shipments_items').select('*').eq('shipment_id', shipmentId);
            const { data: expenses } = await supabase.from('import_expenses').select('*').eq('shipment_id', shipmentId);

            const shipment: ImportShipment = {
                id: data.id,
                referenceNumber: data.reference_number,
                supplierId: data.supplier_id,
                status: data.status,
                originCountry: data.origin_country,
                destinationWarehouseId: data.destination_warehouse_id,
                shippingCarrier: data.shipping_carrier,
                trackingNumber: data.tracking_number,
                departureDate: data.departure_date,
                expectedArrivalDate: data.expected_arrival_date,
                actualArrivalDate: data.actual_arrival_date,
                totalWeightKg: data.total_weight_kg,
                notes: data.notes,
                createdAt: data.created_at,
                updatedAt: data.updated_at,
                createdBy: data.created_by,
                items: items?.map((i: any) => ({
                    id: i.id,
                    shipmentId: i.shipment_id,
                    itemId: i.item_id,
                    quantity: i.quantity,
                    unitPriceFob: i.unit_price_fob,
                    currency: i.currency,
                    expiryDate: i.expiry_date,
                    landingCostPerUnit: i.landing_cost_per_unit,
                    notes: i.notes,
                    createdAt: i.created_at,
                    updatedAt: i.updated_at
                })) || [],
                expenses: expenses?.map((e: any) => ({
                    id: e.id,
                    shipmentId: e.shipment_id,
                    expenseType: e.expense_type,
                    amount: e.amount,
                    currency: e.currency,
                    exchangeRate: e.exchange_rate,
                    baseAmount: Number.isFinite(Number(e.base_amount)) ? Number(e.base_amount) : undefined,
                    paymentMethod: e.payment_method,
                    description: e.description,
                    invoiceNumber: e.invoice_number,
                    paidAt: e.paid_at,
                    createdBy: e.created_by,
                    createdAt: e.created_at,
                    updatedAt: e.updated_at
                })) || []
            };
            return shipment;

        } catch (error: any) {
            console.error('Error fetching shipment details:', error);
            showNotification(localizeSupabaseError(error) || 'تعذر تحميل تفاصيل الشحنة.', 'error');
            return null;
        }
    };

    const addShipment = async (shipment: Omit<ImportShipment, 'id' | 'createdAt' | 'updatedAt'>) => {
        if (!supabase) return null;
        try {
            const { data, error } = await supabase.from('import_shipments').insert([{
                reference_number: shipment.referenceNumber,
                supplier_id: shipment.supplierId,
                status: shipment.status,
                origin_country: shipment.originCountry,
                destination_warehouse_id: shipment.destinationWarehouseId,
                shipping_carrier: shipment.shippingCarrier,
                tracking_number: shipment.trackingNumber,
                departure_date: shipment.departureDate,
                expected_arrival_date: shipment.expectedArrivalDate,
                total_weight_kg: shipment.totalWeightKg,
                notes: shipment.notes,
                created_by: user?.id
            }]).select().single();

            if (error) throw error;
            showNotification('Shipment created successfully', 'success');
            fetchShipments();

            return {
                id: data.id,
                referenceNumber: data.reference_number,
                status: data.status,
                createdAt: data.created_at
            } as ImportShipment;

        } catch (error: any) {
            console.error('Error adding shipment:', error);
            showNotification(localizeSupabaseError(error), 'error');
            return null;
        }
    };

    const updateShipment = async (id: string, updates: Partial<ImportShipment>) => {
        if (!supabase) return;
        try {
            const dbUpdates: any = {};
            if (updates.status) dbUpdates.status = updates.status;
            if (updates.referenceNumber) dbUpdates.reference_number = updates.referenceNumber;
            if (updates.actualArrivalDate) dbUpdates.actual_arrival_date = updates.actualArrivalDate;
            if (updates.notes) dbUpdates.notes = updates.notes;
            if (updates.destinationWarehouseId !== undefined) dbUpdates.destination_warehouse_id = updates.destinationWarehouseId || null;
            dbUpdates.updated_at = new Date().toISOString();

            const { error } = await supabase
                .from('import_shipments')
                .update(dbUpdates)
                .eq('id', id);

            if (error) throw error;
            showNotification('Shipment updated', 'success');
            fetchShipments();
        } catch (error: any) {
            console.error('Error updating shipment:', error);
            showNotification(localizeSupabaseError(error), 'error');
        }
    };

    const deleteShipment = async (id: string) => {
        if (!supabase) return;
        try {
            const { error } = await supabase.from('import_shipments').delete().eq('id', id);
            if (error) throw error;
            showNotification('Shipment deleted', 'success');
            fetchShipments();
        } catch (error: any) {
            showNotification(localizeSupabaseError(error), 'error');
        }
    };

    const addShipmentItem = async (item: Omit<ImportShipmentItem, 'id' | 'createdAt' | 'updatedAt'>) => {
        if (!supabase) return;
        try {
            const { error } = await supabase.from('import_shipments_items').insert([{
                shipment_id: item.shipmentId,
                item_id: item.itemId,
                quantity: item.quantity,
                unit_price_fob: item.unitPriceFob,
                currency: item.currency,
                expiry_date: item.expiryDate,
                notes: item.notes
            }]);
            if (error) throw error;
            showNotification('Item added', 'success');
        } catch (error: any) {
            showNotification(localizeSupabaseError(error), 'error');
        }
    };

    const deleteShipmentItem = async (id: string) => {
        if (!supabase) return;
        try {
            const { error } = await supabase.from('import_shipments_items').delete().eq('id', id);
            if (error) throw error;
            showNotification('Item removed', 'success');
        } catch (error: any) {
            showNotification(localizeSupabaseError(error), 'error');
        }
    };

    const addExpense = async (expense: Omit<ImportExpense, 'id' | 'createdAt' | 'updatedAt'>) => {
        if (!supabase) return;
        try {
            const currency = String((expense as any).currency || '').toUpperCase();
            if (!currency) throw new Error('اختر عملة للمصروف.');
            const exchangeRate = Number((expense as any).exchangeRate);
            if (!Number.isFinite(exchangeRate) || exchangeRate <= 0) throw new Error('سعر الصرف غير صالح.');
            const { error } = await supabase.from('import_expenses').insert([{
                shipment_id: expense.shipmentId,
                expense_type: expense.expenseType,
                amount: expense.amount,
                currency,
                exchange_rate: exchangeRate,
                payment_method: expense.paymentMethod || 'cash',
                description: expense.description,
                invoice_number: expense.invoiceNumber,
                paid_at: expense.paidAt,
                created_by: user?.id
            }]);
            if (error) throw error;
            showNotification('Expense added', 'success');
        } catch (error: any) {
            showNotification(error.message, 'error');
        }
    };

    const deleteExpense = async (id: string) => {
        if (!supabase) return;
        try {
            const { error } = await supabase.from('import_expenses').delete().eq('id', id);
            if (error) throw error;
            showNotification('Expense removed', 'success');
        } catch (error: any) {
            showNotification(error.message, 'error');
        }
    };

    const calculateLandedCost = async (shipmentId: string) => {
        if (!supabase) return;
        try {
            const sid = String(shipmentId || '').trim();
            if (!isUuid(sid)) throw new Error('معرف الشحنة غير صالح (UUID). حدّث قاعدة البيانات في الإنتاج ثم أعد المحاولة.');
            const { error } = await supabase.rpc('calculate_shipment_landed_cost', { p_shipment_id: shipmentId });
            if (error) throw error;
            showNotification('Landed cost calculated successfully', 'success');
        } catch (error: any) {
            console.error('Error calculating landed cost:', error);
            showNotification(localizeSupabaseError(error), 'error');
        }
    };

    useEffect(() => {
        if (user && supabase) {
            fetchShipments();
        }
    }, [user, fetchShipments, supabase]);

    return (
        <ImportContext.Provider value={{
            shipments,
            loading,
            fetchShipments,
            getShipmentDetails,
            addShipment,
            updateShipment,
            deleteShipment,
            addShipmentItem,
            deleteShipmentItem,
            addExpense,
            deleteExpense,
            calculateLandedCost
        }}>
            {children}
        </ImportContext.Provider>
    );
};

export const useImport = () => {
    const context = useContext(ImportContext);
    if (context === undefined) {
        throw new Error('useImport must be used within an ImportProvider');
    }
    return context;
};
