import React, { useEffect, useState } from 'react';
import { getSupabaseClient } from '../../supabase';
import * as Icons from '../icons';
import { useDashboard } from './WorldClassWidgets';

const Skeleton: React.FC<{ className?: string }> = ({ className = '' }) => (
    <div className={`bg-gray-200 dark:bg-gray-700 animate-pulse rounded-lg ${className}`} />
);

export const InStoreUxWidget: React.FC = () => {
    const { refreshKey } = useDashboard();
    const [loading, setLoading] = useState(true);
    const [stats, setStats] = useState({
        total: 0,
        slow: 0,
        detached: 0,
        p95: 0,
        slowRate: 0
    });

    useEffect(() => {
        let active = true;
        const load = async () => {
            setLoading(true);
            try {
                const supabase = getSupabaseClient();
                if (!supabase) return;

                // Last 24 hours
                const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

                const { data, error } = await supabase
                    .from('system_audit_logs')
                    .select('metadata')
                    .eq('module', 'orders_ux')
                    .eq('action', 'in_store_sale_ux_metric')
                    .gte('performed_at', since)
                    .limit(1000);

                if (error) throw error;

                if (active && data) {
                    let total = 0;
                    let slow = 0;
                    let detached = 0;
                    const durations: number[] = [];

                    data.forEach((row: any) => {
                        const meta = row.metadata || {};
                        total++;
                        if (meta.slow) slow++;
                        if (meta.detached) detached++;
                        if (typeof meta.durationMs === 'number') durations.push(meta.durationMs);
                    });

                    // Calculate P95
                    durations.sort((a, b) => a - b);
                    let p95 = 0;
                    if (durations.length > 0) {
                        const idx = Math.floor(durations.length * 0.95);
                        p95 = durations[idx];
                    }

                    const slowRate = total > 0 ? ((slow + detached) / total) * 100 : 0;

                    setStats({
                        total,
                        slow,
                        detached,
                        p95,
                        slowRate
                    });
                }
            } catch (err) {
                console.error('Error loading UX stats:', err);
            } finally {
                if (active) setLoading(false);
            }
        };

        load();
        return () => { active = false; };
    }, [refreshKey]);

    // Determine status color based on slow rate
    // < 1% = Good (Green)
    // 1-5% = Warning (Yellow)
    // > 5% = Critical (Red)
    let statusColor = 'text-emerald-500';
    let statusBg = 'bg-emerald-50 dark:bg-emerald-900/20';
    let statusLabel = 'ممتاز';
    
    if (stats.slowRate > 5) {
        statusColor = 'text-red-500';
        statusBg = 'bg-red-50 dark:bg-red-900/20';
        statusLabel = 'حرج';
    } else if (stats.slowRate > 1) {
        statusColor = 'text-amber-500';
        statusBg = 'bg-amber-50 dark:bg-amber-900/20';
        statusLabel = 'متوسط';
    }

    return (
        <div className="glass-card rounded-2xl p-5 animate-slide-in-up h-full">
            <h3 className="font-bold text-gray-800 dark:text-gray-200 text-sm mb-4 flex items-center gap-2">
                <Icons.TrendingUpIcon className={`w-4 h-4 ${statusColor}`} />
                جودة أداء البيع (24 ساعة)
            </h3>

            {loading ? (
                <div className="space-y-3">
                    <Skeleton className="h-8 w-1/2" />
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-3/4" />
                </div>
            ) : (
                <div className="flex flex-col gap-4">
                    {/* Main Metric: Slow Rate */}
                    <div className="flex items-center justify-between">
                        <div>
                            <div className="text-3xl font-bold font-mono text-gray-900 dark:text-white">
                                {stats.slowRate.toFixed(1)}%
                            </div>
                            <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">معدل العمليات البطيئة</div>
                        </div>
                        <div className={`px-3 py-1 rounded-full text-xs font-bold ${statusBg} ${statusColor}`}>
                            {statusLabel}
                        </div>
                    </div>

                    {/* Breakdown */}
                    <div className="space-y-2 pt-2 border-t border-gray-100 dark:border-gray-700/50">
                        <div className="flex justify-between text-xs">
                            <span className="text-gray-600 dark:text-gray-400">إجمالي العمليات</span>
                            <span className="font-mono font-medium text-gray-900 dark:text-white">{stats.total}</span>
                        </div>
                        <div className="flex justify-between text-xs">
                            <span className="text-gray-600 dark:text-gray-400">عمليات بطيئة ({'>'}15ث)</span>
                            <span className={`font-mono font-medium ${stats.slow > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-gray-900 dark:text-white'}`}>
                                {stats.slow}
                            </span>
                        </div>
                        <div className="flex justify-between text-xs">
                            <span className="text-gray-600 dark:text-gray-400">عمليات تم فصلها (خلفية)</span>
                            <span className={`font-mono font-medium ${stats.detached > 0 ? 'text-indigo-600 dark:text-indigo-400' : 'text-gray-900 dark:text-white'}`}>
                                {stats.detached}
                            </span>
                        </div>
                        <div className="flex justify-between text-xs">
                            <span className="text-gray-600 dark:text-gray-400">P95 Latency</span>
                            <span className="font-mono font-medium text-gray-900 dark:text-white">
                                {(stats.p95 / 1000).toFixed(1)}s
                            </span>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
