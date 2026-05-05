import { Resend } from 'resend';

// Lazy-init: Resend v4's constructor throws when the API key is missing,
// which would crash every endpoint that imports this module at LOAD time
// (orders, refund, webhook etc.) — even just to render an unauthorized 401.
// Defer construction so module loading is always safe.
let _resend;
function getResend() {
  if (_resend) return _resend;
  if (!process.env.RESEND_API_KEY) {
    throw new Error('RESEND_API_KEY is not set — cannot send email.');
  }
  _resend = new Resend(process.env.RESEND_API_KEY);
  return _resend;
}

const FROM_NAME = 'Urban Landscape Supplies';
const FROM_EMAIL = process.env.EMAIL_FROM || 'orders@urbanlandscapesupplies.com.au';

const fmtMoney = cents => `$${(cents / 100).toFixed(2)}`;
const shortId  = uuid  => uuid?.split('-')[0]?.toUpperCase() || '';

function lineItemsTable(items) {
  const rows = items.map(i => `
    <tr>
      <td style="padding:8px 0;border-bottom:1px solid #eee">${i.name}${i.unit ? ` <span style="color:#888;font-size:13px">(${i.unit})</span>` : ''}</td>
      <td style="padding:8px 0;border-bottom:1px solid #eee;text-align:center">${i.quantity}</td>
      <td style="padding:8px 0;border-bottom:1px solid #eee;text-align:right;font-variant-numeric:tabular-nums">${fmtMoney(i.price_cents * i.quantity)}</td>
    </tr>
  `).join('');
  return `
    <table style="width:100%;border-collapse:collapse;font-size:14px;margin:16px 0">
      <thead>
        <tr style="text-align:left;color:#666;font-size:12px;text-transform:uppercase;letter-spacing:0.05em">
          <th style="padding:8px 0;border-bottom:1px solid #ddd;font-weight:700">Item</th>
          <th style="padding:8px 0;border-bottom:1px solid #ddd;font-weight:700;text-align:center">Qty</th>
          <th style="padding:8px 0;border-bottom:1px solid #ddd;font-weight:700;text-align:right">Subtotal</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function supplierItemsTable(items) {
  const rows = items.map(i => `
    <tr>
      <td style="padding:10px 0;border-bottom:1px solid #eee">${i.name}${i.unit ? ` <span style="color:#888;font-size:13px">(${i.unit})</span>` : ''}</td>
      <td style="padding:10px 0;border-bottom:1px solid #eee;text-align:right;font-weight:700;font-variant-numeric:tabular-nums">${i.quantity}</td>
    </tr>
  `).join('');
  return `
    <table style="width:100%;border-collapse:collapse;font-size:14px;margin:16px 0">
      <thead>
        <tr style="text-align:left;color:#666;font-size:12px;text-transform:uppercase;letter-spacing:0.05em">
          <th style="padding:8px 0;border-bottom:1px solid #ddd;font-weight:700">Item</th>
          <th style="padding:8px 0;border-bottom:1px solid #ddd;font-weight:700;text-align:right">Qty</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function fmtSydneyDateTime(value) {
  if (!value) return '';
  try {
    return new Intl.DateTimeFormat('en-AU', {
      timeZone: 'Australia/Sydney',
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).format(new Date(value));
  } catch {
    return '';
  }
}

function shellHtml({ heading, intro, order, items }) {
  return `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;color:#222">
      <h1 style="font-size:22px;margin:0 0 8px">${heading}</h1>
      <p style="color:#555;line-height:1.5;margin:0 0 24px">${intro}</p>
      <p style="font-size:13px;color:#888;margin:0 0 4px">Order number</p>
      <p style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:16px;font-weight:700;margin:0 0 24px">#${shortId(order.id)}</p>
      ${lineItemsTable(items)}
      <p style="text-align:right;font-size:18px;font-weight:700;margin:8px 0 32px">Total: ${fmtMoney(order.total_cents)}</p>
      ${order.delivery_address ? `
        <p style="font-size:13px;color:#888;margin:0 0 4px;text-transform:uppercase;letter-spacing:0.05em">Delivery to</p>
        <p style="margin:0 0 24px;line-height:1.5">${order.delivery_address}</p>
      ` : ''}
      <hr style="border:none;border-top:1px solid #eee;margin:24px 0">
      <p style="font-size:12px;color:#999;line-height:1.5;margin:0">
        Urban Landscape Supplies · Wetherill Park NSW · 1300 872 267
      </p>
    </div>
  `;
}

export async function sendCustomerOrderEmail({ order, items }) {
  if (!order?.customer_email) return;
  const html = shellHtml({
    heading: 'Thanks for your order!',
    intro: `Hi ${order.customer_name?.split(' ')[0] || 'there'} — we've received your payment and the yard team is preparing your order. We'll be in touch with delivery details shortly.`,
    order, items,
  });
  return getResend().emails.send({
    from: `${FROM_NAME} <${FROM_EMAIL}>`,
    to: order.customer_email,
    subject: `Your Urban Landscape Supplies order #${shortId(order.id)}`,
    html,
  });
}

export async function sendStaffOrderEmail({ order, items }) {
  const to = process.env.EMAIL_TO_STAFF || process.env.EMAIL_TO;
  if (!to) return;
  const html = shellHtml({
    heading: `New order from ${order.customer_name || 'a customer'}`,
    intro: `Payment confirmed via Square. Customer: ${order.customer_email || '—'}${order.customer_phone ? ` · ${order.customer_phone}` : ''}.`,
    order, items,
  });
  return getResend().emails.send({
    from: `${FROM_NAME} <${FROM_EMAIL}>`,
    to,
    replyTo: order.customer_email || undefined,
    subject: `New order #${shortId(order.id)} — ${order.customer_name || 'Unknown'} (${fmtMoney(order.total_cents)})`,
    html,
  });
}

// Sent when admin moves an order from 'paid' -> 'dispatched' in the admin page.
export async function sendCustomerDispatchEmail({ order, items }) {
  if (!order?.customer_email) return;
  const firstName = order.customer_name?.split(' ')[0] || 'there';
  const html = shellHtml({
    heading: 'Your order is on the way',
    intro: `Hi ${firstName} — good news, your order has been dispatched and is heading your way. Standard delivery is 3-5 business days across Sydney metro. Our driver will be in touch on the day if access details are needed.`,
    order, items,
  });
  return getResend().emails.send({
    from: `${FROM_NAME} <${FROM_EMAIL}>`,
    to: order.customer_email,
    bcc: process.env.EMAIL_TO_STAFF || process.env.EMAIL_TO || undefined,
    subject: `Your Urban Landscape Supplies order is on the way #${shortId(order.id)}`,
    html,
  });
}

// Sent when admin issues a refund from the admin page (Refund button).
export async function sendCustomerRefundEmail({ order, items, refundedCents }) {
  if (!order?.customer_email) return;
  const firstName = order.customer_name?.split(' ')[0] || 'there';
  const amount = refundedCents ?? order.total_cents;
  const html = shellHtml({
    heading: 'Refund processed',
    intro: `Hi ${firstName} — we've processed a refund of ${fmtMoney(amount)} for your order. Refunds typically appear in your account within 5–10 business days, depending on your bank. If anything looks off, just reply to this email and we'll sort it out.`,
    order: { ...order, total_cents: amount },
    items,
  });
  return getResend().emails.send({
    from: `${FROM_NAME} <${FROM_EMAIL}>`,
    to: order.customer_email,
    bcc: process.env.EMAIL_TO_STAFF || process.env.EMAIL_TO || undefined,
    subject: `Refund processed — Urban Landscape Supplies #${shortId(order.id)}`,
    html,
  });
}

// Sent on the 'paid' webhook to the third-party fulfilment supplier so they
// can pick & dispatch. Branded as ULS, no pricing visible. Silently no-ops
// when SUPPLIER_NOTIFICATION_EMAIL is unset (safe to deploy without configuring).
// Comma-separated env value fans out to multiple recipients.
export async function sendSupplierOrderEmail({ order, items }) {
  const recipients = (process.env.SUPPLIER_NOTIFICATION_EMAIL || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  if (recipients.length === 0) {
    console.warn('SUPPLIER_NOTIFICATION_EMAIL not configured — skipping supplier email.');
    return;
  }

  const placedAt = fmtSydneyDateTime(order.created_at);
  const customerName = order.customer_name || 'Customer';
  const phone = order.customer_phone;
  const address = order.delivery_address;
  const notes = order.notes;

  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;color:#222">
      <h1 style="font-size:22px;margin:0 0 4px">New order to fulfil</h1>
      <p style="color:#888;font-size:13px;margin:0 0 24px">Order #${shortId(order.id)}${placedAt ? ` · placed ${placedAt}` : ''}</p>

      <div style="background:#f6f6f4;border-radius:8px;padding:16px;margin:0 0 20px">
        <p style="font-size:12px;color:#666;margin:0 0 6px;text-transform:uppercase;letter-spacing:0.05em">Deliver to</p>
        <p style="font-size:16px;font-weight:700;margin:0 0 8px;line-height:1.4;white-space:pre-wrap">${address || '<span style="color:#b00">No address provided</span>'}</p>
        <p style="font-size:14px;margin:0;color:#444">
          ${customerName}${phone ? ` · <a href="tel:${phone}" style="color:#222;text-decoration:none;font-weight:600">${phone}</a>` : ''}
        </p>
      </div>

      <p style="font-size:12px;color:#888;margin:0 0 4px;text-transform:uppercase;letter-spacing:0.05em">Items to load</p>
      ${supplierItemsTable(items)}

      ${notes ? `
        <div style="background:#fff8e1;border-left:4px solid #ffb300;padding:12px 16px;margin:20px 0;border-radius:4px">
          <p style="font-size:12px;color:#8a6300;margin:0 0 6px;text-transform:uppercase;letter-spacing:0.05em;font-weight:700">Customer note</p>
          <p style="font-size:14px;margin:0;color:#5a3f00;line-height:1.5;white-space:pre-wrap">${notes}</p>
        </div>
      ` : ''}

      <p style="font-size:14px;color:#444;margin:24px 0 0;line-height:1.5">
        <strong>Please contact the customer 1 hour before delivery.</strong>
      </p>

      <hr style="border:none;border-top:1px solid #eee;margin:24px 0">
      <p style="font-size:12px;color:#999;line-height:1.5;margin:0">
        Urban Landscape Supplies · Wetherill Park NSW · 1300 872 267<br>
        Automated dispatch notification — reply to reach the ULS office.
      </p>
    </div>
  `;

  return getResend().emails.send({
    from: `${FROM_NAME} <${FROM_EMAIL}>`,
    to: recipients,
    replyTo: process.env.EMAIL_TO_STAFF || process.env.EMAIL_TO || undefined,
    subject: `New order to fulfil — #${shortId(order.id)} — ${customerName}`,
    html,
  });
}
