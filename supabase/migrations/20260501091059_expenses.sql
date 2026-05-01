-- Expenses ledger: manually-entered business costs.
-- Powers the CRM Accounting tab (revenue from orders + expenses from this
-- table = real P&L). Pre-Xero v1; if/when Xero gets connected later,
-- a separate `xero_synced_at` column can be added without breaking anything.
create table if not exists public.expenses (
  id            uuid primary key default gen_random_uuid(),
  date          date not null,
  vendor        text,
  category      text not null default 'other'
                check (category in (
                  'materials', 'fuel', 'vehicle', 'equipment',
                  'wages',     'rent', 'utilities', 'software',
                  'marketing', 'professional', 'bank_fees', 'other'
                )),
  amount_cents  integer not null check (amount_cents >= 0),
  notes         text,
  created_by    text,                  -- Clerk user id (string), nullable for v1
  created_at    timestamptz not null default now()
);

create index if not exists expenses_date_idx
  on public.expenses (date desc);

create index if not exists expenses_category_date_idx
  on public.expenses (category, date desc);

alter table public.expenses enable row level security;
-- No policies = service-role only (CRM uses service-role key).
