/**
 * Vercel Cron: clean up orphaned `pending_payment` order rows.
 *
 * Every checkout attempt inserts an `orders` row at status `pending_payment`
 * BEFORE the customer reaches Square. If the customer abandons the cart, the
 * Square call fails, or the patch fails, that row never transitions and sits
 * in the table forever. This job deletes any pending_payment row older than
 * 24 hours, plus its associated order_items rows (in case the FK isn't
 * configured to CASCADE on the remote DB).
 *
 * Triggered by Vercel Cron — see `crons` block in vercel.json.
 *
 * Auth: Vercel Cron sends an `Authorization: Bearer <CRON_SECRET>` header.
 * Reject any request without that exact header.
 */
import { supabase } from '../_supabase.js';

export async function GET(request) {
  // 1. Verify cron secret. Vercel Cron auto-injects this when CRON_SECRET is
  //    set as an env var. Manual invocations must include the same Bearer token.
  const auth = request.headers.get('authorization');
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  // 2. Find orphan order ids first so we can delete their items explicitly
  //    (defensive — works regardless of FK CASCADE config on the remote DB).
  const { data: orphans, error: lookupErr } = await supabase
    .from('orders')
    .select('id')
    .eq('status', 'pending_payment')
    .lt('created_at', cutoff);

  if (lookupErr) {
    console.error('[cron-fail]', JSON.stringify({ job: 'cleanup-orphans', stage: 'lookup', error: lookupErr.message }));
    return Response.json({ error: lookupErr.message }, { status: 500 });
  }

  if (!orphans || orphans.length === 0) {
    console.log('[cron-ok]', JSON.stringify({ job: 'cleanup-orphans', deletedCount: 0, cutoff }));
    return Response.json({ deletedCount: 0, cutoff });
  }

  const orphanIds = orphans.map(o => o.id);

  // 3. Delete order_items first, then the order rows.
  const { error: itemsDelErr } = await supabase
    .from('order_items')
    .delete()
    .in('order_id', orphanIds);

  if (itemsDelErr) {
    console.error('[cron-fail]', JSON.stringify({ job: 'cleanup-orphans', stage: 'items-delete', orphanCount: orphanIds.length, error: itemsDelErr.message }));
    return Response.json({ error: itemsDelErr.message }, { status: 500 });
  }

  const { error: ordersDelErr } = await supabase
    .from('orders')
    .delete()
    .in('id', orphanIds);

  if (ordersDelErr) {
    console.error('[cron-fail]', JSON.stringify({ job: 'cleanup-orphans', stage: 'orders-delete', orphanCount: orphanIds.length, error: ordersDelErr.message }));
    return Response.json({ error: ordersDelErr.message }, { status: 500 });
  }

  console.log('[cron-ok]', JSON.stringify({ job: 'cleanup-orphans', deletedCount: orphanIds.length, cutoff }));
  return Response.json({ deletedCount: orphanIds.length, cutoff });
}
