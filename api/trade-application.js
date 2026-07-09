import nodemailer from 'nodemailer';
import { corsHeaders, optionsResponse } from './_cors.js';
import { supabase } from './_supabase.js';

export function OPTIONS(request) {
  return optionsResponse(request);
}

export async function POST(request) {
  try {
    const { business, abn, firstName, lastName, email, phone, businessType, spend, notes } = await request.json();

    if (!business || !email || !phone) {
      return Response.json(
        { error: 'Business name, email and phone are required' },
        { status: 400, headers: corsHeaders(request) }
      );
    }

    const emailRegex  = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const safeReplyTo = emailRegex.test(email) ? email : undefined;
    const referenceId = 'TRD-' + Date.now().toString(36).toUpperCase();
    const from = `"${process.env.EMAIL_FROM_NAME || 'Urban Landscape Supplies'}" <${process.env.EMAIL_FROM}>`;
    const safeBusiness = String(business).replace(/[\r\n]/g, '');

    // The Supabase insert is the source of truth — an application only counts
    // as received once this row exists. Emails are best-effort on top.
    const { error: dbError } = await supabase.from('trade_applications').insert({
      company_name:     business,
      contact_name:     `${firstName} ${lastName}`.trim(),
      email,
      phone,
      abn:              abn || null,
      business_type:    businessType || null,
      annual_spend:     spend || null,
      notes:            notes || null,
      status:           'pending',
    });
    if (dbError) console.error('[trade-fail] Supabase insert failed:', dbError.message);

    const transport = nodemailer.createTransport({
      host: process.env.EMAIL_HOST || 'smtp.gmail.com',
      port: parseInt(process.env.EMAIL_PORT, 10) || 587,
      secure: false,
      auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
    });

    const emailResults = await Promise.allSettled([
      transport.sendMail({
        from,
        to: process.env.EMAIL_TO,
        replyTo: safeReplyTo,
        subject: `Trade Application [${referenceId}] — ${safeBusiness}`,
        text: [
          `TRADE ACCOUNT APPLICATION`,
          `Reference: ${referenceId}`,
          ``,
          `Business: ${business}`,
          `ABN:      ${abn || 'N/A'}`,
          `Type:     ${businessType || 'N/A'}`,
          `Est. monthly spend: ${spend || 'N/A'}`,
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
          `We'll review it and be in touch within 2 business days.`,
          ``,
          `Questions? Call ${process.env.PHONE_NUMBER || '1300 872 267'}`,
          ``,
          `The Urban Landscape Supplies Team`,
          `Sydney NSW · urbanlandscapesupplies.com.au`,
        ].join('\n'),
      }),
    ]);
    const staffEmailOk = emailResults[0].status === 'fulfilled';
    emailResults.forEach((r, i) => {
      if (r.status === 'rejected') console.error(`[trade-fail] ${i === 0 ? 'staff' : 'applicant'} email failed:`, r.reason?.message);
    });

    // Success requires at least one durable record of the application:
    // the DB row, or failing that, the staff notification email.
    if (dbError && !staffEmailOk) {
      return Response.json(
        { error: 'Failed to submit application' },
        { status: 500, headers: corsHeaders(request) }
      );
    }

    return Response.json({ success: true, referenceId }, { headers: corsHeaders(request) });

  } catch (err) {
    console.error('[trade-fail] Trade application error:', err);
    return Response.json(
      { error: 'Failed to submit application' },
      { status: 500, headers: corsHeaders(request) }
    );
  }
}
