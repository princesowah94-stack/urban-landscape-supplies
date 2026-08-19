// Minimal input sanitation shared by the public form endpoints
// (contact, quote, trade-application). Trust boundary only — keeps
// unbounded strings, header-injection and garbage email targets out.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Trim, strip CR/LF (header injection), cap length. Non-strings become ''.
export function str(v, max = 500) {
  return String(v ?? '').replace(/[\r\n]/g, ' ').trim().slice(0, max);
}

// Multi-line free text: keep newlines, cap length.
export function text(v, max = 5000) {
  return String(v ?? '').trim().slice(0, max);
}

export function isEmail(v) {
  return typeof v === 'string' && v.length <= 254 && EMAIL_RE.test(v);
}

export function num(v, { min = 0, max = 1e6, fallback = 0 } = {}) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}
