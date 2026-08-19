/**
 * GET /api/products          — returns all in-stock products
 * GET /api/products?id=slug  — returns a single product by id
 * GET /api/products?all=1    — returns all products including out-of-stock (admin use)
 *
 * Returns the same JSON shape as the legacy data/products.json so the
 * retail JS doesn't need to change — price is converted from cents (DB)
 * to AUD dollars (matching original products.json format).
 */
import { supabase } from './_supabase.js'

export { toClientShape, toBagSizes }

export default async function handler(req, res) {
  // Only allow GET
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { id, all } = req.query

  // Single product by slug
  if (id) {
    const { data, error } = await supabase
      .from('products')
      .select('*')
      .eq('id', id)
      .is('archived_at', null)
      .maybeSingle()

    if (error) {
      console.error('GET /api/products?id error:', error.message)
      return res.status(500).json({ error: 'Failed to load product' })
    }
    if (!data) {
      return res.status(404).json({ error: 'Product not found' })
    }

    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
    return res.status(200).json(toClientShape(data))
  }

  // All products
  let query = supabase
    .from('products')
    .select('*')
    .is('archived_at', null)
    .order('sort_order', { ascending: true })

  // By default only return in-stock; ?all=1 returns everything (for admin)
  if (!all) {
    query = query.eq('in_stock', true)
  }

  const { data, error } = await query

  if (error) {
    console.error('GET /api/products error:', error.message)
    return res.status(500).json({ error: 'Failed to load products' })
  }

  // Return in the same shape as products.json so existing JS works unchanged
  res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
  return res.status(200).json({ products: (data || []).map(toClientShape) })
}

/**
 * Convert DB row to the same shape as data/products.json.
 * DB stores price in cents (integer); retail JS expects price in AUD dollars.
 */
function toClientShape(row) {
  return {
    id:            row.id,
    name:          row.name,
    category:      row.category,
    categoryLabel: row.category_label,
    price:         (row.price || 0) / 100,          // cents → dollars
    unit:          row.unit,
    description:   row.description || '',
    features:      row.features || [],
    sizes:         row.sizes || [],
    image:         row.image || '',
    images:        row.images || [],
    badge:         row.badge || null,
    featured:      row.featured,
    inStock:       row.in_stock,
    sku:           row.sku || '',
    bagSizes:      toBagSizes(row.bag_sizes),
  }
}

// DB stores bag sizes as [{id,label,price_cents,unit}]; retail JS expects
// dollars (same as the old hardcoded map). Empty array → null (no selector).
function toBagSizes(raw) {
  if (!Array.isArray(raw) || raw.length === 0) return null
  return raw.map(b => ({ id: b.id, label: b.label, price: (b.price_cents || 0) / 100, unit: b.unit || '' }))
}
