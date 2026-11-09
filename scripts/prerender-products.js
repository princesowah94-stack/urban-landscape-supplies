#!/usr/bin/env node
/**
 * Generate one static HTML file per product under product/{slug}.html from
 * the product-detail.html template, with title, meta, canonical, Open Graph
 * and Product JSON-LD baked in.
 *
 * The runtime experience is unchanged — products.js still hydrates the page —
 * but Google now sees rich, unique HTML on its first non-rendering crawl.
 *
 * Re-runnable. Overwrites all product/{slug}.html files.
 *
 * Run:  node scripts/prerender-products.js
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SITE_URL = 'https://urbanlandscapesupplies.com.au';
const PRODUCT_DIR = path.join(ROOT, 'product');

const products = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/products.json'), 'utf8')).products;
const template = fs.readFileSync(path.join(ROOT, 'product-detail.html'), 'utf8');

fs.mkdirSync(PRODUCT_DIR, { recursive: true });

// Anything href/src that isn't absolute, anchor, mailto, tel, data, javascript
// gets `../` prefixed so the page can sit one level deep under /product/.
function rewritePathsForSubdir(html) {
  return html.replace(/(href|src)="(?!\/|https?:\/\/|#|mailto:|tel:|data:|javascript:)([^"]+)"/g,
    (_, attr, val) => `${attr}="../${val}"`);
}

function esc(v) {
  return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Keep in sync with buildGalleryHtml() in js/products.js
const GALLERY_SIZES = '(min-width: 1024px) 560px, 100vw';
const isLocal = (src) => src.startsWith('/images/products/');
const stripExt = (src) => src.replace(/\.(jpe?g|webp|png|avif)$/i, '');
const srcsetFor = (src, ext) => isLocal(src) ? `${stripExt(src)}-640.${ext} 640w, ${stripExt(src)}-1024.${ext} 1024w` : src;
const imgSrcFor = (src) => isLocal(src) ? `${stripExt(src)}-1024.jpg` : src;
const thumbSrc = (src) => isLocal(src) ? `${stripExt(src)}-640.webp` : src;

function galleryHtml(product, images) {
  const multi = images.length > 1;
  const name = esc(product.name);
  const chevL = `<svg width="22" height="22" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7"/></svg>`;
  const chevR = `<svg width="22" height="22" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7"/></svg>`;

  return `<div class="pgal" data-product="${product.id}">` +
    `<div class="pgal__viewport"${multi ? ' tabindex="0" aria-label="Product photos, use arrow keys to browse"' : ''}>` +
    `<div class="pgal__track">` +
    images.map((src, i) =>
      `<div class="pgal__slide"><picture>` +
      `<source type="image/avif" srcset="${srcsetFor(src, 'avif')}" sizes="${GALLERY_SIZES}" />` +
      `<source type="image/webp" srcset="${srcsetFor(src, 'webp')}" sizes="${GALLERY_SIZES}" />` +
      `<img src="${imgSrcFor(src)}" srcset="${srcsetFor(src, 'jpg')}" sizes="${GALLERY_SIZES}" width="1024" height="1024" alt="${name}${multi ? ` (photo ${i + 1} of ${images.length})` : ''}" loading="${i === 0 ? 'eager' : 'lazy'}"${i === 0 ? ' fetchpriority="high"' : ''} />` +
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

function fmtAud(price) {
  return Number(price).toFixed(2);
}

function buildProductLD(p) {
  const url = `${SITE_URL}/product/${p.id}`;
  const offers = {
    "@type": "Offer",
    "url": url,
    "priceCurrency": "AUD",
    "price": fmtAud(p.price),
    "availability": p.inStock === false ? "https://schema.org/OutOfStock" : "https://schema.org/InStock",
    "itemCondition": "https://schema.org/NewCondition",
    "seller": { "@type": "Organization", "name": "Urban Landscape Supplies" }
  };
  const images = (p.images && p.images.length ? p.images : (p.image ? [p.image] : []))
    .map(img => img.startsWith('http') ? img : `${SITE_URL}/${img}`);
  return {
    "@context": "https://schema.org",
    "@type": "Product",
    "name": p.name,
    "description": p.description,
    "sku": p.sku,
    "category": p.categoryLabel || p.category,
    "image": images,
    "brand": { "@type": "Brand", "name": "Urban Landscape Supplies" },
    "offers": offers
  };
}

function buildBreadcrumbLD(p) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    "itemListElement": [
      { "@type": "ListItem", "position": 1, "name": "Home",     "item": `${SITE_URL}/` },
      { "@type": "ListItem", "position": 2, "name": "Products", "item": `${SITE_URL}/products` },
      { "@type": "ListItem", "position": 3, "name": p.categoryLabel || p.category, "item": `${SITE_URL}/products?cat=${p.category}` },
      { "@type": "ListItem", "position": 4, "name": p.name,     "item": `${SITE_URL}/product/${p.id}` }
    ]
  };
}

function bake(p) {
  let html = template;

  const url = `${SITE_URL}/product/${p.id}`;
  const title = `${p.name} — ${p.categoryLabel || 'Landscape Supplies'} | Urban Landscape Supplies`;
  const desc = (p.description || '').replace(/\s+/g, ' ').trim();
  const ogImage = (p.image && (p.image.startsWith('http') ? p.image : `${SITE_URL}/${p.image}`)) || `${SITE_URL}/images/brand/og-image.jpg`;

  // Path rewrites first (so subsequent text replacements aren't affected by
  // double-prefixed URLs).
  html = rewritePathsForSubdir(html);

  // <head> replacements
  html = html.replace(/<title>[^<]*<\/title>/, `<title>${title}</title>`);
  html = html.replace(/<meta name="description" content="[^"]*"\s*\/?>/,
    `<meta name="description" content="${desc.replace(/"/g, '&quot;')}" />`);
  html = html.replace(/<link rel="canonical" href="[^"]*"\s+id="canonical-tag"\s*\/?>/,
    `<link rel="canonical" href="${url}" id="canonical-tag" />`);

  // Inject prerender block before </head>: og tags, Product LD, BreadcrumbList LD,
  // and the window.PRODUCT_ID hook so products.js knows which product to hydrate
  // without needing ?id= in the URL.
  const block = [
    '',
    '  <!-- BEGIN:prerender -->',
    `  <meta property="og:title" content="${title.replace(/"/g, '&quot;')}" />`,
    `  <meta property="og:description" content="${desc.replace(/"/g, '&quot;')}" />`,
    `  <meta property="og:url" content="${url}" />`,
    `  <meta property="og:type" content="product" />`,
    `  <meta property="og:image" content="${ogImage}" />`,
    `  <meta property="product:price:amount" content="${fmtAud(p.price)}" />`,
    `  <meta property="product:price:currency" content="AUD" />`,
    `  <script type="application/ld+json">${JSON.stringify(buildProductLD(p))}</script>`,
    `  <script type="application/ld+json">${JSON.stringify(buildBreadcrumbLD(p))}</script>`,
    `  <script>window.PRODUCT_ID = ${JSON.stringify(p.id)};</script>`,
    '  <!-- END:prerender -->',
    ''
  ].join('\n');
  // Callback replace avoids back-reference interpretation of $-sequences
  // in the block (Product LD descriptions can legitimately contain "$X" price strings).
  html = html.replace(/(\s*)<\/head>/, (_, ws) => block + ws + '</head>');

  // Bake static body content so crawlers see real text, not "Loading..."
  // (JS will overwrite with the same values when it runs)
  html = html.replace(
    /<span class="breadcrumb__item breadcrumb__item--current" id="breadcrumb-product">Loading\.\.\.<\/span>/,
    `<span class="breadcrumb__item breadcrumb__item--current" id="breadcrumb-product">${p.name}</span>`
  );
  html = html.replace(
    /<a href="\.\.\/products\.html" id="breadcrumb-category-link"><span id="breadcrumb-category-label">Products<\/span><\/a>/,
    `<a href="../products.html?cat=${p.category}" id="breadcrumb-category-link"><span id="breadcrumb-category-label">${p.categoryLabel || 'Products'}</span></a>`
  );
  html = html.replace(
    /<h1 class="detail-name" id="detail-name">Loading\.\.\.<\/h1>/,
    `<h1 class="detail-name" id="detail-name">${p.name}</h1>`
  );
  html = html.replace(
    /<span class="detail-price" id="detail-price">—<\/span>/,
    `<span class="detail-price" id="detail-price">$${fmtAud(p.price)}</span>`
  );
  html = html.replace(
    /<span class="detail-unit" id="detail-unit"><\/span>/,
    `<span class="detail-unit" id="detail-unit">${p.unit || ''}</span>`
  );

  // Bake the whole gallery (slides, arrows, thumbnails) so the photos and
  // controls are there before products.js + the API load. products.js sees
  // the matching data-product + slide count and only binds events.
  const images = (p.images && p.images.length) ? p.images : [p.image];
  if (images[0]) {
    html = html.replace(
      /<div class="product-gallery" id="product-gallery">[\s\S]*?<\/div>/,
      `<div class="product-gallery" id="product-gallery">${galleryHtml(p, images)}</div>`
    );
  }

  // Bake the rest of the detail body too. Previously these were empty in the
  // HTML and filled by products.js after load, which shoved everything below
  // down (CLS ~0.65 on mobile). products.js re-renders identical markup, so
  // nothing moves when it runs.
  html = html.replace(
    /<span class="detail-category" id="detail-category"><\/span>/,
    `<span class="detail-category" id="detail-category">${esc(p.categoryLabel || '')}</span>`
  );
  if (p.badge) {
    html = html.replace(
      /<span class="badge" id="detail-badge" style="display:none;width:fit-content"><\/span>/,
      `<span class="badge" id="detail-badge" style="width:fit-content">${esc(p.badge)}</span>`
    );
  }
  html = html.replace(
    /<p class="detail-desc" id="detail-desc"><\/p>/,
    `<p class="detail-desc" id="detail-desc">${esc(p.description || '')}</p>`
  );
  html = html.replace(
    /<ul class="detail-features" id="detail-features"><\/ul>/,
    `<ul class="detail-features" id="detail-features">${(p.features || []).map((f) => `<li>${esc(f)}</li>`).join('')}</ul>`
  );
  if (p.sizes && p.sizes.length) {
    html = html.replace(
      /<div id="detail-size-selector"><\/div>/,
      `<div id="detail-size-selector"><div class="size-selector"><p class="size-selector__label">Size</p><div class="size-selector__options">${
        p.sizes.map((sz, i) => `<button class="size-btn${i === 0 ? ' size-btn--active' : ''}" data-size="${esc(sz)}">${esc(sz)}</button>`).join('')
      }</div></div></div>`
    );
  }
  if (p.bagSizes && p.bagSizes.length) {
    const sel = (p.bagSizes.find((b) => b.id === 'bulk') || p.bagSizes[0]).id;
    html = html.replace(
      /<div id="detail-pkg-selector"><\/div>/,
      `<div id="detail-pkg-selector"><div class="size-selector"><p class="size-selector__label">Bag Size</p><div class="size-selector__options">${
        p.bagSizes.map((b) => `<button class="size-btn${b.id === sel ? ' size-btn--active' : ''}" data-bag-id="${esc(b.id)}">${esc(b.label)}</button>`).join('')
      }</div></div></div>`
    );
  }

  fs.writeFileSync(path.join(PRODUCT_DIR, `${p.id}.html`), html, 'utf8');
  return p.id;
}

const baked = products.map(bake);
console.log(`Baked ${baked.length} product pages → product/`);
