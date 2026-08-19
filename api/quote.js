import nodemailer from 'nodemailer';
import { waitUntil } from '@vercel/functions';
import { corsHeaders, optionsResponse } from './_cors.js';
import { supabase } from './_supabase.js';
import { str, text, num, isEmail } from './_validate.js';

// Coerce empty strings / undefined to null so DATE columns don't choke
const orNull = (v) => (v === '' || v === undefined ? null : v);

export function OPTIONS(request) {
  return optionsResponse(request);
}

export async function POST(request) {
  try {
    const body = await request.json();
    const rawItems = body?.items;
    const delivery = body?.delivery && typeof body.delivery === 'object' ? body.delivery : {};
    const contact  = body?.contact  && typeof body.contact  === 'object' ? body.contact  : {};

    if (!Array.isArray(rawItems) || rawItems.length === 0 || rawItems.length > 50) {
      return Response.json({ error: 'No items in quote' }, { status: 400, headers: corsHeaders(request) });
    }
    if (!isEmail(contact.email) || !str(contact.phone, 40)) {
      return Response.json({ error: 'Valid email and phone required' }, { status: 400, headers: corsHeaders(request) });
    }

    // Sanitise everything we echo into emails / DB. Quote prices are indicative
    // only (staff confirm), but still bounded so a bad payload can't blow up totals.
    const items = rawItems.map(i => ({
      id:       str(i?.id, 100),
      name:     str(i?.name, 150),
      unit:     str(i?.unit, 40),
      price:    num(i?.price,    { min: 0, max: 100000 }),
      quantity: num(i?.quantity, { min: 0.01, max: 10000, fallback: 1 }),
    }));
    contact.firstName = str(contact.firstName, 80);
    contact.lastName  = str(contact.lastName, 80);
    contact.phone     = str(contact.phone, 40);
    contact.company   = str(contact.company, 120);
    contact.notes     = text(contact.notes, 2000);
    delivery.address  = str(delivery.address, 200);
    delivery.suburb   = str(delivery.suburb, 80);
    delivery.postcode = str(delivery.postcode, 10);
    delivery.access   = text(delivery.access, 2000);
    delivery.notes    = text(delivery.notes, 2000);

    const safeReplyTo    = contact.email;
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
        replyTo: safeReplyTo,
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
          `Questions? Call ${process.env.PHONE_NUMBER || '1300 872 267'}`,
          ``,
          `The Urban Landscape Supplies Team`,
          `Sydney NSW · urbanlandscapesupplies.com.au`,
        ].join('\n'),
      }),
    ]);

    // Persist the quote to Supabase after the response (waitUntil keeps the
    // function alive long enough for the insert to complete).
    waitUntil((async () => {
      const { error } = await supabase.from('quotes').insert({
        reference_id:          referenceId,
        contact_first_name:    contact.firstName || null,
        contact_last_name:     contact.lastName || null,
        contact_email:         contact.email,
        contact_phone:         contact.phone || null,
        is_trade:              !!contact.isTrade,
        delivery_address:      delivery?.address || null,
        delivery_suburb:       delivery?.suburb || null,
        delivery_postcode:     delivery?.postcode || null,
        delivery_date_from:    orNull(delivery?.dateFrom),
        delivery_date_to:      orNull(delivery?.dateTo),
        delivery_access:       delivery?.access || null,
        notes:                 contact.notes || null,
        items,
        estimated_total_cents: Math.round(estimatedTotal * 100),
        status:                'new',
      });
      if (error) console.error('Supabase quotes insert error:', error.message);
    })());

    return Response.json({ success: true, referenceId }, { headers: corsHeaders(request) });

  } catch (err) {
    console.error('Quote email error:', err);
    return Response.json(
      { error: 'Failed to send quote', message: 'Please call 1300 872 267' },
      { status: 500, headers: corsHeaders(request) }
    );
  }
}
