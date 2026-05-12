/**
 * coverage-calc.js — Landscape Material Coverage Calculator
 *
 * Self-contained module (no imports from ui.js or cart.js).
 * Loaded as a classic script on coverage-calculator.html.
 *
 * Maths:
 *   Volume (m³) = Area (m²) × [Depth (mm) ÷ 1000]
 *   Weight (t)  = Volume (m³) × Bulk density (t/m³)
 *   Bags needed = ceil(Weight × buffer)   buffer = 1.1 (10%) or 1.0
 *
 * Each product is sold as a 1-tonne bulk bag, so bags = tonnes (rounded up).
 */

// ─── MATERIAL DATA ───────────────────────────────────────────────────────────
const MATERIALS = {
  mulch: {
    id: 'mulch',
    label: 'Mulch & Bark',
    icon: '🌿',
    density: 0.25,           // t/m³ — very light, mostly wood fibre + air
    defaultDepth: 75,
    minDepth: 50,
    maxDepth: 150,
    depthPresets: [50, 75, 100],
    depthHint: '75 mm is the industry standard for effective weed suppression.',
    densityExplain: 'Mulch is mostly wood fibre and air — one cubic metre weighs only ~250 kg. That\'s why a single bag covers so much ground.',
    category: 'mulch',
  },
  soil: {
    id: 'soil',
    label: 'Garden Soil',
    icon: '🪴',
    density: 0.85,           // t/m³ — loose blended soil
    defaultDepth: 100,
    minDepth: 75,
    maxDepth: 300,
    depthPresets: [75, 100, 150],
    depthHint: '100 mm gives garden beds a good deep foundation for root development.',
    densityExplain: 'Blended garden soil is moderately dense — fine particles and organic matter pack together to around 850 kg per cubic metre.',
    category: 'soil',
  },
  turf: {
    id: 'turf',
    label: 'Turf Underlay',
    icon: '🌱',
    density: 1.0,            // t/m³ — denser soil/sand blend
    defaultDepth: 75,
    minDepth: 50,
    maxDepth: 100,
    depthPresets: [50, 75, 100],
    depthHint: '75 mm of underlay gives turf roots room to establish while maintaining good drainage.',
    densityExplain: 'Turf underlay is a dense soil-and-sand blend at roughly 1 tonne per cubic metre — heavier than standard garden soil due to the sand content.',
    category: 'soil',
  },
  sand: {
    id: 'sand',
    label: 'Sand',
    icon: '🏖️',
    density: 1.5,            // t/m³ — compacted mineral aggregate
    defaultDepth: 50,
    minDepth: 25,
    maxDepth: 100,
    depthPresets: [25, 50, 75],
    depthHint: '50 mm is standard for levelling and drainage applications.',
    densityExplain: 'Sand is dense mineral aggregate — fine particles pack tightly to around 1,500 kg per cubic metre, much heavier than mulch or soil.',
    category: 'sand',
  },
  pebbles: {
    id: 'pebbles',
    label: 'Decorative Pebbles',
    icon: '⚪',
    density: 1.45,           // t/m³ — dense stone aggregate
    defaultDepth: 50,
    minDepth: 30,
    maxDepth: 75,
    depthPresets: [30, 50, 75],
    depthHint: '50 mm looks great and prevents weeds growing through the layer.',
    densityExplain: 'Stone pebbles are dense at around 1,450 kg per cubic metre — similar to sand, because they\'re solid mineral all the way through.',
    category: 'pebbles',
  },
};

// ─── PRODUCT CATALOGUE (mirrors products.json, kept in sync manually) ────────
// Only products relevant to the calculator — keyed by id, grouped by material id.
const PRODUCTS = {
  mulch: [
    { id: 'mulch-hardwood-chip',   name: 'Premium Hardwood Chip',   price: 697.50 },
    { id: 'mulch-woodlands-blend', name: 'Woodlands Blend Mulch',   price: 647.50 },
    { id: 'mulch-woodlands-natural', name: 'Woodlands Natural Mulch', price: 597.50 },
    { id: 'mulch-nls-pine-bark',   name: 'Pine Bark',               price: 647.50 },
  ],
  soil: [
    { id: 'soil-nls-top-dressing',       name: 'Top Dressing',             price: 747.50 },
    { id: 'soil-planter-box-a',          name: 'Planter Box A (Horizon A)', price: 500.00 },
  ],
  turf: [
    { id: 'soil-premium-turf-underlay', name: 'Premium Turf Underlay 80/20', price: 500.00 },
  ],
  sand: [
    { id: 'sand-nls-sydney', name: 'Sydney Sand', price: 497.50 },
  ],
  pebbles: [
    { id: 'pebbles-snow-white',         name: 'Regular Snow White Pebbles',   price: 947.50 },
    { id: 'pebbles-charcoal-grey',      name: 'Charcoal Grey Pebbles',        price: 997.50 },
    { id: 'pebbles-crushed-snow-white', name: 'Crushed Snow White Pebbles',   price: 1097.50 },
    { id: 'pebbles-charcoal-lava',      name: 'Charcoal Lava Pebbles',        price: 1147.50 },
    { id: 'pebbles-red-lava',           name: 'Red Lava Pebbles',             price: 1147.50 },
  ],
};

// ─── STATE ───────────────────────────────────────────────────────────────────
let state = {
  materialId: 'mulch',
  productId: null,        // null = use cheapest for cost estimate
  zones: [{ len: '', wid: '', area: '' }],
  areaMode: 'dimensions', // 'dimensions' | 'direct'
  depth: 75,
  buffer: true,
};

// ─── CORE MATHS ──────────────────────────────────────────────────────────────
function calcZone(zone) {
  let area = 0;
  if (state.areaMode === 'dimensions') {
    const l = parseFloat(zone.len) || 0;
    const w = parseFloat(zone.wid) || 0;
    area = l * w;
  } else {
    area = parseFloat(zone.area) || 0;
  }
  return area;
}

function calcResult() {
  const mat = MATERIALS[state.materialId];
  const depthM = state.depth / 1000;
  const bufferFactor = state.buffer ? 1.1 : 1.0;

  let totalArea = 0;
  const zoneResults = state.zones.map((z, i) => {
    const area = calcZone(z);
    const volume = area * depthM;
    const weight = volume * mat.density;
    totalArea += area;
    return { index: i, area, volume, weight };
  });

  const totalVolume = totalArea * depthM;
  const totalWeight = totalVolume * mat.density;
  const bagsRaw = totalWeight * bufferFactor;
  const bagsNeeded = Math.ceil(bagsRaw);

  const products = PRODUCTS[state.materialId] || [];
  const selectedProduct = state.productId
    ? products.find(p => p.id === state.productId)
    : products.slice().sort((a, b) => a.price - b.price)[0]; // cheapest
  const costPerBag = selectedProduct?.price || null;
  const totalCost = costPerBag ? bagsNeeded * costPerBag : null;

  return {
    mat,
    totalArea,
    totalVolume,
    totalWeight,
    bagsRaw,
    bagsNeeded,
    depthM,
    depthMm: state.depth,
    bufferFactor,
    zoneResults,
    selectedProduct,
    costPerBag,
    totalCost,
  };
}

// ─── FORMAT HELPERS ───────────────────────────────────────────────────────────
const fmt2 = n => Number(n).toFixed(2);
const fmt3 = n => Number(n).toFixed(3);
const fmtAud = n => `$${Number(n).toFixed(2)}`;

// ─── RENDER ───────────────────────────────────────────────────────────────────
function render() {
  renderMaterialPills();
  renderZones();
  renderDepth();
  renderProductPicker();
  renderResults();
  renderCoverageTable();
  syncHash();
}

function renderMaterialPills() {
  const container = document.getElementById('material-pills');
  if (!container) return;
  container.innerHTML = Object.values(MATERIALS).map(m => `
    <button
      class="calc-pill ${m.id === state.materialId ? 'calc-pill--active' : ''}"
      data-mat="${m.id}"
      type="button"
    >
      <span class="calc-pill__icon">${m.icon}</span>
      ${m.label}
    </button>
  `).join('');
}

function renderZones() {
  const container = document.getElementById('zones-container');
  if (!container) return;

  container.innerHTML = state.zones.map((z, i) => {
    const area = calcZone(z);
    const label = state.zones.length > 1 ? `Area ${i + 1}` : 'Your area';
    return `
    <div class="calc-zone" data-zone="${i}">
      ${state.zones.length > 1 ? `
        <div class="calc-zone__header">
          <span class="calc-zone__label">${label}</span>
          <button class="calc-zone__remove" data-remove="${i}" type="button" aria-label="Remove zone ${i + 1}">✕</button>
        </div>` : ''}

      <div class="calc-area-modes">
        <button class="calc-area-tab ${state.areaMode === 'dimensions' ? 'calc-area-tab--active' : ''}" data-mode="dimensions" type="button">Length × Width</button>
        <button class="calc-area-tab ${state.areaMode === 'direct' ? 'calc-area-tab--active' : ''}" data-mode="direct" type="button">Enter m² directly</button>
      </div>

      ${state.areaMode === 'dimensions' ? `
        <div class="calc-dimensions">
          <div class="form-group">
            <label class="form-label" for="zone-len-${i}">Length (m)</label>
            <input class="form-input" id="zone-len-${i}" type="number" min="0" step="0.1"
              placeholder="e.g. 6" value="${z.len}" data-field="len" data-zone="${i}" />
          </div>
          <span class="calc-dimensions__times">×</span>
          <div class="form-group">
            <label class="form-label" for="zone-wid-${i}">Width (m)</label>
            <input class="form-input" id="zone-wid-${i}" type="number" min="0" step="0.1"
              placeholder="e.g. 4" value="${z.wid}" data-field="wid" data-zone="${i}" />
          </div>
        </div>
        ${area > 0 ? `<p class="calc-area-hint">Area: <strong>${fmt2(area)} m²</strong></p>` : ''}
      ` : `
        <div class="form-group">
          <label class="form-label" for="zone-area-${i}">Area (m²)</label>
          <input class="form-input" id="zone-area-${i}" type="number" min="0" step="0.5"
            placeholder="e.g. 24" value="${z.area}" data-field="area" data-zone="${i}" />
        </div>
      `}
    </div>`;
  }).join('');

  // Add-zone button
  const addBtn = document.getElementById('add-zone-btn');
  if (addBtn) addBtn.style.display = state.zones.length >= 5 ? 'none' : '';
}

function renderDepth() {
  const mat = MATERIALS[state.materialId];
  const slider = document.getElementById('depth-slider');
  const numInput = document.getElementById('depth-number');
  const hint = document.getElementById('depth-hint');
  const presets = document.getElementById('depth-presets');

  if (slider) {
    slider.min = mat.minDepth;
    slider.max = mat.maxDepth;
    slider.value = state.depth;
  }
  if (numInput) numInput.value = state.depth;
  if (hint) hint.textContent = mat.depthHint;
  if (presets) {
    presets.innerHTML = mat.depthPresets.map(d => `
      <button class="calc-depth-preset ${d === state.depth ? 'calc-depth-preset--active' : ''}"
        data-depth="${d}" type="button">${d} mm</button>
    `).join('');
  }
}

function renderProductPicker() {
  const container = document.getElementById('product-picker');
  if (!container) return;

  const products = PRODUCTS[state.materialId] || [];
  if (!products.length) {
    container.innerHTML = '';
    return;
  }

  const sorted = [...products].sort((a, b) => a.price - b.price);
  container.innerHTML = `
    <div class="form-group">
      <label class="form-label" for="product-select">Which product? <span style="font-weight:400;color:var(--color-text-muted)">(optional — affects cost estimate)</span></label>
      <select class="form-select" id="product-select">
        <option value="">Cheapest option (${fmtAud(sorted[0].price)}/bag)</option>
        ${sorted.map(p => `
          <option value="${p.id}" ${p.id === state.productId ? 'selected' : ''}>${p.name} — ${fmtAud(p.price)}/bag</option>
        `).join('')}
      </select>
    </div>
  `;
}

function renderResults() {
  const container = document.getElementById('calc-results');
  if (!container) return;

  const totalArea = state.zones.reduce((s, z) => s + calcZone(z), 0);
  if (totalArea <= 0 || state.depth <= 0) {
    container.innerHTML = `
      <div class="calc-results-empty">
        <div class="calc-results-empty__icon">📐</div>
        <p>Enter your area and depth above to see your results.</p>
      </div>
    `;
    return;
  }

  const r = calcResult();
  const mat = r.mat;
  const hasMultipleZones = state.zones.length > 1;

  // Zone breakdown rows (only shown when >1 zone)
  const zoneBreakdown = hasMultipleZones ? `
    <div class="calc-zone-breakdown">
      <p class="calc-step-label">Zone breakdown</p>
      ${r.zoneResults.filter(z => z.area > 0).map((z, i) => `
        <div class="calc-zone-row">
          <span>Area ${z.index + 1}: ${fmt2(z.area)} m²</span>
          <span>${fmt3(z.volume)} m³ · ${fmt2(z.weight)} t</span>
        </div>
      `).join('')}
    </div>
  ` : '';

  container.innerHTML = `
    <div class="calc-headline">
      <div class="calc-headline__bags">${r.bagsNeeded}</div>
      <div class="calc-headline__label">bag${r.bagsNeeded === 1 ? '' : 's'} needed</div>
      <div class="calc-headline__sub">
        ${mat.label} · ${r.depthMm} mm deep over ${fmt2(r.totalArea)} m²
      </div>
      ${r.totalCost ? `
        <div class="calc-headline__cost">
          Estimated cost: <strong>${fmtAud(r.totalCost)}</strong>
          <span class="calc-headline__cost-sub">${r.bagsNeeded} × ${fmtAud(r.costPerBag)} (${r.selectedProduct.name})</span>
        </div>
      ` : ''}
    </div>

    ${zoneBreakdown}

    <details class="calc-workings" open>
      <summary class="calc-workings__title">How we calculated it</summary>
      <div class="calc-workings__body">
        <div class="calc-step">
          <span class="calc-step__num">1</span>
          <div>
            <p class="calc-step__label">Volume</p>
            <p class="calc-step__formula">
              Area (${fmt2(r.totalArea)} m²) × Depth (${fmt3(r.depthM)} m)
              = <strong>${fmt3(r.totalVolume)} m³</strong>
            </p>
          </div>
        </div>
        <div class="calc-step">
          <span class="calc-step__num">2</span>
          <div>
            <p class="calc-step__label">Weight</p>
            <p class="calc-step__formula">
              Volume (${fmt3(r.totalVolume)} m³) × Density (${mat.density} t/m³)
              = <strong>${fmt3(r.totalWeight)} tonnes</strong>
            </p>
          </div>
        </div>
        <div class="calc-step">
          <span class="calc-step__num">3</span>
          <div>
            <p class="calc-step__label">Bags</p>
            <p class="calc-step__formula">
              ${fmt3(r.totalWeight)} t ÷ 1 t per bag = ${fmt3(r.bagsRaw / r.bufferFactor)} bags
              ${state.buffer ? `× 1.10 buffer = ${fmt2(r.bagsRaw)} → round up to <strong>${r.bagsNeeded} bags</strong>` : `→ round up to <strong>${r.bagsNeeded} bags</strong>`}
            </p>
          </div>
        </div>

        ${state.buffer ? `
          <p class="calc-workings__buffer-note">
            <strong>Why a 10% buffer?</strong>
            Landscape materials compress, spill slightly during spreading, and settle over time.
            A 10% buffer is the industry standard to avoid running short mid-project.
          </p>
        ` : ''}

        <p class="calc-workings__density-note">
          <strong>Why does density matter?</strong>
          ${mat.densityExplain}
        </p>
      </div>
    </details>

    <div class="calc-cta-group">
      ${r.selectedProduct ? `
        <a href="/product/${r.selectedProduct.id}" class="btn btn--primary">
          View ${r.selectedProduct.name} →
        </a>
      ` : `
        <a href="/products?cat=${mat.category}" class="btn btn--primary">
          Shop ${mat.label} →
        </a>
      `}
      <a href="/bulk-quote" class="btn btn--outline">Get a bulk quote</a>
    </div>

    ${r.bagsNeeded > 5 ? `
      <p class="calc-bulk-hint">
        💡 Ordering 5+ bags? <a href="/bulk-quote">Request a custom quote</a> — we often have better rates for volume orders.
      </p>
    ` : ''}
  `;
}

function renderCoverageTable() {
  const container = document.getElementById('coverage-table-body');
  if (!container) return;

  const mat = MATERIALS[state.materialId];
  const depths = [mat.depthPresets[0], mat.defaultDepth, mat.depthPresets[mat.depthPresets.length - 1]]
    .filter((v, i, a) => a.indexOf(v) === i);

  // Area covered by 1 bag: volume_per_bag / depth, where volume_per_bag = 1 / density
  const volumePerBag = 1 / mat.density;

  container.innerHTML = depths.map(d => {
    const areaCovered = volumePerBag / (d / 1000);
    return `
      <tr>
        <td>${d} mm</td>
        <td>${fmt2(volumePerBag)} m³</td>
        <td><strong>${Math.floor(areaCovered)} m²</strong></td>
      </tr>
    `;
  }).join('');
}

// ─── URL HASH SYNC ────────────────────────────────────────────────────────────
function syncHash() {
  const z0 = state.zones[0];
  const params = new URLSearchParams();
  params.set('mat', state.materialId);
  if (state.areaMode === 'dimensions') {
    if (z0.len) params.set('l', z0.len);
    if (z0.wid) params.set('w', z0.wid);
  } else {
    if (z0.area) params.set('a', z0.area);
    params.set('mode', 'direct');
  }
  params.set('d', state.depth);
  if (!state.buffer) params.set('buf', '0');
  if (state.productId) params.set('pid', state.productId);
  history.replaceState(null, '', '#' + params.toString());
}

function loadFromHash() {
  const hash = window.location.hash.replace('#', '');
  if (!hash) return;
  const params = new URLSearchParams(hash);
  const mat = params.get('mat');
  if (mat && MATERIALS[mat]) state.materialId = mat;
  const mode = params.get('mode');
  state.areaMode = mode === 'direct' ? 'direct' : 'dimensions';
  const l = params.get('l');
  const w = params.get('w');
  const a = params.get('a');
  const d = params.get('d');
  const buf = params.get('buf');
  const pid = params.get('pid');
  if (l) state.zones[0].len = l;
  if (w) state.zones[0].wid = w;
  if (a) state.zones[0].area = a;
  if (d) state.depth = Math.max(MATERIALS[state.materialId].minDepth, Math.min(MATERIALS[state.materialId].maxDepth, parseInt(d)));
  if (buf === '0') state.buffer = false;
  if (pid) state.productId = pid;
}

// ─── EVENT WIRING ─────────────────────────────────────────────────────────────
function initEvents() {
  // Material pills
  document.addEventListener('click', e => {
    const pill = e.target.closest('[data-mat]');
    if (pill) {
      state.materialId = pill.dataset.mat;
      state.depth = MATERIALS[state.materialId].defaultDepth;
      state.productId = null;
      render();
    }
  });

  // Zone field changes
  document.addEventListener('input', e => {
    const field = e.target.dataset.field;
    const zoneIdx = parseInt(e.target.dataset.zone);
    if (field && !isNaN(zoneIdx)) {
      state.zones[zoneIdx][field] = e.target.value;
      renderResults();
      syncHash();
    }
    // Depth slider
    if (e.target.id === 'depth-slider') {
      state.depth = parseInt(e.target.value);
      document.getElementById('depth-number').value = state.depth;
      renderResults();
      renderCoverageTable();
      renderDepth();
      syncHash();
    }
    // Depth number input
    if (e.target.id === 'depth-number') {
      const mat = MATERIALS[state.materialId];
      state.depth = Math.max(mat.minDepth, Math.min(mat.maxDepth, parseInt(e.target.value) || mat.defaultDepth));
      const slider = document.getElementById('depth-slider');
      if (slider) slider.value = state.depth;
      renderResults();
      renderCoverageTable();
      syncHash();
    }
    // Product picker
    if (e.target.id === 'product-select') {
      state.productId = e.target.value || null;
      renderResults();
      syncHash();
    }
  });

  // Depth presets
  document.addEventListener('click', e => {
    const preset = e.target.closest('[data-depth]');
    if (preset && preset.classList.contains('calc-depth-preset')) {
      state.depth = parseInt(preset.dataset.depth);
      renderDepth();
      renderResults();
      renderCoverageTable();
      syncHash();
    }
  });

  // Area mode tabs
  document.addEventListener('click', e => {
    const tab = e.target.closest('[data-mode]');
    if (tab && tab.classList.contains('calc-area-tab')) {
      state.areaMode = tab.dataset.mode;
      // reset zone values on mode switch
      state.zones = state.zones.map(() => ({ len: '', wid: '', area: '' }));
      renderZones();
      renderResults();
      syncHash();
    }
  });

  // Remove zone
  document.addEventListener('click', e => {
    const removeBtn = e.target.closest('[data-remove]');
    if (removeBtn) {
      const idx = parseInt(removeBtn.dataset.remove);
      state.zones.splice(idx, 1);
      renderZones();
      renderResults();
      syncHash();
    }
  });

  // Add zone
  const addBtn = document.getElementById('add-zone-btn');
  if (addBtn) {
    addBtn.addEventListener('click', () => {
      if (state.zones.length < 5) {
        state.zones.push({ len: '', wid: '', area: '' });
        renderZones();
      }
    });
  }

  // Buffer checkbox
  const bufferCheck = document.getElementById('buffer-check');
  if (bufferCheck) {
    bufferCheck.addEventListener('change', () => {
      state.buffer = bufferCheck.checked;
      renderResults();
      syncHash();
    });
  }

  // Copy link
  const copyBtn = document.getElementById('copy-link-btn');
  if (copyBtn) {
    copyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(window.location.href).then(() => {
        copyBtn.textContent = '✓ Copied!';
        setTimeout(() => { copyBtn.textContent = 'Copy link'; }, 2000);
      });
    });
  }
}

// ─── INIT ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  loadFromHash();
  initEvents();
  render();
});
