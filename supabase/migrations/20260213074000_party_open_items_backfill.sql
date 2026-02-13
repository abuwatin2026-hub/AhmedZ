set app.allow_ledger_ddl = '1';

create or replace function public.backfill_party_open_items_for_party(
  p_party_id uuid,
  p_batch int default 5000
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ledger int := 0;
  v_open int := 0;
begin
  if not public.has_admin_permission('accounting.manage') then
    raise exception 'not allowed';
  end if;

  if p_party_id is null then
    raise exception 'party_id is required';
  end if;

  begin
    v_ledger := coalesce(public.backfill_party_ledger_for_existing_entries(coalesce(p_batch, 5000), p_party_id), 0);
  exception when others then
    v_ledger := 0;
  end;

  with candidates as (
    select
      ple.party_id,
      ple.journal_entry_id,
      ple.journal_line_id,
      ple.account_id,
      ple.direction,
      ple.occurred_at,
      je.source_table,
      je.source_id,
      je.source_event,
      psa.role as item_role,
      public._party_open_item_type(je.source_table, je.source_event) as item_type,
      upper(coalesce(ple.currency_code, public.get_base_currency())) as currency_code,
      ple.foreign_amount,
      ple.base_amount,
      case
        when coalesce(je.source_table,'') = 'party_documents' then nullif(je.source_id,'')::uuid
        else null
      end as party_document_id
    from public.party_ledger_entries ple
    join public.journal_entries je on je.id = ple.journal_entry_id
    join public.party_subledger_accounts psa on psa.account_id = ple.account_id and psa.is_active = true
    left join public.party_open_items poi on poi.journal_line_id = ple.journal_line_id
    where ple.party_id = p_party_id
      and poi.id is null
      and coalesce(je.source_table,'') <> 'settlements'
      and coalesce(je.source_event,'') <> 'realized_fx'
    order by ple.occurred_at asc, ple.journal_entry_id asc, ple.journal_line_id asc
    limit greatest(1, coalesce(p_batch, 5000))
  )
  insert into public.party_open_items(
    party_id,
    journal_entry_id,
    journal_line_id,
    account_id,
    direction,
    occurred_at,
    due_date,
    item_role,
    item_type,
    source_table,
    source_id,
    source_event,
    party_document_id,
    currency_code,
    foreign_amount,
    base_amount,
    open_foreign_amount,
    open_base_amount,
    status
  )
  select
    c.party_id,
    c.journal_entry_id,
    c.journal_line_id,
    c.account_id,
    c.direction,
    c.occurred_at,
    c.occurred_at::date,
    c.item_role,
    c.item_type,
    c.source_table,
    c.source_id,
    c.source_event,
    c.party_document_id,
    c.currency_code,
    c.foreign_amount,
    c.base_amount,
    c.foreign_amount,
    c.base_amount,
    'open'
  from candidates c
  on conflict (journal_line_id) do nothing;

  get diagnostics v_open = row_count;

  return jsonb_build_object(
    'ledgerBackfilled', coalesce(v_ledger, 0),
    'openItemsCreated', coalesce(v_open, 0)
  );
end;
$$;

revoke all on function public.backfill_party_open_items_for_party(uuid, int) from public;
grant execute on function public.backfill_party_open_items_for_party(uuid, int) to authenticated;

notify pgrst, 'reload schema';
