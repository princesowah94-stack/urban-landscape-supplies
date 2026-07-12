import { corsHeaders, optionsResponse } from './_cors.js';

export function OPTIONS(request) {
  return optionsResponse(request);
}

export function GET(request) {
  return Response.json(
    {
      status: 'ok',
      environment: process.env.SQUARE_ENVIRONMENT || 'sandbox',
      timestamp: new Date().toISOString(),
    },
    { headers: corsHeaders(request) }
  );
}

// Temporary client-side diagnostic reporter (see index.html inline script).
// Logs to Vercel function logs only — no database write, no PII stored.
export async function POST(request) {
  try {
    const body = await request.json();
    const ua = request.headers.get('user-agent') || 'unknown';
    console.log('[client-diagnostic]', JSON.stringify({ ...body, userAgent: ua, ts: new Date().toISOString() }));
    return Response.json({ ok: true }, { headers: corsHeaders(request) });
  } catch (err) {
    console.error('[client-diagnostic] failed to parse report:', err.message);
    return Response.json({ ok: false }, { status: 400, headers: corsHeaders(request) });
  }
}
