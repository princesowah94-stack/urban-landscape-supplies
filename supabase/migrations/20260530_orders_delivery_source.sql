-- Extend orders table with:
--   delivery_scheduled_at   — date admin assigns for the delivery run
--   delivery_notes_internal — private internal notes not shown to customer
--   source                  — where the order originated ('online' | 'phone' | 'manual')
--   payment_method          — how the customer paid ('square' | 'bank_transfer' | 'cash' | 'card_phone')
--
-- These enable the Deliveries calendar page and Manual Order Entry in the CRM.

alter table public.orders
  add column if not exists delivery_scheduled_at  date,
  add column if not exists delivery_notes_internal text,
  add column if not exists source                 text not null default 'online',
  add column if not exists payment_method         text;

-- Backfill existing rows
update public.orders
  set source = 'online',
      payment_method = 'square'
  where source = 'online' and payment_method is null;

create index if not exists orders_delivery_scheduled_idx
  on public.orders (delivery_scheduled_at)
  where delivery_scheduled_at is not null;

create index if not exists orders_source_idx
  on public.orders (source);
