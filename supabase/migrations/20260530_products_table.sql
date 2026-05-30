-- Products table — moves the product catalogue from data/products.json into
-- Supabase so the CRM can manage prices, stock, badges and descriptions without
-- editing code. The retail site reads via GET /api/products instead of the
-- static JSON file. The CRM writes via its admin API routes.

-- ──────────────────────────────────────────────────────────────────
-- Table
-- ──────────────────────────────────────────────────────────────────
create table if not exists public.products (
  id               text primary key,                  -- slug, e.g. "pebbles-snow-white"
  name             text not null,
  category         text not null,                     -- pebbles | mulch | soil | sand
  category_label   text not null,
  price            integer not null,                  -- cents AUD (avoid float rounding)
  unit             text not null default 'per 1 tonne bulk bag',
  description      text,
  features         jsonb not null default '[]'::jsonb,
  sizes            jsonb not null default '[]'::jsonb,
  image            text,                               -- primary /images/products/... path
  images           jsonb not null default '[]'::jsonb, -- carousel array
  badge            text,                               -- "Bestseller" | "New" | "Featured" | null
  featured         boolean not null default false,
  in_stock         boolean not null default true,
  sku              text,
  sort_order       integer not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

comment on table public.products is
  'Product catalogue for Urban Landscape Supplies. Managed from the CRM Products page. Read by the retail site via GET /api/products.';

create index if not exists products_category_idx    on public.products (category);
create index if not exists products_sort_order_idx  on public.products (sort_order);
create index if not exists products_in_stock_idx    on public.products (in_stock);

-- ──────────────────────────────────────────────────────────────────
-- RLS — public SELECT (anon key), write via service role only
-- ──────────────────────────────────────────────────────────────────
alter table public.products enable row level security;

create policy "Public can read products"
  on public.products for select
  using (true);

-- (No insert/update/delete policies — only the service-role key, used
-- by the Vercel functions, can write. Never expose service-role key
-- to the browser.)

-- ──────────────────────────────────────────────────────────────────
-- Seed — 13 products from data/products.json
-- ──────────────────────────────────────────────────────────────────
insert into public.products
  (id, name, category, category_label, price, unit, description, features, sizes, image, images, badge, featured, in_stock, sku, sort_order)
values
  (
    'pebbles-snow-white',
    'Regular Snow White Pebbles',
    'pebbles', 'Decorative Pebbles',
    80000, 'per 1 tonne bulk bag',
    'Classic rounded snow white pebbles — the most popular decorative pebble in Sydney gardens. Clean, bright and timeless for any garden style.',
    '["Rounded smooth finish","Brilliant white colour","Multiple size options","Pool area safe"]'::jsonb,
    '["20-30mm","30-50mm","50-80mm"]'::jsonb,
    '/images/products/pebbles-snow-white-lifestyle.jpg',
    '["/images/products/pebbles-snow-white-1.jpg","/images/products/pebbles-snow-white-2.jpg","/images/products/pebbles-snow-white-3.jpg","/images/products/pebbles-snow-white-4.jpg","/images/products/pebbles-snow-white-5.jpg","/images/products/pebbles-snow-white-6.jpg","/images/products/pebbles-snow-white-7.jpg"]'::jsonb,
    'Bestseller', true, true, 'ULS-PEB-001', 1
  ),
  (
    'pebbles-crushed-snow-white',
    'Crushed Snow White Pebbles',
    'pebbles', 'Decorative Pebbles',
    109750, 'per 1 tonne bulk bag',
    'Angular crushed white stone with a bright, clean appearance. Ideal for contemporary pathways, drainage applications and under-downpipe areas.',
    '["Angular crushed stone","Bright white finish","Drainage friendly","10–20mm size"]'::jsonb,
    '[]'::jsonb,
    '/images/products/pebbles-crushed-snow-white-lifestyle.jpg',
    '[]'::jsonb,
    null, false, true, 'ULS-PEB-002', 2
  ),
  (
    'pebbles-charcoal-grey',
    'Charcoal Grey Pebbles',
    'pebbles', 'Decorative Pebbles',
    100000, 'per 1 tonne bulk bag',
    'Smooth charcoal grey pebbles with subtle earthy variation. A versatile, contemporary choice for garden beds, pathways and water features.',
    '["Smooth finish","10–25mm size","Weather resistant","Versatile application"]'::jsonb,
    '[]'::jsonb,
    '/images/products/pebbles-charcoal-grey-lifestyle.jpg',
    '[]'::jsonb,
    null, false, true, 'ULS-PEB-004', 3
  ),
  (
    'pebbles-charcoal-lava',
    'Charcoal Lava Pebbles',
    'pebbles', 'Decorative Pebbles',
    100000, 'per 1 tonne bulk bag',
    'Lightweight volcanic lava pebbles in dark charcoal tones. Highly porous — ideal as a planting medium, pot topper and feature garden accent.',
    '["Lightweight volcanic rock","Multiple size options","Excellent drainage","Suits potted arrangements"]'::jsonb,
    '["20-30mm","30-50mm","50-70mm"]'::jsonb,
    '/images/products/pebbles-charcoal-lava-lifestyle.jpg',
    '["/images/products/pebbles-charcoal-lava-1.jpg","/images/products/pebbles-charcoal-lava-2.jpg","/images/products/pebbles-charcoal-lava-3.jpg","/images/products/pebbles-charcoal-lava-4.jpg","/images/products/pebbles-charcoal-lava-5.jpg","/images/products/pebbles-charcoal-lava-6.jpg","/images/products/pebbles-charcoal-lava-7.jpg"]'::jsonb,
    null, true, true, 'ULS-PEB-006', 4
  ),
  (
    'pebbles-red-lava',
    'Red Lava Pebbles',
    'pebbles', 'Decorative Pebbles',
    100000, 'per 1 tonne bulk bag',
    'Striking volcanic red lava pebbles — warm, bold tones that add drama to garden beds, potted plants and feature areas. Lightweight and highly porous.',
    '["Lightweight volcanic rock","Warm red tones","30–50mm size","Excellent aeration"]'::jsonb,
    '["30-50mm"]'::jsonb,
    '/images/products/pebbles-red-lava-lifestyle.jpg',
    '[]'::jsonb,
    null, false, true, 'ULS-PEB-007', 5
  ),
  (
    'mulch-hardwood-chip',
    'Premium Hardwood Chip',
    'mulch', 'Mulch & Bark',
    17800, 'per 1 tonne bulk bag',
    'A great balance between appearance, durability, and economy. Made from mixed sustainable hardwoods. Long lasting natural timber chip ideal for moisture retention and weed suppression.',
    '["Mixed sustainable hardwoods","25-40mm grade","Weed suppression","Moisture retention"]'::jsonb,
    '["25-40mm"]'::jsonb,
    '/images/products/mulch-hardwood-chip-lifestyle.jpg',
    '[]'::jsonb,
    null, false, true, 'ULS-MUL-001', 6
  ),
  (
    'mulch-woodlands-blend',
    'Woodlands Blend Mulch',
    'mulch', 'Mulch & Bark',
    13900, 'per 1 tonne bulk bag',
    'A great balance between appearance, durability and economy. Made from a mixture of soft/hard natural shredded timbers. Ideal for moisture retention and weed suppression.',
    '["Soft/hard shredded timbers","10-40mm grade","Weed suppression","Moisture retention"]'::jsonb,
    '["10-40mm"]'::jsonb,
    '/images/products/mulch-woodlands-blend-lifestyle.jpg',
    '[]'::jsonb,
    null, false, true, 'ULS-MUL-002', 7
  ),
  (
    'mulch-woodlands-natural',
    'Woodlands Natural Mulch',
    'mulch', 'Mulch & Bark',
    14900, 'per 1 tonne bulk bag',
    'A great balance between appearance, durability and economy. Made from a mixture of soft/hard natural shredded timbers. Ideal for moisture retention and weed suppression. Used in both domestic and commercial applications.',
    '["Natural shredded timbers","Weed suppression","Moisture retention","Domestic & commercial use"]'::jsonb,
    '[]'::jsonb,
    '/images/products/mulch-woodlands-natural-lifestyle.jpg',
    '[]'::jsonb,
    null, false, true, 'ULS-MUL-003', 8
  ),
  (
    'mulch-nls-pine-bark',
    'Pine Bark',
    'mulch', 'Mulch & Bark',
    15200, 'per 1 tonne bulk bag',
    'Long lasting natural timber chip ideal for moisture retention and weed suppression. Used in both domestic and commercial applications.',
    '["Mixed sustainable hardwoods","Long-lasting","Weed suppression","Moisture retention"]'::jsonb,
    '[]'::jsonb,
    '/images/products/mulch-nls-pine-bark-lifestyle.jpg',
    '[]'::jsonb,
    null, false, true, 'ULS-MUL-004', 9
  ),
  (
    'soil-nls-top-dressing',
    'Top Dressing',
    'soil', 'Soil & Turf',
    12800, 'per 1 tonne bulk bag',
    'A premium blend of finely screened organic matter and soil, designed to revitalise lawns and garden beds. Boosts moisture retention, improves nutrient availability, and supports healthy, sustained growth.',
    '["Finely screened organic matter","Boosts moisture retention","Improves nutrient availability","Revitalises lawns & garden beds"]'::jsonb,
    '[]'::jsonb,
    '/images/products/soil-nls-top-dressing-lifestyle.jpg',
    '[]'::jsonb,
    null, true, true, 'ULS-SOIL-001', 10
  ),
  (
    'soil-planter-box-a',
    'Planter Box A (Horizon A)',
    'soil', 'Soil & Turf',
    13900, 'per 1 tonne bulk bag',
    'A premium soil blend designed for deep-rooted plants in planter boxes and raised beds. Enhances root development, nutrient retention, soil stability, and moisture management.',
    '["Premium blend for deep-rooted plants","Boosts root development","Strong nutrient retention","Reliable moisture management"]'::jsonb,
    '[]'::jsonb,
    '/images/products/soil-planter-box-a-lifestyle.jpg',
    '[]'::jsonb,
    null, false, true, 'ULS-SOIL-002', 11
  ),
  (
    'soil-premium-turf-underlay',
    'Premium Turf Underlay 80/20',
    'soil', 'Soil & Turf',
    12800, 'per 1 tonne bulk bag',
    'A quality-assured mix of soil, sand and composted organics that gives newly laid turf the head start it needs. Suitable for Buffalo, Couch, Durban, Kikuyu and Zoysia turf varieties.',
    '["80/20 soil + sand blend with composted organics","Boosts root establishment for new turf","Improves drainage","Suits Buffalo, Couch, Kikuyu, Zoysia"]'::jsonb,
    '[]'::jsonb,
    '/images/products/soil-premium-turf-underlay-lifestyle.jpg',
    '[]'::jsonb,
    null, false, true, 'ULS-SOIL-003', 12
  ),
  (
    'sand-nls-sydney',
    'Sydney Sand',
    'sand', 'Sand',
    14300, 'per 1 tonne bulk bag',
    'Sydney Sand, also known as washed sand, tiling sand, or rendering sand. Free of clay content, making it safe for children''s sandpits. Ideal for plastering, rendering, tiling, and grouting.',
    '["Washed and graded","Clay-free","Tiling, rendering & paving","Sandpit safe"]'::jsonb,
    '[]'::jsonb,
    '/images/products/sand-nls-sydney-lifestyle.jpg',
    '[]'::jsonb,
    null, true, true, 'ULS-SND-001', 13
  )
on conflict (id) do nothing;
