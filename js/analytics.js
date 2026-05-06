/**
 * GA4 (gtag.js) loader.
 *
 * Loaded site-wide via <script defer src="/js/analytics.js"></script> in every
 * page <head>. Self-contained — no inline gtag config in the HTML, so the
 * Measurement ID lives in exactly one place.
 *
 * Privacy note: the GA4 cookies set by this script (_ga, _ga_*) are disclosed
 * in privacy.html. If GA4 needs to be disabled (cookie-banner, opt-out, etc.),
 * delete or stub this file — no other JS depends on `gtag`.
 */
(function () {
  const GA_ID = 'G-STY5N2Z7NB';

  // Inject the gtag.js library asynchronously
  const s = document.createElement('script');
  s.async = true;
  s.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA_ID;
  document.head.appendChild(s);

  // Standard gtag bootstrap. Calls made before gtag.js loads queue in dataLayer
  // and replay once it's ready.
  window.dataLayer = window.dataLayer || [];
  window.gtag = function gtag() { window.dataLayer.push(arguments); };
  window.gtag('js', new Date());
  window.gtag('config', GA_ID, {
    // Anonymise IP at ingestion (defaults to true in GA4 but stated explicitly
    // for the privacy policy to reference)
    anonymize_ip: true,
  });
})();
