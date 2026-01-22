begin;

delete from public.sales_returns;
delete from public.payments;
delete from public.expenses;
delete from public.inventory_movements;
delete from public.stock_history;
delete from public.orders;
delete from public.stock_management;
delete from public.menu_items;
delete from public.ads;
delete from public.item_categories;

commit;