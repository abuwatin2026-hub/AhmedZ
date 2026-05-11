create index if not exists idx_inventory_movements_reference
on public.inventory_movements(reference_table, reference_id, movement_type);
