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
