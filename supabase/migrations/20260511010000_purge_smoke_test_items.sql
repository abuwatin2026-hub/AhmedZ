do $$
begin
  raise notice 'Purging smoke test items...';
  -- Bypass all referential integrity and custom immutable triggers for this purge
  set session_replication_role = 'replica';

  declare
    v_item_ids uuid[] := array[
      'baa36164-0b1d-4991-8ac6-c7870ab0db1e'::uuid,
      '4992e25a-d858-46ee-a7da-101c3e9b0c83'::uuid,
      'c3de5ec5-178e-4e50-9538-50e5a819f2cc'::uuid,
      'd52e0ca0-c309-4a4c-853a-0015b3018e30'::uuid,
      '579d786a-48df-46e2-a911-003300c91000'::uuid,
      '9ebd72e5-54c2-4a0d-a6de-89e02eefdfd6'::uuid,
      'de759985-cd23-4217-9f04-12aaac226414'::uuid,
      '0b0ac6de-8728-4ee3-bac6-401468d28b56'::uuid,
      '4489d164-f733-4b92-8e81-bfa0f876e347'::uuid,
      '3c314e25-fdd7-4b1f-aa30-c33e0e822d62'::uuid,
      'b164abbe-fe51-40ef-a3cf-4c59ef2e33ed'::uuid,
      'aa945140-15b1-47ea-87fc-9d7bf88cf6b0'::uuid,
      'bb0b2020-1989-47d4-a14e-2f0a419d2167'::uuid,
      'e8d78af7-86b4-4e9a-be6b-0a28073b55f2'::uuid,
      '8a453702-d2eb-4854-a81f-c346d99e4e4f'::uuid,
      '5e93704f-2fb5-4488-a9d6-3c1caefa0f45'::uuid,
      '94ec4f68-398b-4600-bd57-67f06eb7d7bc'::uuid,
      '105a8c81-3e65-4e09-95d8-ee888a33737d'::uuid,
      'ff436679-aac9-41ae-92c5-db7ecf8547fd'::uuid,
      '6c7e75c3-a86a-4e1c-8c4d-7e549fead676'::uuid,
      'b804172d-68a2-435d-87ac-b1b85d70f0e8'::uuid,
      '1cf3cb91-2056-4160-b5d3-8002df6392a1'::uuid
    ];
  begin
    delete from public.item_uom where item_id = any(v_item_ids::text[]);
    delete from public.item_uom_units where item_id = any(v_item_ids::text[]);
    delete from public.batches where item_id = any(v_item_ids::text[]);
    delete from public.stock_management where item_id = any(v_item_ids::text[]);
    delete from public.menu_items where id = any(v_item_ids::text[]);
  end;

  set session_replication_role = 'origin';
  raise notice '✅ Smoke items purge complete';
end $$;
