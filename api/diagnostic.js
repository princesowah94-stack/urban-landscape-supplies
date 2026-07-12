import { corsHeaders, optionsResponse } from './_cors.js';

// Lightweight client-side diagnostic reporter. Logs to Vercel function logs
// so we can see exactly what a specific visitor's browser experienced
// (stylesheet load failures, UA, connection info) without needing them to
// describe it themselves. No PII stored, no database write — logs only.
export function OPTIONS(request) {
  return optionsResponse(request);
}

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
