-- Create Notifications Table
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  message text not null,
  type text check (type in ('info', 'success', 'warning', 'error', 'order_update', 'promo')) default 'info',
  link text, -- Optional link to navigate to (e.g. /order/123)
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);
-- RLS Policies
alter table public.notifications enable row level security;
drop policy if exists notifications_select_own on public.notifications;
create policy notifications_select_own on public.notifications
  for select using (auth.uid() = user_id);
drop policy if exists notifications_update_own on public.notifications;
create policy notifications_update_own on public.notifications
  for update using (auth.uid() = user_id);
-- Index for performance
create index if not exists idx_notifications_user_unread on public.notifications(user_id) where is_read = false;
-- Trigger to create notification on Order Status Change
create or replace function public.notify_order_status_change()
returns trigger
language plpgsql
security definer
as $$
declare
  v_title text;
  v_message text;
  v_link text;
begin
  if old.status is distinct from new.status then
    v_link := '/order/' || new.id;
    
    case new.status
      when 'preparing' then
        v_title := 'طلبك قيد التحضير 🍳';
        v_message := 'بدأنا في تجهيز طلبك رقم #' || substring(new.id::text, 1, 6);
      when 'out_for_delivery' then
        v_title := 'طلبك في الطريق 🛵';
        v_message := 'خرج المندوب لتوصيل طلبك رقم #' || substring(new.id::text, 1, 6);
      when 'delivered' then
        v_title := 'تم التوصيل 🎉';
        v_message := 'نتمنى لك تجربة ممتعة! تم توصيل الطلب #' || substring(new.id::text, 1, 6);
      when 'cancelled' then
        v_title := 'تم إلغاء الطلب ❌';
        v_message := 'عذراً، تم إلغاء طلبك رقم #' || substring(new.id::text, 1, 6);
      when 'scheduled' then
        v_title := 'تم جدولة الطلب 📅';
        v_message := 'تم تأكيد جدولة طلبك رقم #' || substring(new.id::text, 1, 6);
      else
        return new;
    end case;

    -- Insert notification for the customer (if user_id exists)
    if new.user_id is not null then
      insert into public.notifications (user_id, title, message, type, link)
      values (new.user_id, v_title, v_message, 'order_update', v_link);
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_notify_order_status on public.orders;
create trigger trg_notify_order_status
after update on public.orders
for each row execute function public.notify_order_status_change();
