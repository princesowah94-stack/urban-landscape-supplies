/* ============================================================
   DELIVERY — Hub page calculator + Suburb page renderer
   ============================================================ */

let suburbData = null;

async function loadSuburbData() {
  if (suburbData) return suburbData;
  const res = await fetch('/data/suburbs.json');
  suburbData = await res.json();
  return suburbData;
}

/* ─── HUB PAGE CALCULATOR ─────────────────────────────────── */

function initCalculator(data) {
  const input    = document.getElementById('suburb-search');
  const resultEl = document.getElementById('suburb-search-results');
  const infoEl   = document.getElementById('delivery-info-result');
  if (!input) return;

  let activeSuburb = null;

  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    if (q.length < 2) {
      resultEl.innerHTML = '';
      resultEl.hidden = true;
      return;
    }

    const matches = data.suburbs.filter(s => s.name.toLowerCase().startsWith(q)).slice(0, 8);

    if (!matches.length) {
      resultEl.innerHTML = '<li class="search-no-result">No results — <a href="contact.html">contact us</a></li>';
      resultEl.hidden = false;
      return;
    }

    resultEl.innerHTML = matches.map(s =>
      `<li><button type="button" data-slug="${s.slug}">
        ${s.name}
        <span class="suburb-postcode">${s.postcode}</span>
      </button></li>`
    ).join('');
    resultEl.hidden = false;

    resultEl.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('click', () => {
        const sub = data.suburbs.find(s => s.slug === btn.dataset.slug);
        activeSuburb = sub;
        input.value = sub.name;
        resultEl.hidden = true;
        showDeliveryInfo(sub, data, infoEl);
      });
    });
  });

  // Hide results on outside click
  document.addEventListener('click', e => {
    if (!input.contains(e.target) && !resultEl.contains(e.target)) {
      resultEl.hidden = true;
    }
  });
}

function showDeliveryInfo(suburb, data, container) {
  const zone = data.zones[suburb.zone];
  const zoneCls = suburb.zone.toLowerCase();

  container.innerHTML = `
    <div class="delivery-result-card">
      <span class="zone-badge zone-badge--${zoneCls}">${zone.label}</span>
      <h3>${suburb.name} NSW ${suburb.postcode}</h3>
      <div class="delivery-result-row">
        <span class="delivery-result-row__label">Standard delivery fee</span>
        <span class="delivery-result-row__value">$${zone.deliveryFee}</span>
      </div>
      <div class="delivery-result-row">
        <span class="delivery-result-row__label">Free delivery from</span>
        <span class="delivery-result-row__value delivery-result-row__value--free">$${zone.freeThreshold}</span>
      </div>
      <div class="delivery-result-row">
        <span class="delivery-result-row__label">Estimated timeframe</span>
        <span class="delivery-result-row__value">${zone.days}</span>
      </div>
      <div class="order-slider-wrap">
        <div class="order-slider-label">
          <span>Order value</span>
          <strong id="slider-value">$150</strong>
        </div>
        <input type="range" class="order-slider" id="order-slider"
          min="0" max="500" step="10" value="150" />
        <div class="order-slider-result" id="slider-result"></div>
      </div>
      <a href="/delivery/${suburb.slug}" class="btn btn--primary btn--sm" style="margin-top:var(--sp-5);display:inline-block">
        View ${suburb.name} delivery details →
      </a>
    </div>
  `;
  container.hidden = false;

  // Wire up slider
  const slider    = container.querySelector('#order-slider');
  const sliderVal = container.querySelector('#slider-value');
  const sliderRes = container.querySelector('#slider-result');

  function updateSlider() {
    const val = parseInt(slider.value, 10);
    sliderVal.textContent = `$${val}`;
    if (val >= zone.freeThreshold) {
      sliderRes.innerHTML = `Your delivery to <strong>${suburb.name}</strong>: <span class="free-badge">FREE</span>`;
    } else {
      sliderRes.innerHTML = `Your delivery to <strong>${suburb.name}</strong>: <span class="fee">$${zone.deliveryFee}</span>`;
    }
  }

  slider.addEventListener('input', updateSlider);
  updateSlider();
}

/* ─── HUB PAGE REGION GRID ────────────────────────────────── */

function renderRegionCards(data) {
  const grid = document.getElementById('region-cards');
  if (!grid) return;

  grid.innerHTML = data.regions.map(region => {
    const suburbs = data.suburbs.filter(s => s.region === region.slug);
    const zoneCls = region.zone.toLowerCase();
    return `
      <div class="region-card" id="region-${region.slug}">
        <div class="region-card__header">
          <h3 class="region-card__name">${region.name}</h3>
          <span class="zone-badge zone-badge--${zoneCls}">Zone ${region.zone}</span>
        </div>
        <div class="region-card__suburbs">
          ${suburbs.map(s =>
            `<a href="/delivery/${s.slug}">${s.name}</a>`
          ).join('')}
        </div>
      </div>
    `;
  }).join('');
}

/* ─── HUB PAGE A–Z LIST ───────────────────────────────────── */

function renderAZList(data) {
  const el = document.getElementById('suburb-az-list');
  if (!el) return;

  const sorted = [...data.suburbs].sort((a, b) => a.name.localeCompare(b.name));
  el.innerHTML = sorted.map(s =>
    `<a href="/delivery/${s.slug}">${s.name}</a>`
  ).join('');
}

/* ─── SUBURB PAGE RENDERER ────────────────────────────────── */

async function initSuburbPage() {
  const root = document.getElementById('suburb-page-root');
  if (!root) return;

  const slug = new URLSearchParams(window.location.search).get('suburb');
  if (!slug) { window.location.href = '/delivery-areas'; return; }

  let data;
  try {
    data = await loadSuburbData();
  } catch {
    root.innerHTML = `
      <div class="container section">
        <p>Unable to load delivery information. Please <a href="contact.html">contact us</a> for help.</p>
      </div>`;
    root.classList.add('is-loaded');
    return;
  }

  const suburb = data.suburbs.find(s => s.slug === slug);
  if (!suburb) { window.location.href = '/delivery-areas'; return; }

  const region = data.regions.find(r => r.slug === suburb.region);
  const zone   = data.zones[suburb.zone];

  // ── Meta tags ────────────────────────────────────────────
  document.title = `Landscaping Supplies ${suburb.name} NSW | Urban Landscape Supplies`;

  const metaDesc = document.querySelector('meta[name="description"]');
  if (metaDesc) {
    metaDesc.setAttribute('content',
      `Premium mulch, soil, pebbles and bulk landscape materials delivered to ${suburb.name} NSW ${suburb.postcode}. ` +
      `${zone.label} — ${suburb.zone === 'A' ? 'free delivery over $150' : suburb.zone === 'B' ? 'delivery from $25' : 'delivery from $45'}. ` +
      `Urban Landscape Supplies Sydney.`
    );
  }

  // ── Canonical ────────────────────────────────────────────
  let canon = document.querySelector('link[rel="canonical"]');
  if (!canon) { canon = document.createElement('link'); canon.rel = 'canonical'; document.head.appendChild(canon); }
  canon.href = `https://urbanlandscapesupplies.com.au/delivery/${slug}`;

  // ── JSON-LD ───────────────────────────────────────────────
  const ldScript = document.createElement('script');
  ldScript.type = 'application/ld+json';
  ldScript.textContent = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    "name": "Urban Landscape Supplies",
    "url": "https://urbanlandscapesupplies.com.au",
    "telephone": "+611300872267",
    "address": {
      "@type": "PostalAddress",
      "addressLocality": "Sydney",
      "addressRegion": "NSW",
      "addressCountry": "AU"
    },
    "areaServed": {
      "@type": "City",
      "name": suburb.name,
      "postalCode": suburb.postcode,
      "containedInPlace": { "@type": "AdministrativeArea", "name": "New South Wales" }
    },
    "hasOfferCatalog": {
      "@type": "OfferCatalog",
      "name": `Landscaping Supplies Delivered to ${suburb.name}`,
      "itemListElement": [
        { "@type": "Offer", "itemOffered": { "@type": "Service", "name": "Mulch Delivery" }},
        { "@type": "Offer", "itemOffered": { "@type": "Service", "name": "Garden Soil Delivery" }},
        { "@type": "Offer", "itemOffered": { "@type": "Service", "name": "Pebbles & Stone Delivery" }},
        { "@type": "Offer", "itemOffered": { "@type": "Service", "name": "Bulk Landscape Materials" }}
      ]
    }
  });
  document.head.appendChild(ldScript);

  // ── Breadcrumb JSON-LD ────────────────────────────────────
  const breadcrumbScript = document.createElement('script');
  breadcrumbScript.type = 'application/ld+json';
  breadcrumbScript.textContent = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    "itemListElement": [
      { "@type": "ListItem", "position": 1, "name": "Home",           "item": "https://urbanlandscapesupplies.com.au/" },
      { "@type": "ListItem", "position": 2, "name": "Delivery Areas", "item": "https://urbanlandscapesupplies.com.au/delivery-areas" },
      { "@type": "ListItem", "position": 3, "name": region.name,      "item": `https://urbanlandscapesupplies.com.au/delivery-areas#region-${region.slug}` },
      { "@type": "ListItem", "position": 4, "name": suburb.name,      "item": `https://urbanlandscapesupplies.com.au/delivery/${slug}` }
    ]
  });
  document.head.appendChild(breadcrumbScript);

  // ── Populate DOM ──────────────────────────────────────────

  // Breadcrumb
  const bcRegion = document.getElementById('bc-region');
  bcRegion.textContent = region.name;
  bcRegion.href = `/delivery-areas#region-${region.slug}`;
  document.getElementById('bc-suburb').textContent = suburb.name;

  // Zone badge
  const zoneCls = suburb.zone.toLowerCase();
  document.getElementById('suburb-zone-badge').innerHTML =
    `<span class="zone-badge zone-badge--${zoneCls}">Zone ${suburb.zone} — ${zone.label}</span>`;

  // Hero
  document.querySelectorAll('[data-suburb-name]').forEach(el => el.textContent = suburb.name);
  document.querySelectorAll('[data-suburb-postcode]').forEach(el => el.textContent = suburb.postcode);
  document.querySelectorAll('[data-suburb-landmark]').forEach(el => el.textContent = suburb.landmark);
  document.querySelectorAll('[data-region-name]').forEach(el => el.textContent = region.name);

  // Delivery info card
  document.getElementById('info-fee').textContent     = `$${zone.deliveryFee}`;
  document.getElementById('info-fee-sub').textContent = `on orders under $${zone.freeThreshold}`;
  document.getElementById('info-free').textContent    = `$${zone.freeThreshold}+`;
  document.getElementById('info-days').textContent    = zone.days;

  // Inline calculator
  const calcSlider = document.getElementById('suburb-order-slider');
  const calcLabel  = document.getElementById('suburb-slider-value');
  const calcResult = document.getElementById('suburb-slider-result');

  if (calcSlider) {
    function updateSuburbSlider() {
      const val = parseInt(calcSlider.value, 10);
      calcLabel.textContent = `$${val}`;
      if (val >= zone.freeThreshold) {
        calcResult.innerHTML = `Delivery to <strong>${suburb.name}</strong>: <span class="free">FREE</span>`;
      } else {
        calcResult.innerHTML = `Delivery to <strong>${suburb.name}</strong>: <span class="fee">$${zone.deliveryFee}</span>`;
      }
    }
    calcSlider.addEventListener('input', updateSuburbSlider);
    updateSuburbSlider();
  }

  // Nearby suburbs
  const nearby = data.suburbs.filter(s => s.region === suburb.region && s.slug !== slug).slice(0, 8);
  document.getElementById('nearby-list').innerHTML = nearby.length
    ? nearby.map(s => `<a href="/delivery/${s.slug}" class="nearby-link">${s.name}</a>`).join('')
    : '<span style="color:var(--color-text-muted);font-size:var(--text-sm)">More areas coming soon.</span>';

  // FAQ suburb name injection
  document.querySelectorAll('.faq-suburb').forEach(el => el.textContent = suburb.name);
  document.querySelectorAll('.faq-fee').forEach(el => el.textContent = `$${zone.deliveryFee}`);
  document.querySelectorAll('.faq-threshold').forEach(el => el.textContent = `$${zone.freeThreshold}`);
  document.querySelectorAll('.faq-days').forEach(el => el.textContent = zone.days);

  // Reveal page
  root.classList.add('is-loaded');
}

/* ─── INIT ────────────────────────────────────────────────── */

async function init() {
  // Suburb page
  if (document.getElementById('suburb-page-root')) {
    await initSuburbPage();
    return;
  }

  // Hub page
  if (document.getElementById('suburb-search')) {
    try {
      const data = await loadSuburbData();
      initCalculator(data);
      renderRegionCards(data);
      renderAZList(data);
    } catch (e) {
      console.error('Failed to load suburb data:', e);
    }
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
