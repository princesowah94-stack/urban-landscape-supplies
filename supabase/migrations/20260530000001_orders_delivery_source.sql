-- Add delivery scheduling and order source columns to orders table.

alter table public.orders
  add column if not exists delivery_scheduled_at  date,
  add column if not exists delivery_notes_internal text,
  add column if not exists source                 text not null default 'online',
  add column if not exists payment_method         text;

update public.orders
  set payment_method = 'square'
  where payment_method is null;

create index if not exists orders_delivery_scheduled_idx
  on public.orders (delivery_scheduled_at)
  where delivery_scheduled_at is not null;

create index if not exists orders_source_idx
  on public.orders (source);
