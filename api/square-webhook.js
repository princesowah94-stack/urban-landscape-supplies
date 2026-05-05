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
    console.warn('Square webhook signature mismatch — rejecting');
    return new Response('Invalid signature', { status: 401 });
  }

  let event;
  try { event = JSON.parse(rawBody); }
  catch { return new Response('Bad JSON', { status: 400 }); }

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
    console.warn(`Webhook: no Supabase order for Square order ${squareOrderId}`);
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
    console.error('Webhook: failed to mark order paid:', updateErr.message);
    // Return 500 so Square retries the webhook once Supabase is back.
    return new Response('DB error', { status: 500 });
  }

  // Pull line items + send the two emails. Email errors must NOT fail the webhook.
  try {
    const { data: items } = await supabase
      .from('order_items')
      .select('product_id, name, quantity, price_cents')
      .eq('order_id', order.id);

    const updatedOrder = { ...order, status: 'paid', square_payment_id: squarePaymentId };
    await Promise.allSettled([
      sendCustomerOrderEmail({ order: updatedOrder, items: items || [] }),
      sendStaffOrderEmail({ order: updatedOrder, items: items || [] }),
      sendSupplierOrderEmail({ order: updatedOrder, items: items || [] }),
    ]);
  } catch (err) {
    console.error('Webhook: email send failed (order is still marked paid):', err);
  }

  return new Response('OK', { status: 200 });
}
