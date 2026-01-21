import React, { createContext, useContext, useState, ReactNode, useCallback, useEffect } from 'react';
import type { DeliveryZone } from '../types';
import { getSupabaseClient } from '../supabase';
import { logger } from '../utils/logger';
import { localizeSupabaseError, isAbortLikeError } from '../utils/errorUtils';
import { enqueueTable } from '../utils/offlineQueue';

interface DeliveryZoneContextType {
  deliveryZones: DeliveryZone[];
  loading: boolean;
  fetchDeliveryZones: () => Promise<void>;
  addDeliveryZone: (zone: Omit<DeliveryZone, 'id'>) => Promise<void>;
  updateDeliveryZone: (zone: DeliveryZone) => Promise<void>;
  deleteDeliveryZone: (zoneId: string) => Promise<void>;
  getDeliveryZoneById: (zoneId: string) => DeliveryZone | undefined;
}

const DeliveryZoneContext = createContext<DeliveryZoneContextType | undefined>(undefined);

export const DeliveryZoneProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const MAX_SNAPSHOT_AGE_MS = 5 * 60 * 1000;
  const [deliveryZones, setDeliveryZones] = useState<DeliveryZone[]>([]);
  const [loading, setLoading] = useState(true);
  const lastSnapshotRef = React.useRef<{ zones: DeliveryZone[]; ts: number }>({ zones: [], ts: 0 });

  const getZoneNameText = (zone: DeliveryZone | Omit<DeliveryZone, 'id'>) => {
    const name = (zone as any)?.name;
    if (name && typeof name === 'object') {
      const ar = typeof name.ar === 'string' ? name.ar : '';
      const en = typeof name.en === 'string' ? name.en : '';
      return ar || en || '';
    }
    return '';
  };

  const fetchDeliveryZones = useCallback(async () => {
    setLoading(true);
    try {
      const supabase = getSupabaseClient();
      if (!supabase) {
        setDeliveryZones([]);
        return;
      }
      const { data: rows, error: rowsError } = await supabase.from('delivery_zones').select('id,data');
      if (rowsError) throw rowsError;
      const list = (rows || []).map(row => row.data as DeliveryZone).filter(Boolean);
      setDeliveryZones(list);
      lastSnapshotRef.current = { zones: list, ts: Date.now() };
    } catch (error) {
      const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
      if (offline || isAbortLikeError(error)) {
        const snap = lastSnapshotRef.current;
        const fresh = snap.ts > 0 && (Date.now() - snap.ts <= MAX_SNAPSHOT_AGE_MS);
        setDeliveryZones(fresh ? snap.zones : []);
        return;
      }
      logger.error(localizeSupabaseError(error));
      setDeliveryZones([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDeliveryZones();
  }, [fetchDeliveryZones]);

  useEffect(() => {
    const onOffline = () => {
      const snap = lastSnapshotRef.current;
      const fresh = snap.ts > 0 && (Date.now() - snap.ts <= MAX_SNAPSHOT_AGE_MS);
      setDeliveryZones(fresh ? snap.zones : []);
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('offline', onOffline);
      return () => window.removeEventListener('offline', onOffline);
    }
  }, []);

  useEffect(() => {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    const channel = supabase
      .channel('public:delivery_zones')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'delivery_zones' },
        async () => {
          await fetchDeliveryZones();
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchDeliveryZones]);

  const addDeliveryZone = async (zone: Omit<DeliveryZone, 'id'>) => {
    const newZone = { ...zone, id: crypto.randomUUID() };
    const supabase = getSupabaseClient();
    if (supabase) {
      try {
        const { error } = await supabase.from('delivery_zones').insert({
          id: newZone.id,
          name: getZoneNameText(newZone),
          is_active: Boolean((newZone as any).isActive ?? true),
          delivery_fee: Number.isFinite((newZone as any).deliveryFee) ? Number((newZone as any).deliveryFee) : 0,
          data: newZone,
        });
        if (error) throw error;
      } catch (err) {
        const isOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
        if (isOffline || isAbortLikeError(err)) {
          enqueueTable('delivery_zones', 'insert', {
            id: newZone.id,
            name: getZoneNameText(newZone),
            is_active: Boolean((newZone as any).isActive ?? true),
            delivery_fee: Number.isFinite((newZone as any).deliveryFee) ? Number((newZone as any).deliveryFee) : 0,
            data: newZone,
          });
        } else {
          throw new Error(localizeSupabaseError(err));
        }
      }
    } else {
      throw new Error('Supabase غير مهيأ.');
    }
    await fetchDeliveryZones();
  };

  const updateDeliveryZone = async (zone: DeliveryZone) => {
    const supabase = getSupabaseClient();
    if (supabase) {
      try {
        const { error } = await supabase.from('delivery_zones').upsert(
          {
            id: zone.id,
            name: getZoneNameText(zone),
            is_active: Boolean((zone as any).isActive ?? true),
            delivery_fee: Number.isFinite((zone as any).deliveryFee) ? Number((zone as any).deliveryFee) : 0,
            data: zone,
          },
          { onConflict: 'id' }
        );
        if (error) throw error;
      } catch (err) {
        const isOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
        if (isOffline || isAbortLikeError(err)) {
          enqueueTable('delivery_zones', 'upsert', {
            id: zone.id,
            name: getZoneNameText(zone),
            is_active: Boolean((zone as any).isActive ?? true),
            delivery_fee: Number.isFinite((zone as any).deliveryFee) ? Number((zone as any).deliveryFee) : 0,
            data: zone,
          }, { onConflict: 'id' });
        } else {
          throw new Error(localizeSupabaseError(err));
        }
      }
    } else {
      throw new Error('Supabase غير مهيأ.');
    }
    await fetchDeliveryZones();
  };

  const deleteDeliveryZone = async (zoneId: string) => {
    const supabase = getSupabaseClient();
    if (supabase) {
      try {
        const { error } = await supabase.from('delivery_zones').delete().eq('id', zoneId);
        if (error) throw error;
      } catch (err) {
        const isOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
        if (isOffline || isAbortLikeError(err)) {
          enqueueTable('delivery_zones', 'delete', undefined, { match: { column: 'id', value: zoneId } });
        } else {
          throw new Error(localizeSupabaseError(err));
        }
      }
    } else {
      throw new Error('Supabase غير مهيأ.');
    }
    await fetchDeliveryZones();
  };

  const getDeliveryZoneById = (zoneId: string) => deliveryZones.find(z => z.id === zoneId);

  return (
    <DeliveryZoneContext.Provider value={{ deliveryZones, loading, fetchDeliveryZones, addDeliveryZone, updateDeliveryZone, deleteDeliveryZone, getDeliveryZoneById }}>
      {children}
    </DeliveryZoneContext.Provider>
  );
};

export const useDeliveryZones = () => {
  const context = useContext(DeliveryZoneContext);
  if (context === undefined) {
    throw new Error('useDeliveryZones must be used within a DeliveryZoneProvider');
  }
  return context;
};
