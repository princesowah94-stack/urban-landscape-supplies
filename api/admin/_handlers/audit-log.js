/**
 * GET /api/admin/audit-log?orderId=<uuid>
 *      Returns up to 50 most recent audit-log entries for the given order.
 *
 * Auth: Authorization: Bearer <Supabase JWT> — same as the other /api/admin/* endpoints.
 */
import { corsHeaders, optionsResponse } from '../../_cors.js';
import { supabase } from '../../_supabase.js';
import { authenticateAdmin } from '../../_admin-auth.js';

export function OPTIONS(request) {
  return optionsResponse(request);
}

export async function GET(request) {
  const auth = await authenticateAdmin(request);
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const orderId = url.searchParams.get('orderId');
  if (!orderId) {
    return Response.json(
      { error: 'orderId is required' },
      { status: 400, headers: corsHeaders(request) }
    );
  }

  const { data, error } = await supabase
    .from('order_audit_log')
    .select('id, action, actor_display_name, details, created_at')
    .eq('order_id', orderId)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) {
    console.error('[admin-fail]', JSON.stringify({ stage: 'audit-log-fetch', orderId, error: error.message }));
    return Response.json(
      { error: 'Could not fetch audit log' },
      { status: 500, headers: corsHeaders(request) }
    );
  }

  return Response.json(
    { entries: data || [] },
    { headers: corsHeaders(request) }
  );
}
