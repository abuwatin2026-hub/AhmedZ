-- ============================================================
-- Migration: Performance optimizations
-- Date: 2026-03-22
--
-- Adds missing indexes, creates timezone cache, and optimizes
-- frequently accessed tables
-- ============================================================

-- === Missing Indexes ===

-- notifications (14.9% index usage → should be 90%+)
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON public.notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_is_read ON public.notifications(is_read) WHERE is_read = false;
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON public.notifications(created_at DESC);

-- batches (52.5% index usage)
CREATE INDEX IF NOT EXISTS idx_batches_item_warehouse ON public.batches(item_id, warehouse_id);
CREATE INDEX IF NOT EXISTS idx_batches_expiry ON public.batches(expiry_date) WHERE expiry_date IS NOT NULL;

-- stock_management (75% index usage)
CREATE INDEX IF NOT EXISTS idx_stock_mgmt_item_wh ON public.stock_management(item_id, warehouse_id);

-- system_audit_logs (25% of DB, speed up queries)
CREATE INDEX IF NOT EXISTS idx_audit_logs_performed_at ON public.system_audit_logs(performed_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_module ON public.system_audit_logs(module);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON public.system_audit_logs(action);

-- price_history (3.7% index usage — worst!)
CREATE INDEX IF NOT EXISTS idx_price_history_item ON public.price_history(item_id);

-- party_open_items
CREATE INDEX IF NOT EXISTS idx_party_open_status ON public.party_open_items(status) WHERE status = 'open';

-- orders (optimize common queries)
CREATE INDEX IF NOT EXISTS idx_orders_status ON public.orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON public.orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_customer ON public.orders(customer_auth_user_id);

-- === Timezone Cache (replaces slow pg_timezone_names query) ===
CREATE MATERIALIZED VIEW IF NOT EXISTS public.cached_timezone_names AS
SELECT name, abbrev, utc_offset::text as utc_offset, is_dst
FROM pg_timezone_names ORDER BY name;

CREATE UNIQUE INDEX IF NOT EXISTS idx_cached_tz_name ON public.cached_timezone_names(name);
GRANT SELECT ON public.cached_timezone_names TO authenticated, anon;

-- === ANALYZE all key tables ===
ANALYZE public.orders;
ANALYZE public.inventory_movements;
ANALYZE public.journal_entries;
ANALYZE public.journal_lines;
ANALYZE public.payments;
ANALYZE public.batches;
ANALYZE public.notifications;
ANALYZE public.batch_balances;
ANALYZE public.stock_management;
