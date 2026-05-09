/**
 * Single dispatcher for /api/admin/* — keeps us under the Vercel Hobby plan's
 * 12-function-per-project cap by routing all admin endpoints through one
 * Vercel Function file.
 *
 * Vercel maps `[action].js` to any single path segment, so:
 *   /api/admin/orders     → action = "orders"
 *   /api/admin/quotes     → action = "quotes"
 *   /api/admin/audit-log  → action = "audit-log"
 *   …etc
 *
 * The actual handler logic lives in `_handlers/<action>.js` (underscore prefix
 * = private module, not deployed as its own function). Each handler module
 * exports plain `GET`/`POST` functions that take a `Request` and return a
 * `Response` — same signature as a Vercel Function handler, so moving them
 * was a pure rename.
 */
import { corsHeaders, optionsResponse } from '../_cors.js';

import * as ordersHandler    from './_handlers/orders.js';
import * as refundHandler    from './_handlers/refund.js';
import * as auditLogHandler  from './_handlers/audit-log.js';
import * as editOrderHandler from './_handlers/edit-order.js';
import * as quotesHandler    from './_handlers/quotes.js';
import * as contactsHandler  from './_handlers/contacts.js';
import * as statsHandler     from './_handlers/stats.js';

const HANDLERS = {
  'orders':     ordersHandler,
  'refund':     refundHandler,
  'audit-log':  auditLogHandler,
  'edit-order': editOrderHandler,
  'quotes':     quotesHandler,
  'contacts':   contactsHandler,
  'stats':      statsHandler,
};

// Pull `action` out of the request URL. Vercel routes `/api/admin/<action>` to
// this file but doesn't surface the path param to plain JS handlers — we parse
// it from the URL ourselves.
function actionFromRequest(request) {
  const path = new URL(request.url).pathname;
  // Path looks like `/api/admin/orders` → last segment is the action
  const segments = path.split('/').filter(Boolean);
  return segments[segments.length - 1] || '';
}

function notFound(request, action) {
  return Response.json(
    { error: 'Unknown admin action', message: `No handler for "${action}"` },
    { status: 404, headers: corsHeaders(request) }
  );
}

function methodNotAllowed(request, action, method) {
  return Response.json(
    { error: 'Method not allowed', message: `${method} is not supported on /api/admin/${action}` },
    { status: 405, headers: corsHeaders(request) }
  );
}

export function OPTIONS(request) {
  return optionsResponse(request);
}

export async function GET(request) {
  const action = actionFromRequest(request);
  const mod = HANDLERS[action];
  if (!mod) return notFound(request, action);
  if (typeof mod.GET !== 'function') return methodNotAllowed(request, action, 'GET');
  return mod.GET(request);
}

export async function POST(request) {
  const action = actionFromRequest(request);
  const mod = HANDLERS[action];
  if (!mod) return notFound(request, action);
  if (typeof mod.POST !== 'function') return methodNotAllowed(request, action, 'POST');
  return mod.POST(request);
}
