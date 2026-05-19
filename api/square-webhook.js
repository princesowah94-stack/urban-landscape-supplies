/**
 * Square webhook receiver — subscribed to: payment.updated
 *
 * Square retries on any non-2xx response, so we ALWAYS return 200 once
 * we've done our signature check — even on failures we can't recover from.
 * The only exception is a Supabase write failure (500), which tells Square
 * to retry so we don't lose the "mark paid" step.
 */
import crypto from 'node:crypto';
import { supabase } from './_supabase.js';
import { sendCustomerOrderEmail, sendStaffOrderEmail, sendSupplierOrderEmail } from './_email.js';

function verifySignature(rawBody, signatureHeader, notificationUrl) {
  const key = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY;
  if (!key || !signatureHeader) return false;

  const expected = crypto
    .createHmac('sha256', key)
    .update(notificationUrl + rawBody)
    .digest('base64');

  try {
    const a = Buffer.from(expected);
    const b = Buffer.from(signatureHeader);
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export async function POST(request) {
  const rawBody = await request.text();
  const signatureHeader = request.headers.get('x-square-hmacsha256-signature');

  const notificationUrl =
    process.env.SQUARE_WEBHOOK_URL ||
    `${process.env.SITE_URL || 'https://urbanlandscapesupplies.com.au'}/api/square-webhook`;

  // Return 200 on bad signature — returning non-2xx causes Square to retry indefinitely
  if (!verifySignature(rawBody, signatureHeader, notificationUrl)) {
    console.warn('[webhook] signature mismatch — ignoring');
    return new Response('OK', { status: 200 });
  }

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    console.warn('[webhook] invalid JSON body');
    return new Response('OK', { status: 200 });
  }

  // Only process completed payments
  if (event?.type !== 'payment.updated') return new Response('OK', { status: 200 });
  const payment = event?.data?.object?.payment;
  if (payment?.status !== 'COMPLETED') return new Response('OK', { status: 200 });

  const squareOrderId   = payment.order_id;
  const squarePaymentId = payment.id;
  if (!squareOrderId) return new Response('OK', { status: 200 });

  // Look up our order by the Square order ID
  const { data: order, error: lookupErr } = await supabase
    .from('orders')
    .select('*')
    .eq('square_order_id', squareOrderId)
    .single();

  if (lookupErr || !order) {
    console.warn('[webhook] order not found for square_order_id:', squareOrderId);
    return new Response('OK', { status: 200 });
  }

  // Idempotency guard — Square may retry; don't double-process or double-email
  if (order.status === 'paid') {
    console.log('[webhook] already paid — skipping:', order.id);
    return new Response('OK', { status: 200 });
  }

  // Mark the order as paid — return 500 here so Square retries if the DB is down
  const { error: updateErr } = await supabase
    .from('orders')
    .update({ status: 'paid', square_payment_id: squarePaymentId })
    .eq('id', order.id);

  if (updateErr) {
    console.error('[webhook] failed to mark order paid:', order.id, updateErr.message);
    return new Response('DB error', { status: 500 });
  }

  // Send emails — failures must NOT cause Square retries (hence Promise.allSettled + try/catch)
  try {
    const { data: items } = await supabase
      .from('order_items')
      .select('product_id, name, quantity, price_cents')
      .eq('order_id', order.id);

    const paidOrder = { ...order, status: 'paid', square_payment_id: squarePaymentId };

    const results = await Promise.allSettled([
      sendCustomerOrderEmail({ order: paidOrder, items: items || [] }),
      sendStaffOrderEmail({ order: paidOrder, items: items || [] }),
      sendSupplierOrderEmail({ order: paidOrder, items: items || [] }),
    ]);

    ['customer', 'staff', 'supplier'].forEach((recipient, i) => {
      if (results[i].status === 'rejected') {
        console.error(`[webhook] ${recipient} email failed for order ${order.id}:`, results[i].reason?.message);
      }
    });
  } catch (err) {
    console.error('[webhook] email block failed for order', order.id, ':', err.message);
  }

  console.log('[webhook] order paid OK:', order.id, 'square_payment_id:', squarePaymentId);
  return new Response('OK', { status: 200 });
}
