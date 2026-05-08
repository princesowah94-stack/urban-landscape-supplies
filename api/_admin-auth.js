/**
 * Shared admin auth — Supabase Auth backed.
 *
 * The admin page uses Supabase magic-link login. After login the browser holds
 * a JWT access token, which it sends as `Authorization: Bearer <jwt>` on every
 * admin API call. This helper:
 *
 *   1. Verifies the JWT via Supabase (`auth.getUser(token)`).
 *   2. Looks up the user's row in `admin_profiles`. If absent or `is_active=false`,
 *      the request is denied — being a Supabase auth user isn't enough; you
 *      have to be on the allowlist too.
 *   3. Returns `{ user, profile }` so callers can use the actor identity for
 *      audit-log entries.
 *
 * Replaces the old shared-password / SHA-256 token scheme.
 */
import { corsHeaders } from './_cors.js';
import { supabase } from './_supabase.js';

/**
 * Authenticate the request. Returns one of:
 *   { ok: true, user, profile }       — call can proceed
 *   { ok: false, response }           — caller should immediately return this Response
 */
export async function authenticateAdmin(request) {
  const header = request.headers.get('authorization') || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return {
      ok: false,
      response: Response.json(
        { error: 'Unauthorized', message: 'Missing bearer token' },
        { status: 401, headers: corsHeaders(request) }
      ),
    };
  }

  const token = match[1].trim();

  // Verify JWT with Supabase. supabase.auth.getUser(token) returns the user
  // identified by the access token, or { data: { user: null }, error } if invalid.
  const { data: { user }, error: jwtErr } = await supabase.auth.getUser(token);
  if (jwtErr || !user) {
    return {
      ok: false,
      response: Response.json(
        { error: 'Unauthorized', message: 'Invalid or expired session' },
        { status: 401, headers: corsHeaders(request) }
      ),
    };
  }

  // Look up the admin profile to check membership. Being a Supabase auth user
  // isn't enough — you must also be on the allowlist (admin_profiles row).
  const { data: profile, error: profileErr } = await supabase
    .from('admin_profiles')
    .select('id, display_name, role, is_active')
    .eq('id', user.id)
    .maybeSingle();

  if (profileErr) {
    console.error('[admin-auth-fail]', JSON.stringify({ stage: 'profile-lookup', userId: user.id, error: profileErr.message }));
    return {
      ok: false,
      response: Response.json(
        { error: 'Server error', message: 'Could not verify admin profile' },
        { status: 500, headers: corsHeaders(request) }
      ),
    };
  }

  if (!profile || !profile.is_active) {
    console.warn('[admin-auth-fail]', JSON.stringify({ stage: 'not-allowlisted', userId: user.id, email: user.email }));
    return {
      ok: false,
      response: Response.json(
        { error: 'Forbidden', message: 'Your account is not on the admin allowlist. Contact Prince to be added.' },
        { status: 403, headers: corsHeaders(request) }
      ),
    };
  }

  return { ok: true, user, profile };
}

/**
 * Backwards-compat shim for handlers that prefer the early-return pattern.
 * Returns a Response on failure, or null on success — but loses the user/profile
 * info. New callers should prefer `authenticateAdmin` so they can write audit
 * log entries with the actor's identity.
 *
 * NOTE: this returns a Promise now (was sync). All call sites must `await`.
 */
export async function requireAdmin(request) {
  const result = await authenticateAdmin(request);
  return result.ok ? null : result.response;
}
