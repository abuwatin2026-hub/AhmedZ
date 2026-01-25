import React, { useEffect, useMemo, useState } from 'react';
import { useSettings } from '../../../contexts/SettingsContext';
import { useToast } from '../../../contexts/ToastContext';
import { useDeliveryZones } from '../../../contexts/DeliveryZoneContext';
import { exportToXlsx, sharePdf } from '../../../utils/export';
import { buildPdfBrandOptions, buildXlsxBrandOptions } from '../../../utils/branding';
import HorizontalBarChart from '../../../components/admin/charts/HorizontalBarChart';
import { getSupabaseClient } from '../../../supabase';
import { localizeSupabaseError } from '../../../utils/errorUtils';

interface ProductSalesRow {
    item_id: string;
    item_name: any;
    unit_type: string;
    quantity_sold: number;
    current_stock: number;
    reserved_stock: number;
    current_cost_price: number;
    total_sales: number;
    total_cost: number;
    total_profit: number;
    avg_inventory?: number;
}

const ProductReports: React.FC = () => {
    const { settings } = useSettings();
    const { deliveryZones } = useDeliveryZones();
    const { showNotification } = useToast();
    const [isSharing, setIsSharing] = useState(false);
    const [loading, setLoading] = useState(false);
    
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');
    const [selectedZoneId, setSelectedZoneId] = useState<string>('');
    const [rangePreset, setRangePreset] = useState<'today' | 'week' | 'month' | 'year' | 'all'>('all');
    const [productSearch, setProductSearch] = useState('');
    const [showAllProducts, setShowAllProducts] = useState(false);
    
    const [reportData, setReportData] = useState<ProductSalesRow[]>([]);

    const language = 'ar'; // Fixed for now or get from context if available

    const applyPreset = (preset: typeof rangePreset) => {
        setRangePreset(preset);
        if (preset === 'all') {
            setStartDate('');
            setEndDate('');
            return;
        }
        const now = new Date();
        const start = new Date(now);
        const end = new Date(now);

        if (preset === 'today') {
            // Start and End are already 'now'
        } else if (preset === 'week') {
            const day = now.getDay();
            const diff = (day + 6) % 7; // Adjust if week starts on Monday
            start.setDate(now.getDate() - diff);
        } else if (preset === 'month') {
            start.setDate(1);
            end.setMonth(now.getMonth() + 1, 0);
        } else if (preset === 'year') {
            start.setMonth(0, 1);
            end.setMonth(11, 31);
        }
        
        // Use local date string YYYY-MM-DD
        const toLocalYMD = (date: Date) => {
            const offset = date.getTimezoneOffset();
            const local = new Date(date.getTime() - (offset * 60 * 1000));
            return local.toISOString().slice(0, 10);
        };

        setStartDate(toLocalYMD(start));
        setEndDate(toLocalYMD(end));
    };

    // Initialize with "all" or specific range
    useEffect(() => {
        // Only if not set
        if (!startDate && !endDate && rangePreset === 'all') {
            // keep as is
        }
    }, []);

    const range = useMemo(() => {
        if (!startDate && !endDate) return null;

        // Construct dates ensuring they represent the start of the day and end of the day in LOCAL time
        // Parsing "YYYY-MM-DD" usually defaults to UTC in Date.parse, but "YYYY-MM-DDT00:00:00" defaults to local in most implementations,
        // or we can construct it manually.
        
        const getStartOfDay = (dateStr: string) => {
            if (!dateStr) return null;
            const d = new Date(dateStr);
            d.setHours(0, 0, 0, 0);
            // If the browser parsed YYYY-MM-DD as UTC (e.g. 00:00 UTC), and we are in +3, it might be 3AM local.
            // Better approach:
            const parts = dateStr.split('-');
            if (parts.length !== 3) return new Date(dateStr);
            return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]), 0, 0, 0, 0);
        };

        const getEndOfDay = (dateStr: string) => {
            if (!dateStr) return null;
            const parts = dateStr.split('-');
            if (parts.length !== 3) return new Date(dateStr);
            return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]), 23, 59, 59, 999);
        };

        const start = startDate ? getStartOfDay(startDate) : null;
        const end = endDate ? getEndOfDay(endDate) : null;
        
        if (!start || !end) return null;

        return { start, end };
    }, [startDate, endDate]);

    useEffect(() => {
        let active = true;
        const load = async () => {
            const supabase = getSupabaseClient();
            if (!supabase) return;

            setLoading(true);
            try {
                let p_start = '2000-01-01T00:00:00Z';
                let p_end = '2100-01-01T23:59:59Z';

                if (range) {
                    p_start = range.start.toISOString();
                    p_end = range.end.toISOString();
                }

                const chunk = <T,>(arr: T[], size: number) => {
                    const out: T[][] = [];
                    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
                    return out;
                };

                const parseNumber = (v: any) => {
                    const n = typeof v === 'number' ? v : Number(v);
                    return Number.isFinite(n) ? n : 0;
                };

                const normalizeRpcRow = (r: any): ProductSalesRow => ({
                    item_id: String(r?.item_id ?? ''),
                    item_name: r?.item_name,
                    unit_type: String(r?.unit_type ?? 'piece'),
                    quantity_sold: parseNumber(r?.quantity_sold),
                    current_stock: parseNumber(r?.current_stock),
                    reserved_stock: parseNumber(r?.reserved_stock),
                    current_cost_price: parseNumber(r?.current_cost_price),
                    total_sales: parseNumber(r?.total_sales),
                    total_cost: parseNumber(r?.total_cost),
                    total_profit: parseNumber(r?.total_profit),
                    avg_inventory: r?.avg_inventory === null || r?.avg_inventory === undefined ? undefined : parseNumber(r?.avg_inventory),
                });

                const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
                const zoneArg = (selectedZoneId && uuidRegex.test(selectedZoneId)) ? selectedZoneId : null;

                let rpcRows: ProductSalesRow[] | null = null;
                try {
                    const { data: rpcData, error: rpcErr } = await supabase.rpc('get_product_sales_report_v9', {
                        p_start_date: p_start,
                        p_end_date: p_end,
                        p_zone_id: zoneArg ?? null,
                        p_invoice_only: false,
                    } as any);
                    if (!rpcErr && Array.isArray(rpcData)) {
                        rpcRows = (rpcData as any[]).map(normalizeRpcRow);
                    }
                } catch (_) {}

                if (rpcRows) {
                    if (active) setReportData(rpcRows);
                    return;
                }

                const orderIds: string[] = [];
                const limit = 20000;
                let offset = 0;
                while (true) {
                    const { data: page, error: pageErr } = await supabase.rpc('get_sales_report_orders', {
                        p_start_date: p_start,
                        p_end_date: p_end,
                        p_zone_id: zoneArg ?? undefined,
                        p_invoice_only: false,
                        p_search: null,
                        p_limit: limit,
                        p_offset: offset,
                    });
                    if (pageErr) throw pageErr;
                    const rows = Array.isArray(page) ? page : [];
                    for (const r of rows) {
                        const id = String((r as any)?.id || '');
                        if (id) orderIds.push(id);
                    }
                    if (rows.length < limit) break;
                    offset += limit;
                }

                const ordersById = new Map<string, any>();
                for (const ids of chunk(orderIds, 200)) {
                    const { data: orders, error: oErr } = await supabase
                        .from('orders')
                        .select('id,status,created_at,delivery_zone_id,data')
                        .in('id', ids);
                    if (oErr) throw oErr;
                    for (const o of orders || []) {
                        ordersById.set(String((o as any).id), o);
                    }
                }

                const { data: menuItems, error: miErr } = await supabase
                    .from('menu_items')
                    .select('id,unit_type,cost_price,data');
                if (miErr) throw miErr;
                const menuById = new Map<string, any>();
                const menuByNameAr = new Map<string, string>();
                const menuByNameEn = new Map<string, string>();
                for (const mi of menuItems || []) {
                    const id = String((mi as any).id);
                    menuById.set(id, mi);
                    const nameAr = String((mi as any)?.data?.name?.ar || '').trim();
                    const nameEn = String((mi as any)?.data?.name?.en || '').trim();
                    if (nameAr) menuByNameAr.set(nameAr, id);
                    if (nameEn) menuByNameEn.set(nameEn, id);
                }

                const { data: stocks, error: smErr } = await supabase
                    .from('stock_management')
                    .select('item_id,available_quantity,reserved_quantity,avg_cost');
                if (smErr) throw smErr;
                const stockById = new Map<string, { current_stock: number; reserved_stock: number; current_cost_price: number }>();
                for (const s of stocks || []) {
                    const id = String((s as any)?.item_id || '');
                    if (!id) continue;
                    stockById.set(id, {
                        current_stock: parseNumber((s as any)?.available_quantity),
                        reserved_stock: parseNumber((s as any)?.reserved_quantity),
                        current_cost_price: parseNumber((s as any)?.avg_cost),
                    });
                }

                const getItemAddonsTotal = (addons: any) => {
                    if (!addons) return 0;
                    if (Array.isArray(addons)) {
                        return addons.reduce((sum, a) => sum + parseNumber(a?.addon?.price) * parseNumber(a?.quantity), 0);
                    }
                    if (typeof addons === 'object') {
                        return Object.values(addons).reduce((sum: number, a: any) => sum + parseNumber(a?.addon?.price) * parseNumber(a?.quantity), 0);
                    }
                    return 0;
                };

                const computeOrderItemLines = (orderData: any) => {
                    const invoiceItems = orderData?.invoiceSnapshot?.items;
                    const dataItems = orderData?.items;
                    const items = Array.isArray(invoiceItems) && invoiceItems.length > 0
                        ? invoiceItems
                        : (Array.isArray(dataItems) ? dataItems : []);
                    const lines: { itemId: string; name: any; unitType: string; qtyStock: number; salesAmountGross: number }[] = [];
                    for (const it of items) {
                        const nameObj = it?.name;
                        const nameAr = String(nameObj?.ar || '').trim();
                        const nameEn = String(nameObj?.en || '').trim();
                        let itemId = String(it?.itemId || it?.id || it?.menuItemId || '').trim();
                        if (!itemId) {
                            const byName = (nameAr && menuByNameAr.get(nameAr)) || (nameEn && menuByNameEn.get(nameEn)) || '';
                            itemId = String(byName || '').trim();
                        }
                        if (!itemId) continue;
                        const mi = menuById.get(itemId);
                        const unitType = String(it?.unitType || it?.unit || mi?.unit_type || 'piece');
                        const quantity = parseNumber(it?.quantity);
                        const weight = parseNumber(it?.weight);
                        const price = parseNumber(it?.price);
                        const pricePerUnit = parseNumber(it?.pricePerUnit);
                        const addonsTotal = getItemAddonsTotal(it?.selectedAddons);

                        const multiplier = (unitType === 'kg' || unitType === 'gram')
                            ? Math.max(quantity || 0, 1)
                            : Math.max(quantity || 0, 0);

                        const qtyStock = (unitType === 'kg' || unitType === 'gram') && weight > 0
                            ? (weight * multiplier)
                            : multiplier;

                        const base = (unitType === 'gram' && pricePerUnit > 0 && weight > 0)
                            ? (pricePerUnit / 1000.0) * weight
                            : ((unitType === 'kg' || unitType === 'gram') && weight > 0)
                                ? price * weight
                                : price;

                        const salesAmountGross = (base + addonsTotal) * multiplier;

                        lines.push({
                            itemId,
                            name: it?.name || mi?.data?.name || { ar: itemId },
                            unitType,
                            qtyStock,
                            salesAmountGross,
                        });
                    }
                    return lines;
                };

                const salesAgg = new Map<string, { item_id: string; item_name: any; unit_type: string; quantity_sold: number; gross_sales: number }>();
                const orderLinesByOrderId = new Map<string, Map<string, { qtyStock: number; grossSales: number; netSales: number }>>();
                for (const [id, o] of ordersById.entries()) {
                    const data = (o as any)?.data || {};
                    const lines = computeOrderItemLines(data);
                    const orderDiscount = parseNumber(data?.discountAmount ?? data?.discountTotal ?? data?.discount);
                    const orderGross = lines.reduce((s, ln) => s + ln.salesAmountGross, 0);
                    const orderSubtotal = parseNumber(data?.subtotal);
                    const scaleToSubtotal = (orderSubtotal > 0 && orderGross > 0) ? (orderSubtotal / orderGross) : 1;
                    const baseForDiscount = (orderSubtotal > 0) ? orderSubtotal : orderGross;
                    const perItem = new Map<string, { qtyStock: number; grossSales: number; netSales: number }>();
                    for (const ln of lines) {
                        const prev = perItem.get(ln.itemId) || { qtyStock: 0, grossSales: 0, netSales: 0 };
                        prev.qtyStock += ln.qtyStock;
                        const lineGrossAdj = ln.salesAmountGross * scaleToSubtotal;
                        prev.grossSales += lineGrossAdj;
                        perItem.set(ln.itemId, prev);

                        const discountShare = (orderDiscount > 0 && baseForDiscount > 0) ? (orderDiscount * (lineGrossAdj / baseForDiscount)) : 0;
                        const netSalesAmount = lineGrossAdj - discountShare;
                        const after = perItem.get(ln.itemId)!;
                        after.netSales += netSalesAmount;
                        perItem.set(ln.itemId, after);

                        const agg = salesAgg.get(ln.itemId) || {
                            item_id: ln.itemId,
                            item_name: ln.name,
                            unit_type: ln.unitType,
                            quantity_sold: 0,
                            gross_sales: 0,
                        };
                        agg.item_name = agg.item_name || ln.name;
                        agg.unit_type = agg.unit_type || ln.unitType;
                        agg.quantity_sold += ln.qtyStock;
                        agg.gross_sales += netSalesAmount;
                        salesAgg.set(ln.itemId, agg);
                    }
                    orderLinesByOrderId.set(id, perItem);
                }

                const { data: returns, error: rErr } = await supabase
                    .from('sales_returns')
                    .select('id,order_id,total_refund_amount,items,return_date,status')
                    .eq('status', 'completed')
                    .gte('return_date', p_start)
                    .lte('return_date', p_end);
                if (rErr) throw rErr;

                const returnOrderIds = [...new Set((returns || []).map((r: any) => String(r?.order_id || '')).filter(Boolean))];
                const returnOrdersInfo = new Map<string, any>();
                if (returnOrderIds.length > 0) {
                    for (const ids of chunk(returnOrderIds, 200)) {
                        const { data: orders, error: oErr } = await supabase
                            .from('orders')
                            .select('id,delivery_zone_id,data')
                            .in('id', ids);
                        if (oErr) throw oErr;
                        for (const o of orders || []) {
                            returnOrdersInfo.set(String((o as any).id), o);
                        }
                    }
                }
                const zoneOfOrder = (o: any): string | null => {
                    const dz = String(o?.data?.deliveryZoneId || '').trim();
                    const zTxt = (dz && uuidRegex.test(dz)) ? dz : null;
                    const zCol = o?.delivery_zone_id ? String(o.delivery_zone_id) : null;
                    return zTxt || zCol || null;
                };
                const returnOrdersInZone = new Set<string>(
                    returnOrderIds.filter(id => {
                        if (!zoneArg) return true;
                        const o = ordersById.get(id) || returnOrdersInfo.get(id);
                        if (!o) return false;
                        const z = zoneOfOrder(o);
                        return z === zoneArg;
                    })
                );

                const returnedSalesByItem = new Map<string, number>();
                const returnedQtyByItem = new Map<string, number>();

                for (const sr of returns || []) {
                    const orderId = String((sr as any)?.order_id || '');
                    const refund = parseNumber((sr as any)?.total_refund_amount);
                    const items = Array.isArray((sr as any)?.items) ? (sr as any).items : [];
                    if (!orderId || refund <= 0 || items.length === 0) continue;
                    if (zoneArg && !returnOrdersInZone.has(orderId)) continue;
                    const order = ordersById.get(orderId);
                    const orderData = (order as any)?.data || {};
                    const orderLines = orderLinesByOrderId.get(orderId) || (() => {
                        const lines = computeOrderItemLines(orderData);
                        const perItem = new Map<string, { qtyStock: number; grossSales: number; netSales: number }>();
                        for (const ln of lines) {
                            const prev = perItem.get(ln.itemId) || { qtyStock: 0, grossSales: 0, netSales: 0 };
                            prev.qtyStock += ln.qtyStock;
                            prev.grossSales += ln.salesAmountGross;
                            perItem.set(ln.itemId, prev);
                        }
                        orderLinesByOrderId.set(orderId, perItem);
                        return perItem;
                    })();

                    const perItemGrossValue: { itemId: string; qty: number; grossValue: number }[] = [];
                    let grossSum = 0;
                    for (const ri of items) {
                        const itemId = String(ri?.itemId || ri?.id || '').trim();
                        const qty = parseNumber(ri?.quantity);
                        if (!itemId || qty <= 0) continue;
                        const line = orderLines.get(itemId);
                        const unitPrice = line && line.qtyStock > 0 ? ((line.netSales ?? line.grossSales) / line.qtyStock) : 0;
                        const grossValue = qty * unitPrice;
                        perItemGrossValue.push({ itemId, qty, grossValue });
                        grossSum += grossValue;
                    }
                    if (grossSum <= 0) continue;
                    const scale = refund / grossSum;
                    for (const row of perItemGrossValue) {
                        returnedQtyByItem.set(row.itemId, (returnedQtyByItem.get(row.itemId) || 0) + row.qty);
                        returnedSalesByItem.set(row.itemId, (returnedSalesByItem.get(row.itemId) || 0) + (row.grossValue * scale));
                    }
                }

                const { data: movements, error: mErr } = await supabase
                    .from('inventory_movements')
                    .select('item_id,quantity,total_cost,movement_type,reference_table,occurred_at,data')
                    .eq('reference_table', 'sales_returns')
                    .eq('movement_type', 'return_in')
                    .gte('occurred_at', p_start)
                    .lte('occurred_at', p_end);
                if (mErr) throw mErr;
                const returnedCostByItem = new Map<string, number>();
                for (const mv of movements || []) {
                    const orderId = String((mv as any)?.data?.orderId || '');
                    if (zoneArg && orderId && !returnOrdersInZone.has(orderId)) continue;
                    const itemId = String((mv as any)?.item_id || '');
                    if (!itemId) continue;
                    returnedCostByItem.set(itemId, (returnedCostByItem.get(itemId) || 0) + parseNumber((mv as any)?.total_cost));
                }

                const deliveredPaidOrderIds = orderIds.filter(id => {
                    const o = ordersById.get(id);
                    const status = String((o as any)?.status || '');
                    const paidAt = String((o as any)?.data?.paidAt || '');
                    return status === 'delivered' || Boolean(paidAt);
                });
                const costByItem = new Map<string, number>();
                for (const ids of chunk(deliveredPaidOrderIds, 200)) {
                    const { data: cogs, error: cErr } = await supabase
                        .from('order_item_cogs')
                        .select('item_id,total_cost')
                        .in('order_id', ids);
                    if (cErr) throw cErr;
                    for (const c of cogs || []) {
                        const itemId = String((c as any)?.item_id || '');
                        if (!itemId) continue;
                        costByItem.set(itemId, (costByItem.get(itemId) || 0) + parseNumber((c as any)?.total_cost));
                    }
                }

                const keys = new Set<string>([
                    ...salesAgg.keys(),
                    ...returnedSalesByItem.keys(),
                    ...returnedCostByItem.keys(),
                    ...costByItem.keys(),
                ]);

                const rows: ProductSalesRow[] = [];
                for (const itemId of keys) {
                    const base = salesAgg.get(itemId) || { item_id: itemId, item_name: menuById.get(itemId)?.data?.name || { ar: itemId }, unit_type: menuById.get(itemId)?.unit_type || 'piece', quantity_sold: 0, gross_sales: 0 };
                    const returnedSales = returnedSalesByItem.get(itemId) || 0;
                    const returnedQty = returnedQtyByItem.get(itemId) || 0;
                    const grossCost = costByItem.get(itemId) || 0;
                    const returnedCost = returnedCostByItem.get(itemId) || 0;
                    const stock = stockById.get(itemId) || { current_stock: 0, reserved_stock: 0, current_cost_price: parseNumber(menuById.get(itemId)?.cost_price) };
                    const totalSales = base.gross_sales - returnedSales;
                    const totalCost = grossCost - returnedCost;
                    rows.push({
                        item_id: itemId,
                        item_name: base.item_name,
                        unit_type: base.unit_type,
                        quantity_sold: Math.max(base.quantity_sold - returnedQty, 0),
                        total_sales: totalSales,
                        total_cost: totalCost,
                        total_profit: totalSales - totalCost,
                        current_stock: stock.current_stock,
                        reserved_stock: stock.reserved_stock,
                        current_cost_price: stock.current_cost_price,
                    });
                }

                rows.sort((a, b) => Number(b.total_sales || 0) - Number(a.total_sales || 0));

                if (active) setReportData(rows);
            } catch (e) {
                console.error(e);
                const msg = localizeSupabaseError(e);
                if (msg) showNotification(msg, 'error');
                if (active) setReportData([]);
            } finally {
                if (active) setLoading(false);
            }
        };
        load();
        return () => { active = false; };
    }, [range, selectedZoneId]);

    const processedData = useMemo(() => {
        return reportData.map(row => {
            // Name resolution
            const nameObj = row.item_name;
            const name = (typeof nameObj === 'object' && nameObj !== null)
                ? (nameObj[language] || nameObj.ar || nameObj.en || row.item_id)
                : (String(nameObj || row.item_id));

            const totalSales = Number(row.total_sales || 0);
            const totalCost = Number(row.total_cost || 0);
            const totalProfit = Number(row.total_profit || (totalSales - totalCost));
            const qtySold = Number(row.quantity_sold || 0);
            const currentStock = Number(row.current_stock || 0);

            // Derived metrics
            const profitMargin = totalSales > 0 ? (totalProfit / totalSales) * 100 : 0;
            
            // Turnover: Quantity Sold / Average Inventory (preferred)
            const averageInv = typeof row.avg_inventory === 'number' ? Number(row.avg_inventory || 0) : currentStock;
            const turnoverRate = averageInv > 0 ? qtySold / averageInv : 0;

            // Days until stockout
            // Daily Sales Rate = Quantity Sold / Days in Period
            let daysInPeriod = 30;
            if (range) {
                const diffTime = Math.abs(range.end.getTime() - range.start.getTime());
                daysInPeriod = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) || 1;
            } else {
                // If "All" time, it's hard to calculate daily rate accurately without knowing the first sale date.
                // Let's assume 365 days for "All" or just disable this metric.
                daysInPeriod = 365;
            }

            const dailySalesRate = qtySold / daysInPeriod;
            const daysUntilStockout = (dailySalesRate > 0 && currentStock > 0)
                ? currentStock / dailySalesRate
                : null;

            return {
                ...row,
                total_sales: totalSales,
                total_cost: totalCost,
                total_profit: totalProfit,
                quantity_sold: qtySold,
                current_stock: currentStock,
                name,
                profitMargin,
                turnoverRate,
                daysUntilStockout
            };
        });
    }, [reportData, range, language]);

    // Removed unused stockByItemId memo
    const visibleProducts = useMemo(() => {
        const q = productSearch.trim().toLowerCase();
        const sorted = [...processedData].sort((a, b) => Number(b.total_sales || 0) - Number(a.total_sales || 0));
        if (!q) return sorted;
        return sorted.filter(p => {
            const name = String((p as any).name || '').toLowerCase();
            const idShort = String(p.item_id || '').slice(-6).toLowerCase();
            const unit = String(p.unit_type || '').toLowerCase();
            return name.includes(q) || idShort.includes(q) || unit.includes(q);
        });
    }, [processedData, productSearch]);
    
    const totalInventoryValue = useMemo(() => {
        return processedData.reduce((sum, item) => {
            const physicalQty = Number(item.current_stock || 0) + Number(item.reserved_stock || 0);
            return sum + (physicalQty * Number(item.current_cost_price || 0));
        }, 0);
    }, [processedData]);
    const totals = useMemo(() => {
        const qty = processedData.reduce((s, p) => s + Number(p.quantity_sold || 0), 0);
        const sales = processedData.reduce((s, p) => s + Number(p.total_sales || 0), 0);
        const cost = processedData.reduce((s, p) => s + Number(p.total_cost || 0), 0);
        const profit = processedData.reduce((s, p) => s + Number(p.total_profit || 0), 0);
        const inv = processedData.reduce((s, p) => s + Number((p as any).avg_inventory ?? p.current_stock ?? 0), 0);
        const turnover = inv > 0 ? (qty / inv) : 0;
        return { qty, sales, cost, profit, inv, turnover };
    }, [processedData]);

    const topSalesChart = useMemo(() => {
        return [...processedData]
            .sort((a, b) => Number(b.total_sales || 0) - Number(a.total_sales || 0))
            .slice(0, 10)
            .map(p => ({ label: p.name || p.item_id.slice(-6).toUpperCase(), value: Math.round(Number(p.total_sales || 0) * 100) / 100 }));
    }, [processedData]);

    const lowStock = useMemo(() => {
        // We need 'toSell' (available - reserved).
        // RPC returns current_stock (available) and reserved_stock.
        // Wait, check RPC logic for current_stock.
        // "coalesce(sm.available_quantity, 0) as current_stock" -> This is usually physical - reserved? 
        // In my schema: available_quantity IS the quantity available for sale (physical - reserved is handled implicitly or explicitly?).
        // Let's check 'deduct_stock'. It updates available_quantity.
        // Usually available_quantity = Physical - Reserved? 
        // Or Physical = Available + Reserved?
        // Schema: available_quantity, reserved_quantity.
        // Usually 'Available' means 'Available for sale'.
        // So I'll use it directly.
        
        return processedData
            .filter(p => p.current_stock <= 5 && p.current_stock > 0) // Arbitrary threshold 5 or get from item settings if I had joined it. RPC doesn't return threshold.
            .sort((a, b) => a.current_stock - b.current_stock)
            .slice(0, 15)
            .map(p => ({
                label: p.name,
                value: Number(p.current_stock)
            }));
    }, [processedData]);

    const handleExport = async () => {
        const exportProducts = showAllProducts ? visibleProducts : visibleProducts.slice(0, 200);
        const headers = [
            'اسم المنتج',
            'الكمية المباعة',
            'الوحدة',
            'إجمالي المبيعات',
            'التكلفة',
            'الربح',
            'هامش الربح %',
            'المتاح',
            'المحجوز',
            'قيمة المخزون',
        ];
        const rows = exportProducts.map(p => [
            p.name,
            Number(p.quantity_sold.toFixed(3)),
            p.unit_type,
            Number(p.total_sales || 0).toFixed(2),
            Number(p.total_cost || 0).toFixed(2),
            Number(p.total_profit || 0).toFixed(2),
            p.profitMargin.toFixed(1) + '%',
            p.current_stock,
            p.reserved_stock,
            ((Number(p.current_stock || 0) + Number(p.reserved_stock || 0)) * Number(p.current_cost_price || 0)).toFixed(2)
        ]);
        const success = await exportToXlsx(
            headers,
            rows,
            `product_report_${startDate || 'all'}_to_${endDate || 'all'}.xlsx`,
            { sheetName: 'Products', currencyColumns: [3, 4, 5, 9], currencyFormat: '#,##0.00', ...buildXlsxBrandOptions(settings, 'المنتجات', headers.length, { periodText: `الفترة: ${startDate || '—'} → ${endDate || '—'}` }) }
        );
        if (success) {
            showNotification(`تم حفظ التقرير في مجلد المستندات`, 'success');
        } else {
            showNotification('فشل تصدير الملف.', 'error');
        }
    };

    const handleSharePdf = async () => {
        setIsSharing(true);
        const success = await sharePdf(
            'print-area',
            'تقرير المنتجات',
            `product_report_${startDate || 'all'}_to_${endDate || 'all'}.pdf`,
            buildPdfBrandOptions(settings, 'تقرير المنتجات', { pageNumbers: true })
        );
        if (success) {
            showNotification('تم حفظ التقرير في مجلد المستندات', 'success');
        } else {
            showNotification('فشل مشاركة الملف.', 'error');
        }
        setIsSharing(false);
    };

    const currency = 'ر.ي';

    return (
        <div className="animate-fade-in space-y-6">
            <div className="flex flex-col md:flex-row justify-between items-center gap-3">
                <h1 className="text-3xl font-bold dark:text-white">تقرير المنتجات</h1>
                <div className="flex gap-2 flex-wrap justify-center">
                    <button onClick={handleSharePdf} disabled={isSharing || loading} className="bg-red-600 text-white font-semibold py-2 px-4 rounded-lg shadow hover:bg-red-700 transition disabled:bg-gray-400">
                        {isSharing ? 'جاري التحميل...' : 'مشاركة PDF'}
                    </button>
                    <button onClick={handleExport} disabled={loading} className="bg-green-600 text-white font-semibold py-2 px-4 rounded-lg shadow hover:bg-green-700 transition disabled:bg-gray-400">تصدير Excel</button>
                </div>
            </div>

            <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow-md flex flex-col md:flex-row gap-4 items-center flex-wrap">
                <div className="flex items-center gap-2">
                    <label htmlFor="startDate" title="فلتر التاريخ يعتمد على: تاريخ إصدار الفاتورة إن وُجد، وإلا paid_at ثم delivered_at ثم created_at.">من:</label>
                    <input
                        type="date"
                        id="startDate"
                        value={startDate}
                        onChange={e => {
                            setRangePreset('all');
                            setStartDate(e.target.value);
                        }}
                        className="p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600"
                    />
                </div>
                <div className="flex items-center gap-2">
                    <label htmlFor="endDate" title="فلتر التاريخ يعتمد على: تاريخ إصدار الفاتورة إن وُجد، وإلا paid_at ثم delivered_at ثم created_at.">إلى:</label>
                    <input
                        type="date"
                        id="endDate"
                        value={endDate}
                        onChange={e => {
                            setRangePreset('all');
                            setEndDate(e.target.value);
                        }}
                        className="p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600"
                    />
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400 md:ml-auto">
                    تاريخ التقرير: invoice_date → paid_at → delivered_at → created_at
                </div>
                <div className="flex items-center gap-2">
                    <label htmlFor="zone">منطقة:</label>
                    <select
                        id="zone"
                        value={selectedZoneId}
                        onChange={e => setSelectedZoneId(e.target.value)}
                        className="p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600"
                    >
                        <option value="">الكل</option>
                        {deliveryZones.map(z => (
                            <option key={z.id} value={z.id}>{z.name.ar || z.name.en || z.id}</option>
                        ))}
                    </select>
                </div>
                <div className="flex gap-2 flex-wrap justify-center">
                    <button type="button" onClick={() => applyPreset('today')} className={`px-3 py-2 rounded-lg text-sm font-semibold border ${rangePreset === 'today' ? 'bg-orange-500 text-white border-orange-500' : 'bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 border-gray-300 dark:border-gray-600'}`}>اليوم</button>
                    <button type="button" onClick={() => applyPreset('week')} className={`px-3 py-2 rounded-lg text-sm font-semibold border ${rangePreset === 'week' ? 'bg-orange-500 text-white border-orange-500' : 'bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 border-gray-300 dark:border-gray-600'}`}>هذا الأسبوع</button>
                    <button type="button" onClick={() => applyPreset('month')} className={`px-3 py-2 rounded-lg text-sm font-semibold border ${rangePreset === 'month' ? 'bg-orange-500 text-white border-orange-500' : 'bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 border-gray-300 dark:border-gray-600'}`}>هذا الشهر</button>
                    <button type="button" onClick={() => applyPreset('year')} className={`px-3 py-2 rounded-lg text-sm font-semibold border ${rangePreset === 'year' ? 'bg-orange-500 text-white border-orange-500' : 'bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 border-gray-300 dark:border-gray-600'}`}>هذه السنة</button>
                    <button type="button" onClick={() => applyPreset('all')} className={`px-3 py-2 rounded-lg text-sm font-semibold border ${rangePreset === 'all' ? 'bg-orange-500 text-white border-orange-500' : 'bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 border-gray-300 dark:border-gray-600'}`}>الكل</button>
                </div>
            </div>

            {loading && <div className="text-center py-4">جاري تحميل البيانات...</div>}

            {!loading && (
                <>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                        <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow-md flex items-center justify-between">
                            <div>
                                <h3 className="text-gray-500 dark:text-gray-400">إجمالي قيمة المخزون (بالتكلفة)</h3>
                                <p className="text-3xl font-bold text-blue-600">{totalInventoryValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {currency}</p>
                            </div>
                        </div>
                        <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow-md flex items-center justify-between">
                            <div>
                                <h3 className="text-gray-500 dark:text-gray-400">ملخص الفترة</h3>
                                <p className="text-sm dark:text-gray-300">
                                    كمية مباعة: <span className="font-bold">{totals.qty.toLocaleString('en-US')}</span> •
                                    صافي المبيعات: <span className="font-bold text-orange-600">{totals.sales.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {currency}</span> •
                                    صافي التكلفة: <span className="font-bold text-red-600">{totals.cost.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {currency}</span> •
                                    صافي الربح: <span className={`font-bold ${totals.profit >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>{totals.profit.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {currency}</span> •
                                    معدل الدوران: <span className="font-bold">{totals.turnover.toFixed(2)}×</span>
                                </p>
                            </div>
                        </div>
                    </div>

                    <div id="print-area">
                        <div className="print-only mb-4">
                            <div className="flex items-center gap-3 mb-2">
                                {settings.logoUrl ? <img src={settings.logoUrl} alt="" className="h-10 w-auto" /> : null}
                                <div className="leading-tight">
                                    <div className="font-bold text-black">{settings.cafeteriaName?.ar || settings.cafeteriaName?.en || ''}</div>
                                    <div className="text-xs text-black">{[settings.address || '', settings.contactNumber || ''].filter(Boolean).join(' • ')}</div>
                                </div>
                            </div>
                            <h2 className="text-2xl font-bold text-black">تقرير المنتجات</h2>
                            <p className="text-base text-black mt-1">التاريخ: {new Date().toLocaleDateString('en-US')}</p>
                            <p className="text-base text-black mt-1">إجمالي قيمة المخزون: {totalInventoryValue.toLocaleString('en-US', { minimumFractionDigits: 2 })} {currency}</p>
                            <p className="text-xs text-black mt-1">تم الإنشاء: {new Date().toLocaleString('en-US')}</p>
                        </div>

                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
                            <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow-md">
                                <HorizontalBarChart data={topSalesChart} title="أفضل الأصناف حسب صافي المبيعات" unit={currency} />
                            </div>
                            <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow-md">
                                <HorizontalBarChart
                                    data={lowStock}
                                    title="تنبيه مخزون منخفض (المتاح)"
                                    unit="وحدة"
                                />
                            </div>
                        </div>

                    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl overflow-hidden">
                        <div className="p-4 border-b border-gray-200 dark:border-gray-700">
                            <div className="flex flex-col md:flex-row gap-3 md:items-center md:justify-between">
                                <div className="text-sm text-gray-600 dark:text-gray-300">
                                    عدد الأصناف: <span className="font-bold">{visibleProducts.length.toLocaleString('en-US')}</span>
                                </div>
                                <div className="flex flex-col md:flex-row gap-3 md:items-center">
                                    <input
                                        value={productSearch}
                                        onChange={(e) => setProductSearch(e.target.value)}
                                        placeholder="بحث: الاسم، رقم الصنف، الوحدة"
                                        className="w-full md:w-[420px] p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600"
                                    />
                                    <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
                                        <input
                                            type="checkbox"
                                            checked={showAllProducts}
                                            onChange={(e) => setShowAllProducts(e.target.checked)}
                                            className="h-4 w-4"
                                        />
                                        عرض كل النتائج
                                    </label>
                                </div>
                            </div>
                        </div>
                        <div className="overflow-x-auto">
                            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                                    <thead className="bg-gray-50 dark:bg-gray-700">
                                        <tr>
                                            <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase border-r dark:border-gray-700">اسم المنتج</th>
                                            <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase border-r dark:border-gray-700">الكمية المباعة</th>
                                            <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase border-r dark:border-gray-700">الوحدة</th>
                                            <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase border-r dark:border-gray-700">صافي المبيعات</th>
                                            <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase border-r dark:border-gray-700">صافي التكلفة</th>
                                            <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase border-r dark:border-gray-700">صافي الربح</th>
                                            <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase border-r dark:border-gray-700">هامش الربح %</th>
                                            <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase border-r dark:border-gray-700">معدل الدوران</th>
                                            <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase border-r dark:border-gray-700">أيام حتى النفاد</th>
                                            <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase border-r dark:border-gray-700">المتاح</th>
                                            <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase border-r dark:border-gray-700">المحجوز</th>
                                            <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">قيمة المخزون</th>
                                        </tr>
                                    </thead>
                                    <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                                        {(showAllProducts ? visibleProducts : visibleProducts.slice(0, 200)).map(product => (
                                            <tr key={product.item_id}>
                                                <td className="px-6 py-4 whitespace-nowrap font-medium border-r dark:border-gray-700">{product.name}</td>
                                                <td className="px-6 py-4 whitespace-nowrap text-lg font-bold border-r dark:border-gray-700">{product.quantity_sold.toFixed(3).replace(/\.?0+$/, '')}</td>
                                                <td className="px-6 py-4 whitespace-nowrap border-r dark:border-gray-700">{product.unit_type}</td>
                                                <td className="px-6 py-4 whitespace-nowrap font-semibold text-orange-500 border-r dark:border-gray-700">{Number(product.total_sales || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {currency}</td>
                                                <td className="px-6 py-4 whitespace-nowrap text-red-600 dark:text-red-400 border-r dark:border-gray-700">{Number(product.total_cost || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {currency}</td>
                                                <td className={`px-6 py-4 whitespace-nowrap font-bold border-r dark:border-gray-700 ${product.total_profit >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                                                    {Number(product.total_profit || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {currency}
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap border-r dark:border-gray-700">
                                                    <span className={`font-bold text-sm px-2 py-1 rounded ${product.profitMargin >= 50 ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' :
                                                        product.profitMargin >= 30 ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200' :
                                                            'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
                                                        }`}>
                                                        {product.profitMargin.toFixed(1)}%
                                                    </span>
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap border-r dark:border-gray-700">
                                                    <span className={`font-semibold ${product.turnoverRate >= 2 ? 'text-green-600 dark:text-green-400' :
                                                            product.turnoverRate >= 1 ? 'text-yellow-600 dark:text-yellow-400' :
                                                                'text-gray-600 dark:text-gray-400'
                                                        }`}>
                                                        {product.turnoverRate.toFixed(2)}×
                                                    </span>
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap border-r dark:border-gray-700">
                                                    {product.daysUntilStockout !== null ? (
                                                        <span className={`font-semibold ${product.daysUntilStockout <= 7 ? 'text-red-600 dark:text-red-400' :
                                                                product.daysUntilStockout <= 14 ? 'text-yellow-600 dark:text-yellow-400' :
                                                                    'text-green-600 dark:text-green-400'
                                                            }`}>
                                                            {Math.ceil(product.daysUntilStockout).toLocaleString('en-US')} يوم
                                                        </span>
                                                    ) : (
                                                        <span className="text-gray-400">-</span>
                                                    )}
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap border-r dark:border-gray-700">
                                                    {Number(product.current_stock || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })}
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap border-r dark:border-gray-700">
                                                    {Number(product.reserved_stock || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })}
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap font-mono text-gray-600 dark:text-gray-400">
                                                    {Number((Number(product.current_stock || 0) + Number(product.reserved_stock || 0)) * Number(product.current_cost_price || 0)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
};

export default ProductReports;
