import { supabase } from './_supabase.js';
import { corsHeaders } from './_cors.js';

export async function GET(request) {
  const { data, error } = await supabase
    .from('inventory')
    .select('product_id, stock, low_stock_threshold');

  if (error) {
    return Response.json({ error: error.message }, { status: 500, headers: corsHeaders(request) });
  }

  return Response.json(data, { headers: corsHeaders(request) });
}
