/**
 * GET  /api/admin/orders[?status=paid|dispatched|delivered|cancelled|pending_payment]
 *      Returns the latest 50 orders with their line items.
 *
 * POST /api/admin/orders
 *      Body: { orderId, status }
 *      Validates the transition, updates Supabase, fires the dispatch email when
 *      moving paid -> dispatched.
 *
 * All requests require: Authorization: Bearer <token>
 */
import { waitUntil } from '@vercel/functions';
import { corsHeaders, optionsResponse } from '../_cors.js';
import { supabase } from '../_supabase.js';
import { requireAdmin } from '../_admin-auth.js';
import { sendCustomerDispatchEmail } from '../_email.js';

const ALLOWED_TRANSITIONS = {
  paid:       new Set(['dispatched', 'cancelled']),
  dispatched: new Set(['delivered', 'cancelled']),
};

const VALID_FILTERS = new Set(['pending_payment', 'paid', 'dispatched', 'delivered', 'cancelled']);

export function OPTIONS(request) {
  return optionsResponse(request);
}

export async function GET(request) {
  const unauthorized = requireAdmin(request);
  if (unauthorized) return unauthorized;

  try {
    const url = new URL(request.url);
    const statusFilter = url.searchParams.get('status');

    let query = supabase
      .from('orders')
      .select('*, order_items(*)')
      .order('created_at', { ascending: false })
      .limit(50);

    if (statusFilter && VALID_FILTERS.has(statusFilter)) {
      query = query.eq('status', statusFilter);
    }

    const { data, error } = await query;
    if (error) {
      console.error('Admin orders fetch error:', error.message);
      return Response.json({ error: 'DB error' }, { status: 500, headers: corsHeaders(request) });
    }

    return Response.json({ orders: data || [] }, { headers: corsHeaders(request) });

  } catch (err) {
    console.error('Admin orders GET error:', err);
    return Response.json({ error: 'Server error' }, { status: 500, headers: corsHeaders(request) });
  }
}

export async function POST(request) {
  const unauthorized = requireAdmin(request);
  if (unauthorized) return unauthorized;

  try {
    const { orderId, status: nextStatus } = await request.json();
    if (!orderId || !nextStatus) {
      return Response.json(
        { error: 'orderId and status are required' },
        { status: 400, headers: corsHeaders(request) }
      );
    }

    // Load current order to validate the transition
    const { data: order, error: lookupErr } = await supabase
      .from('orders')
      .select('*, order_items(*)')
      .eq('id', orderId)
      .single();

    if (lookupErr || !order) {
      return Response.json({ error: 'Order not found' }, { status: 404, headers: corsHeaders(request) });
    }

    const allowed = ALLOWED_TRANSITIONS[order.status];
    if (!allowed || !allowed.has(nextStatus)) {
      return Response.json(
        { error: 'Invalid transition', message: `Cannot move ${order.status} -> ${nextStatus}` },
        { status: 400, headers: corsHeaders(request) }
      );
    }

    const { error: updateErr } = await supabase
      .from('orders')
      .update({ status: nextStatus })
      .eq('id', orderId);

    if (updateErr) {
      console.error('Status update failed:', updateErr.message);
      return Response.json({ error: 'Update failed' }, { status: 500, headers: corsHeaders(request) });
    }

    // Customer email only fires on paid -> dispatched
    if (order.status === 'paid' && nextStatus === 'dispatched' && order.customer_email) {
      const items = (order.order_items || []).map(i => ({
        name: i.name,
        quantity: i.quantity,
        price_cents: i.price_cents,
      }));
      waitUntil((async () => {
        try {
          await sendCustomerDispatchEmail({ order: { ...order, status: 'dispatched' }, items });
        } catch (mailErr) {
          console.error('Dispatch email failed:', mailErr.message);
        }
      })());
    }

    return Response.json(
      { ok: true, status: nextStatus },
      { headers: corsHeaders(request) }
    );

  } catch (err) {
    console.error('Admin orders POST error:', err);
    return Response.json({ error: 'Server error' }, { status: 500, headers: corsHeaders(request) });
  }
}
