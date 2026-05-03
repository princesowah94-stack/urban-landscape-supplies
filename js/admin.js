/**
 * admin.js — login, fetch orders, render table, transition status.
 * Token lives in sessionStorage so closing the tab logs out.
 */
const TOKEN_KEY = 'uls_admin_token';
const AUTO_REFRESH_MS = 60_000;

const STATUS_LABELS = {
  pending_payment: 'Pending payment',
  paid:            'Paid',
  dispatched:      'Dispatched',
  delivered:       'Delivered',
  cancelled:       'Cancelled',
  refunded:        'Refunded',
};
// Each entry is either a status transition ({to, label}) or a special action ({action, label}).
// Refund hits /api/admin/refund and lives on paid/dispatched/delivered.
// Reopen flips a cancelled order back to paid (cancelled -> paid).
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
let allOrders = [];
let expandedOrderId = null;

const $  = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => Array.from(root.querySelectorAll(s));
const aud = (cents) => `$${(cents / 100).toFixed(2)}`;

const escapeHTML = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]));

const formatDate = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('en-AU', { day: '2-digit', month: 'short' });
};

// ─── AUTH ──────────────────────────────────────────────────────
function getToken() { return sessionStorage.getItem(TOKEN_KEY); }
function setToken(t) { sessionStorage.setItem(TOKEN_KEY, t); }
function clearToken() { sessionStorage.removeItem(TOKEN_KEY); }

function authHeaders() {
  return { 'Authorization': `Bearer ${getToken()}` };
}

async function login(password) {
  const res = await fetch('/api/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  if (!res.ok) throw new Error('Invalid password');
  const { token } = await res.json();
  setToken(token);
}

function logout() {
  clearToken();
  stopAutoRefresh();
  showLogin();
}

// ─── VIEW SWAP ─────────────────────────────────────────────────
function showLogin() {
  $('#admin-login-view').style.display = '';
  $('#admin-dashboard-view').style.display = 'none';
  $('#admin-pw').value = '';
  $('#admin-pw').focus();
}

function showDashboard() {
  $('#admin-login-view').style.display = 'none';
  $('#admin-dashboard-view').style.display = '';
  loadOrders();
}

// ─── DATA ──────────────────────────────────────────────────────
async function loadOrders() {
  const container = $('#admin-orders-container');
  container.innerHTML = '<div class="admin-loading">Loading orders...</div>';

  try {
    const url = currentFilter ? `/api/admin/orders?status=${currentFilter}` : '/api/admin/orders';
    const res = await fetch(url, { headers: authHeaders() });

    if (res.status === 401) { logout(); return; }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const { orders } = await res.json();
    allOrders = orders || [];
    renderOrders();
  } catch (err) {
    console.error('Load orders failed:', err);
    container.innerHTML = '<div class="admin-empty">Could not load orders. Try refresh.</div>';
  }
}

async function transitionOrder(orderId, nextStatus) {
  const order = allOrders.find(o => o.id === orderId);
  if (!order) return;

  const previousStatus = order.status;
  // Optimistic update
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

    const msg = nextStatus === 'dispatched'
      ? 'Marked dispatched · customer notified'
      : `Marked ${STATUS_LABELS[nextStatus].toLowerCase()}`;
    showToast(msg);
  } catch (err) {
    console.error('Transition failed:', err);
    // Roll back
    order.status = previousStatus;
    renderOrders();
    showToast(`Update failed: ${err.message}`);
  }
}

async function refundOrder(orderId) {
  const order = allOrders.find(o => o.id === orderId);
  if (!order) return;

  const previousStatus = order.status;
  // Optimistic update
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
      </div>
    </td></tr>
  `;
}

// ─── EVENTS ────────────────────────────────────────────────────
$('#admin-login-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const pw = $('#admin-pw').value;
  const errEl = $('#admin-login-error');
  const btnText = $('#admin-login-btn-text');
  errEl.classList.remove('admin-login__error--visible');
  btnText.textContent = 'Signing in...';
  try {
    await login(pw);
    showDashboard();
    startAutoRefresh();
  } catch (err) {
    errEl.textContent = err.message || 'Invalid password.';
    errEl.classList.add('admin-login__error--visible');
  } finally {
    btnText.textContent = 'Sign in';
  }
});

$('#admin-logout')?.addEventListener('click', logout);

$('#admin-refresh')?.addEventListener('click', loadOrders);

$('#admin-filters')?.addEventListener('click', (e) => {
  const btn = e.target.closest('.admin-filter');
  if (!btn) return;
  $$('.admin-filter').forEach(b => b.classList.remove('admin-filter--active'));
  btn.classList.add('admin-filter--active');
  currentFilter = btn.dataset.status || '';
  expandedOrderId = null;
  loadOrders();
});

// Delegated handler for row expand + status transition + refund buttons
document.addEventListener('click', (e) => {
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
    expandedOrderId = expandedOrderId === id ? null : id;
    renderOrders();
  }
});

// ─── AUTO-REFRESH ──────────────────────────────────────────────
let autoRefreshTimer = null;
function startAutoRefresh() {
  stopAutoRefresh();
  autoRefreshTimer = setInterval(() => {
    // Skip the silent reload while a row is expanded so it doesn't collapse mid-read.
    if (!getToken() || document.hidden || expandedOrderId) return;
    loadOrders();
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
document.addEventListener('DOMContentLoaded', () => {
  if (getToken()) {
    showDashboard();
    startAutoRefresh();
  } else {
    showLogin();
  }
});
