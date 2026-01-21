import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { getSupabaseClient } from '../supabase';
import { isAbortLikeError, localizeSupabaseError } from '../utils/errorUtils';
import { useAuth } from './AuthContext';
import type { Warehouse, WarehouseTransfer, WarehouseTransferItem } from '../types';

interface WarehouseContextType {
  warehouses: Warehouse[];
  transfers: WarehouseTransfer[];
  loading: boolean;
  error: string | null;
  
  // Warehouse CRUD
  addWarehouse: (warehouse: Omit<Warehouse, 'id' | 'createdAt' | 'updatedAt'>) => Promise<void>;
  updateWarehouse: (id: string, updates: Partial<Warehouse>) => Promise<void>;
  deleteWarehouse: (id: string) => Promise<void>;
  
  // Transfer operations
  createTransfer: (
    fromWarehouseId: string,
    toWarehouseId: string,
    transferDate: string,
    items: Array<{ itemId: string; quantity: number; notes?: string }>,
    notes?: string
  ) => Promise<void>;
  completeTransfer: (transferId: string) => Promise<void>;
  cancelTransfer: (transferId: string, reason?: string) => Promise<void>;
  
  // Fetch functions
  fetchWarehouses: () => Promise<void>;
  fetchTransfers: () => Promise<void>;
  
  // Utility
  getWarehouseById: (id: string) => Warehouse | undefined;
  getWarehouseStock: (warehouseId: string) => Promise<any[]>;
}

const WarehouseContext = createContext<WarehouseContextType | undefined>(undefined);

export const WarehouseProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [transfers, setTransfers] = useState<WarehouseTransfer[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { hasPermission } = useAuth();

  // Map database row to Warehouse
  const mapWarehouseRow = (row: any): Warehouse => ({
    id: String(row.id),
    code: String(row.code || ''),
    name: String(row.name || ''),
    type: row.type,
    location: row.location ?? undefined,
    address: row.address ?? undefined,
    managerId: row.manager_id ?? undefined,
    phone: row.phone ?? undefined,
    isActive: row.is_active ?? true,
    capacityLimit: row.capacity_limit ?? undefined,
    notes: row.notes ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at ?? undefined,
  });

  const mapTransferItemRow = (row: any): WarehouseTransferItem => ({
    id: String(row.id),
    transferId: String(row.transfer_id),
    itemId: String(row.item_id),
    quantity: Number(row.quantity ?? 0),
    transferredQuantity: Number(row.transferred_quantity ?? 0),
    notes: row.notes ?? undefined,
    itemName: row.item_name ?? undefined,
  });

  const mapTransferRow = (row: any): WarehouseTransfer => ({
    id: String(row.id),
    transferNumber: String(row.transfer_number || ''),
    fromWarehouseId: String(row.from_warehouse_id),
    toWarehouseId: String(row.to_warehouse_id),
    transferDate: row.transfer_date,
    status: row.status,
    notes: row.notes ?? undefined,
    createdBy: row.created_by ?? undefined,
    approvedBy: row.approved_by ?? undefined,
    completedAt: row.completed_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at ?? undefined,
    fromWarehouseName: row.from_warehouse?.name ?? row.from_warehouse_name ?? undefined,
    toWarehouseName: row.to_warehouse?.name ?? row.to_warehouse_name ?? undefined,
    items: Array.isArray(row.items) ? row.items.map(mapTransferItemRow) : undefined,
  });

  // Fetch warehouses
  const fetchWarehouses = useCallback(async () => {
    const supabase = getSupabaseClient();
    if (!supabase) {
      setError('قاعدة البيانات غير متاحة');
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const { data, error: fetchError } = await supabase
        .from('warehouses')
        .select('*')
        .order('name', { ascending: true });

      if (fetchError) throw fetchError;

      setWarehouses((data || []).map(mapWarehouseRow));
    } catch (err: any) {
      if (!isAbortLikeError(err)) {
        console.error('Error fetching warehouses:', err);
        setError(localizeSupabaseError(err));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch transfers
  const fetchTransfers = useCallback(async () => {
    const supabase = getSupabaseClient();
    if (!supabase) return;

    try {
      const { data, error: fetchError } = await supabase
        .from('warehouse_transfers')
        .select(`
          *,
          from_warehouse:warehouses!warehouse_transfers_from_warehouse_id_fkey(name),
          to_warehouse:warehouses!warehouse_transfers_to_warehouse_id_fkey(name)
        `)
        .order('created_at', { ascending: false });

      if (fetchError) throw fetchError;
      setTransfers((data || []).map(mapTransferRow));
    } catch (err: any) {
      if (!isAbortLikeError(err)) {
        console.error('Error fetching transfers:', err);
      }
    }
  }, []);

  // Add warehouse
  const addWarehouse = useCallback(async (warehouse: Omit<Warehouse, 'id' | 'createdAt' | 'updatedAt'>) => {
    const supabase = getSupabaseClient();
    if (!supabase) throw new Error('قاعدة البيانات غير متاحة');
    if (!hasPermission('stock.manage')) throw new Error('ليس لديك صلاحية لإضافة مخازن');

    const { error: insertError } = await supabase
      .from('warehouses')
      .insert({
        code: warehouse.code,
        name: warehouse.name,
        type: warehouse.type,
        location: warehouse.location,
        address: warehouse.address,
        manager_id: warehouse.managerId,
        phone: warehouse.phone,
        is_active: warehouse.isActive ?? true,
        capacity_limit: warehouse.capacityLimit,
        notes: warehouse.notes,
      });

    if (insertError) throw insertError;

    await fetchWarehouses();
  }, [hasPermission, fetchWarehouses]);

  // Update warehouse
  const updateWarehouse = useCallback(async (id: string, updates: Partial<Warehouse>) => {
    const supabase = getSupabaseClient();
    if (!supabase) throw new Error('قاعدة البيانات غير متاحة');
    if (!hasPermission('stock.manage')) throw new Error('ليس لديك صلاحية لتعديل المخازن');

    const dbUpdates: Record<string, unknown> = {};
    if (updates.code !== undefined) dbUpdates.code = updates.code;
    if (updates.name !== undefined) dbUpdates.name = updates.name;
    if (updates.type !== undefined) dbUpdates.type = updates.type;
    if (updates.location !== undefined) dbUpdates.location = updates.location;
    if (updates.address !== undefined) dbUpdates.address = updates.address;
    if (updates.managerId !== undefined) dbUpdates.manager_id = updates.managerId;
    if (updates.phone !== undefined) dbUpdates.phone = updates.phone;
    if (updates.isActive !== undefined) dbUpdates.is_active = updates.isActive;
    if (updates.capacityLimit !== undefined) dbUpdates.capacity_limit = updates.capacityLimit;
    if (updates.notes !== undefined) dbUpdates.notes = updates.notes;
    dbUpdates.updated_at = new Date().toISOString();

    const { error: updateError } = await supabase
      .from('warehouses')
      .update(dbUpdates)
      .eq('id', id);

    if (updateError) throw updateError;

    await fetchWarehouses();
  }, [hasPermission, fetchWarehouses]);

  // Delete warehouse
  const deleteWarehouse = useCallback(async (id: string) => {
    const supabase = getSupabaseClient();
    if (!supabase) throw new Error('قاعدة البيانات غير متاحة');
    if (!hasPermission('stock.manage')) throw new Error('ليس لديك صلاحية لحذف المخازن');

    // Check if warehouse has stock
    const { data: stockData, error: stockError } = await supabase
      .from('stock_management')
      .select('id')
      .eq('warehouse_id', id)
      .gt('available_quantity', 0)
      .limit(1);

    if (stockError) throw stockError;
    if (stockData && stockData.length > 0) {
      throw new Error('لا يمكن حذف مخزن يحتوي على مخزون');
    }

    const { error: deleteError } = await supabase
      .from('warehouses')
      .delete()
      .eq('id', id);

    if (deleteError) throw deleteError;

    await fetchWarehouses();
  }, [hasPermission, fetchWarehouses]);

  // Create transfer
  const createTransfer = useCallback(async (
    fromWarehouseId: string,
    toWarehouseId: string,
    transferDate: string,
    items: Array<{ itemId: string; quantity: number; notes?: string }>,
    notes?: string
  ) => {
    const supabase = getSupabaseClient();
    if (!supabase) throw new Error('قاعدة البيانات غير متاحة');
    if (!hasPermission('stock.manage')) throw new Error('ليس لديك صلاحية لإنشاء عمليات نقل');

    if (items.length === 0) throw new Error('يجب إضافة أصناف للنقل');

    // Insert transfer
    const { data: transferData, error: transferError } = await supabase
      .from('warehouse_transfers')
      .insert({
        from_warehouse_id: fromWarehouseId,
        to_warehouse_id: toWarehouseId,
        transfer_date: transferDate,
        status: 'pending',
        notes,
      })
      .select()
      .single();

    if (transferError) throw transferError;
    if (!transferData) throw new Error('فشل إنشاء عملية النقل');

    // Insert items
    const itemsToInsert = items.map(item => ({
      transfer_id: transferData.id,
      item_id: item.itemId,
      quantity: item.quantity,
      notes: item.notes,
    }));

    const { error: itemsError } = await supabase
      .from('warehouse_transfer_items')
      .insert(itemsToInsert);

    if (itemsError) throw itemsError;

    await fetchTransfers();
  }, [hasPermission, fetchTransfers]);

  // Complete transfer
  const completeTransfer = useCallback(async (transferId: string) => {
    const supabase = getSupabaseClient();
    if (!supabase) throw new Error('قاعدة البيانات غير متاحة');
    if (!hasPermission('stock.manage')) throw new Error('ليس لديك صلاحية لإتمام عمليات النقل');

    const { error } = await supabase.rpc('complete_warehouse_transfer', {
      p_transfer_id: transferId,
    });

    if (error) throw error;

    await fetchTransfers();
  }, [hasPermission, fetchTransfers]);

  // Cancel transfer
  const cancelTransfer = useCallback(async (transferId: string, reason?: string) => {
    const supabase = getSupabaseClient();
    if (!supabase) throw new Error('قاعدة البيانات غير متاحة');
    if (!hasPermission('stock.manage')) throw new Error('ليس لديك صلاحية لإلغاء عمليات النقل');

    const { error } = await supabase.rpc('cancel_warehouse_transfer', {
      p_transfer_id: transferId,
      p_reason: reason,
    });

    if (error) throw error;

    await fetchTransfers();
  }, [hasPermission, fetchTransfers]);

  // Get warehouse by ID
  const getWarehouseById = useCallback((id: string) => {
    return warehouses.find(w => w.id === id);
  }, [warehouses]);

  // Get warehouse stock
  const getWarehouseStock = useCallback(async (warehouseId: string) => {
    const supabase = getSupabaseClient();
    if (!supabase) throw new Error('قاعدة البيانات غير متاحة');

    const { data, error } = await supabase
      .from('stock_management')
      .select(`
        *,
        menu_items!inner(id, data)
      `)
      .eq('warehouse_id', warehouseId);

    if (error) throw error;

    return data || [];
  }, []);

  // Initial fetch
  useEffect(() => {
    fetchWarehouses();
    fetchTransfers();
  }, [fetchWarehouses, fetchTransfers]);

  const value: WarehouseContextType = {
    warehouses,
    transfers,
    loading,
    error,
    addWarehouse,
    updateWarehouse,
    deleteWarehouse,
    createTransfer,
    completeTransfer,
    cancelTransfer,
    fetchWarehouses,
    fetchTransfers,
    getWarehouseById,
    getWarehouseStock,
  };

  return <WarehouseContext.Provider value={value}>{children}</WarehouseContext.Provider>;
};

export const useWarehouses = () => {
  const context = useContext(WarehouseContext);
  if (!context) {
    throw new Error('useWarehouses must be used within WarehouseProvider');
  }
  return context;
};
