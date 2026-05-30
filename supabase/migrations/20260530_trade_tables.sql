-- Trade account management tables.
--
-- trade_applications — form submissions from trade.html, reviewed in CRM
-- trade_accounts     — approved trade clients with discount tiers

-- ──────────────────────────────────────────────────────────────────
-- trade_applications
-- ──────────────────────────────────────────────────────────────────
create table if not exists public.trade_applications (
  id               uuid primary key default gen_random_uuid(),
  company_name     text,
  contact_name     text not null,
  email            text not null,
  phone            text,
  abn              text,
  delivery_address text,
  business_type    text,   -- builder | landscaper | developer | designer | other
  annual_spend     text,   -- e.g. "$5,000–$20,000"
  notes            text,
  status           text not null default 'pending',  -- pending | approved | rejected
  reviewed_at      timestamptz,
  reviewed_by      text,   -- Clerk user ID
  created_at       timestamptz not null default now()
);

comment on table public.trade_applications is
  'Trade account applications submitted from the retail site trade.html form. Reviewed in the CRM Trade tab.';

create index if not exists trade_applications_status_idx  on public.trade_applications (status, created_at desc);
create index if not exists trade_applications_email_idx   on public.trade_applications (email);

alter table public.trade_applications enable row level security;
-- No policies — service-role only

-- ──────────────────────────────────────────────────────────────────
-- trade_accounts
-- ──────────────────────────────────────────────────────────────────
create table if not exists public.trade_accounts (
  id                  uuid primary key default gen_random_uuid(),
  application_id      uuid references public.trade_applications(id) on delete set null,
  company_name        text not null,
  contact_name        text not null,
  email               text not null,
  phone               text,
  abn                 text,
  discount_tier       text not null default 'standard',  -- standard | silver | gold
  is_active           boolean not null default true,
  credit_limit_cents  integer,
  notes               text,
  approved_at         timestamptz not null default now(),
  approved_by         text        -- Clerk user ID
);

comment on table public.trade_accounts is
  'Active trade accounts approved from applications. Managed via the CRM Trade tab.';

create index if not exists trade_accounts_email_idx     on public.trade_accounts (email);
create index if not exists trade_accounts_is_active_idx on public.trade_accounts (is_active);

alter table public.trade_accounts enable row level security;
-- No policies — service-role only
