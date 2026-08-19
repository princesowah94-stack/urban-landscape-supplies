-- Phase 2a: product management
-- 1. Soft archive (never hard-delete products referenced by order_items)
-- 2. Bag sizes move from retail api/products.js hardcode into the DB
-- 3. Public storage bucket for product images uploaded from the CRM

alter table public.products
  add column if not exists archived_at timestamptz,
  add column if not exists bag_sizes jsonb not null default '[]';

comment on column public.products.bag_sizes is
  'Optional alternative pack sizes: [{id, label, price_cents, unit}]. Empty = sold only per `unit` at `price`.';

create index if not exists products_archived_idx on public.products (archived_at) where archived_at is null;

-- Seed bag sizes (was BAG_SIZES in retail api/products.js; prices in cents)
update public.products set bag_sizes = '[{"id":"20kg","label":"20kg Bag","price_cents":1800,"unit":"per 20kg bag"},{"id":"bulk","label":"1 Tonne Bulk Bag","price_cents":80000,"unit":"per 1 tonne bulk bag"}]'::jsonb where id = 'pebbles-snow-white';
update public.products set bag_sizes = '[{"id":"20kg","label":"20kg Bag","price_cents":1800,"unit":"per 20kg bag"},{"id":"bulk","label":"1 Tonne Bulk Bag","price_cents":109750,"unit":"per 1 tonne bulk bag"}]'::jsonb where id = 'pebbles-crushed-snow-white';
update public.products set bag_sizes = '[{"id":"20kg","label":"20kg Bag","price_cents":2200,"unit":"per 20kg bag"},{"id":"bulk","label":"1 Tonne Bulk Bag","price_cents":100000,"unit":"per 1 tonne bulk bag"}]'::jsonb where id in ('pebbles-charcoal-grey','pebbles-charcoal-lava','pebbles-red-lava');

-- Storage bucket for CRM-uploaded product images (public read, service-role write)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-images', 'product-images', true, 5242880, array['image/jpeg','image/png','image/webp','image/avif'])
on conflict (id) do nothing;

drop policy if exists "Public read product images" on storage.objects;
create policy "Public read product images"
  on storage.objects for select
  using (bucket_id = 'product-images');
