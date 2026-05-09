/**
 * GET  /api/admin/contacts[?unreplied=true]
 *      Returns the latest 50 contact-form submissions. With `unreplied=true`
 *      only returns rows where replied_at IS NULL.
 *
 * POST /api/admin/contacts
 *      Body: { contactId, action: 'mark-replied' | 'mark-unreplied' }
 *      Sets/clears replied_at + replied_by.
 *
 * Auth: Authorization: Bearer <Supabase JWT>.
 */
import { corsHeaders, optionsResponse } from '../../_cors.js';
import { supabase } from '../../_supabase.js';
import { authenticateAdmin } from '../../_admin-auth.js';

const ALLOWED_ACTIONS = new Set(['mark-replied', 'mark-unreplied']);

export function OPTIONS(request) {
  return optionsResponse(request);
}

export async function GET(request) {
  const auth = await authenticateAdmin(request);
  if (!auth.ok) return auth.response;

  try {
    const url = new URL(request.url);
    const unreplied = url.searchParams.get('unreplied') === 'true';
    const replied = url.searchParams.get('replied') === 'true';

    let query = supabase
      .from('contacts')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50);

    if (unreplied) query = query.is('replied_at', null);
    if (replied)   query = query.not('replied_at', 'is', null);

    const { data, error } = await query;
    if (error) {
      console.error('[admin-fail]', JSON.stringify({ stage: 'contacts-fetch', error: error.message }));
      return Response.json({ error: 'DB error' }, { status: 500, headers: corsHeaders(request) });
    }

    // Resolve replied_by display names in one round-trip.
    const actorIds = [...new Set(data.map(c => c.replied_by).filter(Boolean))];
    let actorById = {};
    if (actorIds.length) {
      const { data: profiles } = await supabase
        .from('admin_profiles')
        .select('id, display_name')
        .in('id', actorIds);
      actorById = Object.fromEntries((profiles || []).map(p => [p.id, p.display_name]));
    }
    const enriched = data.map(c => ({
      ...c,
      replied_by_name: c.replied_by ? (actorById[c.replied_by] || null) : null,
    }));

    return Response.json({ contacts: enriched }, { headers: corsHeaders(request) });

  } catch (err) {
    console.error('[admin-fail]', JSON.stringify({ stage: 'contacts-get', error: err?.message || String(err) }));
    return Response.json({ error: 'Server error' }, { status: 500, headers: corsHeaders(request) });
  }
}

export async function POST(request) {
  const auth = await authenticateAdmin(request);
  if (!auth.ok) return auth.response;

  try {
    const { contactId, action } = await request.json();
    if (!contactId || !action) {
      return Response.json(
        { error: 'contactId and action are required' },
        { status: 400, headers: corsHeaders(request) }
      );
    }
    if (!ALLOWED_ACTIONS.has(action)) {
      return Response.json(
        { error: 'Invalid action', message: `Allowed: ${[...ALLOWED_ACTIONS].join(', ')}` },
        { status: 400, headers: corsHeaders(request) }
      );
    }

    const updates = action === 'mark-replied'
      ? { replied_at: new Date().toISOString(), replied_by: auth.profile.id }
      : { replied_at: null,                     replied_by: null };

    const { error: updateErr } = await supabase
      .from('contacts')
      .update(updates)
      .eq('id', contactId);

    if (updateErr) {
      console.error('[admin-fail]', JSON.stringify({ stage: 'contacts-update', contactId, error: updateErr.message }));
      return Response.json({ error: 'Update failed' }, { status: 500, headers: corsHeaders(request) });
    }

    return Response.json(
      { ok: true, action, actor: auth.profile.display_name },
      { headers: corsHeaders(request) }
    );

  } catch (err) {
    console.error('[admin-fail]', JSON.stringify({ stage: 'contacts-post', error: err?.message || String(err) }));
    return Response.json({ error: 'Server error' }, { status: 500, headers: corsHeaders(request) });
  }
}
