/**
 * GET  /api/admin/quotes[?status=new|quoted|won|lost]
 *      Returns the latest 50 quotes with the listed status (or all if omitted).
 *
 * POST /api/admin/quotes
 *      Body: { quoteId, status }
 *      Validates the requested status, updates `status` + `status_changed_at`
 *      + `status_changed_by`. No external side effects today (no email).
 *
 * Auth: Authorization: Bearer <Supabase JWT> (same pattern as orders.js).
 */
import { corsHeaders, optionsResponse } from '../_cors.js';
import { supabase } from '../_supabase.js';
import { authenticateAdmin } from '../_admin-auth.js';

const ALLOWED_STATUSES = new Set(['new', 'quoted', 'won', 'lost']);

export function OPTIONS(request) {
  return optionsResponse(request);
}

export async function GET(request) {
  const auth = await authenticateAdmin(request);
  if (!auth.ok) return auth.response;

  try {
    const url = new URL(request.url);
    const statusFilter = url.searchParams.get('status');

    let query = supabase
      .from('quotes')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50);

    if (statusFilter && ALLOWED_STATUSES.has(statusFilter)) {
      query = query.eq('status', statusFilter);
    }

    const { data, error } = await query;
    if (error) {
      console.error('[admin-fail]', JSON.stringify({ stage: 'quotes-fetch', error: error.message }));
      return Response.json({ error: 'DB error' }, { status: 500, headers: corsHeaders(request) });
    }

    // Resolve actor display names for any rows with a status_changed_by uuid.
    // We do a single in() query against admin_profiles instead of N round-trips.
    const actorIds = [...new Set(data.map(q => q.status_changed_by).filter(Boolean))];
    let actorById = {};
    if (actorIds.length) {
      const { data: profiles } = await supabase
        .from('admin_profiles')
        .select('id, display_name')
        .in('id', actorIds);
      actorById = Object.fromEntries((profiles || []).map(p => [p.id, p.display_name]));
    }
    const enriched = data.map(q => ({
      ...q,
      status_changed_by_name: q.status_changed_by ? (actorById[q.status_changed_by] || null) : null,
    }));

    return Response.json({ quotes: enriched }, { headers: corsHeaders(request) });

  } catch (err) {
    console.error('[admin-fail]', JSON.stringify({ stage: 'quotes-get', error: err?.message || String(err) }));
    return Response.json({ error: 'Server error' }, { status: 500, headers: corsHeaders(request) });
  }
}

export async function POST(request) {
  const auth = await authenticateAdmin(request);
  if (!auth.ok) return auth.response;

  try {
    const { quoteId, status } = await request.json();
    if (!quoteId || !status) {
      return Response.json(
        { error: 'quoteId and status are required' },
        { status: 400, headers: corsHeaders(request) }
      );
    }
    if (!ALLOWED_STATUSES.has(status)) {
      return Response.json(
        { error: 'Invalid status', message: `Allowed: ${[...ALLOWED_STATUSES].join(', ')}` },
        { status: 400, headers: corsHeaders(request) }
      );
    }

    const { error: updateErr } = await supabase
      .from('quotes')
      .update({
        status,
        status_changed_at: new Date().toISOString(),
        status_changed_by: auth.profile.id,
      })
      .eq('id', quoteId);

    if (updateErr) {
      console.error('[admin-fail]', JSON.stringify({ stage: 'quotes-update', quoteId, error: updateErr.message }));
      return Response.json({ error: 'Update failed' }, { status: 500, headers: corsHeaders(request) });
    }

    return Response.json(
      { ok: true, status, actor: auth.profile.display_name },
      { headers: corsHeaders(request) }
    );

  } catch (err) {
    console.error('[admin-fail]', JSON.stringify({ stage: 'quotes-post', error: err?.message || String(err) }));
    return Response.json({ error: 'Server error' }, { status: 500, headers: corsHeaders(request) });
  }
}
