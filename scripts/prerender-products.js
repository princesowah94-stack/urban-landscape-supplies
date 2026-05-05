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
  html = html.replace(/(\s*)<\/head>/, `${block}$1</head>`);

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

  fs.writeFileSync(path.join(PRODUCT_DIR, `${p.id}.html`), html, 'utf8');
  return p.id;
}

const baked = products.map(bake);
console.log(`Baked ${baked.length} product pages → product/`);
