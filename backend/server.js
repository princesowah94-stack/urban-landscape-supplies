/**
 * Urban Landscape Supplies — Backend Server
 *
 * Two endpoints:
 *   POST /api/create-checkout  → Square Payment Links API → returns checkoutUrl
 *   POST /api/quote            → sends bulk quote email to staff + auto-reply to customer
 *
 * Deploy to Render.com or Railway (free tier).
 * Set environment variables in their dashboard — never commit .env
 */

require('dotenv').config();

const express    = require('express');
const cors       = require('cors');
const nodemailer = require('nodemailer');
const path       = require('path');
const { Client, Environment, ApiError } = require('square');

const app  = express();
const PORT = process.env.PORT || 3001;

// ─── MIDDLEWARE ──────────────────────────────────────────────────
app.use(express.json());
app.use(cors({
  origin: [
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'https://urbanlandscapesupplies.com.au',
    'https://www.urbanlandscapesupplies.com.au',
  ],
  credentials: true
}));

// Serve static frontend files (for local development with `node server.js`)
app.use(express.static(path.join(__dirname, '..')));

// ─── SQUARE CLIENT ───────────────────────────────────────────────
const squareClient = new Client({
  accessToken: process.env.SQUARE_ACCESS_TOKEN,
  environment: process.env.SQUARE_ENVIRONMENT === 'production'
    ? Environment.Production
    : Environment.Sandbox
});

const { checkoutApi } = squareClient;

// ─── EMAIL TRANSPORT ─────────────────────────────────────────────
const emailTransport = nodemailer.createTransport({
  host: process.env.EMAIL_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.EMAIL_PORT, 10) || 587,
  secure: false,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

// ─── PRODUCT PRICE VALIDATION ────────────────────────────────────
// Load products.json to validate prices server-side (prevents client-side manipulation)
let productPrices = {};
try {
  const products = require('../data/products.json');
  products.products.forEach(p => { productPrices[p.id] = p.price; });
} catch (e) {
  console.warn('⚠️  Could not load products.json for price validation:', e.message);
}

function validateAndPriceCart(items) {
  return items.map(item => {
    const serverPrice = productPrices[item.id];
    if (!serverPrice) throw new Error(`Unknown product ID: ${item.id}`);

    // Check submitted price matches server price (within $0.01 tolerance)
    if (Math.abs(serverPrice - parseFloat(item.price)) > 0.01) {
      console.warn(`Price mismatch for ${item.id}: submitted $${item.price}, server $${serverPrice}`);
    }

    return {
      id: item.id,
      name: item.name,
      price: serverPrice,     // Always use server price
      quantity: Math.max(1, parseInt(item.quantity, 10) || 1)
    };
  });
}

// ─── ROUTE: CREATE SQUARE CHECKOUT ───────────────────────────────
app.post('/api/create-checkout', async (req, res) => {
  try {
    const { items, customer, delivery } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Cart is empty' });
    }

    // Validate and re-price cart server-side
    const validatedItems = validateAndPriceCart(items);

    // Build Square line items (amounts in cents)
    const lineItems = validatedItems.map(item => ({
      name: item.name,
      quantity: String(item.quantity),
      basePriceMoney: {
        amount: BigInt(Math.round(item.price * 100)),
        currency: 'AUD'
      }
    }));

    // Add delivery charge if express
    if (delivery?.method === 'express') {
      lineItems.push({
        name: 'Express Delivery',
        quantity: '1',
        basePriceMoney: { amount: BigInt(1500), currency: 'AUD' }
      });
    }

    // Build redirect URL (Square redirects here on success)
    const siteUrl = process.env.SITE_URL || 'https://urbanlandscapesupplies.com.au';
    const redirectUrl = `${siteUrl}/order-confirmation.html`;

    // Create Square payment link
    const response = await checkoutApi.createPaymentLink({
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
                  country: 'AU'
                } : undefined
              }
            }
          }]
        } : {})
      },
      checkoutOptions: {
        redirectUrl,
        merchantSupportEmail: process.env.EMAIL_TO || 'orders@urbanlandscapesupplies.com.au',
        allowTipping: false,
        askForShippingAddress: !delivery?.address
      },
      ...(customer?.email ? { prePopulatedData: { buyerEmail: customer.email } } : {})
    });

    const checkoutUrl = response.result?.paymentLink?.url;
    if (!checkoutUrl) throw new Error('Square did not return a checkout URL');

    res.json({ checkoutUrl, orderId: response.result?.paymentLink?.orderId });

  } catch (err) {
    console.error('Square checkout error:', err instanceof ApiError ? err.errors : err);

    if (err instanceof ApiError) {
      const squareError = err.errors?.[0];
      return res.status(422).json({
        error: 'Payment gateway error',
        message: squareError?.detail || 'Unable to create checkout. Please try again.'
      });
    }

    res.status(500).json({
      error: 'Server error',
      message: err.message || 'An unexpected error occurred. Please call us on 1300 872 267.'
    });
  }
});

// ─── ROUTE: BULK QUOTE EMAIL ──────────────────────────────────────
app.post('/api/quote', async (req, res) => {
  try {
    const { items, delivery, contact } = req.body;

    if (!items || items.length === 0) {
      return res.status(400).json({ error: 'No items in quote' });
    }

    if (!contact?.email || !contact?.phone) {
      return res.status(400).json({ error: 'Contact details required' });
    }

    // Generate reference ID
    const referenceId = 'BQ-' + Date.now().toString(36).toUpperCase();

    // Format items table for email
    const itemsTable = items.map(item =>
      `  • ${item.name}: ${item.quantity} ${item.unit} (est. $${(item.price * item.quantity).toFixed(2)})`
    ).join('\n');

    const estimatedTotal = items.reduce((s, i) => s + (i.price || 0) * (i.quantity || 1), 0);

    // ─── Email to staff ───────────────────────────────────────────
    const staffSubject = `New Bulk Quote Request [${referenceId}] — ${contact.firstName} ${contact.lastName}`;
    const staffBody = `
NEW BULK QUOTE REQUEST
Reference: ${referenceId}
Submitted: ${new Date().toLocaleString('en-AU', { timeZone: 'Australia/Sydney' })}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
MATERIALS REQUESTED
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${itemsTable}

Estimated total (indicative): $${estimatedTotal.toFixed(2)} AUD
Note: Final price based on delivery location & availability

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DELIVERY ADDRESS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${delivery?.address}${delivery?.suburb ? ', ' + delivery.suburb : ''}${delivery?.postcode ? ' ' + delivery.postcode : ''}

Preferred window: ${delivery?.dateFrom || 'flexible'} → ${delivery?.dateTo || 'flexible'}
Access notes: ${delivery?.access || 'None provided'}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CUSTOMER CONTACT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Name:  ${contact.firstName} ${contact.lastName}
Email: ${contact.email}
Phone: ${contact.phone}
Trade account: ${contact.isTrade ? 'Yes (or interested)' : 'No'}
Notes: ${contact.notes || 'None'}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ACTION REQUIRED: Reply to customer within 2 business hours to confirm
pricing, availability and delivery scheduling.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    `.trim();

    // ─── Auto-reply to customer ───────────────────────────────────
    const customerSubject = `Your Bulk Quote Request [${referenceId}] — Urban Landscape Supplies`;
    const customerBody = `
Hi ${contact.firstName},

Thanks for your bulk quote request! We've received your enquiry and our team will be in touch within 2 business hours to confirm pricing, availability and delivery scheduling.

Your reference number is: ${referenceId}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
YOUR REQUEST SUMMARY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${itemsTable}

Delivery address: ${delivery?.address}${delivery?.suburb ? ', ' + delivery.suburb : ''}${delivery?.postcode ? ' ' + delivery.postcode : ''}
Preferred window: ${delivery?.dateFrom || 'flexible'} → ${delivery?.dateTo || 'flexible'}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Please note: Prices shown are indicative only. Final pricing will be confirmed by our team based on your delivery location and current stock availability.

If you need to speak with us urgently:
📞 1300 872 267
✉️ ${process.env.EMAIL_TO || 'orders@urbanlandscapesupplies.com.au'}

We look forward to helping with your project!

The Urban Landscape Supplies Team
Sydney NSW · urbanlandscapesupplies.com.au
    `.trim();

    // Send both emails
    await Promise.all([
      emailTransport.sendMail({
        from: `"${process.env.EMAIL_FROM_NAME || 'Urban Landscape Supplies'}" <${process.env.EMAIL_FROM}>`,
        to: process.env.EMAIL_TO,
        subject: staffSubject,
        text: staffBody,
        replyTo: contact.email
      }),
      emailTransport.sendMail({
        from: `"${process.env.EMAIL_FROM_NAME || 'Urban Landscape Supplies'}" <${process.env.EMAIL_FROM}>`,
        to: contact.email,
        subject: customerSubject,
        text: customerBody
      })
    ]);

    res.json({ success: true, referenceId });

  } catch (err) {
    console.error('Quote email error:', err);
    res.status(500).json({
      error: 'Failed to send quote',
      message: 'Unable to submit quote. Please call us on 1300 872 267 or email orders@urbanlandscapesupplies.com.au'
    });
  }
});

// ─── ROUTE: CONTACT FORM ─────────────────────────────────────────
app.post('/api/contact', async (req, res) => {
  try {
    const { name, email, phone, subject, message } = req.body;

    if (!name || !email || !message) {
      return res.status(400).json({ error: 'Name, email and message are required' });
    }

    const subjectLabels = {
      order: 'Order enquiry',
      delivery: 'Delivery question',
      bulk: 'Bulk order enquiry',
      trade: 'Trade account',
      product: 'Product advice',
      other: 'Other'
    };

    const staffSubject = `Website Contact [${subjectLabels[subject] || subject || 'General'}] — ${name}`;
    const staffBody = `
NEW CONTACT FORM SUBMISSION
Submitted: ${new Date().toLocaleString('en-AU', { timeZone: 'Australia/Sydney' })}

Name:    ${name}
Email:   ${email}
Phone:   ${phone || 'Not provided'}
Subject: ${subjectLabels[subject] || subject || 'General'}

─────────────────────────────────
MESSAGE
─────────────────────────────────
${message}
─────────────────────────────────

Reply directly to this email to respond to ${name}.
    `.trim();

    await emailTransport.sendMail({
      from: `"${process.env.EMAIL_FROM_NAME || 'Urban Landscape Supplies Website'}" <${process.env.EMAIL_FROM}>`,
      to: process.env.EMAIL_TO,
      subject: staffSubject,
      text: staffBody,
      replyTo: email
    });

    res.json({ success: true });

  } catch (err) {
    console.error('Contact form error:', err);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

// ─── ROUTE: TRADE APPLICATION ─────────────────────────────────────
app.post('/api/trade-application', async (req, res) => {
  try {
    const { business, abn, firstName, lastName, email, phone, businessType, address, notes } = req.body;

    if (!business || !email || !phone) {
      return res.status(400).json({ error: 'Business name, email and phone are required' });
    }

    const referenceId = 'TRD-' + Date.now().toString(36).toUpperCase();

    const staffSubject = `Trade Account Application [${referenceId}] — ${business}`;
    const staffBody = `
NEW TRADE ACCOUNT APPLICATION
Reference: ${referenceId}
Submitted: ${new Date().toLocaleString('en-AU', { timeZone: 'Australia/Sydney' })}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
BUSINESS DETAILS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Business Name: ${business}
ABN:           ${abn || 'Not provided'}
Business Type: ${businessType || 'Not specified'}
Address:       ${address || 'Not provided'}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CONTACT PERSON
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Name:  ${firstName} ${lastName}
Email: ${email}
Phone: ${phone}

Notes: ${notes || 'None'}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ACTION: Review application and contact applicant within 1 business day.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    `.trim();

    const customerSubject = `Trade Application Received [${referenceId}] — Urban Landscape Supplies`;
    const customerBody = `
Hi ${firstName},

Thanks for applying for a trade account with Urban Landscape Supplies!

Your application reference is: ${referenceId}

Our team will review your application and be in touch within 1 business day to discuss your account terms, credit limit and exclusive pricing.

In the meantime, feel free to call us on 1300 872 267 if you have any questions.

The Urban Landscape Supplies Team
Sydney NSW · urbanlandscapesupplies.com.au
    `.trim();

    await Promise.all([
      emailTransport.sendMail({
        from: `"${process.env.EMAIL_FROM_NAME || 'Urban Landscape Supplies'}" <${process.env.EMAIL_FROM}>`,
        to: process.env.EMAIL_TO,
        subject: staffSubject,
        text: staffBody,
        replyTo: email
      }),
      emailTransport.sendMail({
        from: `"${process.env.EMAIL_FROM_NAME || 'Urban Landscape Supplies'}" <${process.env.EMAIL_FROM}>`,
        to: email,
        subject: customerSubject,
        text: customerBody
      })
    ]);

    res.json({ success: true, referenceId });

  } catch (err) {
    console.error('Trade application error:', err);
    res.status(500).json({ error: 'Failed to submit application' });
  }
});

// ─── HEALTH CHECK ────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    environment: process.env.SQUARE_ENVIRONMENT || 'sandbox',
    timestamp: new Date().toISOString()
  });
});

// ─── START ───────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n✅ Urban Landscape Supplies backend running on http://localhost:${PORT}`);
  console.log(`   Square environment: ${process.env.SQUARE_ENVIRONMENT || 'sandbox'}`);
  console.log(`   Frontend served at: http://localhost:${PORT}\n`);
});
