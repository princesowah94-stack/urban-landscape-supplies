-- Multi-user admin auth via Supabase Auth + per-action audit log.
--
-- Replaces the shared ADMIN_PASSWORD scheme. Anyone can sign in via magic link
-- (Supabase auth.users), but only emails listed in admin_profiles can use the
-- admin tools. Every status transition / refund / future edit writes a row in
-- order_audit_log so we know who did what.

-- ──────────────────────────────────────────────────────────────────
-- admin_profiles — allowlist of users with admin access
-- ──────────────────────────────────────────────────────────────────
create table if not exists public.admin_profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  display_name  text not null,
  role          text not null default 'admin',
  is_active     boolean not null default true,
  created_at    timestamptz not null default now()
);

comment on table public.admin_profiles is
  'Allowlist of Supabase auth users who may use the retail admin. New admins are added by INSERTing a row that references auth.users.id (after the user has signed in once via magic link to create their auth.users row).';

create index if not exists admin_profiles_is_active_idx
  on public.admin_profiles (is_active);

-- ──────────────────────────────────────────────────────────────────
-- order_audit_log — append-only trail of every admin action on an order
-- ──────────────────────────────────────────────────────────────────
create table if not exists public.order_audit_log (
  id                    uuid primary key default gen_random_uuid(),
  order_id              uuid not null references public.orders(id) on delete cascade,
  actor_user_id         uuid references auth.users(id) on delete set null,
  actor_display_name    text not null,
  action                text not null,
  details               jsonb not null default '{}'::jsonb,
  created_at            timestamptz not null default now()
);

comment on table public.order_audit_log is
  'Append-only log of admin actions on orders. action is a short verb like "transition", "refund", "reopen", "edit". details is a free-form JSON describing the change (status_from / status_to / refund_id / etc.).';

create index if not exists order_audit_log_order_id_idx
  on public.order_audit_log (order_id, created_at desc);

create index if not exists order_audit_log_actor_idx
  on public.order_audit_log (actor_user_id, created_at desc);

-- ──────────────────────────────────────────────────────────────────
-- RLS: lock both tables down — service-role key bypasses RLS, so the
-- API still works. Anonymous / anon-key access is denied by default.
-- ──────────────────────────────────────────────────────────────────
alter table public.admin_profiles    enable row level security;
alter table public.order_audit_log   enable row level security;

-- (No policies created on purpose — only the service-role key, used by
-- the Vercel functions via SUPABASE_SERVICE_ROLE_KEY, can read/write.
-- The browser only ever talks to these tables via the API endpoints,
-- never directly.)
