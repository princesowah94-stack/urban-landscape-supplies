import { Client, Environment, ApiError } from 'square';
import { createRequire } from 'module';
import { corsHeaders, optionsResponse } from './_cors.js';
import { supabase } from './_supabase.js';

const require = createRequire(import.meta.url);

// Load product prices server-side to prevent client-side price manipulation.
// Hard failure at cold start is intentional — surfaces immediately in Vercel logs.
const _productData = require('../data/products.json');
const productPrices = {};
_productData.products.forEach(p => { productPrices[p.id] = p.price; });

const EXPRESS_DELIVERY_CENTS = parseInt(process.env.EXPRESS_DELIVERY_CENTS || '1500', 10);

function validateCart(items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('Cart is empty');
  }
  return items.map(item => {
    const serverPrice = productPrices[item.id];
    if (!serverPrice) throw new Error(`Unknown product: ${item.id}`);
    if (Math.abs(serverPrice - parseFloat(item.price)) > 0.01) {
      console.warn(`[price-mismatch] ${item.id}: submitted $${item.price}, server $${serverPrice}`);
    }
    return {
      id:       item.id,
      name:     item.name,
      price:    serverPrice,
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

    // 1. Validate cart against server-side prices
    const validatedItems = validateCart(items);
    const isExpress = delivery?.method === 'express';
    const totalCents =
      validatedItems.reduce((s, i) => s + Math.round(i.price * 100) * i.quantity, 0) +
      (isExpress ? EXPRESS_DELIVERY_CENTS : 0);

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

    if (isExpress) {
      lineItems.push({
        name:           'Express Delivery',
        quantity:       '1',
        basePriceMoney: { amount: BigInt(EXPRESS_DELIVERY_CENTS), currency: 'AUD' },
      });
    }

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
      { error: 'Server error', message: err.message || 'An unexpected error occurred. Please call us on 1300 872 267.' },
      { status: 500, headers: corsHeaders(request) }
    );
  }
}
