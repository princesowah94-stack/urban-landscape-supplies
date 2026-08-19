-- Customer profiles derived from orders, aggregated in Postgres.
-- Replaces the CRM's select-all-orders-then-group-in-JS (unbounded, O(orders)).
-- One row per customer email. Name/phone = most recent non-null value.

create or replace view public.customer_summary
with (security_invoker = true)
as
with real_orders as (
  select
    lower(trim(customer_email)) as email,
    customer_name,
    customer_phone,
    total_cents,
    created_at
  from public.orders
  where customer_email is not null
    and trim(customer_email) <> ''
    and status not in ('pending_payment', 'cancelled')
),
latest as (
  -- most recent non-null name / phone per email
  select distinct on (email)
    email,
    customer_name  as name,
    customer_phone as phone
  from real_orders
  where customer_name is not null or customer_phone is not null
  order by email, created_at desc
)
select
  r.email,
  coalesce(l.name,  '') as name,
  coalesce(l.phone, '') as phone,
  count(*)::int                         as order_count,
  coalesce(sum(r.total_cents), 0)::bigint as lifetime_value,
  min(r.created_at)                     as first_order_at,
  max(r.created_at)                     as last_order_at
from real_orders r
left join latest l using (email)
group by r.email, l.name, l.phone;

comment on view public.customer_summary is
  'CRM: one row per customer email aggregated from paid/dispatched/delivered/refunded orders. Read via PostgREST with ilike/limit/offset.';
