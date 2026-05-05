#!/usr/bin/env node
/**
 * Bake per-suburb SEO metadata into each delivery/{slug}.html file.
 *
 * Why: delivery.js already sets title, meta, canonical and JSON-LD client-side,
 * but Google's first-pass crawler sees the static HTML BEFORE JS runs. Without
 * this pre-render, all 65 suburb pages share an identical title + meta + no
 * schema — which Google treats as duplicates / thin content.
 *
 * Idempotent: re-running on already-baked files just rewrites the same blocks.
 *
 * Run:  node scripts/prerender-suburbs.js
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DATA = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/suburbs.json'), 'utf8'));
const DELIVERY_DIR = path.join(ROOT, 'delivery');
const SITE_URL = 'https://urbanlandscapesupplies.com.au';

const STATIC_TITLE_RE  = /<title>[^<]*<\/title>/;
const META_DESC_RE     = /<meta name="description" content="[^"]*"\s*\/?>/;
const TITLE_COMMENT_RE = /<!--\s*Title and meta description are set dynamically by delivery\.js\s*-->\s*\n?/;
const VIEWPORT_LINE    = '<meta name="viewport" content="width=device-width, initial-scale=1.0" />';
const LOCALE_LINE      = '<meta property="og:locale" content="en_AU" />';
const HEAD_END_RE      = /(\s*)<\/head>/;
const H1_RE            = /<h1 class="page-hero__title">\s*Landscaping Supplies <span data-suburb-name><\/span> NSW\s*<\/h1>/;
const PRERENDER_BLOCK_RE = /\n\s*<!-- BEGIN:prerender -->[\s\S]*?<!-- END:prerender -->\n/;

function buildTitle(suburb)   { return `Landscape Supplies Delivery to ${suburb.name} NSW ${suburb.postcode} | Urban Landscape Supplies`; }
function buildMeta(suburb, zone) {
  const feeText = suburb.zone === 'A'
    ? 'free delivery on orders over $150'
    : suburb.zone === 'B'
      ? `delivery from $${zone.deliveryFee} (free over $${zone.freeThreshold})`
      : `delivery from $${zone.deliveryFee} (free over $${zone.freeThreshold})`;
  return `Premium soil, mulch, pebbles, sand and 1-tonne bulk bags delivered to ${suburb.name} NSW ${suburb.postcode} from our Wetherill Park yard. ${zone.label} — ${feeText}.`;
}

function buildPrerenderBlock(suburb, region, zone, slug) {
  const canonical = `${SITE_URL}/delivery/${slug}`;
  const localBusiness = {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    "name": "Urban Landscape Supplies",
    "url": SITE_URL,
    "telephone": "+611300872267",
    "image": `${SITE_URL}/images/brand/og-image.jpg`,
    "address": {
      "@type": "PostalAddress",
      "streetAddress": "Wetherill Park",
      "addressLocality": "Wetherill Park",
      "addressRegion": "NSW",
      "postalCode": "2164",
      "addressCountry": "AU"
    },
    "geo": { "@type": "GeoCoordinates", "latitude": -33.8315, "longitude": 150.9054 },
    "openingHoursSpecification": [
      { "@type": "OpeningHoursSpecification", "dayOfWeek": ["Monday","Tuesday","Wednesday","Thursday","Friday"], "opens": "07:00", "closes": "17:00" },
      { "@type": "OpeningHoursSpecification", "dayOfWeek": "Saturday", "opens": "08:00", "closes": "13:00" }
    ],
    "areaServed": {
      "@type": "City",
      "name": suburb.name,
      "postalCode": suburb.postcode,
      "containedInPlace": { "@type": "AdministrativeArea", "name": "New South Wales" }
    },
    "hasOfferCatalog": {
      "@type": "OfferCatalog",
      "name": `Landscape Supplies Delivered to ${suburb.name}`,
      "itemListElement": [
        { "@type": "Offer", "itemOffered": { "@type": "Service", "name": "Mulch Delivery" } },
        { "@type": "Offer", "itemOffered": { "@type": "Service", "name": "Garden Soil Delivery" } },
        { "@type": "Offer", "itemOffered": { "@type": "Service", "name": "Pebbles & Stone Delivery" } },
        { "@type": "Offer", "itemOffered": { "@type": "Service", "name": "Sand Delivery" } },
        { "@type": "Offer", "itemOffered": { "@type": "Service", "name": "1-Tonne Bulk Bag Delivery" } }
      ]
    }
  };
  const breadcrumb = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    "itemListElement": [
      { "@type": "ListItem", "position": 1, "name": "Home",           "item": `${SITE_URL}/` },
      { "@type": "ListItem", "position": 2, "name": "Delivery Areas", "item": `${SITE_URL}/delivery-areas` },
      { "@type": "ListItem", "position": 3, "name": region.name,      "item": `${SITE_URL}/delivery-areas#region-${region.slug}` },
      { "@type": "ListItem", "position": 4, "name": suburb.name,      "item": canonical }
    ]
  };
  return [
    '',
    '  <!-- BEGIN:prerender -->',
    `  <link rel="canonical" href="${canonical}" />`,
    `  <meta property="og:title" content="${buildTitle(suburb)}" />`,
    `  <meta property="og:url" content="${canonical}" />`,
    `  <meta property="og:type" content="website" />`,
    `  <script type="application/ld+json">${JSON.stringify(localBusiness)}</script>`,
    `  <script type="application/ld+json">${JSON.stringify(breadcrumb)}</script>`,
    '  <!-- END:prerender -->',
    ''
  ].join('\n');
}

function processFile(suburb) {
  const slug   = suburb.slug;
  const region = DATA.regions.find(r => r.slug === suburb.region);
  const zone   = DATA.zones[suburb.zone];
  const file   = path.join(DELIVERY_DIR, `${slug}.html`);

  if (!fs.existsSync(file)) {
    console.warn(`SKIP ${slug} — file not found`);
    return;
  }
  if (!region || !zone) {
    console.warn(`SKIP ${slug} — region/zone missing in suburbs.json`);
    return;
  }

  let html = fs.readFileSync(file, 'utf8');

  const title = buildTitle(suburb);
  const meta  = buildMeta(suburb, zone);

  if (!STATIC_TITLE_RE.test(html))  { console.warn(`SKIP ${slug} — no <title> match`); return; }
  if (!META_DESC_RE.test(html))     { console.warn(`SKIP ${slug} — no meta description match`); return; }

  html = html.replace(TITLE_COMMENT_RE, '');
  html = html.replace(STATIC_TITLE_RE, `<title>${title}</title>`);
  html = html.replace(META_DESC_RE, `<meta name="description" content="${meta}" />`);
  html = html.replace(H1_RE, `<h1 class="page-hero__title">\n        Landscape Supplies Delivery to <span data-suburb-name>${suburb.name}</span> NSW\n      </h1>`);

  // Strip any prior prerender block so re-runs are clean
  html = html.replace(PRERENDER_BLOCK_RE, '\n');

  // Inject prerender block right before </head>
  const block = buildPrerenderBlock(suburb, region, zone, slug);
  html = html.replace(HEAD_END_RE, `${block}$1</head>`);

  fs.writeFileSync(file, html, 'utf8');
  return slug;
}

const baked = [];
const skipped = [];
for (const suburb of DATA.suburbs) {
  const result = processFile(suburb);
  if (result) baked.push(result); else skipped.push(suburb.slug);
}

console.log(`Baked ${baked.length} suburb pages.`);
if (skipped.length) console.log(`Skipped: ${skipped.join(', ')}`);
