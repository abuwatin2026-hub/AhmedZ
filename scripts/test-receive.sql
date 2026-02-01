begin;
select set_config('request.jwt.claim.sub','da34a585-b883-438e-9bd5-8ca493091e63', false);
select set_config('request.jwt.claim.role','authenticated', false);
select public.receive_purchase_order_partial(
  'ef1ea356-8dd6-4a5c-badb-da72af613c3d',
  '[{"itemId":"86221e5d-1f1f-4692-ae08-dc1f1ae1ee89","quantity":100,"expiryDate":"2026-05-01","harvestDate":"2026-01-01"}]'::jsonb,
  now()
);
commit;
