/**
 * cart.js — Shopping cart state (localStorage), add/remove/update, event dispatch
 */

const CART_KEY = 'uls_cart';

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
        <a href="products.html" class="btn btn--primary" style="margin-top:var(--sp-4)" onclick="closeCartDrawer()">Shop Now</a>
      </div>
    `;
    return;
  }

  container.innerHTML = cart.map(item => `
    <div class="cart-item" data-id="${item.id}">
      <img
        src="${item.image}"
        alt="${item.name}"
        class="cart-item__img"
        onerror="this.src='images/products/placeholder.jpg'"
      />
      <div>
        <p class="cart-item__name">${item.name}</p>
        <p class="cart-item__meta">${item.unit}</p>
        <div class="qty-stepper">
          <button class="qty-stepper__btn" onclick="updateCartQty('${item.id}', ${item.quantity - 1})" aria-label="Decrease quantity">−</button>
          <input class="qty-stepper__val" type="number" value="${item.quantity}" min="1"
            onchange="updateCartQty('${item.id}', this.value)"
            aria-label="Quantity"
          />
          <button class="qty-stepper__btn" onclick="updateCartQty('${item.id}', ${item.quantity + 1})" aria-label="Increase quantity">+</button>
        </div>
      </div>
      <div style="display:flex;flex-direction:column;align-items:flex-end;gap:var(--sp-2)">
        <span class="cart-item__price">${formatPrice(item.price * item.quantity)}</span>
        <button class="cart-item__remove" onclick="removeFromCart('${item.id}')" aria-label="Remove ${item.name}">×</button>
      </div>
    </div>
  `).join('');
}

// ─── DRAWER OPEN/CLOSE ──────────────────────────────────────────
function openCartDrawer() {
  document.getElementById('cart-drawer')?.classList.add('open');
  document.getElementById('overlay')?.classList.add('active');
  document.body.style.overflow = 'hidden';
}

function closeCartDrawer() {
  document.getElementById('cart-drawer')?.classList.remove('open');
  document.getElementById('overlay')?.classList.remove('active');
  document.body.style.overflow = '';
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
  document.getElementById('cart-toggle')?.addEventListener('click', openCartDrawer);
  document.getElementById('cart-close')?.addEventListener('click', closeCartDrawer);

  // Overlay click closes drawer
  document.getElementById('overlay')?.addEventListener('click', () => {
    closeCartDrawer();
    closeMobileNav();
  });
});
