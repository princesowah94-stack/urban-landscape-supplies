import nodemailer from 'nodemailer';
import { corsHeaders, optionsResponse } from './_cors.js';

export function OPTIONS(request) {
  return optionsResponse(request);
}

export async function POST(request) {
  try {
    const { items, delivery, contact } = await request.json();

    if (!items || items.length === 0) {
      return Response.json({ error: 'No items in quote' }, { status: 400, headers: corsHeaders(request) });
    }
    if (!contact?.email || !contact?.phone) {
      return Response.json({ error: 'Contact details required' }, { status: 400, headers: corsHeaders(request) });
    }

    const referenceId    = 'BQ-' + Date.now().toString(36).toUpperCase();
    const itemsTable     = items.map(i => `  • ${i.name}: ${i.quantity} ${i.unit} (est. $${(i.price * i.quantity).toFixed(2)})`).join('\n');
    const estimatedTotal = items.reduce((s, i) => s + (i.price || 0) * (i.quantity || 1), 0);
    const deliveryLine   = `${delivery?.address || ''}${delivery?.suburb ? ', ' + delivery.suburb : ''}${delivery?.postcode ? ' ' + delivery.postcode : ''}`;
    const from           = `"${process.env.EMAIL_FROM_NAME || 'Urban Landscape Supplies'}" <${process.env.EMAIL_FROM}>`;

    const transport = nodemailer.createTransport({
      host: process.env.EMAIL_HOST || 'smtp.gmail.com',
      port: parseInt(process.env.EMAIL_PORT, 10) || 587,
      secure: false,
      auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
    });

    await Promise.all([
      transport.sendMail({
        from,
        to: process.env.EMAIL_TO,
        replyTo: contact.email,
        subject: `New Bulk Quote [${referenceId}] — ${contact.firstName} ${contact.lastName}`,
        text: [
          `NEW BULK QUOTE REQUEST`,
          `Reference: ${referenceId}`,
          `Submitted: ${new Date().toLocaleString('en-AU', { timeZone: 'Australia/Sydney' })}`,
          ``,
          `MATERIALS`,
          itemsTable,
          `Estimated total: $${estimatedTotal.toFixed(2)} AUD`,
          ``,
          `DELIVERY`,
          deliveryLine,
          `Window: ${delivery?.dateFrom || 'flexible'} → ${delivery?.dateTo || 'flexible'}`,
          `Access: ${delivery?.access || 'None'}`,
          ``,
          `CUSTOMER`,
          `${contact.firstName} ${contact.lastName}`,
          `${contact.email} | ${contact.phone}`,
          `Trade: ${contact.isTrade ? 'Yes' : 'No'}`,
          `Notes: ${contact.notes || 'None'}`,
        ].join('\n'),
      }),
      transport.sendMail({
        from,
        to: contact.email,
        subject: `Your Bulk Quote Request [${referenceId}] — Urban Landscape Supplies`,
        text: [
          `Hi ${contact.firstName},`,
          ``,
          `Thanks for your bulk quote request! Your reference is: ${referenceId}`,
          ``,
          `We'll be in touch within 2 business hours to confirm pricing and delivery.`,
          ``,
          `YOUR ITEMS`,
          itemsTable,
          ``,
          `Delivery: ${deliveryLine}`,
          `Preferred window: ${delivery?.dateFrom || 'flexible'} → ${delivery?.dateTo || 'flexible'}`,
          ``,
          `Questions? Call 1300 872 267`,
          ``,
          `The Urban Landscape Supplies Team`,
          `Sydney NSW · urbanlandscapesupplies.com.au`,
        ].join('\n'),
      }),
    ]);

    return Response.json({ success: true, referenceId }, { headers: corsHeaders(request) });

  } catch (err) {
    console.error('Quote email error:', err);
    return Response.json(
      { error: 'Failed to send quote', message: 'Please call 1300 872 267' },
      { status: 500, headers: corsHeaders(request) }
    );
  }
}
