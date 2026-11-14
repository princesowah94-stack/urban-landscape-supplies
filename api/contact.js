import nodemailer from 'nodemailer';
import { corsHeaders, optionsResponse } from './_cors.js';
import { supabase } from './_supabase.js';
import { str, text, isEmail } from './_validate.js';

const SUBJECT_LABELS = {
  order: 'Order enquiry',
  delivery: 'Delivery question',
  bulk: 'Bulk order enquiry',
  trade: 'Trade account',
  product: 'Product advice',
  other: 'Other',
};

export function OPTIONS(request) {
  return optionsResponse(request);
}

export async function POST(request) {
  try {
    const b = await request.json();
    const name    = str(b?.name, 120);
    const email   = str(b?.email, 254);
    const phone   = str(b?.phone, 40);
    const subject = str(b?.subject, 40);
    const message = text(b?.message, 5000);

    if (!name || !isEmail(email) || !message) {
      return Response.json(
        { error: 'Name, valid email and message are required' },
        { status: 400, headers: corsHeaders(request) }
      );
    }

    const safeReplyTo = email;

    const transport = nodemailer.createTransport({
      host: process.env.EMAIL_HOST || 'smtp.gmail.com',
      port: parseInt(process.env.EMAIL_PORT, 10) || 587,
      secure: false,
      auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
      // Give up on a stuck mail server quickly: nodemailer's defaults wait minutes.
      connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000,
    });

    const safeSubject = SUBJECT_LABELS[subject] || 'General';
    const safeName    = String(name).replace(/[\r\n]/g, '');

    // Save and email side by side, and wait for both. The enquiry only counts as
    // lost when BOTH fail: a failed email must not stop the save, and the other
    // way round. (The function can be frozen once we respond, so nothing is left running.)
    const [saved, mailed] = await Promise.allSettled([
      (async () => {
        const { error } = await supabase.from('contacts').insert({
          name, email,
          phone: phone || null,
          message,
          source: subject ? `contact-form:${subject}` : 'contact-form',
        }).abortSignal(AbortSignal.timeout(8000)); // a stuck database must not hold the page open
        if (error) throw new Error(error.message);
      })(),
      transport.sendMail({
        from: `"${process.env.EMAIL_FROM_NAME || 'ULS Website'}" <${process.env.EMAIL_FROM}>`,
        to: process.env.EMAIL_TO,
        replyTo: safeReplyTo,
        subject: `Website Contact [${safeSubject}] — ${safeName}`,
        text: [
          `Name:    ${name}`,
          `Email:   ${email}`,
          `Phone:   ${phone || 'Not provided'}`,
          `Subject: ${SUBJECT_LABELS[subject] || subject || 'General'}`,
          ``,
          message,
        ].join('\n'),
      }),
    ]);
    if (saved.status === 'rejected') console.error('Supabase contact insert error:', saved.reason?.message);
    if (mailed.status === 'rejected') console.error('Contact email error:', mailed.reason?.message);
    if (saved.status === 'rejected' && mailed.status === 'rejected') {
      throw new Error('Contact enquiry neither saved nor emailed');
    }

    return Response.json({ success: true }, { headers: corsHeaders(request) });

  } catch (err) {
    console.error('Contact form error:', err);
    return Response.json(
      { error: 'Failed to send message' },
      { status: 500, headers: corsHeaders(request) }
    );
  }
}
