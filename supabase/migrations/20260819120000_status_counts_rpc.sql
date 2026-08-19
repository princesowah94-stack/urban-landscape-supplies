-- Generic status-count aggregate for the CRM.
-- Replaces N parallel HEAD-count queries (one per status) with a single GROUP BY.
-- Allow-listed table names only; never interpolates caller input into SQL.

create or replace function public.status_counts(tbl text)
returns table (status text, count bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if tbl not in ('orders', 'quotes', 'trade_applications', 'campaigns', 'social_posts') then
    raise exception 'status_counts: table % not allowed', tbl;
  end if;
  return query execute format(
    'select status::text, count(*)::bigint from public.%I group by status',
    tbl
  );
end;
$$;

revoke all on function public.status_counts(text) from public;
grant execute on function public.status_counts(text) to service_role;
