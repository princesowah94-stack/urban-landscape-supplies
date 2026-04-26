/**
 * Shared admin auth.
 * Token = SHA-256(ADMIN_PASSWORD). Server recomputes on every request and
 * timing-safe compares against the bearer token sent by the admin page.
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import { corsHeaders } from './_cors.js';

export function expectedToken() {
  const pw = process.env.ADMIN_PASSWORD;
  if (!pw) throw new Error('ADMIN_PASSWORD env var is not set');
  return createHash('sha256').update(pw).digest('hex');
}

export function safeEqualHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
  } catch {
    return false;
  }
}

export function requireAdmin(request) {
  let expected;
  try {
    expected = expectedToken();
  } catch (e) {
    return Response.json(
      { error: 'Server misconfigured', message: e.message },
      { status: 500, headers: corsHeaders(request) }
    );
  }

  const header = request.headers.get('authorization') || '';
  const match = header.match(/^Bearer\s+([a-f0-9]+)$/i);
  if (!match || !safeEqualHex(match[1].toLowerCase(), expected)) {
    return Response.json(
      { error: 'Unauthorized' },
      { status: 401, headers: corsHeaders(request) }
    );
  }
  return null;
}
