-- Migration: Purge test data from 2026-05-10T00:00:00Z onwards

set app.allow_ledger_ddl = '1';

do $$
declare
  v_order_ids uuid[] := array[
    'ff346159-47ca-48c4-8abd-4b404f49c481'::uuid,
    '471cdb6b-e9bb-406e-b085-e0d417d0f3e4'::uuid,
    '16f0fef5-a9c9-4bd4-bd85-e6d4e5091ded'::uuid,
    '7986e8f2-eee3-49a7-bb6c-7fd0774ba7c8'::uuid,
    'b70a8c31-e08a-45ea-a52f-ec33e5037809'::uuid,
    '280b0136-f159-4d43-a4a8-770518494cfe'::uuid,
    '67c0b824-7d73-4a26-8001-960c2fcc679b'::uuid,
    '3d61f63d-43f0-4d52-805e-6f0292b83644'::uuid,
    'ae013476-b297-4618-8eb7-4025bef93d8b'::uuid,
    'ce3eb2e2-33fd-48c7-9370-fcd1c41d879d'::uuid,
    '1879f69c-652b-4c07-8ffb-5706421c3355'::uuid,
    'b6fdb314-81c5-40e9-8e96-e66c082d5126'::uuid,
    '37c0b76e-1fa3-4f86-a0af-812ac5825dcc'::uuid,
    '727d4d89-da3a-4cd5-9620-934fd23668b5'::uuid,
    'f75c30fd-1286-4d02-b250-a44444df5d75'::uuid,
    '69c7d599-18ee-4587-8218-d07d4f1a3bb9'::uuid,
    'b4f3a919-ecd3-4fc4-9a6a-53e75f6d942e'::uuid,
    'db2ca099-4ab3-4f45-8a52-8e472312590f'::uuid,
    '89d32c64-8c53-4220-abac-cfd2626987f6'::uuid,
    'ed9860a0-bd32-4fbe-9e48-40cbaf6c38f5'::uuid,
    '79b42920-51ff-4abf-ba21-84b9b35f2e39'::uuid,
    '5978278a-1c4e-44f9-8467-315526ca425c'::uuid,
    'dfaa7c3f-9d77-4cc3-9a65-263069c1a9c5'::uuid,
    '26aa7bc5-f97b-4d7b-9fc9-6e19b2696bcd'::uuid,
    '4e8a8d01-8444-49d4-822c-2840b1f7cc90'::uuid,
    '36d403c5-82a8-46eb-a906-484c609caf2c'::uuid
  ];
  v_item_ids uuid[] := array[
    '2ebd05a3-9248-4d30-bae2-6ca8de5d82c7'::uuid,
    '2d7f5561-b3a3-4a50-9d2a-d1c951598441'::uuid,
    '4fb74fc0-89fc-4fbb-a80a-bf481d5d1152'::uuid,
    'bb6ae175-50ae-4f63-9890-26fdee00a80f'::uuid,
    'fc6a1627-430b-4835-a9c7-80052f6f9f71'::uuid,
    'bd09c7de-60f9-497a-8fc9-670c950f12fb'::uuid,
    '959c1481-7812-4d49-93ff-614d81811ba3'::uuid,
    'dc935d1f-dbb5-4dd7-bfdd-d1a9c30c3a96'::uuid,
    '86958c91-c6c3-4fb7-8be4-6aaa6c2f9628'::uuid,
    '5f88aa83-f439-4af6-99ae-722c621f5a89'::uuid,
    '75192bad-0497-4787-b664-c200fb4bfbed'::uuid,
    'c2975189-76fe-4c21-8ab6-aee73d01824f'::uuid,
    '79c5e890-deb6-4e9c-9b16-7eba534e9941'::uuid,
    '2be99026-58a8-40bb-9acd-550713bba4c6'::uuid,
    '94582498-8eac-495a-9962-282862aa45aa'::uuid,
    '66a75c47-7a38-43e9-a657-ee6aeafaebf2'::uuid,
    '96aeccb7-3497-4655-ac98-24e50179bb01'::uuid,
    'de35f5e7-e798-4e5d-a44b-fb42cec52b63'::uuid,
    'dfe64c81-cff0-457c-9d90-6764077a4d4d'::uuid,
    '3946a84b-2d5e-4268-aaa3-05799297539d'::uuid,
    '8b3e4ba4-3a58-49b1-815d-8244cadfd46b'::uuid,
    '63081e3f-0650-46f1-883f-9d8baec1adab'::uuid,
    '813c0df7-5ac0-4c29-b371-efdb96f8db10'::uuid,
    'f0ab2e9d-0abb-4b06-899a-e24b6de81aa8'::uuid,
    '531fa22e-d33e-473f-9774-7aa8b190b1ea'::uuid,
    '620120e8-013e-4eae-9130-13f269853f86'::uuid,
    '04a8442f-73b1-470a-9e7e-50d398942e94'::uuid,
    'b6c8aadb-b43d-414c-954b-ee83606928e6'::uuid,
    '311af500-e61f-46e6-b03e-acdf27527131'::uuid,
    '4408deea-ae28-48b6-bcdf-de8dbbe7d1db'::uuid,
    '565374f5-9bda-4fbd-a7f2-48e7e7e69fdd'::uuid,
    '1ff46db9-226f-4bff-972b-3358c20d4eb7'::uuid,
    '13f07209-1b77-4c15-a4d3-c2de29e85ea0'::uuid,
    'f707831d-fe3c-428f-9ea0-72a9cad33ca2'::uuid,
    '79c8b5ee-029d-430c-ae8e-f3cb9b227cf3'::uuid,
    'c75eee7c-d20c-466f-85d3-112cc87b7803'::uuid,
    '39a3c30d-6212-4ca2-8111-22ee9c1eff5c'::uuid,
    'a3331d34-302a-4787-85e0-e626420a2416'::uuid,
    '6dabd52b-0666-4218-96e2-80f8efc8e6d4'::uuid,
    'b472883c-bd5a-4770-aeae-2342670d5323'::uuid,
    '0e25fe0a-d206-4e09-810b-3c62f083dc09'::uuid,
    'e1c88ecc-70c2-4ae6-8af1-2631e77cc19d'::uuid,
    'e28fc3ae-667e-4cff-85c1-fa801ab55e80'::uuid,
    'f32f6768-20ab-460b-87a4-0a1295bb7aa2'::uuid,
    'a8a66fd2-d88d-483e-85ca-2662f30a74e5'::uuid
  ];
  v_batch_ids uuid[] := array[
    'feca4044-6048-4655-ab79-18065dbb59c4'::uuid,
    'c3b6af35-c3c3-458b-b216-55ab1410189d'::uuid,
    '0b79d749-571b-4ce6-baf9-de1fd2703e56'::uuid,
    '50568ba1-aa28-4101-a979-34b049b73e2d'::uuid,
    '16a7b7bf-1c83-4bed-9ffb-ae411df05d92'::uuid,
    '186f70ba-f0a1-4cf8-8724-07547784bb47'::uuid,
    '601b746b-61c3-4b19-aef9-b28863c9bbe0'::uuid,
    '89747c7d-a779-4ac6-b960-385bbf4c0841'::uuid,
    'a7d2777c-20a3-49ba-9a42-8d7ea408683f'::uuid,
    'dc64e9b9-2174-4927-8d8d-8353a059f2a0'::uuid,
    'eb8d734b-5dbe-4666-bf0f-3df2ea4f8e48'::uuid,
    'd538e948-963f-4405-9c17-f5d65bfec3ca'::uuid,
    '65d0a90f-eb18-466d-9a65-d2dcd64e13bd'::uuid,
    '21f97a0c-8415-409a-a538-565e071a72a4'::uuid,
    'e3acb917-bc02-486e-87d0-6d6d08bd4cf7'::uuid,
    '6cb99024-8064-44a6-b2ef-66cfb383e84c'::uuid,
    'd2497ced-0955-4e06-bb17-2979db001a6c'::uuid,
    '27c249d1-4258-4dc5-9301-af0d5514ab02'::uuid,
    'bab03613-054e-4deb-a88d-c074ea02b400'::uuid,
    'b6c4437b-0bcc-4479-a24b-90b6a4b12a2e'::uuid,
    'f1661cce-6fec-4efc-8297-8ea29b98e1b4'::uuid,
    'c74b4d4c-0346-4839-97ff-6f606c46b93a'::uuid,
    'e2469893-80f3-4ff7-9833-241959adafc6'::uuid,
    'b59d6e01-cf47-4da3-80f1-cb914d869363'::uuid,
    '012dddfe-b042-4215-9bd4-2c87237dcf28'::uuid,
    '1e2ccece-5216-4e5d-938b-38d7ad85d8e6'::uuid,
    '2f32f275-7ca6-4452-84de-0c318694b308'::uuid,
    '3c55fa3e-81b1-4a5e-956b-f8345d7f44f8'::uuid,
    'dd373e30-cca6-48e6-a2d8-da4061dd374a'::uuid,
    '8fbae0ca-387e-4fec-8718-de7aac36004a'::uuid,
    '3357f220-ea84-4809-9f61-2f1a0ada30b2'::uuid,
    '7ac92d1d-f568-4bf7-94bb-dc0359de2b97'::uuid,
    '76fb0020-0061-40b8-a79c-1dc0ffa5c414'::uuid,
    'd29699f8-b6ed-44b6-8b7a-ffff152a83ae'::uuid,
    '63843fc1-0ac1-468d-b7e0-c149fde0918f'::uuid,
    '01e0cda9-3747-4cef-a018-2d2d87807331'::uuid,
    '0fc21d49-68af-4f7b-9938-b1558ff476d0'::uuid,
    'd7aa2d35-6b93-4add-84be-40f056734f60'::uuid,
    '4a542cba-3d00-4d28-855f-7fcb8d6de74d'::uuid,
    '73c95ebf-75e1-4d98-a011-399c45712adc'::uuid,
    'd3a215d5-c743-45a3-a244-d6d3043a9cee'::uuid,
    '46606b93-526c-4b3a-9890-a105c41530a3'::uuid,
    'e8a876c9-afae-43fc-8ee6-61f8e0f4e605'::uuid
  ];
  v_customer_ids uuid[] := array[
    'bad066fd-8794-41ce-9d14-ac82b8f644e7'::uuid
  ];
  v_payment_ids uuid[];
  v_mov_ids uuid[];
  v_je_ids uuid[];
  v_batch record;
begin
  raise notice 'Starting purge...';
  -- Bypass all referential integrity and custom immutable triggers for this purge
  set session_replication_role = 'replica';

  -- Restore batch quantities for delivered orders (if the batch itself is NOT being deleted)
  for v_batch in
    select im.batch_id, sum(im.quantity) as qty
    from public.inventory_movements im
    where im.reference_id = any(v_order_ids::text[])
      and im.movement_type = 'sale_out'
      and im.batch_id is not null
      and not (im.batch_id = any(v_batch_ids))
    group by im.batch_id
  loop
    update public.batches
    set quantity_consumed = greatest(0, coalesce(quantity_consumed, 0) - coalesce(v_batch.qty, 0))
    where id = v_batch.batch_id;
    raise notice 'Restored % units to batch %', v_batch.qty, v_batch.batch_id;
  end loop;

  -- Collect payment IDs
  select array_agg(id) into v_payment_ids
  from public.payments where reference_id = any(v_order_ids::text[]);

  -- Collect inventory movement IDs
  select array_agg(id) into v_mov_ids
  from public.inventory_movements where reference_id = any(v_order_ids::text[]);

  -- Collect journal entry IDs
  select array_agg(id) into v_je_ids
  from public.journal_entries
  where source_id = any(
    array(
      select id::text from public.orders where id = any(v_order_ids)
      union all
      select id::text from public.payments where id = any(v_payment_ids)
      union all
      select id::text from public.inventory_movements where id = any(v_mov_ids)
    )
  );

  -- 0. ar_allocations
  delete from public.ar_allocations 
  where open_item_id in (select id from public.ar_open_items where invoice_id = any(v_order_ids));
  if v_payment_ids is not null and array_length(v_payment_ids,1) > 0 then
    delete from public.ar_allocations where payment_id = any(v_payment_ids);
  end if;

  -- 1. ar_open_items
  delete from public.ar_open_items where invoice_id = any(v_order_ids);
  -- 2. ar_payment_status
  if v_payment_ids is not null and array_length(v_payment_ids,1) > 0 then
    delete from public.ar_payment_status where payment_id = any(v_payment_ids);
  end if;
  -- 3. batch_sales_trace
  delete from public.batch_sales_trace where order_id = any(v_order_ids);
  
  -- 3.4. settlement_lines
  if v_je_ids is not null and array_length(v_je_ids,1) > 0 then
    delete from public.settlement_lines 
    where from_open_item_id in (select id from public.party_open_items where journal_line_id in (select id from public.journal_lines where journal_entry_id = any(v_je_ids)))
       or to_open_item_id in (select id from public.party_open_items where journal_line_id in (select id from public.journal_lines where journal_entry_id = any(v_je_ids)));
  end if;

  -- 3.5. party_ledger_entries, party_open_items
  if v_je_ids is not null and array_length(v_je_ids,1) > 0 then
    delete from public.party_open_items where journal_line_id in (select id from public.journal_lines where journal_entry_id = any(v_je_ids));
    delete from public.party_ledger_entries where journal_line_id in (select id from public.journal_lines where journal_entry_id = any(v_je_ids));
  end if;

  -- 4. journal_lines & journal_entries
  if v_je_ids is not null and array_length(v_je_ids,1) > 0 then
    delete from public.journal_lines where journal_entry_id = any(v_je_ids);
    delete from public.journal_entries where id = any(v_je_ids);
  end if;
  -- 5. inventory_movements
  if v_mov_ids is not null and array_length(v_mov_ids,1) > 0 then
    delete from public.inventory_movements where id = any(v_mov_ids);
  end if;
  -- 6. order_item_cogs
  delete from public.order_item_cogs where order_id = any(v_order_ids);
  -- 7. payments
  if v_payment_ids is not null and array_length(v_payment_ids,1) > 0 then
    delete from public.payments where id = any(v_payment_ids);
  end if;
  -- 8. order_item_reservations
  delete from public.order_item_reservations where order_id = any(v_order_ids);
  -- 9. party_credit_overrides
  delete from public.party_credit_overrides where order_id = any(v_order_ids);
  -- 10. orders
  delete from public.orders where id = any(v_order_ids);

  -- 11. item_uom, item_uom_units
  if v_item_ids is not null and array_length(v_item_ids,1) > 0 then
    delete from public.item_uom where item_id = any(v_item_ids::text[]);
    delete from public.item_uom_units where item_id = any(v_item_ids::text[]);
  end if;

  -- 12. batches
  if v_batch_ids is not null and array_length(v_batch_ids,1) > 0 then
    delete from public.batches where id = any(v_batch_ids);
  end if;

  -- 13. stock_management
  if v_item_ids is not null and array_length(v_item_ids,1) > 0 then
    delete from public.stock_management where item_id = any(v_item_ids::text[]);
  end if;

  -- 14. menu_items
  if v_item_ids is not null and array_length(v_item_ids,1) > 0 then
    delete from public.menu_items where id = any(v_item_ids::text[]);
  end if;

  -- 15. customers
  if v_customer_ids is not null and array_length(v_customer_ids,1) > 0 then
    delete from public.customers where auth_user_id = any(v_customer_ids);
  end if;

  set session_replication_role = 'origin';
  raise notice '✅ Purge complete';
end $$;
