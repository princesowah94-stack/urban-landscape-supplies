-- Trade account management tables.

create table if not exists public.trade_applications (
  id               uuid primary key default gen_random_uuid(),
  company_name     text,
  contact_name     text not null,
  email            text not null,
  phone            text,
  abn              text,
  delivery_address text,
  business_type    text,
  annual_spend     text,
  notes            text,
  status           text not null default 'pending',
  reviewed_at      timestamptz,
  reviewed_by      text,
  created_at       timestamptz not null default now()
);

create index if not exists trade_applications_status_idx on public.trade_applications (status, created_at desc);
create index if not exists trade_applications_email_idx  on public.trade_applications (email);

alter table public.trade_applications enable row level security;

create table if not exists public.trade_accounts (
  id                 uuid primary key default gen_random_uuid(),
  application_id     uuid references public.trade_applications(id) on delete set null,
  company_name       text not null,
  contact_name       text not null,
  email              text not null,
  phone              text,
  abn                text,
  discount_tier      text not null default 'standard',
  is_active          boolean not null default true,
  credit_limit_cents integer,
  notes              text,
  approved_at        timestamptz not null default now(),
  approved_by        text
);

create index if not exists trade_accounts_email_idx     on public.trade_accounts (email);
create index if not exists trade_accounts_is_active_idx on public.trade_accounts (is_active);

alter table public.trade_accounts enable row level security;
