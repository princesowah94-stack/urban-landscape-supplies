/**
 * checkout.js — Renders order summary, collects delivery info,
 * calls /api/create-checkout → redirects to Square hosted checkout
 * Note: esc() is declared in cart.js, which this page always loads first.
 */

document.addEventListener('DOMContentLoaded', () => {
  const cart = getCart?.() || [];
  if (cart.length === 0) { window.location.href = 'cart.html'; return; }

  renderCheckoutSummary(cart);
  updateTotals(cart);

  document.querySelectorAll('input[name="delivery"]').forEach(radio => {
    radio.addEventListener('change', () => updateTotals(cart));
  });

  // Trade pricing: probe once the customer has typed their email.
  const emailEl = document.getElementById('email');
  emailEl?.addEventListener('blur', () => checkTradePricing(cart));
  emailEl?.addEventListener('change', () => checkTradePricing(cart));
  if (emailEl?.value) checkTradePricing(cart); // browser autofill
});

// ─── SUMMARY RENDERING ──────────────────────────────────────────

function renderCheckoutSummary(cart) {
  const container = document.getElementById('checkout-line-items');
  if (!container) return;

  container.innerHTML = cart.map(item => `
    <div class="checkout-line-item">
      <div class="checkout-line-item__img-wrap">
        <picture>
          <source type="image/webp" srcset="${esc((item.image || '').replace(/\.jpe?g$/i, '.webp'))}" />
          <img
            src="${esc(item.image)}"
            alt="${esc(item.name)}"
            class="checkout-line-item__img"
            loading="lazy"
            onerror="this.src='images/products/placeholder.jpg'"
          />
        </picture>
        <span class="checkout-line-item__qty">${parseInt(item.quantity, 10)}</span>
      </div>
      <div style="flex:1">
        <p style="font-size:var(--text-sm);font-weight:600;color:var(--color-text-primary)">${esc(item.name)}</p>
        <p style="font-size:var(--text-xs);color:var(--color-text-muted)">${esc(item.unit)}</p>
      </div>
      <span style="font-size:var(--text-sm);font-weight:700;color:var(--color-price)">$${(parseFloat(item.price) * parseInt(item.quantity, 10)).toFixed(2)}</span>
    </div>
  `).join('');
}

// Delivery is quoted per job after checkout — nothing is charged online for it.
function getDeliveryCost() {
  return 0;
}

// Trade pricing — populated by checkTradePricing() once a valid email is entered.
// Display only; the server re-checks the account and applies the real discount.
let tradeDiscount = null; // { tier, percent } | null

async function checkTradePricing(cart) {
  const email = document.getElementById('email')?.value.trim() || '';
  const banner = document.getElementById('trade-banner');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { tradeDiscount = null; if (banner) banner.hidden = true; updateTotals(cart); return; }
  try {
    const res = await fetch('/api/trade-application?email=' + encodeURIComponent(email));
    const data = res.ok ? await res.json() : { trade: null };
    tradeDiscount = data.trade && data.trade.percent > 0 ? data.trade : null;
  } catch { tradeDiscount = null; }
  if (banner) {
    if (tradeDiscount) {
      const tier = tradeDiscount.tier.charAt(0).toUpperCase() + tradeDiscount.tier.slice(1);
      banner.textContent = `Trade pricing applied — ${tier} account, ${tradeDiscount.percent}% off materials.`;
      banner.hidden = false;
    } else {
      banner.hidden = true;
    }
  }
  updateTotals(cart);
}

function updateTotals(cart) {
  const gross    = cart.reduce((s, i) => s + i.price * i.quantity, 0);
  const discount = tradeDiscount ? cart.reduce((s, i) => s + (i.price * i.quantity - Math.round(i.price * 100 * (1 - tradeDiscount.percent / 100)) / 100 * i.quantity), 0) : 0;
  const subtotal = gross - discount;
  const method   = document.querySelector('input[name="delivery"]:checked')?.value || 'standard';
  const delivery = getDeliveryCost();
  const total    = subtotal + delivery;

  const tradeRow = document.getElementById('checkout-trade-row');
  if (tradeRow) {
    tradeRow.hidden = !tradeDiscount;
    if (tradeDiscount) {
      document.getElementById('checkout-trade-label').textContent = `(${tradeDiscount.percent}%)`;
      document.getElementById('checkout-trade').textContent = `−$${discount.toFixed(2)}`;
    }
  }

  const deliveryEl = document.getElementById('checkout-delivery');
  if (deliveryEl) {
    deliveryEl.textContent = method === 'pickup' ? 'Free' : 'Quoted separately';
  }
  const subtotalEl = document.getElementById('checkout-subtotal');
  if (subtotalEl) subtotalEl.textContent = `$${gross.toFixed(2)}`;

  const totalEl = document.getElementById('checkout-total');
  if (totalEl) totalEl.textContent = `$${total.toFixed(2)}`;
}

// ─── FORM VALIDATION ────────────────────────────────────────────

function validateForm() {
  const required = [
    { id: 'first-name', label: 'First name' },
    { id: 'last-name',  label: 'Last name' },
    { id: 'email',      label: 'Email address' },
    { id: 'address',    label: 'Street address' },
    { id: 'suburb',     label: 'Suburb' },
    { id: 'postcode',   label: 'Postcode' },
  ];

  for (const field of required) {
    const el = document.getElementById(field.id);
    if (!el?.value.trim()) {
      el?.classList.add('error');
      showError(`Please enter your ${field.label}.`);
      el?.focus();
      return false;
    }
    el?.classList.remove('error');
  }

  const email = document.getElementById('email').value.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    document.getElementById('email').classList.add('error');
    showError('Please enter a valid email address.');
    return false;
  }

  return true;
}

function showError(msg) {
  const el = document.getElementById('checkout-error');
  if (!el) return;
  el.textContent = msg;
  el.style.display = 'block';
  el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function clearError() {
  const el = document.getElementById('checkout-error');
  if (el) el.style.display = 'none';
}

// ─── SUBMIT ──────────────────────────────────────────────────────

document.getElementById('checkout-submit-btn')?.addEventListener('click', async () => {
  clearError();
  if (!validateForm()) return;

  const cart = getCart?.() || [];
  if (cart.length === 0) { window.location.href = 'cart.html'; return; }

  const btn = document.getElementById('checkout-submit-btn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner" style="width:18px;height:18px;border-width:2px"></span>&nbsp; Processing...';

  const deliveryMethod = document.querySelector('input[name="delivery"]:checked')?.value || 'standard';

  const payload = {
    items: cart.map(item => ({
      id:       item.id,
      name:     item.name,
      price:    item.price,
      quantity: item.quantity,
    })),
    customer: {
      firstName: document.getElementById('first-name')?.value.trim(),
      lastName:  document.getElementById('last-name')?.value.trim(),
      email:     document.getElementById('email')?.value.trim(),
      phone:     document.getElementById('phone')?.value.trim(),
    },
    delivery: {
      method:   deliveryMethod,
      address:  document.getElementById('address')?.value.trim(),
      address2: document.getElementById('address2')?.value.trim(),
      suburb:   document.getElementById('suburb')?.value.trim(),
      state:    document.getElementById('state')?.value,
      postcode: document.getElementById('postcode')?.value.trim(),
      notes:    document.getElementById('delivery-notes')?.value.trim(),
    },
  };

  try {
    const res = await fetch('/api/create-checkout', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || `Server error (${res.status})`);
    }

    const { checkoutUrl } = await res.json();
    if (!checkoutUrl) throw new Error('No checkout URL returned from payment server.');

    window.location.href = checkoutUrl;

  } catch (err) {
    console.error('Checkout error:', err);
    showError(
      err.message.includes('fetch')
        ? 'Unable to connect. Please check your connection and try again, or call us on 0433 132 406.'
        : err.message
    );
    btn.disabled = false;
    btn.innerHTML = '<svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/></svg> Proceed to Payment';
  }
});
