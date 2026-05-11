do $$
begin
  raise notice 'Purging UAT test items...';
  -- Bypass all referential integrity and custom immutable triggers for this purge
  set session_replication_role = 'replica';

  declare
    v_item_ids uuid[] := array[
      '442d9d2b-11f6-432d-8a8c-4f972fee4570'::uuid,
      '47945ac9-dedd-4304-ac95-ef8a63c77bc3'::uuid,
      'eb6b0e24-a231-4351-91c4-120a3a3f40a2'::uuid,
      '4d5609b7-507e-46b6-8b13-51f1a719eeb3'::uuid,
      'fe531c48-94dd-4cef-9cdd-69106e1c3a50'::uuid,
      'e416eb37-094c-4316-9c25-9bc89967658b'::uuid,
      '0cbf0abb-3db4-4997-a5bd-7dc12ff7ab8d'::uuid,
      'd9cb8beb-198f-47c6-8503-f938f2bb2337'::uuid,
      '6c86b80a-b926-4483-bf3c-b7f4a9d268be'::uuid,
      '27b85d65-9e6a-4bdc-a5cf-b42f1b98a014'::uuid,
      '28c9435d-79c4-41a4-98c8-58bda9578186'::uuid,
      'a03fc673-af9b-4f1b-bea3-e287f86cf625'::uuid,
      '274f0023-b1e2-44ce-b2cb-4dbf8558c7d2'::uuid,
      '00f6a226-7b43-4fc2-907a-e16e5bb77ca5'::uuid,
      '4d16009f-db5e-42bc-9129-90bce7263b99'::uuid,
      '3d1e8397-6b7e-415f-9355-e985de6b6603'::uuid,
      '1de280ea-5a15-4f29-afde-96cd70243a90'::uuid,
      '83756c29-bde7-4fc9-b0e2-e38a0d87cbf1'::uuid,
      '7423427a-0731-43fd-a932-7ae46baf6fa5'::uuid,
      'e0895087-6792-47b1-8e58-f195b12550c1'::uuid,
      '66c1e11d-a4cb-452b-854e-97e9310cd259'::uuid
    ];
  begin
    delete from public.item_uom where item_id = any(v_item_ids::text[]);
    delete from public.item_uom_units where item_id = any(v_item_ids::text[]);
    delete from public.batches where item_id = any(v_item_ids::text[]);
    delete from public.stock_management where item_id = any(v_item_ids::text[]);
    delete from public.menu_items where id = any(v_item_ids::text[]);
  end;

  set session_replication_role = 'origin';
  raise notice '✅ UAT items purge complete';
end $$;
