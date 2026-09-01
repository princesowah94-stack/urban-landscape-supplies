import { Client, Environment, ApiError } from 'square';
import { createRequire } from 'module';
import { corsHeaders, optionsResponse } from './_cors.js';
import { supabase } from './_supabase.js';
import { getTradeDiscount, applyDiscountCents } from './_trade.js';

const require = createRequire(import.meta.url);

// Product prices are resolved server-side (never trusted from the client).
// Source of truth is Supabase (so CRM price/bag-size edits apply to checkout
// immediately); data/products.json is only a cold fallback if the DB is down.
// ponytail: module-scope cache, 60s TTL — fine for one warm function instance.
import { toClientShape } from './products.js';
const _fallbackData = require('../data/products.json');
let _catalogue = { byId: {}, idsByLength: [], loadedAt: 0 };
const CATALOGUE_TTL_MS = 60_000;

function indexCatalogue(list) {
  const byId = {};
  list.forEach(p => { byId[p.id] = p; });
  return { byId, idsByLength: Object.keys(byId).sort((a, b) => b.length - a.length), loadedAt: Date.now() };
}

async function getCatalogue() {
  if (Date.now() - _catalogue.loadedAt < CATALOGUE_TTL_MS && _catalogue.idsByLength.length) return _catalogue;
  const { data, error } = await supabase.from('products').select('*').is('archived_at', null);
  if (error || !data?.length) {
    console.error('[checkout] products from DB failed, using products.json fallback:', error?.message);
    if (!_catalogue.idsByLength.length) _catalogue = indexCatalogue(_fallbackData.products);
    return _catalogue;
  }
  _catalogue = indexCatalogue(data.map(toClientShape));
  return _catalogue;
}

const MAX_QTY = 100;
const MAX_ITEMS = 50;

// Cart ids are `<productId>[-<size>][-<bagId>]` (see js/products.js). Sizes
// themselves contain hyphens ("20-30mm"), so resolve by known-prefix match and
// known-bag-suffix rather than splitting on '-'.
function resolveCartItem(rawId, catalogue) {
  const id = String(rawId || '');
  const baseId = catalogue.idsByLength.find(p => id === p || id.startsWith(p + '-'));
  if (!baseId) return null;
  const product = catalogue.byId[baseId];
  const rest = id.slice(baseId.length + 1);           // "" | "20-30mm" | "20-30mm-20kg" | "20kg"
  const bag = (product.bagSizes || []).find(b => rest === b.id || rest.endsWith('-' + b.id)) || null;
  const size = bag ? rest.slice(0, rest.length - bag.id.length).replace(/-$/, '') : rest;
  if (size && !(product.sizes || []).includes(size)) return null;
  const label = [size, bag?.label].filter(Boolean).join(', ');
  return {
    name:  product.name + (label ? ` (${label})` : ''),
    price: bag ? bag.price : product.price,
  };
}

async function validateCart(items) {
  if (!Array.isArray(items) || items.length === 0) throw new Error('Cart is empty');
  if (items.length > MAX_ITEMS) throw new Error('Too many items');
  const catalogue = await getCatalogue();
  return items.map(item => {
    const resolved = resolveCartItem(item?.id, catalogue);
    if (!resolved) throw new Error(`Unknown product: ${item?.id}`);
    if (Math.abs(resolved.price - parseFloat(item.price)) > 0.01) {
      console.warn(`[price-mismatch] ${item.id}: submitted $${item.price}, server $${resolved.price}`);
    }
    const qty = parseInt(item.quantity, 10);
    return {
      id:       String(item.id),
      name:     resolved.name,            // server-resolved, never client-supplied
      price:    resolved.price,           // server-resolved
      quantity: Math.min(MAX_QTY, Math.max(1, Number.isFinite(qty) ? qty : 1)),
    };
  });
}

export function OPTIONS(request) {
  return optionsResponse(request);
}

export async function POST(request) {
  try {
    const { items, customer, delivery } = await request.json();

    // 1. Validate cart against server-side prices
    const validatedItems = await validateCart(items);

    // 1b. Trade pricing — active trade account matched by checkout email gets
    // its tier discount applied to item prices (not delivery). Server-side only.
    const trade = await getTradeDiscount(customer?.email).catch(() => null);
    if (trade?.percent) {
      for (const i of validatedItems) {
        i.price = applyDiscountCents(Math.round(i.price * 100), trade.percent) / 100;
      }
    }
    // Delivery is quoted per job after the order — nothing charged for it online.
    // Stale cached clients may still send method 'express'; treat as standard.
    const totalCents =
      validatedItems.reduce((s, i) => s + Math.round(i.price * 100) * i.quantity, 0);

    // 2. Create order record in Supabase (before Square, so we have the UUID for the redirect URL)
    const { data: order, error: orderErr } = await supabase
      .from('orders')
      .insert({
        customer_name:    `${customer?.firstName || ''} ${customer?.lastName || ''}`.trim(),
        customer_email:   customer?.email    || null,
        customer_phone:   customer?.phone    || null,
        delivery_address: delivery
          ? [delivery.address, delivery.address2, delivery.suburb, delivery.state, delivery.postcode]
              .filter(Boolean).join(', ')
          : null,
        notes:       delivery?.notes || null,
        delivery_notes_internal: trade?.percent
          ? `Trade pricing applied: ${trade.tier} (−${trade.percent}%) · ${trade.company || ''}`.trim()
          : null,
        status:      'pending_payment',
        total_cents: totalCents,
      })
      .select()
      .single();

    if (orderErr) {
      console.error('[checkout] order-insert failed:', orderErr.message);
      throw new Error('Could not create order record');
    }

    // 3. Insert line items — must succeed before we send the customer to Square
    const { error: itemsErr } = await supabase
      .from('order_items')
      .insert(validatedItems.map(i => ({
        order_id:    order.id,
        product_id:  i.id,
        name:        i.name,
        quantity:    i.quantity,
        price_cents: Math.round(i.price * 100),
      })));

    if (itemsErr) {
      console.error('[checkout] items-insert failed:', itemsErr.message, '— cleaning up order', order.id);
      await supabase.from('orders').delete().eq('id', order.id);
      throw new Error('Could not record order items');
    }

    // 4. Create Square Payment Link
    const squareClient = new Client({
      accessToken:  process.env.SQUARE_ACCESS_TOKEN,
      environment:  process.env.SQUARE_ENVIRONMENT === 'production'
        ? Environment.Production
        : Environment.Sandbox,
    });

    const lineItems = validatedItems.map(i => ({
      name:           i.name,
      quantity:       String(i.quantity),
      basePriceMoney: { amount: BigInt(Math.round(i.price * 100)), currency: 'AUD' },
    }));

    const siteUrl = process.env.SITE_URL || 'https://urbanlandscapesupplies.com.au';

    const squareRes = await squareClient.checkoutApi.createPaymentLink({
      idempotencyKey: `uls-${order.id}`,
      order: {
        locationId: process.env.SQUARE_LOCATION_ID,
        lineItems,
        ...(customer?.email ? {
          fulfillments: [{
            type:  'SHIPMENT',
            state: 'PROPOSED',
            shipmentDetails: {
              recipient: {
                displayName:  `${customer.firstName || ''} ${customer.lastName || ''}`.trim(),
                emailAddress: customer.email,
                phoneNumber:  customer.phone || undefined,
                address: delivery?.address ? {
                  addressLine1:                  delivery.address,
                  addressLine2:                  delivery.address2 || undefined,
                  locality:                      delivery.suburb,
                  postalCode:                    delivery.postcode,
                  administrativeDistrictLevel1:  delivery.state || 'NSW',
                  country:                       'AU',
                } : undefined,
              },
            },
          }],
        } : {}),
      },
      checkoutOptions: {
        // id= matches what order-confirmation.html and /api/order both expect
        redirectUrl:           `${siteUrl}/order-confirmation?id=${order.id}`,
        merchantSupportEmail:  process.env.EMAIL_TO_STAFF || 'orders@urbanlandscapesupplies.com.au',
        allowTipping:          false,
        askForShippingAddress: false,
      },
      ...(customer?.email ? { prePopulatedData: { buyerEmail: customer.email } } : {}),
    });

    const checkoutUrl   = squareRes.result?.paymentLink?.url;
    const squareOrderId = squareRes.result?.paymentLink?.orderId;

    if (!checkoutUrl) {
      console.error('[checkout] Square returned no URL — orderId:', order.id);
      throw new Error('Payment gateway did not return a checkout URL');
    }

    // 5. Link the Square order ID back to our record so the webhook can match it
    const { error: patchErr } = await supabase
      .from('orders')
      .update({ square_order_id: squareOrderId })
      .eq('id', order.id);

    if (patchErr) {
      console.error('[checkout] order-patch failed:', patchErr.message, '— orderId:', order.id);
      throw new Error('Could not link payment to order');
    }

    return Response.json(
      { checkoutUrl, orderId: order.id },
      { headers: corsHeaders(request) }
    );

  } catch (err) {
    if (err instanceof ApiError) {
      console.error('[checkout] Square API error:', err.errors);
      return Response.json(
        { error: 'Payment gateway error', message: err.errors?.[0]?.detail || 'Could not create checkout.' },
        { status: 422, headers: corsHeaders(request) }
      );
    }
    console.error('[checkout] error:', err.message);
    return Response.json(
      { error: 'Server error', message: 'We couldn’t process your order right now. Please try again, or call us on 0433 132 406 and we’ll place it for you over the phone.' },
      { status: 500, headers: corsHeaders(request) }
    );
  }
}
