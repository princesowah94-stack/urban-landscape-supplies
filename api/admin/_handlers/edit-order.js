/**
 * POST /api/admin/edit-order
 * Body: { orderId, customer_name?, customer_email?, customer_phone?,
 *         delivery_address?, notes? }
 *
 * Edit the customer/delivery fields on an order. Only the fields present in
 * the body are updated. Line items + total cannot be edited here — Square's
 * ordersApi.updateOrder doesn't allow line-item changes on a paid order, so
 * quantity changes need to go through refund + reorder. This endpoint only
 * touches Supabase fields.
 *
 * Auth: Authorization: Bearer <Supabase JWT>.
 *
 * Audit-logs every successful edit with a before/after diff.
 */
import { corsHeaders, optionsResponse } from '../../_cors.js';
import { supabase } from '../../_supabase.js';
import { authenticateAdmin } from '../../_admin-auth.js';
import { logOrderAction } from '../../_audit-log.js';

// Whitelisted fields. Any other key in the body is ignored.
const EDITABLE_FIELDS = [
  'customer_name',
  'customer_email',
  'customer_phone',
  'delivery_address',
  'notes',
];

export function OPTIONS(request) {
  return optionsResponse(request);
}

export async function POST(request) {
  const auth = await authenticateAdmin(request);
  if (!auth.ok) return auth.response;

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: 'Invalid JSON' },
      { status: 400, headers: corsHeaders(request) }
    );
  }

  const { orderId } = body || {};
  if (!orderId) {
    return Response.json(
      { error: 'orderId is required' },
      { status: 400, headers: corsHeaders(request) }
    );
  }

  // Build the update payload from whitelisted fields only.
  const updates = {};
  for (const f of EDITABLE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(body, f)) {
      // Trim strings; allow null/empty to clear a field.
      const val = body[f];
      updates[f] = (typeof val === 'string') ? val.trim() : val;
    }
  }

  if (Object.keys(updates).length === 0) {
    return Response.json(
      { error: 'No editable fields supplied', message: `Allowed: ${EDITABLE_FIELDS.join(', ')}` },
      { status: 400, headers: corsHeaders(request) }
    );
  }

  // Load the current order so we can build a diff for the audit log.
  const { data: before, error: lookupErr } = await supabase
    .from('orders')
    .select('id, ' + EDITABLE_FIELDS.join(', '))
    .eq('id', orderId)
    .maybeSingle();

  if (lookupErr) {
    console.error('[admin-fail]', JSON.stringify({ stage: 'edit-lookup', orderId, error: lookupErr.message }));
    return Response.json({ error: 'DB error' }, { status: 500, headers: corsHeaders(request) });
  }
  if (!before) {
    return Response.json({ error: 'Order not found' }, { status: 404, headers: corsHeaders(request) });
  }

  // Build a minimal diff: only fields that actually changed.
  const diff = {};
  for (const f of Object.keys(updates)) {
    if ((before[f] ?? null) !== (updates[f] ?? null)) {
      diff[f] = { from: before[f] ?? null, to: updates[f] ?? null };
    }
  }

  if (Object.keys(diff).length === 0) {
    // No-op — return success without writing.
    return Response.json(
      { ok: true, changed: 0 },
      { headers: corsHeaders(request) }
    );
  }

  // Apply the update.
  const { error: updateErr } = await supabase
    .from('orders')
    .update(updates)
    .eq('id', orderId);

  if (updateErr) {
    console.error('[admin-fail]', JSON.stringify({ stage: 'edit-update', orderId, error: updateErr.message }));
    return Response.json({ error: 'Update failed' }, { status: 500, headers: corsHeaders(request) });
  }

  // Audit-log the diff. Awaited because we want callers to know it landed.
  await logOrderAction({
    orderId,
    profile: auth.profile,
    action: 'edit',
    details: { diff },
  });

  return Response.json(
    {
      ok: true,
      changed: Object.keys(diff).length,
      changedFields: Object.keys(diff),
      actor: auth.profile.display_name,
    },
    { headers: corsHeaders(request) }
  );
}
