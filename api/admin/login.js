/**
 * POST /api/admin/login
 * Body: { password }
 * Returns: { token }   ← SHA-256 of ADMIN_PASSWORD; client sends as Bearer on every call
 */
import { timingSafeEqual } from 'node:crypto';
import { corsHeaders, optionsResponse } from '../_cors.js';
import { expectedToken } from '../_admin-auth.js';

export function OPTIONS(request) {
  return optionsResponse(request);
}

export async function POST(request) {
  try {
    const { password } = await request.json();
    const stored = process.env.ADMIN_PASSWORD;

    if (!stored) {
      return Response.json(
        { error: 'Server misconfigured', message: 'ADMIN_PASSWORD not set' },
        { status: 500, headers: corsHeaders(request) }
      );
    }

    const a = Buffer.from(String(password || ''), 'utf8');
    const b = Buffer.from(stored, 'utf8');
    const ok = a.length === b.length && timingSafeEqual(a, b);

    // Tiny constant-ish delay to blunt brute-force timing
    await new Promise(r => setTimeout(r, 250));

    if (!ok) {
      return Response.json(
        { error: 'Invalid password' },
        { status: 401, headers: corsHeaders(request) }
      );
    }

    return Response.json(
      { token: expectedToken() },
      { headers: corsHeaders(request) }
    );

  } catch (err) {
    console.error('Admin login error:', err);
    return Response.json(
      { error: 'Server error' },
      { status: 500, headers: corsHeaders(request) }
    );
  }
}
