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
let allOrders = [];
let expandedOrderId = null;
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

$('#admin-filters')?.addEventListener('click', (e) => {
  const btn = e.target.closest('.admin-filter');
  if (!btn) return;
  $$('.admin-filter').forEach(b => b.classList.remove('admin-filter--active'));
  btn.classList.add('admin-filter--active');
  currentFilter = btn.dataset.status || '';
  expandedOrderId = null;
  loadOrders();
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

// Delegated handler for row expand + status transition + refund + edit buttons
document.addEventListener('click', async (e) => {
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
let autoRefreshTimer = null;
function startAutoRefresh() {
  stopAutoRefresh();
  autoRefreshTimer = setInterval(() => {
    if (!currentSession || document.hidden || expandedOrderId) return;
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
bootstrap();
