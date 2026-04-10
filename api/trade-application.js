import nodemailer from 'nodemailer';
import { corsHeaders, handleOptions } from './_cors.js';

export default async function handler(request) {
  const preflight = handleOptions(request);
  if (preflight) return preflight;

  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  try {
    const { business, abn, firstName, lastName, email, phone, businessType, address, notes } = await request.json();

    if (!business || !email || !phone) {
      return Response.json(
        { error: 'Business name, email and phone are required' },
        { status: 400, headers: corsHeaders(request) }
      );
    }

    const referenceId = 'TRD-' + Date.now().toString(36).toUpperCase();
    const from        = `"${process.env.EMAIL_FROM_NAME || 'Urban Landscape Supplies'}" <${process.env.EMAIL_FROM}>`;

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
        replyTo: email,
        subject: `Trade Application [${referenceId}] — ${business}`,
        text: [
          `TRADE ACCOUNT APPLICATION`,
          `Reference: ${referenceId}`,
          ``,
          `Business: ${business}`,
          `ABN:      ${abn || 'N/A'}`,
          `Type:     ${businessType || 'N/A'}`,
          `Address:  ${address || 'N/A'}`,
          ``,
          `Contact: ${firstName} ${lastName}`,
          `Email:   ${email}`,
          `Phone:   ${phone}`,
          `Notes:   ${notes || 'None'}`,
        ].join('\n'),
      }),
      transport.sendMail({
        from,
        to: email,
        subject: `Trade Application Received [${referenceId}] — Urban Landscape Supplies`,
        text: [
          `Hi ${firstName},`,
          ``,
          `Your trade application (ref: ${referenceId}) has been received.`,
          `We'll be in touch within 1 business day to discuss your account terms.`,
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
    console.error('Trade application error:', err);
    return Response.json(
      { error: 'Failed to submit application' },
      { status: 500, headers: corsHeaders(request) }
    );
  }
}
