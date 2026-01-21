-- Create Invoice Sequence
create sequence if not exists public.invoice_seq start 1000;
-- Function to generate next invoice number
create or replace function public.generate_invoice_number()
returns text
language plpgsql
as $$
begin
  -- Format: INV-001000 (padding with zeros)
  return 'INV-' || lpad(nextval('public.invoice_seq')::text, 6, '0');
end;
$$;
-- Trigger to assign invoice number automatically on status change to 'delivered'
create or replace function public.assign_invoice_number()
returns trigger
language plpgsql
as $$
begin
  -- Only assign if not already assigned AND status changed to delivered (or paid)
  if (new.status = 'delivered' or new.payment_status = 'paid') and new.invoice_number is null then
    new.invoice_number := public.generate_invoice_number();
    new.invoice_issued_at := now();
    -- Snapshot is handled by frontend or separate logic usually, 
    -- but we can ensure timestamp is set here.
  end if;
  return new;
end;
$$;
drop trigger if exists trg_assign_invoice_number on public.orders;
create trigger trg_assign_invoice_number
before update on public.orders
for each row execute function public.assign_invoice_number();
