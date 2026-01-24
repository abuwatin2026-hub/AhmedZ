create or replace function public.trg_promotions_enforce_active_window_and_approval()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op in ('INSERT','UPDATE') then
    if new.is_active then
      if new.approval_status <> 'approved' then
        raise exception 'promotion_requires_approval';
      end if;
      if now() > new.end_at then
        raise exception 'promotion_already_ended';
      end if;
    end if;
  end if;
  return new;
end;
$$;

