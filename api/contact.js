import nodemailer from 'nodemailer';
import { corsHeaders, handleOptions } from './_cors.js';

const SUBJECT_LABELS = {
  order: 'Order enquiry',
  delivery: 'Delivery question',
  bulk: 'Bulk order enquiry',
  trade: 'Trade account',
  product: 'Product advice',
  other: 'Other',
};

export default async function handler(request) {
  const preflight = handleOptions(request);
  if (preflight) return preflight;

  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  try {
    const { name, email, phone, subject, message } = await request.json();

    if (!name || !email || !message) {
      return Response.json(
        { error: 'Name, email and message are required' },
        { status: 400, headers: corsHeaders(request) }
      );
    }

    const transport = nodemailer.createTransport({
      host: process.env.EMAIL_HOST || 'smtp.gmail.com',
      port: parseInt(process.env.EMAIL_PORT, 10) || 587,
      secure: false,
      auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
    });

    await transport.sendMail({
      from: `"${process.env.EMAIL_FROM_NAME || 'ULS Website'}" <${process.env.EMAIL_FROM}>`,
      to: process.env.EMAIL_TO,
      replyTo: email,
      subject: `Website Contact [${SUBJECT_LABELS[subject] || subject || 'General'}] — ${name}`,
      text: [
        `Name:    ${name}`,
        `Email:   ${email}`,
        `Phone:   ${phone || 'Not provided'}`,
        `Subject: ${SUBJECT_LABELS[subject] || subject || 'General'}`,
        ``,
        message,
      ].join('\n'),
    });

    return Response.json({ success: true }, { headers: corsHeaders(request) });

  } catch (err) {
    console.error('Contact form error:', err);
    return Response.json(
      { error: 'Failed to send message' },
      { status: 500, headers: corsHeaders(request) }
    );
  }
}
