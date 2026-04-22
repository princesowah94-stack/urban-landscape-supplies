/**
 * products.js — Product data loading, rendering, and filtering
 */

let allProducts = [];
let allBulkMaterials = [];
let productsLoaded = false;

// ─── DATA LOADING ──────────────────────────────────────────────
async function loadProducts() {
  if (productsLoaded) return { products: allProducts, bulkMaterials: allBulkMaterials };
  try {
    const res = await fetch('data/products.json');
    const data = await res.json();
    allProducts = data.products;
    allBulkMaterials = data.bulkMaterials;
    productsLoaded = true;
    return data;
  } catch (err) {
    console.error('Failed to load products.json', err);
    return { products: [], bulkMaterials: [] };
  }
}

function getProductById(id) {
  return allProducts.find(p => p.id === id) || null;
}

// ─── PRODUCT CARD HTML ─────────────────────────────────────────
function buildProductCard(product) {
  const badgeHtml = product.badge
    ? `<span class="badge ${product.badge === 'Bestseller' ? 'badge--dark' : 'badge--sage'} product-card__badge">${product.badge}</span>`
    : '';

  const pkgToggle = product.bulkBagPrice ? `
    <div class="pkg-toggle" data-id="${product.id}">
      <button class="pkg-btn pkg-btn--active" data-pkg="bag"
        data-price="${product.price}" data-unit="${product.unit}">
        20kg Bags
      </button>
      <button class="pkg-btn" data-pkg="bulk"
        data-price="${product.bulkBagPrice}" data-unit="per tonne bulk bag">
        1 Tonne Bulk Bag
      </button>
    </div>
  ` : '';

  return `
    <article class="product-card" data-id="${product.id}" onclick="window.location='product-detail.html?id=${product.id}'">
      <div class="product-card__image-wrap">
        <img
          src="${product.image}"
          alt="${product.name}"
          class="product-card__image"
          loading="lazy"
          onerror="this.src='images/products/placeholder.jpg'"
        />
        ${badgeHtml}
      </div>
      <div class="product-card__body">
        <span class="product-card__category">${product.categoryLabel}</span>
        <h3 class="product-card__name">${product.name}</h3>
        <p class="product-card__desc">${product.description}</p>
        ${product.sizes && product.sizes.length > 1 ? `<div class="product-card__sizes">${product.sizes.map(s => `<span>${s}</span>`).join('')}</div>` : ''}
        ${pkgToggle}
        <div class="product-card__footer">
          <div>
            <span class="product-card__price" id="price-${product.id}">$${product.price.toFixed(2)}</span>
            <span class="product-card__price-unit" id="unit-${product.id}"> ${product.unit}</span>
          </div>
          <button
            class="product-card__add-btn"
            onclick="event.stopPropagation(); addToCartFromCard('${product.id}')"
            ${product.inStock ? '' : 'disabled'}
            aria-label="Add ${product.name} to cart"
          >${product.inStock ? 'Add to Cart' : 'Out of Stock'}</button>
        </div>
      </div>
    </article>
  `;
}

// ─── ADD TO CART FROM CARD ─────────────────────────────────────
function addToCartFromCard(productId) {
  const product = getProductById(productId);
  if (!product) return;

  const toggle = document.querySelector(`.pkg-toggle[data-id="${productId}"]`);
  const activeBtn = toggle?.querySelector('.pkg-btn--active');
  const isBulk = activeBtn?.dataset.pkg === 'bulk';

  addToCart({
    id:       isBulk ? `${product.id}-bulk` : product.id,
    name:     isBulk ? `${product.name} (1 Tonne Bulk Bag)` : product.name,
    price:    isBulk ? product.bulkBagPrice : product.price,
    unit:     isBulk ? 'per tonne bulk bag' : product.unit,
    image:    product.image,
    quantity: 1
  });

  // Flash button feedback
  const cards = document.querySelectorAll(`.product-card[data-id="${productId}"] .product-card__add-btn`);
  cards.forEach(btn => {
    const original = btn.textContent;
    btn.textContent = '✓ Added';
    btn.classList.add('added');
    setTimeout(() => {
      btn.textContent = original;
      btn.classList.remove('added');
    }, 1400);
  });
}

// ─── RENDER FEATURED ──────────────────────────────────────────
async function renderFeaturedProducts(containerId, count = 4) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const { products } = await loadProducts();
  const featured = products.filter(p => p.featured).slice(0, count);

  container.innerHTML = featured.map(buildProductCard).join('');
}

// ─── RENDER CATALOG ────────────────────────────────────────────
async function renderCatalog(containerId, { category = null, search = '' } = {}) {
  const container = document.getElementById(containerId);
  if (!container) return;

  container.innerHTML = '<div class="loading-cards">' + Array(8).fill('<div class="product-card-skeleton"></div>').join('') + '</div>';

  const { products } = await loadProducts();

  let filtered = products;

  if (category && category !== 'all') {
    filtered = filtered.filter(p => p.category === category);
  }

  if (search.trim()) {
    const q = search.trim().toLowerCase();
    filtered = filtered.filter(p =>
      p.name.toLowerCase().includes(q) ||
      p.description.toLowerCase().includes(q) ||
      p.categoryLabel.toLowerCase().includes(q)
    );
  }

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="empty-state" style="grid-column:1/-1">
        <div class="empty-state__icon">🌿</div>
        <h3 class="empty-state__title">No products found</h3>
        <p class="empty-state__text">Try a different category or clear your search filter.</p>
        <button class="btn btn--secondary" onclick="clearFilters()">Clear Filters</button>
      </div>
    `;
    return;
  }

  container.innerHTML = filtered.map(buildProductCard).join('');
  updateResultCount(filtered.length);
  initPackagingToggles(containerId);
}

// ─── PACKAGING TOGGLE ──────────────────────────────────────────
function initPackagingToggles(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.addEventListener('click', e => {
    const btn = e.target.closest('.pkg-btn');
    if (!btn) return;
    e.stopPropagation();
    const toggle = btn.closest('.pkg-toggle');
    toggle.querySelectorAll('.pkg-btn').forEach(b => b.classList.remove('pkg-btn--active'));
    btn.classList.add('pkg-btn--active');
    const id = toggle.dataset.id;
    document.getElementById(`price-${id}`).textContent = `$${parseFloat(btn.dataset.price).toFixed(2)}`;
    document.getElementById(`unit-${id}`).textContent = ` ${btn.dataset.unit}`;
  });
}

// ─── RENDER PRODUCT DETAIL ─────────────────────────────────────
async function renderProductDetail() {
  const params = new URLSearchParams(window.location.search);
  const id = params.get('id');

  if (!id) { window.location.href = 'products.html'; return; }

  await loadProducts();
  const product = getProductById(id);

  if (!product) { window.location.href = 'products.html'; return; }

  // Update page meta
  document.title = `${product.name} | Urban Landscape Supplies`;
  document.querySelector('meta[name="description"]')?.setAttribute('content', product.description);

  // Breadcrumb
  const bc = document.getElementById('breadcrumb-product');
  if (bc) {
    bc.textContent = product.name;
    document.getElementById('breadcrumb-category-link').href = `products.html?cat=${product.category}`;
    document.getElementById('breadcrumb-category-label').textContent = product.categoryLabel;
  }

  // Product image / carousel
  initProductGallery(product);

  // Text content
  setTextById('detail-category', product.categoryLabel);
  setTextById('detail-name', product.name);
  setTextById('detail-desc', product.description);
  setTextById('detail-price', `$${product.price.toFixed(2)}`);
  setTextById('detail-unit', product.unit);
  setTextById('detail-sku', product.sku);

  // Size selector
  const sizeWrap = document.getElementById('detail-size-selector');
  if (sizeWrap) {
    if (product.sizes && product.sizes.length > 0) {
      let selectedSize = product.sizes[0];
      sizeWrap.innerHTML = `
        <div class="size-selector">
          <p class="size-selector__label">Size</p>
          <div class="size-selector__options">
            ${product.sizes.map((s, i) => `
              <button class="size-btn${i === 0 ? ' size-btn--active' : ''}" data-size="${s}">${s}</button>
            `).join('')}
          </div>
          ${product.supplier ? `<p class="size-selector__supplier">Supplied by ${product.supplier}</p>` : ''}
        </div>
      `;
      sizeWrap.querySelectorAll('.size-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          selectedSize = btn.dataset.size;
          sizeWrap.querySelectorAll('.size-btn').forEach(b => b.classList.remove('size-btn--active'));
          btn.classList.add('size-btn--active');
        });
      });
      // Expose for Add to Cart
      sizeWrap._getSelectedSize = () => selectedSize;
    } else {
      sizeWrap.innerHTML = '';
    }
  }

  // Features list
  const featList = document.getElementById('detail-features');
  if (featList && product.features) {
    featList.innerHTML = product.features.map(f => `<li>${f}</li>`).join('');
  }

  // Badge
  const badge = document.getElementById('detail-badge');
  if (badge && product.badge) { badge.textContent = product.badge; badge.style.display = ''; }
  else if (badge) badge.style.display = 'none';

  // Stock status
  const addBtn = document.getElementById('detail-add-btn');
  if (addBtn) {
    if (!product.inStock) {
      addBtn.textContent = 'Out of Stock';
      addBtn.disabled = true;
    } else {
      addBtn.onclick = () => {
        const qty = parseInt(document.getElementById('detail-qty')?.value || '1', 10);
        const sizeWrap = document.getElementById('detail-size-selector');
        const selectedSize = sizeWrap?._getSelectedSize?.();
        const cartName = selectedSize ? `${product.name} (${selectedSize})` : product.name;
        addToCart({ id: product.id + (selectedSize ? `-${selectedSize}` : ''), name: cartName, price: product.price, unit: product.unit, image: product.image, quantity: qty });
        addBtn.textContent = '✓ Added to Cart';
        addBtn.classList.add('added');
        setTimeout(() => { addBtn.textContent = 'Add to Cart'; addBtn.classList.remove('added'); }, 1600);
      };
    }
  }

  // Related products
  renderRelatedProducts(product);

  // JSON-LD Product schema
  injectProductSchema(product);
}

function renderRelatedProducts(product) {
  const container = document.getElementById('related-products');
  if (!container) return;
  const related = allProducts
    .filter(p => p.category === product.category && p.id !== product.id)
    .slice(0, 4);
  if (related.length === 0) { container.closest('section')?.remove(); return; }
  container.innerHTML = related.map(buildProductCard).join('');
}

function injectProductSchema(product) {
  const schema = {
    "@context": "https://schema.org",
    "@type": "Product",
    "name": product.name,
    "description": product.description,
    "image": `https://urbanlandscapesupplies.com.au/${product.image}`,
    "sku": product.sku,
    "brand": { "@type": "Brand", "name": "Urban Landscape Supplies" },
    "offers": {
      "@type": "Offer",
      "priceCurrency": "AUD",
      "price": product.price,
      "availability": product.inStock ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
      "seller": { "@type": "Organization", "name": "Urban Landscape Supplies" }
    }
  };
  const script = document.createElement('script');
  script.type = 'application/ld+json';
  script.textContent = JSON.stringify(schema);
  document.head.appendChild(script);
}

// ─── HELPER ────────────────────────────────────────────────────
function initProductGallery(product) {
  const images = (product.images && product.images.length > 1) ? product.images : [product.image];
  let current = 0;
  const gallery = document.getElementById('product-gallery');
  if (!gallery) return;

  const multi = images.length > 1;
  const chevL = `<svg width="22" height="22" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7"/></svg>`;
  const chevR = `<svg width="22" height="22" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7"/></svg>`;

  gallery.innerHTML = `
    <div class="pgal">
      <div class="pgal__viewport">
        <div class="pgal__track" id="pgal-track">
          ${images.map((src, i) => `
            <div class="pgal__slide">
              <img src="${src}" alt="${product.name}" loading="${i === 0 ? 'eager' : 'lazy'}" onerror="this.style.background='var(--color-gray-200)'" />
            </div>
          `).join('')}
        </div>

        ${multi ? `
          <button class="pgal__arrow pgal__arrow--prev" id="pgal-prev" aria-label="Previous image">${chevL}</button>
          <button class="pgal__arrow pgal__arrow--next" id="pgal-next" aria-label="Next image">${chevR}</button>
          <div class="pgal__dots">
            ${images.map((_, i) => `<button class="pgal__dot${i === 0 ? ' pgal__dot--on' : ''}" data-i="${i}" aria-label="Image ${i + 1}"></button>`).join('')}
          </div>
        ` : ''}
      </div>

      ${multi ? `
        <div class="pgal__counter" id="pgal-counter">1 / ${images.length}</div>
      ` : ''}
    </div>
  `;

  if (!multi) return;

  const track   = document.getElementById('pgal-track');
  const counter = document.getElementById('pgal-counter');
  const dots    = gallery.querySelectorAll('.pgal__dot');

  function goTo(index) {
    current = (index + images.length) % images.length;
    track.style.transform = `translateX(-${current * 100}%)`;
    if (counter) counter.textContent = `${current + 1} / ${images.length}`;
    dots.forEach((d, i) => d.classList.toggle('pgal__dot--on', i === current));
  }

  document.getElementById('pgal-prev').addEventListener('click', () => goTo(current - 1));
  document.getElementById('pgal-next').addEventListener('click', () => goTo(current + 1));
  dots.forEach(d => d.addEventListener('click', () => goTo(parseInt(d.dataset.i))));

  // Touch swipe
  let tx = 0;
  const vp = gallery.querySelector('.pgal__viewport');
  vp.addEventListener('touchstart', e => { tx = e.touches[0].clientX; }, { passive: true });
  vp.addEventListener('touchend', e => {
    const diff = tx - e.changedTouches[0].clientX;
    if (Math.abs(diff) > 40) goTo(current + (diff > 0 ? 1 : -1));
  });
}

function setTextById(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function updateResultCount(n) {
  const el = document.getElementById('result-count');
  if (el) el.textContent = `${n} product${n !== 1 ? 's' : ''}`;
}

function clearFilters() {
  window.location.href = 'products.html';
}
