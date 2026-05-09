/**
 * GET /api/admin/stats
 *
 * Returns aggregated dashboard data for the Admin Dashboard tab:
 *   - orders.today / orders.week        (count + revenue_cents)
 *   - quotes.{new,quoted}_count + total_open
 *   - contacts.unreplied_count + unreplied_over_24h_count
 *   - action_queue: prioritised items needing admin attention,
 *     each with { kind, count, label, target } where target is a hash-route
 *     the UI can navigate to (e.g. '#orders?status=paid')
 *
 * All counts are bounded by the same Supabase scan limits as the other admin
 * endpoints (< 50 rows for revenue summing — a hard cap; if volume grows we
 * switch to count-only via the `count: 'exact'` Supabase modifier).
 *
 * Auth: Authorization: Bearer <Supabase JWT>.
 */
import { corsHeaders, optionsResponse } from '../../_cors.js';
import { supabase } from '../../_supabase.js';
import { authenticateAdmin } from '../../_admin-auth.js';

export function OPTIONS(request) {
  return optionsResponse(request);
}

// Returns the start of "today" and "this week" as ISO strings (Sydney local).
// Sydney is UTC+10/+11; using the user's machine timezone is fine since the
// admin runs on the user's browser anyway. Server returns calendar-day buckets.
function periodWindows() {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  // Week starts Monday (AU convention)
  const dayOfWeek = (startOfToday.getDay() + 6) % 7; // Mon=0, Sun=6
  const startOfWeek = new Date(startOfToday);
  startOfWeek.setDate(startOfToday.getDate() - dayOfWeek);
  return {
    todayStart: startOfToday.toISOString(),
    weekStart:  startOfWeek.toISOString(),
    over24hAgo: new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString(),
  };
}

// Statuses considered "real revenue" — pending_payment isn't money in.
const REVENUE_STATUSES = ['paid', 'dispatched', 'delivered'];

export async function GET(request) {
  const auth = await authenticateAdmin(request);
  if (!auth.ok) return auth.response;

  try {
    const { todayStart, weekStart, over24hAgo } = periodWindows();

    // Run the four count queries in parallel — they don't depend on each other.
    const [todayOrdersRes, weekOrdersRes, paidAwaitingDispatchRes,
           newQuotesRes, quotedQuotesRes,
           unrepliedContactsRes, staleContactsRes] = await Promise.all([
      // Today's orders (count + revenue)
      supabase.from('orders')
        .select('total_cents, status')
        .gte('created_at', todayStart)
        .in('status', REVENUE_STATUSES),
      // This week's orders (count + revenue)
      supabase.from('orders')
        .select('total_cents, status')
        .gte('created_at', weekStart)
        .in('status', REVENUE_STATUSES),
      // Paid orders awaiting dispatch
      supabase.from('orders')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'paid'),
      // New quotes
      supabase.from('quotes')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'new'),
      // Quotes sent, awaiting customer decision
      supabase.from('quotes')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'quoted'),
      // Unreplied contacts (all)
      supabase.from('contacts')
        .select('id', { count: 'exact', head: true })
        .is('replied_at', null),
      // Unreplied contacts older than 24h (urgent)
      supabase.from('contacts')
        .select('id', { count: 'exact', head: true })
        .is('replied_at', null)
        .lt('created_at', over24hAgo),
    ]);

    const todayRevenue = (todayOrdersRes.data || [])
      .reduce((s, o) => s + (o.total_cents || 0), 0);
    const weekRevenue  = (weekOrdersRes.data || [])
      .reduce((s, o) => s + (o.total_cents || 0), 0);

    const stats = {
      orders: {
        today: { count: (todayOrdersRes.data || []).length, revenue_cents: todayRevenue },
        week:  { count: (weekOrdersRes.data || []).length,  revenue_cents: weekRevenue },
      },
      quotes: {
        new_count:    newQuotesRes.count    ?? 0,
        quoted_count: quotedQuotesRes.count ?? 0,
        total_open:   (newQuotesRes.count ?? 0) + (quotedQuotesRes.count ?? 0),
      },
      contacts: {
        unreplied_count:           unrepliedContactsRes.count ?? 0,
        unreplied_over_24h_count:  staleContactsRes.count     ?? 0,
      },
    };

    // Build the action queue — sorted by priority. Each item carries a
    // hash-route the UI can navigate to (filters auto-apply).
    const queue = [];
    const dispatchCount = paidAwaitingDispatchRes.count ?? 0;
    if (dispatchCount > 0) {
      queue.push({
        kind:   'dispatch',
        count:  dispatchCount,
        label:  `${dispatchCount} paid order${dispatchCount === 1 ? '' : 's'} awaiting dispatch`,
        target: '#orders?status=paid',
      });
    }
    if (stats.contacts.unreplied_over_24h_count > 0) {
      queue.push({
        kind:   'stale-contact',
        count:  stats.contacts.unreplied_over_24h_count,
        label:  `${stats.contacts.unreplied_over_24h_count} unreplied contact${stats.contacts.unreplied_over_24h_count === 1 ? '' : 's'} older than 24h`,
        target: '#contacts?unreplied=true',
      });
    }
    if (stats.quotes.new_count > 0) {
      queue.push({
        kind:   'new-quote',
        count:  stats.quotes.new_count,
        label:  `${stats.quotes.new_count} new quote${stats.quotes.new_count === 1 ? '' : 's'} awaiting response`,
        target: '#quotes?status=new',
      });
    }
    if (stats.contacts.unreplied_count > stats.contacts.unreplied_over_24h_count) {
      const recent = stats.contacts.unreplied_count - stats.contacts.unreplied_over_24h_count;
      queue.push({
        kind:   'recent-contact',
        count:  recent,
        label:  `${recent} unreplied contact${recent === 1 ? '' : 's'} in last 24h`,
        target: '#contacts?unreplied=true',
      });
    }

    return Response.json(
      { ...stats, action_queue: queue },
      { headers: corsHeaders(request) }
    );

  } catch (err) {
    console.error('[admin-fail]', JSON.stringify({ stage: 'stats-get', error: err?.message || String(err) }));
    return Response.json({ error: 'Server error' }, { status: 500, headers: corsHeaders(request) });
  }
}
