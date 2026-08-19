-- Phase 2b/2c/2d schema: sequential invoice numbers, delivery slot/driver,
-- quote→order linkage + expiry.

-- ── Invoice numbers ──────────────────────────────────────────────────────
-- Assigned on first print/email (not on creation) so abandoned pending orders
-- don't burn numbers. Format INV-0001.
create sequence if not exists public.invoice_number_seq start 1;

alter table public.orders
  add column if not exists invoice_number     text unique,
  add column if not exists invoice_issued_at  timestamptz,
  add column if not exists delivery_slot      text check (delivery_slot in ('am','pm','any')),
  add column if not exists driver             text,
  add column if not exists quote_id           uuid references public.quotes(id) on delete set null;

create or replace function public.assign_invoice_number(p_order_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing text;
  v_new text;
begin
  select invoice_number into v_existing from orders where id = p_order_id for update;
  if not found then
    raise exception 'order % not found', p_order_id;
  end if;
  if v_existing is not null then
    return v_existing;
  end if;
  v_new := 'INV-' || lpad(nextval('public.invoice_number_seq')::text, 4, '0');
  update orders set invoice_number = v_new, invoice_issued_at = now() where id = p_order_id;
  return v_new;
end;
$$;

revoke all on function public.assign_invoice_number(uuid) from public, anon, authenticated;

-- ── Quotes: expiry + conversion link ─────────────────────────────────────
alter table public.quotes
  add column if not exists expires_at          timestamptz,
  add column if not exists converted_at        timestamptz,
  add column if not exists converted_order_id  uuid references public.orders(id) on delete set null;

create index if not exists quotes_expires_idx on public.quotes (expires_at) where status = 'quoted';
