import { corsHeaders, handleOptions } from './_cors.js';

export default async function handler(request) {
  const preflight = handleOptions(request);
  if (preflight) return preflight;

  return Response.json(
    {
      status: 'ok',
      environment: process.env.SQUARE_ENVIRONMENT || 'sandbox',
      timestamp: new Date().toISOString(),
    },
    { headers: corsHeaders(request) }
  );
}
