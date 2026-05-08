/**
 * Append an entry to order_audit_log.
 *
 * Called from every admin endpoint that mutates an order (status transition,
 * refund, edit). Failures are logged but never thrown — losing an audit entry
 * shouldn't roll back the underlying action it was logging.
 */
import { supabase } from './_supabase.js';

/**
 * @param {object} args
 * @param {string} args.orderId      uuid of the order being acted on
 * @param {object} args.profile      admin_profiles row { id, display_name, ... }
 * @param {string} args.action       short verb: 'transition', 'refund', 'edit', etc.
 * @param {object} [args.details]    free-form JSON describing the change
 */
export async function logOrderAction({ orderId, profile, action, details = {} }) {
  if (!orderId || !profile?.id || !action) {
    console.warn('[audit-skip]', JSON.stringify({ reason: 'missing-args', orderId, hasProfile: !!profile, action }));
    return;
  }

  const { error } = await supabase
    .from('order_audit_log')
    .insert({
      order_id:           orderId,
      actor_user_id:      profile.id,
      actor_display_name: profile.display_name,
      action,
      details,
    });

  if (error) {
    // Audit-log failures are observability data themselves — log loudly but
    // don't throw, since the underlying action (refund, transition) already
    // succeeded and rolling that back would be worse.
    console.error('[audit-fail]', JSON.stringify({
      orderId,
      actorUserId: profile.id,
      action,
      error: error.message,
    }));
  }
}
