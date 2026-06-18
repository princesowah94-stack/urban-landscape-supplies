// Shared CORS helper for Vercel Functions (Web Request/Response API)
const ALLOWED_ORIGINS = [
  'http://localhost:3001',
  'https://urban-landscape-supplies.vercel.app',
  'https://urbanlandscapesupplies.com.au',
  'https://www.urbanlandscapesupplies.com.au',
];

export function corsHeaders(request) {
  const origin = request.headers.get('origin') || '';
  const headers = {
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
  if (ALLOWED_ORIGINS.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
  }
  return headers;
}

export function optionsResponse(request) {
  return new Response(null, { status: 204, headers: corsHeaders(request) });
}
