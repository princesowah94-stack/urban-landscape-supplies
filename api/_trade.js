// Trade pricing lookup shared by checkout (apply discount) and the
// GET /api/trade-application?email= probe (show banner at checkout).
// Tiers mirror lib/brand.js tradeTiers in the CRM — keep in sync.
import { supabase } from './_supabase.js';

export const TRADE_TIERS = { standard: 0, silver: 5, gold: 10 };

/** @returns {Promise<{tier:string, percent:number, company:string}|null>} */
export async function getTradeDiscount(email) {
  const e = String(email || '').trim().toLowerCase();
  if (!e) return null;
  const { data, error } = await supabase
    .from('trade_accounts')
    .select('discount_tier, company_name, is_active')
    .ilike('email', e)
    .eq('is_active', true)
    .maybeSingle();
  if (error) { console.error('[trade] lookup failed:', error.message); return null; }
  if (!data) return null;
  const percent = TRADE_TIERS[data.discount_tier] ?? 0;
  return { tier: data.discount_tier, percent, company: data.company_name };
}

/** Discounted unit price in cents, rounded to the cent. */
export function applyDiscountCents(cents, percent) {
  if (!percent) return cents;
  return Math.round(cents * (1 - percent / 100));
}
