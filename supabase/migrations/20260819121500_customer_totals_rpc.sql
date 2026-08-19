-- Headline customer totals for the CRM Customers page header
-- (count + summed lifetime value across all customers, independent of paging).

create or replace function public.customer_totals()
returns table (customers bigint, lifetime_value bigint)
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::bigint, coalesce(sum(lifetime_value), 0)::bigint
  from public.customer_summary;
$$;

revoke all on function public.customer_totals() from public;
grant execute on function public.customer_totals() to service_role;
