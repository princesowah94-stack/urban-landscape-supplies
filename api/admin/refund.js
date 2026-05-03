/**
 * POST /api/admin/refund
 * Body: { orderId }
 *
 * Issues a full refund for the given order via Square's Refunds API.
 * Idempotent on the order id — clicking Refund twice returns the same refund.
 *
 * Auth: requires Authorization: Bearer <admin-token> (same as the rest of /api/admin/*).
 */
import { Client, Environment, ApiError } from 'square';
import { waitUntil } from '@vercel/functions';
import { corsHeaders, optionsResponse } from '../_cors.js';
import { supabase } from '../_supabase.js';
import { requireAdmin } from '../_admin-auth.js';
import { sendCustomerRefundEmail } from '../_email.js';

// Statuses for which "issue a refund" makes sense. We don't refund pending_payment
// (no money was taken), already-cancelled (no payment to refund), or already-refunded.
const REFUNDABLE = new Set(['paid', 'dispatched', 'delivered']);

export function OPTIONS(request) {
  return optionsResponse(request);
}

export async function POST(request) {
  const unauthorized = requireAdmin(request);
  if (unauthorized) return unauthorized;

  // Construct Square client per-request (same pattern as api/create-checkout.js).
  // Module-level construction has been observed to crash cold starts on Vercel.
  const squareClient = new Client({
    accessToken: process.env.SQUARE_ACCESS_TOKEN,
    environment: process.env.SQUARE_ENVIRONMENT === 'production'
      ? Environment.Production
      : Environment.Sandbox,
  });

  try {
    const { orderId } = await request.json().catch(() => ({}));
    if (!orderId) {
      return Response.json(
        { error: 'orderId is required' },
        { status: 400, headers: corsHeaders(request) }
      );
    }

    // Load the order + items so we have everything for the email.
    const { data: order, error: lookupErr } = await supabase
      .from('orders')
      .select('*, order_items(*)')
      .eq('id', orderId)
      .single();

    if (lookupErr || !order) {
      return Response.json(
        { error: 'Order not found' },
        { status: 404, headers: corsHeaders(request) }
      );
    }

    // Idempotency: if it's already refunded, return the existing refund details.
    if (order.status === 'refunded') {
      return Response.json(
        {
          ok: true,
          alreadyRefunded: true,
          refundId: order.square_refund_id,
          refundedAt: order.refunded_at,
          amountCents: order.total_cents,
        },
        { headers: corsHeaders(request) }
      );
    }

    if (!REFUNDABLE.has(order.status)) {
      return Response.json(
        {
          error: 'Not refundable',
          message: `Cannot refund an order in status "${order.status}".`,
        },
        { status: 400, headers: corsHeaders(request) }
      );
    }

    if (!order.square_order_id) {
      return Response.json(
        {
          error: 'No Square order',
          message: 'This order has no Square order id — refund manually via Square Dashboard.',
        },
        { status: 400, headers: corsHeaders(request) }
      );
    }

    // Look up the Square order to find the payment id from its tenders.
    const orderRes = await squareClient.ordersApi.retrieveOrder(order.square_order_id);
    const sqOrder = orderRes.result?.order;
    const paymentId = sqOrder?.tenders?.[0]?.paymentId || sqOrder?.tenders?.[0]?.id;

    if (!paymentId) {
      return Response.json(
        {
          error: 'No payment',
          message: 'Square order has no associated payment to refund.',
        },
        { status: 400, headers: corsHeaders(request) }
      );
    }

    // Issue the refund. Idempotency key = our order id, so a double-submit returns
    // the same refund instead of creating a second one.
    const refundRes = await squareClient.refundsApi.refundPayment({
      idempotencyKey: `refund-${order.id}`,
      paymentId,
      amountMoney: { amount: BigInt(order.total_cents), currency: 'AUD' },
      reason: `Refund issued from admin for order ${order.id}`,
    });

    const refund = refundRes.result?.refund;
    const refundId = refund?.id;
    if (!refundId) {
      throw new Error('Square did not return a refund id');
    }

    // Persist to Supabase. status='refunded' is a new terminal state.
    const refundedAt = new Date().toISOString();
    const { error: updateErr } = await supabase
      .from('orders')
      .update({
        status: 'refunded',
        refunded_at: refundedAt,
        square_refund_id: refundId,
      })
      .eq('id', order.id);

    if (updateErr) {
      console.error('Refund DB update failed:', updateErr.message);
      // The refund itself succeeded — don't roll it back. Surface the error so
      // staff knows to check the row, but the refund will eventually reconcile.
      return Response.json(
        {
          ok: true,
          warning: 'Refund issued in Square, but DB update failed — verify the row.',
          refundId,
          amountCents: order.total_cents,
        },
        { headers: corsHeaders(request) }
      );
    }

    // Fire the customer email after responding so we don't block on Resend.
    if (order.customer_email) {
      const items = (order.order_items || []).map((i) => ({
        name: i.name,
        quantity: i.quantity,
        price_cents: i.price_cents,
        unit: i.unit,
      }));
      waitUntil((async () => {
        try {
          await sendCustomerRefundEmail({
            order: { ...order, status: 'refunded', refunded_at: refundedAt },
            items,
            refundedCents: order.total_cents,
          });
        } catch (mailErr) {
          console.error('Refund email failed:', mailErr.message);
        }
      })());
    }

    return Response.json(
      {
        ok: true,
        refundId,
        refundedAt,
        amountCents: order.total_cents,
        status: refund?.status, // PENDING / APPROVED / COMPLETED — informational
      },
      { headers: corsHeaders(request) }
    );

  } catch (err) {
    console.error('Refund error:', err instanceof ApiError ? err.errors : err);

    if (err instanceof ApiError) {
      const detail = err.errors?.[0]?.detail || 'Square API error';
      return Response.json(
        { error: 'Refund gateway error', message: detail },
        { status: 422, headers: corsHeaders(request) }
      );
    }

    return Response.json(
      { error: 'Server error', message: err.message || 'Unexpected error processing refund.' },
      { status: 500, headers: corsHeaders(request) }
    );
  }
}
