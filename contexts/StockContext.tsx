import React, { createContext, useContext, useState, ReactNode, useCallback, useEffect } from 'react';
import type { MenuItem, StockManagement } from '../types';
import { useToast } from './ToastContext';
import { useSettings } from './SettingsContext';
import { useAuth } from './AuthContext';
import { getSupabaseClient } from '../supabase';
import { logger } from '../utils/logger';
import { isAbortLikeError, localizeSupabaseError } from '../utils/errorUtils';

interface StockContextType {
    stockItems: StockManagement[];
    loading: boolean;
    fetchStock: () => Promise<void>;
    updateStock: (itemId: string, quantity: number, unit: string, reason: string, batchId?: string) => Promise<void>;
    recordWastage: (itemId: string, wastedQuantity: number, unit: string, reason: string, batchId?: string) => Promise<void>;
    reserveStock: (itemId: string, quantity: number, orderId?: string) => Promise<boolean>;
    releaseStock: (itemId: string, quantity: number, orderId?: string) => Promise<void>;
    getStockByItemId: (itemId: string) => StockManagement | undefined;
    checkStockAvailability: (itemId: string, requestedQuantity: number) => boolean;
    initializeStockForItem: (item: MenuItem) => Promise<void>;
    processExpiredItems: () => Promise<void>;
}

const StockContext = createContext<StockContextType | undefined>(undefined);

export const StockProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [stockItems, setStockItems] = useState<StockManagement[]>([]);
    const [loading, setLoading] = useState(true);
    const { showNotification } = useToast();
    const { t, language } = useSettings();
    const { isAuthenticated, hasPermission } = useAuth();

    const toStockFromRow = (row: any): StockManagement | undefined => {
        const itemId = typeof row?.item_id === 'string' ? row.item_id : undefined;
        if (!itemId) return undefined;
        const data = (row?.data && typeof row.data === 'object') ? row.data : {};
        const availableQuantity = Number.isFinite(Number(row?.available_quantity))
            ? Number(row.available_quantity)
            : (Number.isFinite(Number((data as any).availableQuantity)) ? Number((data as any).availableQuantity) : 0);
        const reservedQuantity = Number.isFinite(Number(row?.reserved_quantity))
            ? Number(row.reserved_quantity)
            : (Number.isFinite(Number((data as any).reservedQuantity)) ? Number((data as any).reservedQuantity) : 0);
        const unit = typeof row?.unit === 'string' ? row.unit : (typeof (data as any).unit === 'string' ? (data as any).unit : 'piece');
        const lowStockThreshold = Number.isFinite(Number(row?.low_stock_threshold))
            ? Number(row.low_stock_threshold)
            : (Number.isFinite(Number((data as any).lowStockThreshold)) ? Number((data as any).lowStockThreshold) : 5);
        const lastUpdated = typeof row?.last_updated === 'string'
            ? row.last_updated
            : (typeof (data as any).lastUpdated === 'string' ? (data as any).lastUpdated : new Date().toISOString());
        const avgCost = Number.isFinite(Number(row?.avg_cost))
            ? Number(row.avg_cost)
            : (Number.isFinite(Number((data as any).avgCost)) ? Number((data as any).avgCost) : undefined);

        return {
            id: itemId,
            itemId,
            availableQuantity,
            reservedQuantity,
            unit: unit as any,
            lastUpdated,
            lowStockThreshold,
            avgCost,
        };
    };

    const fetchStock = useCallback(async () => {
        setLoading(true);
        try {
            const supabase = getSupabaseClient();
            if (!supabase) {
                setStockItems([]);
                return;
            }
            const { data: rows, error } = await supabase
                .from('stock_management')
                .select('item_id, available_quantity, reserved_quantity, unit, low_stock_threshold, last_updated, avg_cost, data');
            if (error) throw error;
            const remoteStock = (rows || []).map(toStockFromRow).filter(Boolean) as StockManagement[];
            setStockItems(remoteStock);
        } catch (error) {
            const isOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
            if (isOffline || isAbortLikeError(error)) return;
            const msg = localizeSupabaseError(error);
            if (msg && import.meta.env.DEV) console.error(msg);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchStock();
    }, [fetchStock]);

    useEffect(() => {
        const supabase = getSupabaseClient();
        if (!supabase) return;
        const channel = supabase
            .channel('public:stock_management')
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'stock_management' },
                async () => {
                    await fetchStock();
                }
            )
            .subscribe();
        return () => {
            supabase.removeChannel(channel);
        };
    }, [fetchStock]);

    

    const initializeStockForItem = async (item: MenuItem) => {
        const supabase = getSupabaseClient();
        if (!supabase) {
            throw new Error(language === 'ar' ? 'Supabase غير مهيأ.' : 'Supabase is not configured.');
        }

        try {
            const { error } = await supabase.rpc('manage_menu_item_stock', {
                p_item_id: item.id,
                p_quantity: item.availableStock || 0,
                p_unit: item.unitType || 'piece',
                p_reason: 'Initial Stock / تهيئة المخزون',
                p_low_stock_threshold: 5
            });

            if (error) throw error;
            await fetchStock();
        } catch (err: any) {
            const isOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
            if (isOffline || isAbortLikeError(err)) return;
            const msg = localizeSupabaseError(err);
            if (msg && import.meta.env.DEV) console.error(msg);
        }
    };

    const recordWastage = async (itemId: string, wastedQuantity: number, unit: string, reason: string, batchId?: string) => {
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (!uuidRegex.test(itemId)) {
            const error = new Error(language === 'ar' ? `معرّف المنتج غير صالح: ${itemId}` : `Invalid item ID: ${itemId}`);
            logger.error('Wastage failed: Invalid UUID format:', itemId);
            throw error;
        }
        if (!isAuthenticated) {
            const error = new Error(language === 'ar' ? 'يجب تسجيل الدخول أولاً.' : 'You must be logged in first.');
            logger.error('Wastage failed: Not authenticated');
            throw error;
        }
        if (!hasPermission('stock.manage')) {
            const error = new Error(language === 'ar' ? 'ليس لديك صلاحية تعديل المخزون.' : 'You do not have permission to update stock.');
            logger.error('Wastage failed: No permission');
            throw error;
        }
        if (!Number.isFinite(wastedQuantity) || wastedQuantity <= 0) {
            const error = new Error(language === 'ar' ? 'كمية التالف غير صالحة.' : 'Invalid wasted quantity.');
            logger.error('Wastage failed: Invalid quantity:', wastedQuantity);
            throw error;
        }
        if (!reason?.trim()) {
            const error = new Error(language === 'ar' ? 'سبب الإتلاف مطلوب.' : 'Wastage reason is required.');
            logger.error('Wastage failed: No reason provided');
            throw error;
        }
        const supabase = getSupabaseClient();
        if (!supabase) {
            const error = new Error(language === 'ar' ? 'Supabase غير مهيأ.' : 'Supabase is not configured.');
            logger.error('Wastage failed: Supabase not configured');
            throw error;
        }
        
        try {
            const currentStock = stockItems.find(s => s.itemId === itemId);
            const oldAvailable = currentStock?.availableQuantity ?? 0;
            const nextAvailable = Math.max(0, oldAvailable - wastedQuantity);

            const payload: any = {
                p_item_id: itemId,
                p_quantity: nextAvailable,
                p_unit: unit,
                p_reason: reason,
                p_is_wastage: true
            };
            if (batchId) {
                payload.p_batch_id = batchId;
            }
            const { error } = await supabase.rpc('manage_menu_item_stock', payload);

            if (error) throw error;

            await fetchStock();
            showNotification(language === 'ar' ? `تم تسجيل التالف: ${wastedQuantity} ${unit}` : `Wastage recorded: ${wastedQuantity} ${unit}`, 'success');
        } catch (err: any) {
            logger.error('Exception during wastage:', err);
            throw new Error(localizeSupabaseError(err) || (language === 'ar' ? 'فشل تسجيل التالف' : 'Failed to record wastage'));
        }
    };

    const updateStock = async (itemId: string, quantity: number, unit: string, reason: string, batchId?: string) => {
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (!uuidRegex.test(itemId)) {
            const error = new Error(language === 'ar' ? `معرّف المنتج غير صالح: ${itemId}` : `Invalid item ID: ${itemId}`);
            logger.error('Stock update failed: Invalid UUID format:', itemId);
            throw error;
        }

        if (!isAuthenticated) {
            const error = new Error(language === 'ar' ? 'يجب تسجيل الدخول أولاً.' : 'You must be logged in first.');
            logger.error('Stock update failed: Not authenticated');
            throw error;
        }

        if (!hasPermission('stock.manage')) {
            const error = new Error(language === 'ar' ? 'ليس لديك صلاحية تعديل المخزون.' : 'You do not have permission to update stock.');
            logger.error('Stock update failed: No permission');
            throw error;
        }

        if (!Number.isFinite(quantity) || quantity < 0) {
            const error = new Error(language === 'ar' ? 'قيمة المخزون غير صالحة.' : 'Invalid stock quantity.');
            logger.error('Stock update failed: Invalid quantity:', quantity);
            throw error;
        }

        if (!reason?.trim()) {
            const error = new Error(language === 'ar' ? 'سبب تعديل المخزون مطلوب.' : 'Stock adjustment reason is required.');
            logger.error('Stock update failed: No reason provided');
            throw error;
        }

        const supabase = getSupabaseClient();
        if (!supabase) {
            const error = new Error(language === 'ar' ? 'Supabase غير مهيأ.' : 'Supabase is not configured.');
            logger.error('Stock update failed: Supabase not configured');
            throw error;
        }

        try {
            const payload: any = {
                p_item_id: itemId,
                p_quantity: quantity,
                p_unit: unit,
                p_reason: reason,
                p_low_stock_threshold: 5
            };
            if (batchId) {
                payload.p_batch_id = batchId;
            }
            const { error } = await supabase.rpc('manage_menu_item_stock', payload);

            if (error) throw error;

            await fetchStock();
            
            showNotification(
                language === 'ar'
                    ? `تم تحديث المخزون بنجاح: ${quantity} ${unit}`
                    : `Stock updated successfully: ${quantity} ${unit}`,
                'success'
            );

            const current = stockItems.find(s => s.itemId === itemId);
            const threshold = Number(current?.lowStockThreshold ?? 5);
            if (quantity <= threshold) {
                showNotification(`⚠️ ${t('lowStockAlert')}: ${quantity} ${unit}`, 'info');
            }
        } catch (err: any) {
            logger.error('Exception during stock update:', err);
            throw new Error(localizeSupabaseError(err) || (language === 'ar' ? 'فشل تحديث المخزون' : 'Failed to update stock'));
        }
    };

    const reserveStock = async (itemId: string, quantity: number, orderId?: string): Promise<boolean> => {
        const supabase = getSupabaseClient();
        if (!supabase) {
            throw new Error(language === 'ar' ? 'Supabase غير مهيأ.' : 'Supabase is not configured.');
        }

        try {
            const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
            const safeOrderId = orderId && uuidRegex.test(orderId) ? orderId : null;
            const resolveWarehouseId = async (): Promise<string> => {
                const tryOrder = safeOrderId ? await supabase.from('orders').select('warehouse_id,data').eq('id', safeOrderId).maybeSingle() : { data: null, error: null };
                const orderRow: any = tryOrder?.data || null;
                const byCol = typeof orderRow?.warehouse_id === 'string' ? orderRow?.warehouse_id : undefined;
                const byData = typeof orderRow?.data?.warehouseId === 'string' ? orderRow?.data?.warehouseId : undefined;
                const candidate = byCol || byData;
                if (candidate) return candidate;
                const { data: whRows } = await supabase.from('warehouses').select('id,code,is_active').eq('is_active', true).order('code', { ascending: true });
                const main = (whRows || []).find((w: any) => String(w?.code).toUpperCase() === 'MAIN');
                const first = (whRows || [])[0];
                const resolved = String((main || first)?.id || '');
                if (!resolved) throw new Error(language === 'ar' ? 'تعذر تحديد المخزن الافتراضي.' : 'Unable to resolve default warehouse.');
                return resolved;
            };
            const warehouseId = await resolveWarehouseId();

            // Use RPC for atomic reservation
            const { error } = await supabase.rpc('reserve_stock_for_order', {
                p_items: [{ itemId, quantity }],
                p_order_id: safeOrderId,
                p_warehouse_id: warehouseId
            });

            if (error) {
                if (import.meta.env.DEV) console.warn('Reservation failed:', error.message);
                return false;
            }

            await fetchStock();
            return true;
        } catch (err) {
            return false;
        }
    };

    const releaseStock = async (itemId: string, quantity: number, orderId?: string) => {
        const supabase = getSupabaseClient();
        if (!supabase) {
            throw new Error(language === 'ar' ? 'Supabase غير مهيأ.' : 'Supabase is not configured.');
        }
        
        try {
             const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
             const safeOrderId = orderId && uuidRegex.test(orderId) ? orderId : null;
             const resolveWarehouseId = async (): Promise<string> => {
                const tryOrder = safeOrderId ? await supabase.from('orders').select('warehouse_id,data').eq('id', safeOrderId).maybeSingle() : { data: null, error: null };
                const orderRow: any = tryOrder?.data || null;
                const byCol = typeof orderRow?.warehouse_id === 'string' ? orderRow?.warehouse_id : undefined;
                const byData = typeof orderRow?.data?.warehouseId === 'string' ? orderRow?.data?.warehouseId : undefined;
                const candidate = byCol || byData;
                if (candidate) return candidate;
                const { data: whRows } = await supabase.from('warehouses').select('id,code,is_active').eq('is_active', true).order('code', { ascending: true });
                const main = (whRows || []).find((w: any) => String(w?.code).toUpperCase() === 'MAIN');
                const first = (whRows || [])[0];
                const resolved = String((main || first)?.id || '');
                if (!resolved) throw new Error(language === 'ar' ? 'تعذر تحديد المخزن الافتراضي.' : 'Unable to resolve default warehouse.');
                return resolved;
             };
             const warehouseId = await resolveWarehouseId();

             const { error } = await supabase.rpc('release_reserved_stock_for_order', {
                p_items: [{ itemId, quantity }],
                p_order_id: safeOrderId,
                p_warehouse_id: warehouseId
            });
            if (error) throw error;
            await fetchStock();
        } catch (err) {
            const isOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
            if (isOffline || isAbortLikeError(err)) return;
            const msg = localizeSupabaseError(err);
            if (msg && import.meta.env.DEV) console.error(msg);
        }
    };

    const getStockByItemId = useCallback((itemId: string) => {
        return stockItems.find(stock => stock.itemId === itemId);
    }, [stockItems]);

    const checkStockAvailability = useCallback((itemId: string, requestedQuantity: number): boolean => {
        const stock = stockItems.find(s => s.itemId === itemId);
        if (!stock) return false;
        const available = stock.availableQuantity - stock.reservedQuantity;
        return available >= requestedQuantity;
    }, [stockItems]);

    const processExpiredItems = useCallback(async () => {
        const supabase = getSupabaseClient();
        if (!supabase) return;

        try {
            const { data, error } = await supabase.rpc('process_expired_items');
            if (error) throw error;
            // The RPC returns { success: boolean, processed_count: number }
            if (data && data.success && data.processed_count > 0) {
                showNotification(
                    language === 'ar'
                        ? `تمت أرشفة ${data.processed_count} منتجات منتهية الصلاحية تلقائياً.`
                        : `Auto-archived ${data.processed_count} expired items.`,
                    'info'
                );
                await fetchStock();
            }
        } catch (error) {
            const isOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
            if (isOffline || isAbortLikeError(error)) return;
            const msg = localizeSupabaseError(error);
            if (msg && import.meta.env.DEV) console.error(msg);
        }
    }, [language, fetchStock, showNotification]);

    useEffect(() => {
        // Respect inventory flag: do NOT auto-archive expired items globally
        // The new light expiry processing is invoked via dedicated screens/actions
        // Keeping legacy RPC disabled unless explicitly enabled via settings
        const sup = getSupabaseClient();
        if (!sup) return;
        let enabled = false;
        try {
            // This hook avoids calling processExpiredItems unless a flag is enabled
            // Default is false to prevent global item archiving
            enabled = false;
        } catch {}
        if (enabled) {
            if (isAuthenticated && hasPermission('stock.manage')) {
                processExpiredItems();
            }
        }
    }, [isAuthenticated, hasPermission, processExpiredItems]);

    return (
        <StockContext.Provider value={{
            stockItems,
            loading,
            fetchStock,
            updateStock,
            recordWastage,
            reserveStock,
            releaseStock,
            getStockByItemId,
            checkStockAvailability,
            initializeStockForItem,
            processExpiredItems,
        }}>
            {children}
        </StockContext.Provider>
    );
};

export const useStock = () => {
    const context = useContext(StockContext);
    if (context === undefined) {
        throw new Error('useStock must be used within a StockProvider');
    }
    return context;
};
