-- Products table
-- Moves product catalogue from data/products.json into Supabase.
-- CRM manages prices/stock, retail site reads via GET /api/products.

create table if not exists public.products (
  id             text primary key,
  name           text not null,
  category       text not null,
  category_label text not null,
  price          integer not null,
  unit           text not null default 'per 1 tonne bulk bag',
  description    text,
  features       jsonb not null default '[]',
  sizes          jsonb not null default '[]',
  image          text,
  images         jsonb not null default '[]',
  badge          text,
  featured       boolean not null default false,
  in_stock       boolean not null default true,
  sku            text,
  sort_order     integer not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

alter table public.products enable row level security;

create policy "Public can read products"
  on public.products for select
  using (true);

create index if not exists products_category_idx   on public.products (category);
create index if not exists products_sort_order_idx on public.products (sort_order);

-- Seed 13 products (price stored in cents AUD)
insert into public.products
  (id, name, category, category_label, price, unit, description, features, sizes, image, images, badge, featured, in_stock, sku, sort_order)
values
  (
    'pebbles-snow-white', 'Regular Snow White Pebbles',
    'pebbles', 'Decorative Pebbles', 80000, 'per 1 tonne bulk bag',
    'Classic rounded snow white pebbles, the most popular decorative pebble in Sydney gardens.',
    '["Rounded smooth finish","Brilliant white colour","Multiple size options","Pool area safe"]',
    '["20-30mm","30-50mm","50-80mm"]',
    '/images/products/pebbles-snow-white-lifestyle.jpg',
    '["/images/products/pebbles-snow-white-1.jpg","/images/products/pebbles-snow-white-2.jpg"]',
    'Bestseller', true, true, 'ULS-PEB-001', 1
  ),
  (
    'pebbles-crushed-snow-white', 'Crushed Snow White Pebbles',
    'pebbles', 'Decorative Pebbles', 109750, 'per 1 tonne bulk bag',
    'Angular crushed white stone. Ideal for contemporary pathways and drainage applications.',
    '["Angular crushed stone","Bright white finish","Drainage friendly","10-20mm size"]',
    '[]',
    '/images/products/pebbles-crushed-snow-white-lifestyle.jpg',
    '[]',
    null, false, true, 'ULS-PEB-002', 2
  ),
  (
    'pebbles-charcoal-grey', 'Charcoal Grey Pebbles',
    'pebbles', 'Decorative Pebbles', 100000, 'per 1 tonne bulk bag',
    'Smooth charcoal grey pebbles. Versatile for garden beds, pathways and water features.',
    '["Smooth finish","10-25mm size","Weather resistant","Versatile application"]',
    '[]',
    '/images/products/pebbles-charcoal-grey-lifestyle.jpg',
    '[]',
    null, false, true, 'ULS-PEB-004', 3
  ),
  (
    'pebbles-charcoal-lava', 'Charcoal Lava Pebbles',
    'pebbles', 'Decorative Pebbles', 100000, 'per 1 tonne bulk bag',
    'Lightweight volcanic lava pebbles in dark charcoal tones. Ideal as planting medium and pot topper.',
    '["Lightweight volcanic rock","Multiple size options","Excellent drainage","Suits potted arrangements"]',
    '["20-30mm","30-50mm","50-70mm"]',
    '/images/products/pebbles-charcoal-lava-lifestyle.jpg',
    '["/images/products/pebbles-charcoal-lava-1.jpg","/images/products/pebbles-charcoal-lava-2.jpg"]',
    null, true, true, 'ULS-PEB-006', 4
  ),
  (
    'pebbles-red-lava', 'Red Lava Pebbles',
    'pebbles', 'Decorative Pebbles', 100000, 'per 1 tonne bulk bag',
    'Striking volcanic red lava pebbles. Lightweight and highly porous.',
    '["Lightweight volcanic rock","Warm red tones","30-50mm size","Excellent aeration"]',
    '["30-50mm"]',
    '/images/products/pebbles-red-lava-lifestyle.jpg',
    '[]',
    null, false, true, 'ULS-PEB-007', 5
  ),
  (
    'mulch-hardwood-chip', 'Premium Hardwood Chip',
    'mulch', 'Mulch & Bark', 17800, 'per 1 tonne bulk bag',
    'Made from mixed sustainable hardwoods. Long lasting for moisture retention and weed suppression.',
    '["Mixed sustainable hardwoods","25-40mm grade","Weed suppression","Moisture retention"]',
    '["25-40mm"]',
    '/images/products/mulch-hardwood-chip-lifestyle.jpg',
    '[]',
    null, false, true, 'ULS-MUL-001', 6
  ),
  (
    'mulch-woodlands-blend', 'Woodlands Blend Mulch',
    'mulch', 'Mulch & Bark', 13900, 'per 1 tonne bulk bag',
    'Made from a mixture of soft/hard natural shredded timbers. Ideal for moisture retention.',
    '["Soft/hard shredded timbers","10-40mm grade","Weed suppression","Moisture retention"]',
    '["10-40mm"]',
    '/images/products/mulch-woodlands-blend-lifestyle.jpg',
    '[]',
    null, false, true, 'ULS-MUL-002', 7
  ),
  (
    'mulch-woodlands-natural', 'Woodlands Natural Mulch',
    'mulch', 'Mulch & Bark', 14900, 'per 1 tonne bulk bag',
    'Natural shredded timbers. Ideal for moisture retention and weed suppression.',
    '["Natural shredded timbers","Weed suppression","Moisture retention","Domestic & commercial use"]',
    '[]',
    '/images/products/mulch-woodlands-natural-lifestyle.jpg',
    '[]',
    null, false, true, 'ULS-MUL-003', 8
  ),
  (
    'mulch-nls-pine-bark', 'Pine Bark',
    'mulch', 'Mulch & Bark', 15200, 'per 1 tonne bulk bag',
    'Long lasting natural timber chip for moisture retention and weed suppression.',
    '["Mixed sustainable hardwoods","Long-lasting","Weed suppression","Moisture retention"]',
    '[]',
    '/images/products/mulch-nls-pine-bark-lifestyle.jpg',
    '[]',
    null, false, true, 'ULS-MUL-004', 9
  ),
  (
    'soil-nls-top-dressing', 'Top Dressing',
    'soil', 'Soil & Turf', 12800, 'per 1 tonne bulk bag',
    'Finely screened organic matter and soil to revitalise lawns and garden beds.',
    '["Finely screened organic matter","Boosts moisture retention","Improves nutrient availability","Revitalises lawns & garden beds"]',
    '[]',
    '/images/products/soil-nls-top-dressing-lifestyle.jpg',
    '[]',
    null, true, true, 'ULS-SOIL-001', 10
  ),
  (
    'soil-planter-box-a', 'Planter Box A (Horizon A)',
    'soil', 'Soil & Turf', 13900, 'per 1 tonne bulk bag',
    'Premium soil blend for deep-rooted plants in planter boxes and raised beds.',
    '["Premium blend for deep-rooted plants","Boosts root development","Strong nutrient retention","Reliable moisture management"]',
    '[]',
    '/images/products/soil-planter-box-a-lifestyle.jpg',
    '[]',
    null, false, true, 'ULS-SOIL-002', 11
  ),
  (
    'soil-premium-turf-underlay', 'Premium Turf Underlay 80/20',
    'soil', 'Soil & Turf', 12800, 'per 1 tonne bulk bag',
    'Soil, sand and composted organics for newly laid turf. Suits Buffalo, Couch, Kikuyu and Zoysia.',
    '["80/20 soil and sand blend","Boosts root establishment","Improves drainage","Suits Buffalo, Couch, Kikuyu, Zoysia"]',
    '[]',
    '/images/products/soil-premium-turf-underlay-lifestyle.jpg',
    '[]',
    null, false, true, 'ULS-SOIL-003', 12
  ),
  (
    'sand-nls-sydney', 'Sydney Sand',
    'sand', 'Sand', 14300, 'per 1 tonne bulk bag',
    'Washed sand, free of clay content. Safe for sandpits. Ideal for plastering, rendering, tiling and grouting.',
    '["Washed and graded","Clay-free","Tiling, rendering and paving","Sandpit safe"]',
    '[]',
    '/images/products/sand-nls-sydney-lifestyle.jpg',
    '[]',
    null, true, true, 'ULS-SND-001', 13
  )
on conflict (id) do nothing;
