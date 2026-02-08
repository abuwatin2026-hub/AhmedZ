do $$
begin
  if to_regclass('public.purchase_receipts') is null then
    return;
  end if;

  begin
    alter table public.purchase_receipts
      add column posting_status text not null default 'pending';
  exception when duplicate_column then
    null;
  end;

  begin
    alter table public.purchase_receipts
      add column posting_error text;
  exception when duplicate_column then
    null;
  end;

  begin
    alter table public.purchase_receipts
      add column posted_at timestamptz;
  exception when duplicate_column then
    null;
  end;

  begin
    alter table public.purchase_receipts
      add column updated_at timestamptz not null default now();
  exception when duplicate_column then
    null;
  end;

  begin
    alter table public.purchase_receipts
      add constraint purchase_receipts_posting_status_check
      check (posting_status in ('pending','posted','failed'));
  exception when duplicate_object then
    null;
  end;
end $$;

create or replace function public._trg_set_updated_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

do $$
begin
  if to_regclass('public.purchase_receipts') is not null then
    drop trigger if exists trg_purchase_receipts_updated_at on public.purchase_receipts;
    create trigger trg_purchase_receipts_updated_at
    before update on public.purchase_receipts
    for each row
    execute function public._trg_set_updated_at();
  end if;
end $$;

create or replace function public.post_purchase_receipt(p_receipt_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_receipt record;
  v_mv record;
  v_errors text := '';
  v_failed boolean := false;
  v_count int := 0;
begin
  perform public._require_staff('accounting.post');
  if p_receipt_id is null then
    raise exception 'p_receipt_id is required';
  end if;

  select *
  into v_receipt
  from public.purchase_receipts pr
  where pr.id = p_receipt_id
  for update;
  if not found then
    raise exception 'purchase receipt not found';
  end if;

  for v_mv in
    select im.id
    from public.inventory_movements im
    where im.reference_table = 'purchase_receipts'
      and im.reference_id = p_receipt_id::text
    order by im.occurred_at asc, im.created_at asc
  loop
    begin
      perform public.post_inventory_movement(v_mv.id);
      v_count := v_count + 1;
    exception when others then
      v_failed := true;
      v_errors := left(
        trim(both from (v_errors || case when v_errors = '' then '' else E'\n' end || sqlerrm)),
        2000
      );
    end;
  end loop;

  if v_failed then
    update public.purchase_receipts
    set posting_status = 'failed',
        posting_error = nullif(v_errors, ''),
        posted_at = null
    where id = p_receipt_id;
    return jsonb_build_object(
      'status', 'failed',
      'postedCount', v_count,
      'error', nullif(v_errors, '')
    );
  end if;

  update public.purchase_receipts
  set posting_status = 'posted',
      posting_error = null,
      posted_at = now()
  where id = p_receipt_id;

  return jsonb_build_object(
    'status', 'posted',
    'postedCount', v_count
  );
end;
$$;

revoke all on function public.post_purchase_receipt(uuid) from public;
grant execute on function public.post_purchase_receipt(uuid) to authenticated;

select pg_sleep(0.5);
notify pgrst, 'reload schema';
