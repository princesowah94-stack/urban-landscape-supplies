import { supabase } from './_supabase.js';
import { corsHeaders, optionsResponse } from './_cors.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function OPTIONS(request) {
  return optionsResponse(request);
}

export async function GET(request) {
  const headers = corsHeaders(request);
  const id = new URL(request.url).searchParams.get('id');

  if (!id || !UUID_RE.test(id)) {
    return Response.json({ error: 'Invalid order id' }, { status: 400, headers });
  }

  const { data: order, error: orderErr } = await supabase
    .from('orders')
    .select('id, created_at, customer_name, customer_email, customer_phone, delivery_address, notes, status, total_cents, square_order_id')
    .eq('id', id)
    .single();

  if (orderErr || !order) {
    return Response.json({ error: 'Order not found' }, { status: 404, headers });
  }

  const { data: items } = await supabase
    .from('order_items')
    .select('product_id, name, quantity, price_cents')
    .eq('order_id', id);

  return Response.json({ order, items: items || [] }, { headers });
}
