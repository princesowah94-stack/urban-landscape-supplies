/**
 * cart.js — Shopping cart state (localStorage), add/remove/update, event dispatch
 */

const CART_KEY = 'uls_cart';

const esc = s => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');

// ─── STORAGE ────────────────────────────────────────────────────
function getCart() {
  try {
    return JSON.parse(localStorage.getItem(CART_KEY)) || [];
  } catch {
    return [];
  }
}

function saveCart(cart) {
  localStorage.setItem(CART_KEY, JSON.stringify(cart));
  dispatchCartUpdate(cart);
}

function dispatchCartUpdate(cart) {
  window.dispatchEvent(new CustomEvent('cart:update', { detail: { cart } }));
}

// ─── MUTATIONS ──────────────────────────────────────────────────
function addToCart(item) {
  // item: { id, name, price, unit, image, quantity }
  const cart = getCart();
  const existing = cart.find(c => c.id === item.id);

  if (existing) {
    existing.quantity += (item.quantity || 1);
  } else {
    cart.push({
      id: item.id,
      name: item.name,
      price: parseFloat(item.price),
      unit: item.unit || '',
      image: item.image || '',
      quantity: parseInt(item.quantity, 10) || 1
    });
  }

  saveCart(cart);

  if (typeof window.trackEvent === 'function') {
    window.trackEvent('add_to_cart', {
      currency: 'AUD',
      value: parseFloat(item.price) * (parseInt(item.quantity, 10) || 1),
      items: [{ item_id: item.id, item_name: item.name, price: parseFloat(item.price), quantity: parseInt(item.quantity, 10) || 1 }]
    });
  }

  showToast(`"${item.name}" added to cart`);
  openCartDrawer();
}

function removeFromCart(id) {
  const cart = getCart().filter(c => c.id !== id);
  saveCart(cart);
}

function updateCartQty(id, qty) {
  const q = parseInt(qty, 10);
  if (q < 1) { removeFromCart(id); return; }
  const cart = getCart();
  const item = cart.find(c => c.id === id);
  if (item) { item.quantity = q; saveCart(cart); }
}

function clearCart() {
  localStorage.removeItem(CART_KEY);
  dispatchCartUpdate([]);
}

// ─── COMPUTED ───────────────────────────────────────────────────
function cartTotal(cart) {
  return cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
}

function cartItemCount(cart) {
  return cart.reduce((sum, item) => sum + item.quantity, 0);
}

function formatPrice(n) {
  return `$${n.toFixed(2)}`;
}

// ─── UI SYNC ────────────────────────────────────────────────────
function syncCartUI(cart) {
  const count = cartItemCount(cart);

  // Header badge
  document.querySelectorAll('#cart-count, .cart-count-sync').forEach(el => {
    el.textContent = count;
    el.style.display = count > 0 ? '' : 'none';
    if (count > 0) {
      el.classList.add('bump');
      setTimeout(() => el.classList.remove('bump'), 400);
    }
  });

  // Drawer count label
  const drawerCount = document.getElementById('drawer-item-count');
  if (drawerCount) drawerCount.textContent = count > 0 ? `(${count} item${count !== 1 ? 's' : ''})` : '';

  // Render drawer items
  renderDrawerItems(cart);

  // Subtotal
  const subtotalEl = document.getElementById('cart-subtotal');
  if (subtotalEl) subtotalEl.textContent = formatPrice(cartTotal(cart));

  // Checkout button state
  const checkoutBtn = document.getElementById('drawer-checkout-btn');
  if (checkoutBtn) {
    checkoutBtn.style.opacity = count > 0 ? '1' : '0.5';
    checkoutBtn.style.pointerEvents = count > 0 ? '' : 'none';
  }
}

function renderDrawerItems(cart) {
  const container = document.getElementById('cart-drawer-items');
  if (!container) return;

  if (cart.length === 0) {
    container.innerHTML = `
      <div class="empty-state" style="padding: var(--sp-12) var(--sp-6)">
        <div class="empty-state__icon">🛒</div>
        <h3 class="empty-state__title">Your cart is empty</h3>
        <p class="empty-state__text">Browse our products and add something to get started.</p>
        <a href="/products" class="btn btn--primary" style="margin-top:var(--sp-4)" onclick="closeCartDrawer()">Shop Now</a>
      </div>
    `;
    return;
  }

  container.innerHTML = cart.map(item => `
    <div class="cart-item" data-id="${esc(item.id)}">
      <picture>
        <source type="image/webp" srcset="${esc((item.image || '').replace(/\.jpe?g$/i, '.webp'))}" />
        <img
          src="${esc(item.image)}"
          alt="${esc(item.name)}"
          class="cart-item__img"
          loading="lazy"
          onerror="this.src='images/products/placeholder.jpg'"
        />
      </picture>
      <div>
        <p class="cart-item__name">${esc(item.name)}</p>
        <p class="cart-item__meta">${esc(item.unit)}</p>
        <div class="qty-stepper">
          <button class="qty-stepper__btn" onclick="updateCartQty(${JSON.stringify(item.id)}, ${parseInt(item.quantity, 10) - 1})" aria-label="Decrease quantity">−</button>
          <input class="qty-stepper__val" type="number" value="${parseInt(item.quantity, 10)}" min="1"
            onchange="updateCartQty(${JSON.stringify(item.id)}, this.value)"
            aria-label="Quantity"
          />
          <button class="qty-stepper__btn" onclick="updateCartQty(${JSON.stringify(item.id)}, ${parseInt(item.quantity, 10) + 1})" aria-label="Increase quantity">+</button>
        </div>
      </div>
      <div style="display:flex;flex-direction:column;align-items:flex-end;gap:var(--sp-2)">
        <span class="cart-item__price">${formatPrice(parseFloat(item.price) * parseInt(item.quantity, 10))}</span>
        <button class="cart-item__remove" onclick="removeFromCart(${JSON.stringify(item.id)})" aria-label="Remove ${esc(item.name)}">×</button>
      </div>
    </div>
  `).join('');
}

// ─── DRAWER OPEN/CLOSE ──────────────────────────────────────────
let _cartTrigger = null;
let _trapHandler = null;

function getFocusable(el) {
  return [...el.querySelectorAll('a[href],button:not([disabled]),input,[tabindex]:not([tabindex="-1"])')];
}

function trapFocus(e, drawer) {
  if (e.key === 'Escape') { closeCartDrawer(); return; }
  if (e.key !== 'Tab') return;
  const els = getFocusable(drawer);
  if (!els.length) return;
  const first = els[0], last = els[els.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}

function openCartDrawer(triggerEl) {
  _cartTrigger = triggerEl || document.getElementById('cart-toggle');
  const drawer = document.getElementById('cart-drawer');
  drawer?.classList.add('open');
  document.getElementById('overlay')?.classList.add('active');
  document.body.style.overflow = 'hidden';
  const focusable = getFocusable(drawer);
  if (focusable.length) focusable[0].focus();
  _trapHandler = (e) => trapFocus(e, drawer);
  drawer?.addEventListener('keydown', _trapHandler);
}

function closeCartDrawer() {
  const drawer = document.getElementById('cart-drawer');
  drawer?.classList.remove('open');
  if (_trapHandler) { drawer?.removeEventListener('keydown', _trapHandler); _trapHandler = null; }
  document.getElementById('overlay')?.classList.remove('active');
  document.body.style.overflow = '';
  _cartTrigger?.focus();
  _cartTrigger = null;
}

// ─── TOAST ──────────────────────────────────────────────────────
let toastTimer;
function showToast(message) {
  const toast = document.getElementById('toast');
  const msg = document.getElementById('toast-msg');
  if (!toast || !msg) return;

  msg.textContent = message;
  toast.classList.add('toast--visible');

  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('toast--visible'), 2800);
}

// ─── CHECKOUT PAYLOAD ───────────────────────────────────────────
function buildCheckoutPayload(customerEmail = '') {
  const cart = getCart();
  return {
    items: cart.map(item => ({
      id: item.id,
      name: item.name,
      price: item.price,
      quantity: item.quantity
    })),
    customerEmail,
    totalAUD: cartTotal(cart)
  };
}

// ─── INIT ───────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Initial UI sync
  syncCartUI(getCart());

  // Listen for cart updates
  window.addEventListener('cart:update', e => syncCartUI(e.detail.cart));

  // Cart toggle button
  document.getElementById('cart-toggle')?.addEventListener('click', e => openCartDrawer(e.currentTarget));
  document.getElementById('cart-close')?.addEventListener('click', closeCartDrawer);

  // begin_checkout — fired when user navigates from cart drawer to checkout
  document.getElementById('drawer-checkout-btn')?.addEventListener('click', () => {
    const cart = getCart();
    if (cart.length === 0) return;
    if (typeof window.trackEvent === 'function') {
      window.trackEvent('begin_checkout', {
        currency: 'AUD',
        value: cartTotal(cart),
        items: cart.map(i => ({ item_id: i.id, item_name: i.name, price: i.price, quantity: i.quantity }))
      });
    }
  });

  // Overlay click closes drawer
  document.getElementById('overlay')?.addEventListener('click', () => {
    closeCartDrawer();
    closeMobileNav();
  });
});
