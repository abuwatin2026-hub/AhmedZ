import { getSupabaseClient } from '../supabase';
import type { DeliveryZone, Order } from '../types';

/**
 * Calculate statistics for a specific delivery zone
 * 
 * @param zoneId - The ID of the delivery zone
 * @returns Statistics object or undefined if calculation fails
 */
export async function calculateZoneStatistics(zoneId: string): Promise<DeliveryZone['statistics'] | undefined> {
    try {
        const supabase = getSupabaseClient();
        if (!supabase) return undefined;

        const { data: rows, error } = await supabase
            .from('orders')
            .select('data')
            .eq('status', 'delivered')
            .eq('delivery_zone_id', zoneId)
            .limit(2000);
        if (error) throw error;

        const orders = (rows || []).map(r => r.data as Order).filter(Boolean);

        if (orders.length === 0) {
            return {
                totalOrders: 0,
                totalRevenue: 0,
                averageDeliveryTime: 0,
                lastOrderDate: undefined
            };
        }

        const totalOrders = orders.length;

        const totalRevenue = orders.reduce((sum, order) => sum + (order.total || 0), 0);

        // Calculate average delivery time (in minutes)
        // Using deliveredAt - createdAt
        let totalDeliveryTimeMs = 0;
        let validTimeCount = 0;
        let lastOrderDate: string | undefined = undefined;

        orders.forEach(order => {
            if (order.createdAt && order.deliveredAt) {
                const start = new Date(order.createdAt).getTime();
                const end = new Date(order.deliveredAt).getTime();
                const duration = end - start;

                if (duration > 0) {
                    totalDeliveryTimeMs += duration;
                    validTimeCount++;
                }

                // Track latest order
                if (!lastOrderDate || new Date(order.createdAt) > new Date(lastOrderDate)) {
                    lastOrderDate = order.createdAt;
                }
            } else if (order.createdAt) {
                // Determine latest order even if not delivered (though query filters for delivered)
                if (!lastOrderDate || new Date(order.createdAt) > new Date(lastOrderDate)) {
                    lastOrderDate = order.createdAt;
                }
            }
        });

        const averageDeliveryTimeMs = validTimeCount > 0 ? totalDeliveryTimeMs / validTimeCount : 0;
        const averageDeliveryTime = Math.round(averageDeliveryTimeMs / 60000); // Convert to minutes

        return {
            totalOrders,
            totalRevenue,
            averageDeliveryTime,
            lastOrderDate
        };
    } catch (error) {
        return undefined;
    }
}

/**
 * Update statistics for all delivery zones in the database
 */
export async function updateAllZoneStatistics(): Promise<void> {
    try {
        const supabase = getSupabaseClient();
        if (!supabase) return;

        const { data: rows, error } = await supabase.from('delivery_zones').select('id,data');
        if (error) throw error;

        for (const row of rows || []) {
            const zone = row.data as DeliveryZone | undefined;
            if (!zone?.id) continue;
            const stats = await calculateZoneStatistics(zone.id);
            if (!stats) continue;
            const next: DeliveryZone = { ...zone, statistics: stats };
            const { error: upError } = await supabase.from('delivery_zones').update({ data: next }).eq('id', zone.id);
            if (upError) throw upError;
        }
    } catch {
        return;
    }
}
