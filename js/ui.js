/**
 * ui.js — Mobile nav, header scroll, bulk quote count, accordions, misc UI
 */

const BULK_KEY = 'uls_bulk_quote';

// ─── MOBILE NAV ─────────────────────────────────────────────────
function openMobileNav() {
  document.getElementById('mobile-nav')?.classList.add('open');
  document.getElementById('mobile-menu-btn')?.classList.add('open');
  document.getElementById('overlay')?.classList.add('active');
  document.body.style.overflow = 'hidden';
}

function closeMobileNav() {
  document.getElementById('mobile-nav')?.classList.remove('open');
  document.getElementById('mobile-menu-btn')?.classList.remove('open');
  document.getElementById('overlay')?.classList.remove('active');
  document.body.style.overflow = '';
}

// ─── HEADER SCROLL ──────────────────────────────────────────────
function initHeaderScroll() {
  const header = document.getElementById('site-header');
  if (!header) return;

  const onScroll = () => {
    header.classList.toggle('scrolled', window.scrollY > 20);
  };

  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
}

// ─── BULK QUOTE STATE ────────────────────────────────────────────
function getBulkQuote() {
  try { return JSON.parse(localStorage.getItem(BULK_KEY)) || []; }
  catch { return []; }
}

function saveBulkQuote(items) {
  localStorage.setItem(BULK_KEY, JSON.stringify(items));
  syncBulkQuoteUI();
}

function addToBulkQuote(item) {
  const quote = getBulkQuote();
  const existing = quote.find(q => q.id === item.id);
  if (existing) {
    existing.quantity = (parseFloat(existing.quantity) + parseFloat(item.quantity || 1));
  } else {
    quote.push({ id: item.id, name: item.name, unit: item.unit, price: item.price, quantity: parseFloat(item.quantity || 1) });
  }
  saveBulkQuote(quote);
  showToast?.(`"${item.name}" added to bulk quote`);
}

function removeFromBulkQuote(id) {
  saveBulkQuote(getBulkQuote().filter(q => q.id !== id));
}

function updateBulkQty(id, qty) {
  const q = parseFloat(qty);
  if (q <= 0) { removeFromBulkQuote(id); return; }
  const quote = getBulkQuote();
  const item = quote.find(q => q.id === id);
  if (item) { item.quantity = q; saveBulkQuote(quote); }
}

function syncBulkQuoteUI() {
  const quote = getBulkQuote();
  const count = quote.length;

  const btn = document.getElementById('bulk-quote-btn');
  const countEl = document.getElementById('bulk-quote-count');

  if (btn) btn.style.display = count > 0 ? 'flex' : 'none';
  if (countEl) countEl.textContent = count;
}

// ─── ACCORDIONS ─────────────────────────────────────────────────
function initAccordions() {
  document.querySelectorAll('.accordion-trigger').forEach(trigger => {
    trigger.addEventListener('click', () => {
      const item = trigger.closest('.accordion-item');
      const isOpen = item.classList.contains('open');

      // Close all siblings
      trigger.closest('.accordion-list')?.querySelectorAll('.accordion-item').forEach(el => {
        el.classList.remove('open');
      });

      if (!isOpen) item.classList.add('open');
    });
  });
}

// ─── CATEGORY FILTER ────────────────────────────────────────────
function initCategoryFilter() {
  const params = new URLSearchParams(window.location.search);
  const initialCat = params.get('cat') || 'all';

  const filterBtns = document.querySelectorAll('[data-filter-cat]');
  const searchInput = document.getElementById('product-search');
  const catalogContainer = document.getElementById('product-catalog');

  if (!catalogContainer) return;

  let currentCat = initialCat;
  let currentSearch = '';

  // Set initial active filter
  filterBtns.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.filterCat === currentCat);
  });

  filterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      currentCat = btn.dataset.filterCat;
      filterBtns.forEach(b => b.classList.toggle('active', b.dataset.filterCat === currentCat));
      renderCatalog?.('product-catalog', { category: currentCat === 'all' ? null : currentCat, search: currentSearch });

      // Update URL without reload
      const url = new URL(window.location);
      if (currentCat === 'all') url.searchParams.delete('cat');
      else url.searchParams.set('cat', currentCat);
      history.replaceState(null, '', url);
    });
  });

  // Search
  let searchDebounce;
  searchInput?.addEventListener('input', e => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => {
      currentSearch = e.target.value;
      renderCatalog?.('product-catalog', { category: currentCat === 'all' ? null : currentCat, search: currentSearch });
    }, 280);
  });

  // Initial render
  renderCatalog?.('product-catalog', { category: currentCat === 'all' ? null : currentCat });
}

// ─── BULK CALCULATOR ────────────────────────────────────────────
function calcBulkVolume(areaM2, depthCm) {
  const area = parseFloat(areaM2) || 0;
  const depth = parseFloat(depthCm) || 0;
  return (area * depth / 100).toFixed(2);
}

function initBulkCalculators() {
  document.querySelectorAll('.js-bulk-calc').forEach(form => {
    const areaInput = form.querySelector('.js-calc-area');
    const depthInput = form.querySelector('.js-calc-depth');
    const resultEl = form.querySelector('.js-calc-result');

    const recalc = () => {
      const vol = calcBulkVolume(areaInput?.value, depthInput?.value);
      if (resultEl) {
        resultEl.textContent = vol;
      }
    };

    areaInput?.addEventListener('input', recalc);
    depthInput?.addEventListener('input', recalc);
  });
}

// ─── CART PAGE ──────────────────────────────────────────────────
function renderCartPage() {
  const container = document.getElementById('cart-page-items');
  const subtotalEl = document.getElementById('cart-page-subtotal');
  const totalEl = document.getElementById('cart-page-total');
  const checkoutBtn = document.getElementById('cart-checkout-btn');
  if (!container) return;

  const cart = getCart?.() || [];

  if (cart.length === 0) {
    container.innerHTML = `
      <div class="empty-state" style="padding:var(--sp-16) 0">
        <div class="empty-state__icon">🛒</div>
        <h3 class="empty-state__title">Your cart is empty</h3>
        <p class="empty-state__text">You haven't added anything yet — browse our products to get started.</p>
        <a href="products.html" class="btn btn--primary" style="margin-top:var(--sp-6)">Browse Products</a>
      </div>
    `;
    if (checkoutBtn) checkoutBtn.style.display = 'none';
    return;
  }

  container.innerHTML = cart.map(item => `
    <div class="cart-item" data-id="${item.id}">
      <img src="${item.image}" alt="${item.name}" class="cart-item__img" onerror="this.src='images/products/placeholder.jpg'" />
      <div>
        <p class="cart-item__name" style="font-size:var(--text-md)">${item.name}</p>
        <p class="cart-item__meta">${item.unit}</p>
        <div class="qty-stepper" style="margin-top:var(--sp-3)">
          <button class="qty-stepper__btn" onclick="updateCartQty?.('${item.id}', ${item.quantity - 1}); renderCartPage()">−</button>
          <input class="qty-stepper__val" type="number" value="${item.quantity}" min="1"
            onchange="updateCartQty?.('${item.id}', this.value); renderCartPage()" />
          <button class="qty-stepper__btn" onclick="updateCartQty?.('${item.id}', ${item.quantity + 1}); renderCartPage()">+</button>
        </div>
      </div>
      <div style="display:flex;flex-direction:column;align-items:flex-end;gap:var(--sp-2)">
        <span style="font-size:var(--text-xl);font-weight:700;color:var(--color-price)">$${(item.price * item.quantity).toFixed(2)}</span>
        <span style="font-size:var(--text-sm);color:var(--color-text-muted)">$${item.price.toFixed(2)} each</span>
        <button class="cart-item__remove" onclick="removeFromCart?.('${item.id}'); renderCartPage()">× Remove</button>
      </div>
    </div>
  `).join('');

  const subtotal = cart.reduce((s, i) => s + i.price * i.quantity, 0);
  if (subtotalEl) subtotalEl.textContent = `$${subtotal.toFixed(2)}`;
  if (totalEl) totalEl.textContent = `$${subtotal.toFixed(2)}`;
}

// ─── SCROLL REVEAL ──────────────────────────────────────────────
function initScrollReveal() {
  if (!('IntersectionObserver' in window)) return;
  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('revealed');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.08, rootMargin: '0px 0px -40px 0px' });

  document.querySelectorAll('.reveal').forEach(el => observer.observe(el));
}

// ─── INIT ────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Mobile nav toggle
  document.getElementById('mobile-menu-btn')?.addEventListener('click', () => {
    const isOpen = document.getElementById('mobile-nav')?.classList.contains('open');
    isOpen ? closeMobileNav() : openMobileNav();
  });

  initHeaderScroll();
  initAccordions();
  initBulkCalculators();
  initScrollReveal();
  syncBulkQuoteUI();

  // Products page
  if (document.getElementById('product-catalog')) {
    initCategoryFilter();
  }

  // Cart page
  if (document.getElementById('cart-page-items')) {
    renderCartPage();
    window.addEventListener('cart:update', renderCartPage);
  }
});
