-- Track refunds issued from the retail admin (Refund button → Square Refunds API).
-- Status flips to 'refunded' (new terminal state, peer of 'cancelled' / 'delivered').

alter table public.orders
  add column if not exists refunded_at      timestamptz,
  add column if not exists square_refund_id text;

-- Partial index on refunded rows so the admin's "Refunded" filter / counts stay snappy
create index if not exists orders_status_refunded_idx
  on public.orders (refunded_at desc)
  where status = 'refunded';
