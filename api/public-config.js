/**
 * GET /api/public-config
 *
 * Returns Supabase URL + anon key for the browser to initialise its own
 * Supabase client (used by admin.html magic-link login). Both values are
 * non-secret — the anon key is designed for public client-side use; RLS
 * policies and admin_profiles allowlist enforce real access control.
 *
 * Cached for 5 minutes since these values change rarely.
 */
import { corsHeaders, optionsResponse } from './_cors.js';

export function OPTIONS(request) {
  return optionsResponse(request);
}

export async function GET(request) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return Response.json(
      { error: 'Server misconfigured', message: 'SUPABASE_URL and SUPABASE_ANON_KEY must both be set as Vercel env vars.' },
      { status: 500, headers: corsHeaders(request) }
    );
  }

  return Response.json(
    { supabaseUrl, supabaseAnonKey },
    {
      headers: {
        ...corsHeaders(request),
        'Cache-Control': 'public, max-age=300',
      },
    }
  );
}
