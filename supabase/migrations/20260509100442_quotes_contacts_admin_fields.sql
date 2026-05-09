-- Admin tracking fields for quotes + contacts.
--
-- Both tables already exist on the remote (created via Supabase dashboard
-- pre-CLI). This migration only adds the per-row "who acted on this and when"
-- columns so the new admin tabs can display "Quoted by Jane on 9 May" and
-- "Replied by Prince on 5 May" without needing a separate audit-log table.

-- ──────────────────────────────────────────────────────────────────
-- contacts: track when a contact submission has been replied to + by whom
-- ──────────────────────────────────────────────────────────────────
alter table public.contacts
  add column if not exists replied_at  timestamptz,
  add column if not exists replied_by  uuid references auth.users(id) on delete set null;

create index if not exists contacts_replied_at_idx
  on public.contacts (replied_at);

-- ──────────────────────────────────────────────────────────────────
-- quotes: track when status was last changed + by whom
-- ──────────────────────────────────────────────────────────────────
alter table public.quotes
  add column if not exists status_changed_at  timestamptz,
  add column if not exists status_changed_by  uuid references auth.users(id) on delete set null;

create index if not exists quotes_status_idx
  on public.quotes (status);
