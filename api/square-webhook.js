/**
 * Square webhook receiver.
 *
 * Subscribed event: payment.updated
 * Square will retry on any non-2xx, so we always return 200 once we've
 * verified the signature — emails or downstream calls failing must not
 * cause Square to keep redelivering.
 */
import crypto from 'node:crypto';
import { supabase } from './_supabase.js';
import { sendCustomerOrderEmail, sendStaffOrderEmail, sendSupplierOrderEmail } from './_email.js';

// Verify the HMAC signature Square sends in `x-square-hmacsha256-signature`.
// Signed payload = notification URL + raw request body, hashed with
// SQUARE_WEBHOOK_SIGNATURE_KEY (Base64-decoded), encoded as Base64.
function verifySignature(rawBody, signatureHeader, notificationUrl) {
  const key = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY;
  if (!key || !signatureHeader) return false;

  const expected = crypto
    .createHmac('sha256', key)
    .update(notificationUrl + rawBody)
    .digest('base64');

  const a = Buffer.from(expected);
  const b = Buffer.from(signatureHeader);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export async function POST(request) {
  // Read the raw body BEFORE parsing — HMAC needs the exact bytes Square signed.
  const rawBody = await request.text();
  const signatureHeader = request.headers.get('x-square-hmacsha256-signature');

  // The notification URL Square is calling — fall back to the configured site URL.
  // Square's docs require you to register the exact URL it'll POST to; that same
  // string must go into the HMAC input.
  const notificationUrl =
    process.env.SQUARE_WEBHOOK_URL ||
    `${process.env.SITE_URL || 'https://urbanlandscapesupplies.com.au'}/api/square-webhook`;

  if (!verifySignature(rawBody, signatureHeader, notificationUrl)) {
    console.warn('[webhook-fail]', JSON.stringify({ stage: 'signature', reason: 'mismatch' }));
    return new Response('Invalid signature', { status: 401 });
  }

  let event;
  try { event = JSON.parse(rawBody); }
  catch {
    console.warn('[webhook-fail]', JSON.stringify({ stage: 'parse', reason: 'bad-json' }));
    return new Response('Bad JSON', { status: 400 });
  }

  // We only care about completed payments. Anything else: ack and move on.
  if (event?.type !== 'payment.updated') return new Response('OK', { status: 200 });

  const payment = event?.data?.object?.payment;
  if (payment?.status !== 'COMPLETED') return new Response('OK', { status: 200 });

  const squareOrderId = payment.order_id;
  const squarePaymentId = payment.id;
  if (!squareOrderId) return new Response('OK', { status: 200 });

  // Find the matching Supabase order. If we can't find it, log and ack so Square stops retrying.
  const { data: order, error: lookupErr } = await supabase
    .from('orders')
    .select('*')
    .eq('square_order_id', squareOrderId)
    .single();

  if (lookupErr || !order) {
    console.warn('[webhook-fail]', JSON.stringify({ stage: 'order-lookup', squareOrderId, error: lookupErr?.message || 'not-found' }));
    return new Response('OK', { status: 200 });
  }

  // Idempotency — Square retries. Don't double-send emails or double-process.
  if (order.status === 'paid') return new Response('OK', { status: 200 });

  // Flip status → paid
  const { error: updateErr } = await supabase
    .from('orders')
    .update({ status: 'paid', square_payment_id: squarePaymentId })
    .eq('id', order.id);

  if (updateErr) {
    console.error('[webhook-fail]', JSON.stringify({ stage: 'mark-paid', orderId: order.id, error: updateErr.message }));
    // Return 500 so Square retries the webhook once Supabase is back.
    return new Response('DB error', { status: 500 });
  }

  // Pull line items + send the three emails. Email errors must NOT fail the
  // webhook (would cause Square retries → duplicate emails).
  // Promise.allSettled gives us per-recipient outcomes so a failed supplier
  // email doesn't hide a customer-email failure.
  try {
    const { data: items } = await supabase
      .from('order_items')
      .select('product_id, name, quantity, price_cents')
      .eq('order_id', order.id);

    const updatedOrder = { ...order, status: 'paid', square_payment_id: squarePaymentId };
    const emailResults = await Promise.allSettled([
      sendCustomerOrderEmail({ order: updatedOrder, items: items || [] }),
      sendStaffOrderEmail({ order: updatedOrder, items: items || [] }),
      sendSupplierOrderEmail({ order: updatedOrder, items: items || [] }),
    ]);
    const recipients = ['customer', 'staff', 'supplier'];
    emailResults.forEach((res, i) => {
      if (res.status === 'rejected') {
        console.error('[webhook-fail]', JSON.stringify({
          stage: 'email-send',
          recipient: recipients[i],
          orderId: order.id,
          error: res.reason?.message || String(res.reason),
        }));
      }
    });
    if ((items || []).length === 0) {
      console.warn('[webhook-fail]', JSON.stringify({ stage: 'empty-items', orderId: order.id, reason: 'paid order has no line items — emails will show $0' }));
    }
  } catch (err) {
    console.error('[webhook-fail]', JSON.stringify({ stage: 'email-block', orderId: order.id, error: err?.message || String(err) }));
  }

  console.log('[webhook-ok]', JSON.stringify({ orderId: order.id, squareOrderId, squarePaymentId }));
  return new Response('OK', { status: 200 });
}
