-- Quotes table: bulk quote requests submitted via the public site (api/quote.js)
create table if not exists public.quotes (
  id                     uuid primary key default gen_random_uuid(),
  reference_id           text not null unique,
  contact_first_name     text,
  contact_last_name      text,
  contact_email          text not null,
  contact_phone          text,
  is_trade               boolean      not null default false,
  delivery_address       text,
  delivery_suburb        text,
  delivery_postcode      text,
  delivery_date_from     date,
  delivery_date_to       date,
  delivery_access        text,
  notes                  text,
  items                  jsonb        not null,
  estimated_total_cents  integer,
  status                 text         not null default 'new'
                         check (status in ('new','quoted','accepted','declined','expired')),
  quoted_total_cents     integer,
  responded_at           timestamptz,
  created_at             timestamptz  not null default now()
);

create index if not exists quotes_status_created_idx
  on public.quotes (status, created_at desc);

create index if not exists quotes_reference_idx
  on public.quotes (reference_id);

-- Track which contact-form submissions have been replied to
alter table public.contacts
  add column if not exists replied_at timestamptz;

create index if not exists contacts_unreplied_idx
  on public.contacts (created_at desc)
  where replied_at is null;

-- RLS on: only service role bypasses (CRM uses service role)
alter table public.quotes enable row level security;
