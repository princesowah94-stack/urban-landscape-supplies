/**
 * products.js — Product data loading, rendering, and filtering
 */

let allProducts = [];
let allBulkMaterials = [];
let productsLoaded = false;
let stockMap = {};

// ─── DATA LOADING ──────────────────────────────────────────────
async function loadProducts() {
  if (productsLoaded) return { products: allProducts, bulkMaterials: allBulkMaterials };
  try {
    // Fetch live product data from Supabase via /api/products.
    // Falls back to the static JSON file if the API is unavailable.
    const res = await fetch('/api/products');
    if (!res.ok) throw new Error(`/api/products returned ${res.status}`);
    const data = await res.json();
    allProducts = data.products || [];
    // bulkMaterials are not yet in Supabase — keep reading from static JSON
    try {
      const staticRes = await fetch('/data/products.json');
      const staticData = await staticRes.json();
      allBulkMaterials = staticData.bulkMaterials || [];
    } catch (_) {
      allBulkMaterials = [];
    }
    productsLoaded = true;
    return { products: allProducts, bulkMaterials: allBulkMaterials };
  } catch (err) {
    console.error('Failed to load products from API, falling back to static JSON', err);
    try {
      const res = await fetch('/data/products.json');
      const data = await res.json();
      allProducts = data.products || [];
      allBulkMaterials = data.bulkMaterials || [];
      productsLoaded = true;
      return data;
    } catch (fallbackErr) {
      console.error('Static JSON fallback also failed', fallbackErr);
      return { products: [], bulkMaterials: [] };
    }
  }
}

function getProductById(id) {
  return allProducts.find(p => p.id === id) || null;
}

async function loadStock() {
  try {
    const res = await fetch('/api/stock');
    if (!res.ok) return;
    const { inventory } = await res.json();
    stockMap = Object.fromEntries((inventory || []).map(i => [i.product_id, i]));
  } catch { /* stock display is non-critical */ }
}

function stockBadgeHtml(productId) {
  const inv = stockMap[productId];
  if (!inv) return '';
  if (inv.stock === 0) return `<span class="stock-badge stock-badge--out">Out of stock</span>`;
  if (inv.stock <= inv.low_stock_threshold) return `<span class="stock-badge stock-badge--low">Only ${inv.stock} left!</span>`;
  return `<span class="stock-badge stock-badge--in">${inv.stock} available</span>`;
}

function applyStockToBadgeEl(inv) {
  const badge = document.getElementById('stock-badge');
  if (!badge) return;
  if (inv.stock === 0) {
    badge.className = 'stock-badge stock-badge--out';
    badge.textContent = 'Out of stock';
  } else if (inv.stock <= inv.low_stock_threshold) {
    badge.className = 'stock-badge stock-badge--low';
    badge.textContent = `Only ${inv.stock} left!`;
  } else {
    badge.className = 'stock-badge stock-badge--in';
    badge.textContent = `${inv.stock} available`;
  }
}

async function initRealtimeStock(productId) {
  try {
    const cfg = await fetch('/api/public-config').then(r => r.json());
    if (!cfg.supabaseUrl || !cfg.supabaseAnonKey || !window.supabase) return;
    const client = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
    client
      .channel(`inventory-${productId}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'inventory',
        filter: `product_id=eq.${productId}`,
      }, (payload) => {
        const inv = payload.new;
        stockMap[productId] = inv;
        applyStockToBadgeEl(inv);
        const addBtn = document.getElementById('detail-add-btn');
        if (addBtn && inv.stock === 0) {
          addBtn.textContent = 'Out of Stock';
          addBtn.disabled = true;
        }
      })
      .subscribe();
  } catch { /* realtime is non-critical */ }
}

// Returns the .webp sibling of an /images/products/*.jpg path; falls through
// for anything that doesn't match (e.g. external URLs, png placeholders).
// Only the site's own optimised images have .webp/.avif siblings. CRM-uploaded
// images (absolute Storage URLs) don't, so return the original for those —
// a <source> that 404s would NOT fall back to <img src>.
function hasOptimisedSiblings(p) {
  return typeof p === 'string' && p.startsWith('/images/products/');
}
function webpFor(jpgPath) {
  return hasOptimisedSiblings(jpgPath) ? jpgPath.replace(/\.jpe?g$/i, '.webp') : jpgPath;
}

function avifFor(srcPath) {
  return hasOptimisedSiblings(srcPath) ? srcPath.replace(/\.(jpe?g|webp|png)$/i, '.avif') : srcPath;
}

// Responsive srcset using the -640 / -1024 variants made by
// scripts/make-responsive-images.js. Non-site images (CRM uploads) get the
// single original URL.
function srcsetFor(srcPath, ext) {
  if (!hasOptimisedSiblings(srcPath)) return srcPath;
  const base = srcPath.replace(/\.(jpe?g|webp|png|avif)$/i, '');
  return `${base}-640.${ext} 640w, ${base}-1024.${ext} 1024w`;
}
function imgSrcFor(srcPath) {
  return hasOptimisedSiblings(srcPath) ? srcPath.replace(/\.(jpe?g|webp|png|avif)$/i, '-1024.jpg') : srcPath;
}
const CARD_SIZES = '(min-width: 1024px) 300px, (min-width: 640px) 33vw, 50vw';
const GALLERY_SIZES = '(min-width: 1024px) 560px, 100vw';

// ─── PRODUCT CARD HTML ─────────────────────────────────────────
function buildProductCard(product) {
  const badgeHtml = product.badge
    ? `<span class="badge ${product.badge === 'Bestseller' ? 'badge--dark' : 'badge--sage'} product-card__badge">${product.badge}</span>`
    : '';

  return `
    <article class="product-card" data-id="${product.id}" onclick="window.location='/product/${product.id}'">
      <div class="product-card__image-wrap">
        <picture>
          <source type="image/avif" srcset="${srcsetFor(product.image, 'avif')}" sizes="${CARD_SIZES}" />
          <source type="image/webp" srcset="${srcsetFor(product.image, 'webp')}" sizes="${CARD_SIZES}" />
          <img
            src="${imgSrcFor(product.image)}"
            srcset="${srcsetFor(product.image, 'jpg')}"
            sizes="${CARD_SIZES}"
            width="640" height="640"
            alt="${product.name}"
            class="product-card__image"
            loading="lazy"
            onerror="this.src='/images/products/placeholder.jpg'"
          />
        </picture>
        ${badgeHtml}
      </div>
      <div class="product-card__body">
        <span class="product-card__category">${product.categoryLabel}</span>
        <h3 class="product-card__name">${product.name}</h3>
        <p class="product-card__desc">${product.description}</p>
        ${product.sizes && product.sizes.length > 1 ? `<div class="product-card__sizes">${product.sizes.map(s => `<span>${s}</span>`).join('')}</div>` : ''}
        <div class="product-card__footer">
          <div>
            <span class="product-card__price" id="price-${product.id}">$${product.price.toFixed(2)}</span>
            <span class="product-card__price-unit" id="unit-${product.id}"> ${product.unit}</span>
            ${stockBadgeHtml(product.id)}
          </div>
          <button
            class="product-card__add-btn"
            onclick="event.stopPropagation(); addToCartFromCard('${product.id}')"
            ${(product.inStock && (stockMap[product.id]?.stock ?? 1) > 0) ? '' : 'disabled'}
            aria-label="${(product.inStock && (stockMap[product.id]?.stock ?? 1) > 0) ? 'Add to cart' : 'Out of stock'}: ${product.name}"
          >${(product.inStock && (stockMap[product.id]?.stock ?? 1) > 0) ? 'Add to Cart' : 'Out of Stock'}</button>
        </div>
      </div>
    </article>
  `;
}

// ─── ADD TO CART FROM CARD ─────────────────────────────────────
function addToCartFromCard(productId) {
  const product = getProductById(productId);
  if (!product) return;

  addToCart({
    id:       product.id,
    name:     product.name,
    price:    product.price,
    unit:     product.unit,
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

  await Promise.all([loadProducts(), loadStock()]);
  const featured = allProducts.filter(p => p.featured).slice(0, count);

  container.innerHTML = featured.map(buildProductCard).join('');
}

// ─── RENDER CATALOG ────────────────────────────────────────────
async function renderCatalog(containerId, { category = null, search = '' } = {}) {
  const container = document.getElementById(containerId);
  if (!container) return;

  container.innerHTML = '<div class="loading-cards">' + Array(8).fill('<div class="product-card-skeleton"></div>').join('') + '</div>';

  await Promise.all([loadProducts(), loadStock()]);

  let filtered = allProducts;

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
}

// ─── RENDER PRODUCT DETAIL ─────────────────────────────────────
async function renderProductDetail() {
  // Prefer window.PRODUCT_ID (set by pre-rendered /product/{slug}.html), fall
  // back to the legacy ?id= query (kept for the original product-detail.html
  // SPA URL so old shared links still resolve).
  const params = new URLSearchParams(window.location.search);
  const id = window.PRODUCT_ID || params.get('id');

  if (!id) { window.location.href = '/products'; return; }

  await Promise.all([loadProducts(), loadStock()]);
  const product = getProductById(id);

  if (!product) { window.location.href = '/products'; return; }

  // Update page meta
  document.title = `${product.name} | Urban Landscape Supplies`;
  document.querySelector('meta[name="description"]')?.setAttribute('content', product.description);

  // Breadcrumb
  const bc = document.getElementById('breadcrumb-product');
  if (bc) {
    bc.textContent = product.name;
    document.getElementById('breadcrumb-category-link').href = `/products?cat=${product.category}`;
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

  // Bag size selector (20kg bag vs 1 Tonne Bulk Bag) — decorative pebbles only
  const pkgWrap = document.getElementById('detail-pkg-selector');
  if (pkgWrap) {
    if (product.bagSizes && product.bagSizes.length > 0) {
      let selectedBag = product.bagSizes.find(b => b.id === 'bulk') || product.bagSizes[0];

      pkgWrap.innerHTML = `
        <div class="size-selector">
          <p class="size-selector__label">Bag Size</p>
          <div class="size-selector__options">
            ${product.bagSizes.map(b => `
              <button class="size-btn${b.id === selectedBag.id ? ' size-btn--active' : ''}"
                      data-bag-id="${b.id}">${b.label}</button>
            `).join('')}
          </div>
        </div>
      `;
      pkgWrap.querySelectorAll('.size-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          selectedBag = product.bagSizes.find(b => b.id === btn.dataset.bagId);
          pkgWrap.querySelectorAll('.size-btn').forEach(b => b.classList.remove('size-btn--active'));
          btn.classList.add('size-btn--active');
          setTextById('detail-price', `$${selectedBag.price.toFixed(2)}`);
          setTextById('detail-unit', selectedBag.unit);
        });
      });
      pkgWrap._getSelectedBagSize = () => selectedBag;
    } else {
      pkgWrap.innerHTML = '';
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
        const pkgWrap = document.getElementById('detail-pkg-selector');
        const selectedBag = pkgWrap?._getSelectedBagSize?.();

        const idParts = [product.id, selectedSize, selectedBag?.id].filter(Boolean);
        const sizeLabel = [selectedSize, selectedBag?.label].filter(Boolean).join(', ');
        const baseName = product.name + (sizeLabel ? ` (${sizeLabel})` : '');

        addToCart({
          id:       idParts.join('-'),
          name:     baseName,
          price:    selectedBag ? selectedBag.price : product.price,
          unit:     selectedBag ? selectedBag.unit  : product.unit,
          image:    product.image,
          quantity: qty
        });
        addBtn.textContent = '✓ Added to Cart';
        addBtn.classList.add('added');
        setTimeout(() => { addBtn.textContent = 'Add to Cart'; addBtn.classList.remove('added'); }, 1600);
      };
    }
  }

  // Stock badge on detail page
  const inv = stockMap[id];
  if (inv) applyStockToBadgeEl(inv);

  // Block Add to Cart if inventory says zero (even if in_stock boolean is true)
  const addBtn2 = document.getElementById('detail-add-btn');
  if (addBtn2 && inv && inv.stock === 0) {
    addBtn2.textContent = 'Out of Stock';
    addBtn2.disabled = true;
  }

  // Live updates when stock changes in the CRM
  initRealtimeStock(id);

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
  const images = (product.images && product.images.length) ? product.images : [product.image];
  const gallery = document.getElementById('product-gallery');
  if (!gallery) return;

  // Pre-rendered pages already contain this exact markup (see
  // scripts/prerender-products.js) — only rebuild when it's missing or stale.
  const baked = gallery.querySelector(`.pgal[data-product="${product.id}"]`);
  if (!baked || baked.querySelectorAll('.pgal__slide').length !== images.length) {
    gallery.innerHTML = buildGalleryHtml(product, images);
  }
  if (images.length < 2) return;

  const track  = gallery.querySelector('.pgal__track');
  const prev   = gallery.querySelector('.pgal__arrow--prev');
  const next   = gallery.querySelector('.pgal__arrow--next');
  const thumbs = gallery.querySelectorAll('.pgal__thumb');
  let current = 0;

  // A deck, not a loop: stops at the first and last photo.
  function goTo(index) {
    current = Math.max(0, Math.min(images.length - 1, index));
    track.style.transform = `translateX(-${current * 100}%)`;
    prev.disabled = current === 0;
    next.disabled = current === images.length - 1;
    thumbs.forEach((t, i) => {
      t.classList.toggle('pgal__thumb--on', i === current);
      t.setAttribute('aria-current', i === current ? 'true' : 'false');
    });
    // Centre the active thumb in its strip (scrollIntoView would scroll the page too)
    const strip = thumbs[current].parentElement;
    strip.scrollTo({ left: thumbs[current].offsetLeft - (strip.clientWidth - thumbs[current].offsetWidth) / 2, behavior: 'smooth' });
  }

  prev.addEventListener('click', () => goTo(current - 1));
  next.addEventListener('click', () => goTo(current + 1));
  thumbs.forEach((t, i) => t.addEventListener('click', () => goTo(i)));

  const vp = gallery.querySelector('.pgal__viewport');
  vp.addEventListener('keydown', e => {
    if (e.key === 'ArrowLeft')  { e.preventDefault(); goTo(current - 1); }
    if (e.key === 'ArrowRight') { e.preventDefault(); goTo(current + 1); }
  });

  // Touch swipe
  let tx = 0;
  vp.addEventListener('touchstart', e => { tx = e.touches[0].clientX; }, { passive: true });
  vp.addEventListener('touchend', e => {
    const diff = tx - e.changedTouches[0].clientX;
    if (Math.abs(diff) > 40) goTo(current + (diff > 0 ? 1 : -1));
  });
}

// Keep in sync with galleryHtml() in scripts/prerender-products.js
function buildGalleryHtml(product, images) {
  const multi = images.length > 1;
  const chevL = `<svg width="22" height="22" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7"/></svg>`;
  const chevR = `<svg width="22" height="22" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7"/></svg>`;
  const thumbSrc = (src) => hasOptimisedSiblings(src) ? src.replace(/\.(jpe?g|webp|png|avif)$/i, '-640.webp') : src;

  return `<div class="pgal" data-product="${product.id}">` +
    `<div class="pgal__viewport"${multi ? ' tabindex="0" aria-label="Product photos, use arrow keys to browse"' : ''}>` +
    `<div class="pgal__track">` +
    images.map((src, i) =>
      `<div class="pgal__slide"><picture>` +
      `<source type="image/avif" srcset="${srcsetFor(src, 'avif')}" sizes="${GALLERY_SIZES}" />` +
      `<source type="image/webp" srcset="${srcsetFor(src, 'webp')}" sizes="${GALLERY_SIZES}" />` +
      `<img src="${imgSrcFor(src)}" srcset="${srcsetFor(src, 'jpg')}" sizes="${GALLERY_SIZES}" width="1024" height="1024" alt="${product.name}${multi ? ` (photo ${i + 1} of ${images.length})` : ''}" loading="${i === 0 ? 'eager' : 'lazy'}"${i === 0 ? ' fetchpriority="high"' : ''} />` +
      `</picture></div>`
    ).join('') +
    `</div>` +
    (multi
      ? `<button type="button" class="pgal__arrow pgal__arrow--prev" aria-label="Previous photo" disabled>${chevL}</button>` +
        `<button type="button" class="pgal__arrow pgal__arrow--next" aria-label="Next photo">${chevR}</button>`
      : '') +
    `</div>` +
    (multi
      ? `<div class="pgal__thumbs">` +
        images.map((src, i) =>
          `<button type="button" class="pgal__thumb${i === 0 ? ' pgal__thumb--on' : ''}" aria-label="Show photo ${i + 1}" aria-current="${i === 0}">` +
          `<img src="${thumbSrc(src)}" width="72" height="72" alt="" loading="lazy" /></button>`
        ).join('') +
        `</div>`
      : '') +
    `</div>`;
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
  window.location.href = '/products';
}
