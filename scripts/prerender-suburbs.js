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
const TEMPLATE = fs.readFileSync(path.join(ROOT, 'delivery-suburb.html'), 'utf8');

// Same rule as prerender-products.js: relative href/src get ../ so the page
// works one level deep under /delivery/. Regenerating from the template (not
// editing baked files in place) means template edits propagate on re-run.
function rewritePathsForSubdir(html) {
  return html.replace(/(href|src)="(?!\/|https?:\/\/|#|mailto:|tel:|data:|javascript:)([^"]+)"/g,
    (_, attr, val) => `${attr}="../${val}"`);
}
const SITE_URL = 'https://urbanlandscapesupplies.com.au';

const STATIC_TITLE_RE  = /<title>[^<]*<\/title>/;
const META_DESC_RE     = /<meta name="description" content="[^"]*"\s*\/?>/;
const TITLE_COMMENT_RE = /<!--\s*Title and meta description are set dynamically by delivery\.js\s*-->\s*\n?/;
const HEAD_END_RE      = /(\s*)<\/head>/;
const H1_RE            = /<h1 class="page-hero__title">\s*Landscap(?:e|ing) Supplies(?: Delivery to)? <span data-suburb-name>[^<]*<\/span> NSW\s*<\/h1>/;
const PRERENDER_BLOCK_RE = /\n\s*<!-- BEGIN:prerender -->[\s\S]*?<!-- END:prerender -->\n/;
// Boilerplate paragraph that needs unique local content folded in.
const ABOUT_PARA_RE    = /<p style="color:var\(--color-text-secondary\);line-height:var\(--leading-loose\);margin-bottom:var\(--sp-4\)">\s*Urban Landscape Supplies delivers premium landscaping products to[\s\S]*?<\/p>/;

function buildTitle(suburb)   { return `Landscape Supplies Delivery to ${suburb.name} NSW ${suburb.postcode} | Urban Landscape Supplies`; }
function buildMeta(suburb, zone) {
  return `Premium soil, mulch, pebbles, sand and 1-tonne bulk bags delivered to ${suburb.name} NSW ${suburb.postcode} from our Wetherill Park yard. ${zone.label} — delivery quoted per job.`;
}

function buildPrerenderBlock(suburb, region, zone, slug) {
  const canonical = `${SITE_URL}/delivery/${slug}`;
  const localBusiness = {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    "name": "Urban Landscape Supplies",
    "url": SITE_URL,
    "telephone": "+61433132406",
    "image": `${SITE_URL}/images/brand/og-image.jpg`,
    "address": {
      "@type": "PostalAddress",
      "streetAddress": "21/130 Hassall Street",
      "addressLocality": "Wetherill Park",
      "addressRegion": "NSW",
      "postalCode": "2164",
      "addressCountry": "AU"
    },
    "geo": { "@type": "GeoCoordinates", "latitude": -33.8315, "longitude": 150.9054 },
    "openingHoursSpecification": [
      { "@type": "OpeningHoursSpecification", "dayOfWeek": ["Tuesday","Wednesday","Thursday"], "opens": "10:00", "closes": "17:00" },
      { "@type": "OpeningHoursSpecification", "dayOfWeek": "Friday",   "opens": "10:00", "closes": "16:00" },
      { "@type": "OpeningHoursSpecification", "dayOfWeek": "Saturday", "opens": "10:00", "closes": "15:00" },
      { "@type": "OpeningHoursSpecification", "dayOfWeek": "Sunday",   "opens": "11:00", "closes": "15:00" }
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

  if (!region || !zone) {
    console.warn(`SKIP ${slug} — region/zone missing in suburbs.json`);
    return;
  }

  // Always start from the current template so template edits propagate.
  let html = rewritePathsForSubdir(TEMPLATE);

  const title = buildTitle(suburb);
  const meta  = buildMeta(suburb, zone);

  if (!STATIC_TITLE_RE.test(html))  { console.warn(`SKIP ${slug} — no <title> match`); return; }
  if (!META_DESC_RE.test(html))     { console.warn(`SKIP ${slug} — no meta description match`); return; }

  html = html.replace(TITLE_COMMENT_RE, '');
  html = html.replace(STATIC_TITLE_RE, `<title>${title}</title>`);
  html = html.replace(META_DESC_RE, `<meta name="description" content="${meta}" />`);
  html = html.replace(H1_RE, `<h1 class="page-hero__title">\n        Landscape Supplies Delivery to <span data-suburb-name>${suburb.name}</span> NSW\n      </h1>`);

  // Inject council + localNote into the about-delivery paragraph for unique
  // per-suburb body content. Falls back gracefully if those fields are absent.
  if (suburb.localNote || suburb.council) {
    const localBits = [];
    if (suburb.council)   localBits.push(`Within the ${suburb.council} area.`);
    if (suburb.localNote) localBits.push(suburb.localNote);
    const localSentence = localBits.join(' ');
    html = html.replace(ABOUT_PARA_RE,
      `<p style="color:var(--color-text-secondary);line-height:var(--leading-loose);margin-bottom:var(--sp-4)">\n        Urban Landscape Supplies delivers premium landscaping products to <span data-suburb-name>${suburb.name}</span> NSW <span data-suburb-postcode>${suburb.postcode}</span> and the broader <span data-region-name>${region.name}</span> region. ${localSentence} Whether you're refreshing a garden bed near <span data-suburb-landmark>${suburb.landmark}</span>, building a new patio, or tackling a full backyard renovation, we deliver everything you need straight to your door.\n      </p>`
    );
  }

  // Strip any prior prerender block so re-runs are clean
  html = html.replace(PRERENDER_BLOCK_RE, '\n');

  // Inject prerender block right before </head>. Callback replace avoids
  // String.replace back-reference interpretation of $-sequences in the block.
  const block = buildPrerenderBlock(suburb, region, zone, slug);
  html = html.replace(HEAD_END_RE, (_, ws) => block + ws + '</head>');

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
