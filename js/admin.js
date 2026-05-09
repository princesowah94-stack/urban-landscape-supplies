/**
 * admin.js — magic-link login (Supabase Auth), fetch orders, render table,
 * transition status, refund, audit log.
 *
 * Auth: Supabase JS client handles the session in localStorage. JWT access
 * token is sent as Bearer on every /api/admin/* call. The server
 * (_admin-auth.js) verifies it and checks admin_profiles allowlist.
 *
 * Loaded as ES module (see admin.html). Pulls @supabase/supabase-js v2 from
 * esm.sh — no build step.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const AUTO_REFRESH_MS = 60_000;

const STATUS_LABELS = {
  pending_payment: 'Pending payment',
  paid:            'Paid',
  dispatched:      'Dispatched',
  delivered:       'Delivered',
  cancelled:       'Cancelled',
  refunded:        'Refunded',
};
const TRANSITIONS = {
  paid: [
    { to: 'dispatched', label: 'Dispatch',       primary: true },
    { action: 'refund', label: 'Refund',         danger: true },
    { to: 'cancelled',  label: 'Cancel',         danger: true },
  ],
  dispatched: [
    { to: 'delivered',  label: 'Mark delivered', primary: true },
    { action: 'refund', label: 'Refund',         danger: true },
    { to: 'cancelled',  label: 'Cancel',         danger: true },
  ],
  delivered: [
    { action: 'refund', label: 'Refund',         danger: true },
  ],
  cancelled: [
    { to: 'paid',       label: 'Reopen',         primary: true },
  ],
};

let currentFilter = '';
let currentQuoteFilter = '';
let currentContactFilter = '';
let allOrders = [];
let allQuotes = [];
let allContacts = [];
let currentStats = null;
let expandedOrderId = null;
let expandedQuoteId = null;
let expandedContactId = null;
let auditCache = {};      // orderId -> array of audit entries
let supabase = null;       // Supabase client (initialised after fetching config)
let currentSession = null; // Current Supabase session

const $  = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => Array.from(root.querySelectorAll(s));
const aud = (cents) => `$${(cents / 100).toFixed(2)}`;

const escapeHTML = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]));

const formatDate = (iso) => {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-AU', { day: '2-digit', month: 'short' });
};
const formatDateTime = (iso) => {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-AU', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  });
};

let toastTimer = null;
function showToast(message) {
  const toast = $('#toast');
  const msg = $('#toast-msg');
  if (!toast || !msg) return;
  msg.textContent = message;
  toast.classList.add('toast--visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('toast--visible'), 2800);
}

// ─── BOOTSTRAP ─────────────────────────────────────────────────
async function bootstrap() {
  // Pull supabase config from server (URL + anon key)
  const cfg = await fetch('/api/public-config').then(r => r.json()).catch(() => null);
  if (!cfg?.supabaseUrl || !cfg?.supabaseAnonKey) {
    document.body.innerHTML = '<p style="padding:2rem;font-family:system-ui">Admin temporarily unavailable. Server is missing Supabase config.</p>';
    return;
  }

  supabase = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,   // needed so the magic-link callback can pick up the session
      flowType: 'pkce',
    },
  });

  // 1. Check existing session (or pick up the magic-link redirect)
  const { data: { session } } = await supabase.auth.getSession();
  currentSession = session;

  if (currentSession) {
    showDashboard();
    startAutoRefresh();
  } else {
    showLogin();
  }

  // 2. Listen for sign-in / sign-out events (e.g. after magic link redirect)
  supabase.auth.onAuthStateChange((event, session) => {
    currentSession = session;
    if (event === 'SIGNED_IN' && session) {
      showDashboard();
      startAutoRefresh();
    } else if (event === 'SIGNED_OUT') {
      stopAutoRefresh();
      showLogin();
    }
  });
}

// ─── AUTH ──────────────────────────────────────────────────────
function authHeaders() {
  return { 'Authorization': `Bearer ${currentSession?.access_token || ''}` };
}

async function sendMagicLink(email) {
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: `${window.location.origin}/admin`,
    },
  });
  if (error) throw error;
}

async function logout() {
  await supabase.auth.signOut();
  // onAuthStateChange will call showLogin()
}

// ─── VIEW SWAP ─────────────────────────────────────────────────
function showLogin() {
  $('#admin-login-view').style.display = '';
  $('#admin-dashboard-view').style.display = 'none';
  $('#admin-email').value = '';
  $('#admin-email').focus();
}

function showDashboard() {
  $('#admin-login-view').style.display = 'none';
  $('#admin-dashboard-view').style.display = '';
  // Show user identity
  const userName = currentSession?.user?.email || '';
  $('#admin-user-name').textContent = userName;
  // Activate tab from URL hash (or default to dashboard)
  goToTab(parseHash().tab || 'dashboard');
}

// ─── TAB ROUTING ───────────────────────────────────────────────
//
// URL hash drives which panel is active and which filter is applied.
// Examples:
//   #dashboard
//   #orders
//   #orders?status=paid           ← landed here from action-queue link
//   #quotes?status=new
//   #contacts?unreplied=true
//
// parseHash() returns { tab, params } where params is a URLSearchParams.
function parseHash() {
  const raw = window.location.hash.replace(/^#/, '');
  const [tab, qs] = raw.split('?');
  return { tab: tab || '', params: new URLSearchParams(qs || '') };
}

const VALID_TABS = new Set(['dashboard', 'orders', 'quotes', 'contacts']);

function goToTab(tabName) {
  if (!VALID_TABS.has(tabName)) tabName = 'dashboard';

  // Update tab nav active state
  $$('.admin-tab').forEach(t => {
    t.classList.toggle('admin-tab--active', t.dataset.tab === tabName);
  });
  // Show only the matching panel
  $$('.admin-tab-panel').forEach(p => {
    p.style.display = p.dataset.panel === tabName ? '' : 'none';
  });

  // Apply hash query params + load the tab's data
  const { params } = parseHash();
  if (tabName === 'dashboard') {
    loadStats();
  } else if (tabName === 'orders') {
    const status = params.get('status') || '';
    currentFilter = status;
    $$('.admin-filter[data-status]').forEach(b => {
      b.classList.toggle('admin-filter--active', (b.dataset.status || '') === status);
    });
    loadOrders();
  } else if (tabName === 'quotes') {
    const status = params.get('status') || '';
    currentQuoteFilter = status;
    $$('.admin-filter[data-quote-status]').forEach(b => {
      b.classList.toggle('admin-filter--active', (b.dataset.quoteStatus || '') === status);
    });
    loadQuotes();
  } else if (tabName === 'contacts') {
    const unreplied = params.get('unreplied') === 'true';
    const replied   = params.get('replied') === 'true';
    currentContactFilter = unreplied ? 'unreplied' : (replied ? 'replied' : '');
    $$('.admin-filter[data-contact-filter]').forEach(b => {
      b.classList.toggle('admin-filter--active', (b.dataset.contactFilter || '') === currentContactFilter);
    });
    loadContacts();
  }
}

window.addEventListener('hashchange', () => {
  if (currentSession) goToTab(parseHash().tab || 'dashboard');
});

// ─── DATA ──────────────────────────────────────────────────────
async function loadOrders() {
  const container = $('#admin-orders-container');
  container.innerHTML = '<div class="admin-loading">Loading orders...</div>';

  try {
    const url = currentFilter ? `/api/admin/orders?status=${currentFilter}` : '/api/admin/orders';
    const res = await fetch(url, { headers: authHeaders() });

    if (res.status === 401) { logout(); return; }
    if (res.status === 403) {
      container.innerHTML = '<div class="admin-empty">Your account is signed in but not on the admin allowlist. Contact Prince to be added.</div>';
      return;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const { orders } = await res.json();
    allOrders = orders || [];
    renderOrders();
  } catch (err) {
    console.error('Load orders failed:', err);
    container.innerHTML = '<div class="admin-empty">Could not load orders. Try refresh.</div>';
  }
}

async function loadAuditLog(orderId) {
  if (auditCache[orderId]) return auditCache[orderId];
  try {
    const res = await fetch(`/api/admin/audit-log?orderId=${encodeURIComponent(orderId)}`, { headers: authHeaders() });
    if (!res.ok) return [];
    const { entries } = await res.json();
    auditCache[orderId] = entries || [];
    return auditCache[orderId];
  } catch {
    return [];
  }
}

async function transitionOrder(orderId, nextStatus) {
  const order = allOrders.find(o => o.id === orderId);
  if (!order) return;

  const previousStatus = order.status;
  order.status = nextStatus;
  renderOrders();

  try {
    const res = await fetch('/api/admin/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ orderId, status: nextStatus }),
    });

    if (res.status === 401) { logout(); return; }

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || `HTTP ${res.status}`);
    }

    delete auditCache[orderId]; // invalidate so next expand fetches fresh
    const msg = nextStatus === 'dispatched'
      ? 'Marked dispatched · customer notified'
      : `Marked ${STATUS_LABELS[nextStatus].toLowerCase()}`;
    showToast(msg);
  } catch (err) {
    console.error('Transition failed:', err);
    order.status = previousStatus;
    renderOrders();
    showToast(`Update failed: ${err.message}`);
  }
}

async function refundOrder(orderId) {
  const order = allOrders.find(o => o.id === orderId);
  if (!order) return;

  const previousStatus = order.status;
  order.status = 'refunded';
  renderOrders();

  try {
    const res = await fetch('/api/admin/refund', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ orderId }),
    });

    if (res.status === 401) { logout(); return; }

    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(body.message || body.error || `HTTP ${res.status}`);
    }

    delete auditCache[orderId];
    if (body.alreadyRefunded) {
      showToast('Already refunded');
    } else {
      showToast('Refund issued · customer notified');
    }
  } catch (err) {
    console.error('Refund failed:', err);
    order.status = previousStatus;
    renderOrders();
    showToast(`Refund failed: ${err.message}`);
  }
}

// ─── RENDER ────────────────────────────────────────────────────
function renderOrders() {
  const container = $('#admin-orders-container');
  if (!allOrders.length) {
    container.innerHTML = '<div class="admin-empty">No orders match this filter.</div>';
    return;
  }

  const rows = allOrders.map(renderRow).join('');
  container.innerHTML = `
    <table class="admin-table">
      <thead class="admin-table__head">
        <tr>
          <th>Date</th>
          <th>Customer</th>
          <th>Items</th>
          <th>Total</th>
          <th>Status</th>
          <th></th>
        </tr>
      </thead>
      <tbody id="admin-orders-tbody">${rows}</tbody>
    </table>
  `;
}

function renderRow(order) {
  const itemCount = (order.order_items || []).reduce((s, i) => s + (i.quantity || 0), 0);
  const isExpanded = expandedOrderId === order.id;
  const transitions = TRANSITIONS[order.status] || [];

  const actionsHtml = transitions.map(t => {
    const isRefund = t.action === 'refund';
    const dataAction = isRefund ? 'refund' : 'transition';
    const dataNext = isRefund ? '' : `data-next="${escapeHTML(t.to)}"`;
    return `
    <button
      class="admin-action-btn ${t.primary ? 'admin-action-btn--primary' : ''} ${t.danger ? 'admin-action-btn--danger' : ''}"
      data-action="${dataAction}"
      data-order-id="${escapeHTML(order.id)}"
      ${dataNext}
    >${escapeHTML(t.label)}</button>
  `;
  }).join('');

  return `
    <tr class="admin-table__row ${isExpanded ? 'admin-table__row--expanded' : ''}" data-action="expand" data-order-id="${escapeHTML(order.id)}">
      <td class="admin-table__date">${formatDate(order.created_at)}</td>
      <td class="admin-table__customer">${escapeHTML(order.customer_name || '—')}</td>
      <td class="admin-table__items">${itemCount} item${itemCount !== 1 ? 's' : ''}</td>
      <td class="admin-table__total">${aud(order.total_cents || 0)}</td>
      <td><span class="status-pill status-pill--${order.status}">${STATUS_LABELS[order.status] || order.status}</span></td>
      <td class="admin-table__actions">${actionsHtml}</td>
    </tr>
    ${isExpanded ? renderDetail(order) : ''}
  `;
}

function renderDetail(order) {
  const items = order.order_items || [];
  const itemsHtml = items.map(i => `
    <div class="admin-detail__items-row">
      <span>${escapeHTML(i.quantity)} × ${escapeHTML(i.name)}</span>
      <span>${aud((i.price_cents || 0) * (i.quantity || 0))}</span>
    </div>
  `).join('') || '<em style="color:var(--color-text-muted)">No line items recorded.</em>';

  const auditEntries = auditCache[order.id] || [];
  const auditHtml = auditEntries.length
    ? auditEntries.map(e => {
        const summary = e.action === 'transition'
          ? `${e.details?.status_from || '—'} → ${e.details?.status_to || '—'}`
          : e.action === 'refund'
            ? `Refunded ${aud(e.details?.amount_cents || 0)}`
            : escapeHTML(e.action);
        return `<div class="admin-detail__audit-row">
          <span>${escapeHTML(summary)}</span>
          <span style="color:var(--color-text-muted)">${escapeHTML(e.actor_display_name || '—')} · ${formatDateTime(e.created_at)}</span>
        </div>`;
      }).join('')
    : '<em style="color:var(--color-text-muted);font-size:13px">No admin actions recorded yet.</em>';

  return `
    <tr><td colspan="6" style="padding:0">
      <div class="admin-detail">
        <div class="admin-detail__grid">
          <div>
            <div class="admin-detail__label">Customer</div>
            <div class="admin-detail__value">
              ${escapeHTML(order.customer_name || '—')}<br>
              ${order.customer_email ? `<a href="mailto:${escapeHTML(order.customer_email)}">${escapeHTML(order.customer_email)}</a><br>` : ''}
              ${order.customer_phone ? `<a href="tel:${escapeHTML(order.customer_phone)}">${escapeHTML(order.customer_phone)}</a>` : '<em style="color:var(--color-text-muted)">no phone</em>'}
            </div>
          </div>
          <div>
            <div class="admin-detail__label">Delivery address</div>
            <div class="admin-detail__value">${escapeHTML(order.delivery_address || '—')}</div>
          </div>
          <div>
            <div class="admin-detail__label">Square order</div>
            <div class="admin-detail__value">
              ${order.square_order_id
                ? `<a href="https://squareup.com/dashboard/sales/transactions" target="_blank" rel="noopener">${escapeHTML(order.square_order_id)} ↗</a>`
                : '<em style="color:var(--color-text-muted)">none</em>'}
            </div>
          </div>
          <div>
            <div class="admin-detail__label">Order ID</div>
            <div class="admin-detail__value" style="font-family:monospace;font-size:var(--text-xs)">${escapeHTML(order.id)}</div>
          </div>
        </div>
        <div class="admin-detail__items">${itemsHtml}</div>
        ${order.notes ? `<div class="admin-detail__notes"><strong>Notes:</strong> ${escapeHTML(order.notes)}</div>` : ''}
        <div style="margin-top:var(--sp-3)">
          <button class="admin-action-btn" data-action="edit" data-order-id="${escapeHTML(order.id)}">Edit details…</button>
        </div>
        <div class="admin-detail__label" style="margin-top:var(--sp-4)">Audit trail</div>
        <div class="admin-detail__audit" data-audit-for="${escapeHTML(order.id)}">${auditHtml}</div>
      </div>
    </td></tr>
  `;
}

// ─── DASHBOARD (stats + action queue) ─────────────────────────
async function loadStats() {
  const grid = $('#admin-kpi-grid');
  const queue = $('#admin-action-queue');
  grid.innerHTML = '<div class="admin-loading">Loading stats…</div>';
  queue.innerHTML = '';

  try {
    const res = await fetch('/api/admin/stats', { headers: authHeaders() });
    if (res.status === 401) { logout(); return; }
    if (res.status === 403) {
      grid.innerHTML = '<div class="admin-empty">Your account is signed in but not on the admin allowlist. Contact Prince to be added.</div>';
      return;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    currentStats = await res.json();
    renderDashboard();
  } catch (err) {
    console.error('Load stats failed:', err);
    grid.innerHTML = '<div class="admin-empty">Could not load stats. Try refresh.</div>';
  }
}

function renderDashboard() {
  if (!currentStats) return;
  const s = currentStats;
  const grid = $('#admin-kpi-grid');
  grid.innerHTML = `
    <div class="admin-kpi">
      <div class="admin-kpi__label">Today</div>
      <div class="admin-kpi__value">${s.orders.today.count}<span class="admin-kpi__unit"> orders</span></div>
      <div class="admin-kpi__sub">${aud(s.orders.today.revenue_cents)}</div>
    </div>
    <div class="admin-kpi">
      <div class="admin-kpi__label">This week</div>
      <div class="admin-kpi__value">${s.orders.week.count}<span class="admin-kpi__unit"> orders</span></div>
      <div class="admin-kpi__sub">${aud(s.orders.week.revenue_cents)}</div>
    </div>
    <div class="admin-kpi">
      <div class="admin-kpi__label">Open quotes</div>
      <div class="admin-kpi__value">${s.quotes.total_open}</div>
      <div class="admin-kpi__sub">${s.quotes.new_count} new · ${s.quotes.quoted_count} quoted</div>
    </div>
    <div class="admin-kpi">
      <div class="admin-kpi__label">Unreplied contacts</div>
      <div class="admin-kpi__value">${s.contacts.unreplied_count}</div>
      <div class="admin-kpi__sub">${s.contacts.unreplied_over_24h_count} older than 24h</div>
    </div>
  `;

  const queueEl = $('#admin-action-queue');
  if (!s.action_queue?.length) {
    queueEl.innerHTML = `<div class="admin-action-queue__empty">✓ All caught up — nothing urgent right now.</div>`;
    return;
  }
  queueEl.innerHTML = s.action_queue.map(item => `
    <a class="admin-action-queue__item admin-action-queue__item--${escapeHTML(item.kind)}" href="${escapeHTML(item.target)}">
      <span class="admin-action-queue__count">${item.count}</span>
      <span class="admin-action-queue__label">${escapeHTML(item.label)}</span>
      <span class="admin-action-queue__arrow">→</span>
    </a>
  `).join('');
}

// ─── QUOTES ────────────────────────────────────────────────────
const QUOTE_STATUS_LABELS = {
  new: 'New',
  quoted: 'Quoted',
  won: 'Won',
  lost: 'Lost',
};
const QUOTE_TRANSITIONS = {
  new:    [{ to: 'quoted', label: 'Mark quoted', primary: true }, { to: 'lost', label: 'Mark lost', danger: true }],
  quoted: [{ to: 'won',    label: 'Mark won',    primary: true }, { to: 'lost', label: 'Mark lost', danger: true }],
  won:    [{ to: 'quoted', label: 'Reopen' }],
  lost:   [{ to: 'new',    label: 'Reopen' }],
};

async function loadQuotes() {
  const container = $('#admin-quotes-container');
  container.innerHTML = '<div class="admin-loading">Loading quotes…</div>';
  try {
    const url = currentQuoteFilter ? `/api/admin/quotes?status=${currentQuoteFilter}` : '/api/admin/quotes';
    const res = await fetch(url, { headers: authHeaders() });
    if (res.status === 401) { logout(); return; }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { quotes } = await res.json();
    allQuotes = quotes || [];
    renderQuotes();
  } catch (err) {
    console.error('Load quotes failed:', err);
    container.innerHTML = '<div class="admin-empty">Could not load quotes. Try refresh.</div>';
  }
}

function renderQuotes() {
  const container = $('#admin-quotes-container');
  if (!allQuotes.length) {
    container.innerHTML = '<div class="admin-empty">No quotes match this filter. New ones land here when customers submit /bulk-quote.</div>';
    return;
  }
  const rows = allQuotes.map(renderQuoteRow).join('');
  container.innerHTML = `
    <table class="admin-table">
      <thead class="admin-table__head">
        <tr>
          <th>Date</th><th>Reference</th><th>Customer</th><th>Items</th><th>Est. total</th><th>Status</th><th></th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function renderQuoteRow(q) {
  const itemCount = Array.isArray(q.items) ? q.items.reduce((s, i) => s + (Number(i.quantity) || 1), 0) : (q.items?.length || 0);
  const customer = `${q.contact_first_name || ''} ${q.contact_last_name || ''}`.trim() || q.contact_email || '—';
  const isExpanded = expandedQuoteId === q.id;
  const transitions = QUOTE_TRANSITIONS[q.status] || [];
  const actionsHtml = transitions.map(t => `
    <button class="admin-action-btn ${t.primary ? 'admin-action-btn--primary' : ''} ${t.danger ? 'admin-action-btn--danger' : ''}"
      data-action="quote-transition" data-quote-id="${escapeHTML(q.id)}" data-next="${escapeHTML(t.to)}"
    >${escapeHTML(t.label)}</button>
  `).join('');

  return `
    <tr class="admin-table__row ${isExpanded ? 'admin-table__row--expanded' : ''}" data-action="expand-quote" data-quote-id="${escapeHTML(q.id)}">
      <td class="admin-table__date">${formatDate(q.created_at)}</td>
      <td class="admin-table__customer" style="font-family:monospace;font-size:13px">${escapeHTML(q.reference_id || '—')}</td>
      <td class="admin-table__customer">${escapeHTML(customer)}</td>
      <td class="admin-table__items">${itemCount} item${itemCount !== 1 ? 's' : ''}</td>
      <td class="admin-table__total">${aud(q.estimated_total_cents || 0)}</td>
      <td><span class="status-pill status-pill--${q.status || 'new'}">${QUOTE_STATUS_LABELS[q.status] || q.status || 'new'}</span></td>
      <td class="admin-table__actions">${actionsHtml}</td>
    </tr>
    ${isExpanded ? renderQuoteDetail(q) : ''}
  `;
}

function renderQuoteDetail(q) {
  const items = Array.isArray(q.items) ? q.items : [];
  const itemsHtml = items.length
    ? items.map(i => `
        <div class="admin-detail__items-row">
          <span>${escapeHTML(i.quantity || 1)} × ${escapeHTML(i.name || i.product_name || 'item')}</span>
          <span style="color:var(--color-text-muted)">${i.notes ? escapeHTML(i.notes) : ''}</span>
        </div>`).join('')
    : '<em style="color:var(--color-text-muted)">No items recorded.</em>';

  const lastChange = q.status_changed_at
    ? `<div class="admin-detail__label" style="margin-top:var(--sp-3)">Last status change</div>
       <div class="admin-detail__value">${escapeHTML(QUOTE_STATUS_LABELS[q.status] || q.status)} by ${escapeHTML(q.status_changed_by_name || 'unknown')} · ${formatDateTime(q.status_changed_at)}</div>`
    : '';

  return `
    <tr><td colspan="7" style="padding:0">
      <div class="admin-detail">
        <div class="admin-detail__grid">
          <div>
            <div class="admin-detail__label">Customer</div>
            <div class="admin-detail__value">
              ${escapeHTML(`${q.contact_first_name || ''} ${q.contact_last_name || ''}`.trim() || '—')}<br>
              ${q.contact_email ? `<a href="mailto:${escapeHTML(q.contact_email)}">${escapeHTML(q.contact_email)}</a><br>` : ''}
              ${q.contact_phone ? `<a href="tel:${escapeHTML(q.contact_phone)}">${escapeHTML(q.contact_phone)}</a>` : '<em style="color:var(--color-text-muted)">no phone</em>'}
              ${q.is_trade ? '<br><span class="status-pill" style="margin-top:6px;display:inline-block">Trade</span>' : ''}
            </div>
          </div>
          <div>
            <div class="admin-detail__label">Delivery</div>
            <div class="admin-detail__value">
              ${escapeHTML([q.delivery_address, q.delivery_suburb, q.delivery_postcode].filter(Boolean).join(', ') || '—')}<br>
              ${q.delivery_date_from || q.delivery_date_to
                ? `<span style="color:var(--color-text-muted);font-size:13px">Window: ${escapeHTML(q.delivery_date_from || '?')} – ${escapeHTML(q.delivery_date_to || '?')}</span>`
                : ''}
              ${q.delivery_access ? `<br><span style="color:var(--color-text-muted);font-size:13px">Access: ${escapeHTML(q.delivery_access)}</span>` : ''}
            </div>
          </div>
        </div>
        <div class="admin-detail__items">${itemsHtml}</div>
        ${q.notes ? `<div class="admin-detail__notes"><strong>Notes:</strong> ${escapeHTML(q.notes)}</div>` : ''}
        ${lastChange}
      </div>
    </td></tr>
  `;
}

async function transitionQuote(quoteId, nextStatus) {
  const quote = allQuotes.find(q => q.id === quoteId);
  if (!quote) return;
  const previousStatus = quote.status;
  quote.status = nextStatus;
  renderQuotes();
  try {
    const res = await fetch('/api/admin/quotes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ quoteId, status: nextStatus }),
    });
    if (res.status === 401) { logout(); return; }
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || `HTTP ${res.status}`);
    }
    quote.status_changed_at = new Date().toISOString();
    quote.status_changed_by_name = currentSession?.user?.email || 'you';
    renderQuotes();
    showToast(`Quote marked ${QUOTE_STATUS_LABELS[nextStatus].toLowerCase()}`);
  } catch (err) {
    quote.status = previousStatus;
    renderQuotes();
    showToast(`Update failed: ${err.message}`);
  }
}

// ─── CONTACTS ──────────────────────────────────────────────────
async function loadContacts() {
  const container = $('#admin-contacts-container');
  container.innerHTML = '<div class="admin-loading">Loading contacts…</div>';
  try {
    let url = '/api/admin/contacts';
    if (currentContactFilter === 'unreplied') url += '?unreplied=true';
    if (currentContactFilter === 'replied')   url += '?replied=true';
    const res = await fetch(url, { headers: authHeaders() });
    if (res.status === 401) { logout(); return; }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { contacts } = await res.json();
    allContacts = contacts || [];
    renderContacts();
  } catch (err) {
    console.error('Load contacts failed:', err);
    container.innerHTML = '<div class="admin-empty">Could not load contacts. Try refresh.</div>';
  }
}

function renderContacts() {
  const container = $('#admin-contacts-container');
  if (!allContacts.length) {
    container.innerHTML = '<div class="admin-empty">No contacts match this filter. Submissions from /contact land here.</div>';
    return;
  }
  const rows = allContacts.map(renderContactRow).join('');
  container.innerHTML = `
    <table class="admin-table">
      <thead class="admin-table__head">
        <tr>
          <th>Date</th><th>Name</th><th>Source</th><th>Message</th><th>Replied?</th><th></th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function renderContactRow(c) {
  const isExpanded = expandedContactId === c.id;
  const isReplied = !!c.replied_at;
  const snippet = (c.message || '').slice(0, 80) + ((c.message || '').length > 80 ? '…' : '');
  const sourceLabel = (c.source || 'contact-form').replace('contact-form:', '');
  const action = isReplied
    ? `<button class="admin-action-btn" data-action="contact-mark" data-contact-id="${escapeHTML(c.id)}" data-mark="mark-unreplied">Mark unreplied</button>`
    : `<button class="admin-action-btn admin-action-btn--primary" data-action="contact-mark" data-contact-id="${escapeHTML(c.id)}" data-mark="mark-replied">Mark replied</button>`;
  return `
    <tr class="admin-table__row ${isExpanded ? 'admin-table__row--expanded' : ''}" data-action="expand-contact" data-contact-id="${escapeHTML(c.id)}">
      <td class="admin-table__date">${formatDate(c.created_at)}</td>
      <td class="admin-table__customer">${escapeHTML(c.name || '—')}</td>
      <td class="admin-table__items" style="font-size:13px;color:var(--color-text-muted)">${escapeHTML(sourceLabel)}</td>
      <td class="admin-table__items" style="font-size:13px">${escapeHTML(snippet)}</td>
      <td><span class="status-pill ${isReplied ? 'status-pill--delivered' : 'status-pill--paid'}">${isReplied ? 'Replied' : 'Pending'}</span></td>
      <td class="admin-table__actions">${action}</td>
    </tr>
    ${isExpanded ? renderContactDetail(c) : ''}
  `;
}

function renderContactDetail(c) {
  return `
    <tr><td colspan="6" style="padding:0">
      <div class="admin-detail">
        <div class="admin-detail__grid">
          <div>
            <div class="admin-detail__label">Contact</div>
            <div class="admin-detail__value">
              ${escapeHTML(c.name || '—')}<br>
              ${c.email ? `<a href="mailto:${escapeHTML(c.email)}">${escapeHTML(c.email)}</a><br>` : ''}
              ${c.phone ? `<a href="tel:${escapeHTML(c.phone)}">${escapeHTML(c.phone)}</a>` : '<em style="color:var(--color-text-muted)">no phone</em>'}
            </div>
          </div>
          <div>
            <div class="admin-detail__label">Source</div>
            <div class="admin-detail__value">${escapeHTML(c.source || 'contact-form')}</div>
          </div>
        </div>
        <div class="admin-detail__notes" style="background:var(--color-gray-50);border-left-color:var(--color-sage);color:var(--color-text-primary)">
          <strong>Message:</strong><br>${escapeHTML(c.message || '')}
        </div>
        ${c.replied_at
          ? `<div class="admin-detail__label" style="margin-top:var(--sp-3)">Replied</div>
             <div class="admin-detail__value">by ${escapeHTML(c.replied_by_name || 'unknown')} · ${formatDateTime(c.replied_at)}</div>`
          : ''}
      </div>
    </td></tr>
  `;
}

async function markContact(contactId, action) {
  const c = allContacts.find(x => x.id === contactId);
  if (!c) return;
  const wasReplied = !!c.replied_at;
  // Optimistic update
  c.replied_at = action === 'mark-replied' ? new Date().toISOString() : null;
  c.replied_by_name = action === 'mark-replied' ? (currentSession?.user?.email || 'you') : null;
  renderContacts();
  try {
    const res = await fetch('/api/admin/contacts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ contactId, action }),
    });
    if (res.status === 401) { logout(); return; }
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || `HTTP ${res.status}`);
    }
    showToast(action === 'mark-replied' ? 'Marked replied' : 'Marked unreplied');
  } catch (err) {
    // Roll back
    c.replied_at = wasReplied ? c.replied_at : null;
    renderContacts();
    showToast(`Update failed: ${err.message}`);
  }
}

// ─── EVENTS ────────────────────────────────────────────────────
$('#admin-login-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = $('#admin-email').value.trim();
  const errEl = $('#admin-login-error');
  const okEl = $('#admin-login-success');
  const btnText = $('#admin-login-btn-text');
  const btn = $('#admin-login-btn');
  errEl.classList.remove('admin-login__error--visible');
  okEl.style.display = 'none';
  btnText.textContent = 'Sending link...';
  btn.disabled = true;
  try {
    await sendMagicLink(email);
    okEl.style.display = '';
  } catch (err) {
    errEl.textContent = err.message || 'Could not send sign-in link.';
    errEl.classList.add('admin-login__error--visible');
  } finally {
    btnText.textContent = 'Email me a sign-in link';
    btn.disabled = false;
  }
});

$('#admin-logout')?.addEventListener('click', logout);
$('#admin-refresh')?.addEventListener('click', loadOrders);
$('#admin-stats-refresh')?.addEventListener('click', loadStats);
$('#admin-quotes-refresh')?.addEventListener('click', loadQuotes);
$('#admin-contacts-refresh')?.addEventListener('click', loadContacts);

// Orders filter pills — preserve hash so the URL reflects filter state
$('#admin-filters')?.addEventListener('click', (e) => {
  const btn = e.target.closest('.admin-filter[data-status]');
  if (!btn) return;
  const status = btn.dataset.status || '';
  expandedOrderId = null;
  // Drive via URL hash so back/forward + bookmarks work
  window.location.hash = status ? `#orders?status=${status}` : '#orders';
});

// Quotes filter pills
$('#admin-quotes-filters')?.addEventListener('click', (e) => {
  const btn = e.target.closest('.admin-filter[data-quote-status]');
  if (!btn) return;
  const status = btn.dataset.quoteStatus || '';
  expandedQuoteId = null;
  window.location.hash = status ? `#quotes?status=${status}` : '#quotes';
});

// Contacts filter pills
$('#admin-contacts-filters')?.addEventListener('click', (e) => {
  const btn = e.target.closest('.admin-filter[data-contact-filter]');
  if (!btn) return;
  const f = btn.dataset.contactFilter || '';
  expandedContactId = null;
  if (f === 'unreplied') window.location.hash = '#contacts?unreplied=true';
  else if (f === 'replied') window.location.hash = '#contacts?replied=true';
  else window.location.hash = '#contacts';
});

// ─── EDIT-ORDER MODAL ──────────────────────────────────────────
function openEditModal(orderId) {
  const order = allOrders.find(o => o.id === orderId);
  if (!order) return;
  $('#edit-order-id').value = order.id;
  $('#edit-name').value    = order.customer_name    || '';
  $('#edit-email').value   = order.customer_email   || '';
  $('#edit-phone').value   = order.customer_phone   || '';
  $('#edit-address').value = order.delivery_address || '';
  $('#edit-notes').value   = order.notes            || '';
  $('#edit-modal').style.display = '';
  $('#edit-name').focus();
}
function closeEditModal() {
  $('#edit-modal').style.display = 'none';
}

$('#edit-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const orderId = $('#edit-order-id').value;
  const btn = $('#edit-save-btn');
  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Saving…';

  const payload = {
    orderId,
    customer_name:    $('#edit-name').value.trim(),
    customer_email:   $('#edit-email').value.trim(),
    customer_phone:   $('#edit-phone').value.trim(),
    delivery_address: $('#edit-address').value.trim(),
    notes:            $('#edit-notes').value.trim(),
  };

  try {
    const res = await fetch('/api/admin/edit-order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(payload),
    });

    if (res.status === 401) { logout(); return; }

    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.message || body.error || `HTTP ${res.status}`);

    if (body.changed === 0) {
      showToast('No changes to save');
    } else {
      // Update local state so the table reflects the edits without a full refetch.
      const order = allOrders.find(o => o.id === orderId);
      if (order) {
        order.customer_name    = payload.customer_name    || null;
        order.customer_email   = payload.customer_email   || null;
        order.customer_phone   = payload.customer_phone   || null;
        order.delivery_address = payload.delivery_address || null;
        order.notes            = payload.notes            || null;
      }
      delete auditCache[orderId]; // invalidate so the new edit entry shows up on re-expand
      renderOrders();
      showToast(`Saved · ${body.changed} field${body.changed !== 1 ? 's' : ''} updated`);
    }
    closeEditModal();
  } catch (err) {
    console.error('Edit failed:', err);
    showToast(`Save failed: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = original;
  }
});

// Close modal on backdrop / cancel / × clicks
document.addEventListener('click', (e) => {
  if (e.target.closest('[data-action="close-edit"]')) {
    closeEditModal();
  }
});
// Esc to close
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && $('#edit-modal').style.display !== 'none') {
    closeEditModal();
  }
});

// Delegated handler for all row/button actions across tabs
document.addEventListener('click', async (e) => {
  // Quote status transition
  const quoteTBtn = e.target.closest('[data-action="quote-transition"]');
  if (quoteTBtn) {
    e.stopPropagation();
    const quoteId = quoteTBtn.dataset.quoteId;
    const next = quoteTBtn.dataset.next;
    if ((next === 'lost' || next === 'won') && !confirm(`Mark this quote as ${next}?`)) return;
    transitionQuote(quoteId, next);
    return;
  }

  // Quote row expand
  const quoteRow = e.target.closest('[data-action="expand-quote"]');
  if (quoteRow) {
    const id = quoteRow.dataset.quoteId;
    expandedQuoteId = expandedQuoteId === id ? null : id;
    renderQuotes();
    return;
  }

  // Contact mark replied / unreplied
  const contactMarkBtn = e.target.closest('[data-action="contact-mark"]');
  if (contactMarkBtn) {
    e.stopPropagation();
    markContact(contactMarkBtn.dataset.contactId, contactMarkBtn.dataset.mark);
    return;
  }

  // Contact row expand
  const contactRow = e.target.closest('[data-action="expand-contact"]');
  if (contactRow) {
    const id = contactRow.dataset.contactId;
    expandedContactId = expandedContactId === id ? null : id;
    renderContacts();
    return;
  }

  const editBtn = e.target.closest('[data-action="edit"]');
  if (editBtn) {
    e.stopPropagation();
    openEditModal(editBtn.dataset.orderId);
    return;
  }

  const refundBtn = e.target.closest('[data-action="refund"]');
  if (refundBtn) {
    e.stopPropagation();
    const orderId = refundBtn.dataset.orderId;
    const order = allOrders.find(o => o.id === orderId);
    const total = order ? aud(order.total_cents || 0) : '';
    if (!confirm(`Refund ${total} to the customer via Square? They'll get an email confirmation.`)) return;
    refundOrder(orderId);
    return;
  }

  const transitionBtn = e.target.closest('[data-action="transition"]');
  if (transitionBtn) {
    e.stopPropagation();
    const orderId = transitionBtn.dataset.orderId;
    const next = transitionBtn.dataset.next;
    if (next === 'cancelled' && !confirm("Cancel this order? This won't issue a refund — use the Refund button for that.")) return;
    if (next === 'paid' && !confirm('Reopen this cancelled order back to paid?')) return;
    transitionOrder(orderId, next);
    return;
  }

  const row = e.target.closest('[data-action="expand"]');
  if (row) {
    const id = row.dataset.orderId;
    const wasExpanded = expandedOrderId === id;
    expandedOrderId = wasExpanded ? null : id;
    renderOrders();
    if (!wasExpanded) {
      // Lazy-fetch audit trail when first expanded
      await loadAuditLog(id);
      if (expandedOrderId === id) renderOrders();
    }
  }
});

// ─── AUTO-REFRESH ──────────────────────────────────────────────
//
// Refreshes the active tab every 60s. Skipped when:
//   - tab is hidden (no point)
//   - any row is expanded (avoid collapsing it under the user)
let autoRefreshTimer = null;
function startAutoRefresh() {
  stopAutoRefresh();
  autoRefreshTimer = setInterval(() => {
    if (!currentSession || document.hidden) return;
    if (expandedOrderId || expandedQuoteId || expandedContactId) return;
    const tab = parseHash().tab || 'dashboard';
    if (tab === 'dashboard') loadStats();
    else if (tab === 'orders') loadOrders();
    else if (tab === 'quotes') loadQuotes();
    else if (tab === 'contacts') loadContacts();
  }, AUTO_REFRESH_MS);
}
function stopAutoRefresh() {
  if (autoRefreshTimer) {
    clearInterval(autoRefreshTimer);
    autoRefreshTimer = null;
  }
}
window.addEventListener('beforeunload', stopAutoRefresh);

// ─── INIT ──────────────────────────────────────────────────────
bootstrap();
