import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { getSupabaseClient } from '../supabase';
import { isAbortLikeError, localizeSupabaseError } from '../utils/errorUtils';
import { useAuth } from './AuthContext';
import type { CustomerSpecialPrice, PriceTier } from '../types';

interface PricingContextType {
    priceTiers: PriceTier[];
    specialPrices: CustomerSpecialPrice[];
    loading: boolean;
    error: string | null;

    // Price Tier CRUD
    addPriceTier: (tier: Omit<PriceTier, 'id' | 'createdAt' | 'updatedAt'>) => Promise<void>;
    updatePriceTier: (id: string, updates: Partial<PriceTier>) => Promise<void>;
    deletePriceTier: (id: string) => Promise<void>;
    getPriceTiersForItem: (itemId: string) => PriceTier[];

    // Special Price CRUD
    addSpecialPrice: (price: Omit<CustomerSpecialPrice, 'id' | 'createdAt' | 'updatedAt' | 'createdBy'>) => Promise<void>;
    updateSpecialPrice: (id: string, updates: Partial<CustomerSpecialPrice>) => Promise<void>;
    deleteSpecialPrice: (id: string) => Promise<void>;
    getSpecialPricesForCustomer: (customerId: string) => CustomerSpecialPrice[];

    // Price calculation
    getItemPrice: (itemId: string, customerId: string | null, quantity: number) => Promise<number>;
    getItemDiscount: (itemId: string, customerId: string | null, quantity: number) => Promise<number>;

    // Fetch functions
    fetchPriceTiers: () => Promise<void>;
    fetchSpecialPrices: () => Promise<void>;
}

const PricingContext = createContext<PricingContextType | undefined>(undefined);

export const PricingProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [priceTiers, setPriceTiers] = useState<PriceTier[]>([]);
    const [specialPrices, setSpecialPrices] = useState<CustomerSpecialPrice[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const { hasPermission } = useAuth();

    const mapPriceTierRow = (row: any): PriceTier => ({
        id: String(row.id),
        itemId: String(row.item_id),
        customerType: row.customer_type,
        minQuantity: Number(row.min_quantity ?? 0),
        maxQuantity: row.max_quantity ?? undefined,
        price: Number(row.price ?? 0),
        discountPercentage: row.discount_percentage ?? undefined,
        isActive: row.is_active ?? true,
        validFrom: row.valid_from ?? undefined,
        validTo: row.valid_to ?? undefined,
        notes: row.notes ?? undefined,
        createdAt: row.created_at,
        updatedAt: row.updated_at ?? undefined,
    });

    const mapSpecialPriceRow = (row: any): CustomerSpecialPrice => ({
        id: String(row.id),
        customerId: String(row.customer_id),
        itemId: String(row.item_id),
        specialPrice: Number(row.special_price ?? 0),
        validFrom: row.valid_from,
        validTo: row.valid_to ?? undefined,
        notes: row.notes ?? undefined,
        createdBy: row.created_by ?? undefined,
        createdAt: row.created_at,
        updatedAt: row.updated_at ?? undefined,
    });

    // Fetch price tiers
    const fetchPriceTiers = useCallback(async () => {
        const supabase = getSupabaseClient();
        if (!supabase) {
            setError('قاعدة البيانات غير متاحة');
            return;
        }

        try {
            setLoading(true);
            setError(null);

            const { data, error: fetchError } = await supabase
                .from('price_tiers')
                .select('*')
                .order('item_id', { ascending: true })
                .order('customer_type', { ascending: true })
                .order('min_quantity', { ascending: true });

            if (fetchError) throw fetchError;

            setPriceTiers((data || []).map(mapPriceTierRow));
        } catch (err: any) {
            if (!isAbortLikeError(err)) {
                console.error('Error fetching price tiers:', err);
                setError(localizeSupabaseError(err));
            }
        } finally {
            setLoading(false);
        }
    }, []);

    // Fetch special prices
    const fetchSpecialPrices = useCallback(async () => {
        const supabase = getSupabaseClient();
        if (!supabase) return;

        try {
            const { data, error: fetchError } = await supabase
                .from('customer_special_prices')
                .select('*')
                .order('created_at', { ascending: false });

            if (fetchError) throw fetchError;

            setSpecialPrices((data || []).map(mapSpecialPriceRow));
        } catch (err: any) {
            if (!isAbortLikeError(err)) {
                console.error('Error fetching special prices:', err);
            }
        }
    }, []);

    // Add price tier
    const addPriceTier = useCallback(async (tier: Omit<PriceTier, 'id' | 'createdAt' | 'updatedAt'>) => {
        const supabase = getSupabaseClient();
        if (!supabase) throw new Error('قاعدة البيانات غير متاحة');
        if (!hasPermission('prices.manage')) throw new Error('ليس لديك صلاحية لإضافة شرائح أسعار');

        const row = {
            item_id: tier.itemId,
            customer_type: tier.customerType,
            min_quantity: tier.minQuantity,
            max_quantity: tier.maxQuantity,
            price: tier.price,
            discount_percentage: tier.discountPercentage,
            is_active: tier.isActive ?? true,
            valid_from: tier.validFrom,
            valid_to: tier.validTo,
            notes: tier.notes,
        };

        const { error: insertError } = await supabase
            .from('price_tiers')
            .insert(row);

        if (insertError) throw insertError;

        await fetchPriceTiers();
    }, [hasPermission, fetchPriceTiers]);

    // Update price tier
    const updatePriceTier = useCallback(async (id: string, updates: Partial<PriceTier>) => {
        const supabase = getSupabaseClient();
        if (!supabase) throw new Error('قاعدة البيانات غير متاحة');
        if (!hasPermission('prices.manage')) throw new Error('ليس لديك صلاحية لتعديل شرائح الأسعار');

        const dbUpdates: Record<string, unknown> = {};
        if (updates.itemId !== undefined) dbUpdates.item_id = updates.itemId;
        if (updates.customerType !== undefined) dbUpdates.customer_type = updates.customerType;
        if (updates.minQuantity !== undefined) dbUpdates.min_quantity = updates.minQuantity;
        if (updates.maxQuantity !== undefined) dbUpdates.max_quantity = updates.maxQuantity;
        if (updates.price !== undefined) dbUpdates.price = updates.price;
        if (updates.discountPercentage !== undefined) dbUpdates.discount_percentage = updates.discountPercentage;
        if (updates.isActive !== undefined) dbUpdates.is_active = updates.isActive;
        if (updates.validFrom !== undefined) dbUpdates.valid_from = updates.validFrom;
        if (updates.validTo !== undefined) dbUpdates.valid_to = updates.validTo;
        if (updates.notes !== undefined) dbUpdates.notes = updates.notes;
        dbUpdates.updated_at = new Date().toISOString();

        const { error: updateError } = await supabase
            .from('price_tiers')
            .update(dbUpdates)
            .eq('id', id);

        if (updateError) throw updateError;

        await fetchPriceTiers();
    }, [hasPermission, fetchPriceTiers]);

    // Delete price tier
    const deletePriceTier = useCallback(async (id: string) => {
        const supabase = getSupabaseClient();
        if (!supabase) throw new Error('قاعدة البيانات غير متاحة');
        if (!hasPermission('prices.manage')) throw new Error('ليس لديك صلاحية لحذف شرائح الأسعار');

        const { error: deleteError } = await supabase
            .from('price_tiers')
            .delete()
            .eq('id', id);

        if (deleteError) throw deleteError;

        await fetchPriceTiers();
    }, [hasPermission, fetchPriceTiers]);

    // Get price tiers for item
    const getPriceTiersForItem = useCallback((itemId: string) => {
        return priceTiers.filter(tier => tier.itemId === itemId);
    }, [priceTiers]);

    // Add special price
    const addSpecialPrice = useCallback(async (price: Omit<CustomerSpecialPrice, 'id' | 'createdAt' | 'updatedAt' | 'createdBy'>) => {
        const supabase = getSupabaseClient();
        if (!supabase) throw new Error('قاعدة البيانات غير متاحة');
        if (!hasPermission('prices.manage')) throw new Error('ليس لديك صلاحية لإضافة أسعار خاصة');

        const row = {
            customer_id: price.customerId,
            item_id: price.itemId,
            special_price: price.specialPrice,
            valid_from: price.validFrom,
            valid_to: price.validTo,
            notes: price.notes,
        };

        const { error: insertError } = await supabase
            .from('customer_special_prices')
            .insert(row);

        if (insertError) throw insertError;

        await fetchSpecialPrices();
    }, [hasPermission, fetchSpecialPrices]);

    // Update special price
    const updateSpecialPrice = useCallback(async (id: string, updates: Partial<CustomerSpecialPrice>) => {
        const supabase = getSupabaseClient();
        if (!supabase) throw new Error('قاعدة البيانات غير متاحة');
        if (!hasPermission('prices.manage')) throw new Error('ليس لديك صلاحية لتعديل الأسعار الخاصة');

        const dbUpdates: Record<string, unknown> = {};
        if (updates.customerId !== undefined) dbUpdates.customer_id = updates.customerId;
        if (updates.itemId !== undefined) dbUpdates.item_id = updates.itemId;
        if (updates.specialPrice !== undefined) dbUpdates.special_price = updates.specialPrice;
        if (updates.validFrom !== undefined) dbUpdates.valid_from = updates.validFrom;
        if (updates.validTo !== undefined) dbUpdates.valid_to = updates.validTo;
        if (updates.notes !== undefined) dbUpdates.notes = updates.notes;
        if (updates.createdBy !== undefined) dbUpdates.created_by = updates.createdBy;
        dbUpdates.updated_at = new Date().toISOString();

        const { error: updateError } = await supabase
            .from('customer_special_prices')
            .update(dbUpdates)
            .eq('id', id);

        if (updateError) throw updateError;

        await fetchSpecialPrices();
    }, [hasPermission, fetchSpecialPrices]);

    // Delete special price
    const deleteSpecialPrice = useCallback(async (id: string) => {
        const supabase = getSupabaseClient();
        if (!supabase) throw new Error('قاعدة البيانات غير متاحة');
        if (!hasPermission('prices.manage')) throw new Error('ليس لديك صلاحية لحذف الأسعار الخاصة');

        const { error: deleteError } = await supabase
            .from('customer_special_prices')
            .delete()
            .eq('id', id);

        if (deleteError) throw deleteError;

        await fetchSpecialPrices();
    }, [hasPermission, fetchSpecialPrices]);

    // Get special prices for customer
    const getSpecialPricesForCustomer = useCallback((customerId: string) => {
        return specialPrices.filter(price => price.customerId === customerId);
    }, [specialPrices]);

    // Get item price using RPC function
    const getItemPrice = useCallback(async (itemId: string, customerId: string | null, quantity: number): Promise<number> => {
        const supabase = getSupabaseClient();
        if (!supabase) throw new Error('قاعدة البيانات غير متاحة');

        const { data, error } = await supabase.rpc('get_item_price', {
            p_item_id: itemId,
            p_customer_id: customerId,
            p_quantity: quantity,
        });

        if (error) throw error;

        return data || 0;
    }, []);

    // Get item discount using RPC function
    const getItemDiscount = useCallback(async (itemId: string, customerId: string | null, quantity: number): Promise<number> => {
        const supabase = getSupabaseClient();
        if (!supabase) throw new Error('قاعدة البيانات غير متاحة');

        const { data, error } = await supabase.rpc('get_item_discount', {
            p_item_id: itemId,
            p_customer_id: customerId,
            p_quantity: quantity,
        });

        if (error) throw error;

        return data || 0;
    }, []);

    // Initial fetch
    useEffect(() => {
        fetchPriceTiers();
        fetchSpecialPrices();
    }, [fetchPriceTiers, fetchSpecialPrices]);

    const value: PricingContextType = {
        priceTiers,
        specialPrices,
        loading,
        error,
        addPriceTier,
        updatePriceTier,
        deletePriceTier,
        getPriceTiersForItem,
        addSpecialPrice,
        updateSpecialPrice,
        deleteSpecialPrice,
        getSpecialPricesForCustomer,
        getItemPrice,
        getItemDiscount,
        fetchPriceTiers,
        fetchSpecialPrices,
    };

    return <PricingContext.Provider value={value}>{children}</PricingContext.Provider>;
};

export const usePricing = () => {
    const context = useContext(PricingContext);
    if (!context) {
        throw new Error('usePricing must be used within PricingProvider');
    }
    return context;
};
