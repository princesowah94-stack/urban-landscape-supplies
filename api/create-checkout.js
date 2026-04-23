import { Client, Environment, ApiError } from 'square';
import { createRequire } from 'module';
import { corsHeaders, optionsResponse } from './_cors.js';
import { supabase } from './_supabase.js';

const require = createRequire(import.meta.url);

// Load product prices server-side to prevent client-side price manipulation
let productPrices = {};
try {
  const data = require('../data/products.json');
  data.products.forEach(p => {
    productPrices[p.id] = p.price;
    // Bulk bag variant (id ends in -bulk)
    if (p.bulkBagPrice) productPrices[`${p.id}-bulk`] = p.bulkBagPrice;
  });
} catch (e) {
  console.warn('Could not load products.json:', e.message);
}

function validateAndPriceCart(items) {
  return items.map(item => {
    const serverPrice = productPrices[item.id];
    if (!serverPrice) throw new Error(`Unknown product ID: ${item.id}`);
    if (Math.abs(serverPrice - parseFloat(item.price)) > 0.01) {
      console.warn(`Price mismatch for ${item.id}: submitted $${item.price}, server $${serverPrice}`);
    }
    return {
      id: item.id,
      name: item.name,
      price: serverPrice,
      quantity: Math.max(1, parseInt(item.quantity, 10) || 1),
    };
  });
}

export function OPTIONS(request) {
  return optionsResponse(request);
}

export async function POST(request) {
  try {
    const { items, customer, delivery } = await request.json();

    if (!items || !Array.isArray(items) || items.length === 0) {
      return Response.json({ error: 'Cart is empty' }, { status: 400, headers: corsHeaders(request) });
    }

    const validatedItems = validateAndPriceCart(items);

    const squareClient = new Client({
      accessToken: process.env.SQUARE_ACCESS_TOKEN,
      environment: process.env.SQUARE_ENVIRONMENT === 'production'
        ? Environment.Production
        : Environment.Sandbox,
    });

    const lineItems = validatedItems.map(item => ({
      name: item.name,
      quantity: String(item.quantity),
      basePriceMoney: {
        amount: BigInt(Math.round(item.price * 100)),
        currency: 'AUD',
      },
    }));

    if (delivery?.method === 'express') {
      lineItems.push({
        name: 'Express Delivery',
        quantity: '1',
        basePriceMoney: { amount: BigInt(1500), currency: 'AUD' },
      });
    }

    const siteUrl = process.env.SITE_URL || 'https://urban-landscape-supplies.vercel.app';

    const response = await squareClient.checkoutApi.createPaymentLink({
      idempotencyKey: `uls-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      order: {
        locationId: process.env.SQUARE_LOCATION_ID,
        lineItems,
        ...(customer?.email ? {
          fulfillments: [{
            type: 'SHIPMENT',
            state: 'PROPOSED',
            shipmentDetails: {
              recipient: {
                displayName: `${customer.firstName} ${customer.lastName}`.trim(),
                emailAddress: customer.email,
                phoneNumber: customer.phone || undefined,
                address: delivery ? {
                  addressLine1: delivery.address,
                  addressLine2: delivery.address2 || undefined,
                  locality: delivery.suburb,
                  postalCode: delivery.postcode,
                  administrativeDistrictLevel1: delivery.state || 'NSW',
                  country: 'AU',
                } : undefined,
              },
            },
          }],
        } : {}),
      },
      checkoutOptions: {
        redirectUrl: `${siteUrl}/order-confirmation.html`,
        merchantSupportEmail: process.env.EMAIL_TO || 'orders@urbanlandscapesupplies.com.au',
        allowTipping: false,
        askForShippingAddress: !delivery?.address,
      },
      ...(customer?.email ? { prePopulatedData: { buyerEmail: customer.email } } : {}),
    });

    const checkoutUrl = response.result?.paymentLink?.url;
    const squareOrderId = response.result?.paymentLink?.orderId;
    if (!checkoutUrl) throw new Error('Square did not return a checkout URL');

    // Save order to Supabase (non-blocking)
    const totalCents = validatedItems.reduce((s, i) => s + Math.round(i.price * 100) * i.quantity, 0)
      + (delivery?.method === 'express' ? 1500 : 0);

    supabase.from('orders').insert({
      customer_name:    `${customer?.firstName || ''} ${customer?.lastName || ''}`.trim(),
      customer_email:   customer?.email || null,
      customer_phone:   customer?.phone || null,
      delivery_address: delivery ? [delivery.address, delivery.address2, delivery.suburb, delivery.state, delivery.postcode].filter(Boolean).join(', ') : null,
      notes:            delivery?.notes || null,
      status:           'pending_payment',
      total_cents:      totalCents,
      square_order_id:  squareOrderId || null,
    }).select().single().then(({ data: order, error }) => {
      if (error) { console.error('Supabase order insert error:', error.message); return; }
      // Save line items
      const lineItems = validatedItems.map(i => ({
        order_id:    order.id,
        product_id:  i.id,
        name:        i.name,
        quantity:    i.quantity,
        price_cents: Math.round(i.price * 100),
      }));
      supabase.from('order_items').insert(lineItems).then(({ error: err }) => {
        if (err) console.error('Supabase order_items insert error:', err.message);
      });
    });

    return Response.json(
      { checkoutUrl, orderId: squareOrderId },
      { headers: corsHeaders(request) }
    );

  } catch (err) {
    console.error('Square checkout error:', err instanceof ApiError ? err.errors : err);

    if (err instanceof ApiError) {
      return Response.json(
        { error: 'Payment gateway error', message: err.errors?.[0]?.detail || 'Unable to create checkout.' },
        { status: 422, headers: corsHeaders(request) }
      );
    }

    return Response.json(
      { error: 'Server error', message: 'An unexpected error occurred. Please call us on 1300 872 267.' },
      { status: 500, headers: corsHeaders(request) }
    );
  }
}
