/**
 * checkout.js — Renders order summary, collects delivery info,
 * calls backend /api/create-checkout → redirects to Square hosted checkout
 */

document.addEventListener('DOMContentLoaded', () => {
  const cart = getCart?.() || [];

  if (cart.length === 0) {
    window.location.href = 'cart.html';
    return;
  }

  renderCheckoutSummary(cart);
  updateTotals(cart);
});

function renderCheckoutSummary(cart) {
  const container = document.getElementById('checkout-line-items');
  if (!container) return;

  container.innerHTML = cart.map(item => `
    <div class="checkout-line-item">
      <div class="checkout-line-item__img-wrap">
        <img
          src="${item.image}"
          alt="${item.name}"
          class="checkout-line-item__img"
          onerror="this.src='images/products/placeholder.jpg'"
        />
        <span class="checkout-line-item__qty">${item.quantity}</span>
      </div>
      <div style="flex:1">
        <p style="font-size:var(--text-sm);font-weight:600;color:var(--color-text-primary)">${item.name}</p>
        <p style="font-size:var(--text-xs);color:var(--color-text-muted)">${item.unit}</p>
      </div>
      <span style="font-size:var(--text-sm);font-weight:700;color:var(--color-price)">$${(item.price * item.quantity).toFixed(2)}</span>
    </div>
  `).join('');
}

function updateTotals(cart) {
  const subtotal = cart.reduce((s, i) => s + i.price * i.quantity, 0);
  document.getElementById('checkout-subtotal').textContent = `$${subtotal.toFixed(2)}`;
  document.getElementById('checkout-total').textContent = `$${subtotal.toFixed(2)}*`;
}

// ─── FORM VALIDATION ────────────────────────────────────────────
function validateForm() {
  const required = [
    { id: 'first-name',  label: 'First name' },
    { id: 'last-name',   label: 'Last name' },
    { id: 'email',       label: 'Email address' },
    { id: 'address',     label: 'Street address' },
    { id: 'suburb',      label: 'Suburb' },
    { id: 'postcode',    label: 'Postcode' },
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
      id: item.id,
      name: item.name,
      price: item.price,
      quantity: item.quantity
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
    }
  };

  try {
    // BACKEND: POST /api/create-checkout
    // Returns { checkoutUrl } from Square Checkout API
    const response = await fetch('/api/create-checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.message || `Server error: ${response.status}`);
    }

    const { checkoutUrl } = await response.json();

    if (!checkoutUrl) throw new Error('No checkout URL received from payment server.');

    // Redirect to Square hosted checkout
    window.location.href = checkoutUrl;

  } catch (err) {
    console.error('Checkout error:', err);
    showError(
      err.message.includes('fetch')
        ? 'Unable to connect to payment server. Please check your connection and try again, or call us on 1300 872 267.'
        : err.message
    );
    btn.disabled = false;
    btn.innerHTML = '<svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/></svg> Proceed to Payment';
  }
});
