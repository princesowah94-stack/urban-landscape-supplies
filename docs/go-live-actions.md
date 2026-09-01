# Go-live actions (manual steps Prince/client must do)

Everything code-side is deployed. These three items need dashboard/DNS access.

## 1. Email forwarding: info@ → gmail (~10 min, free)

The site now shows **info@urbanlandscapesupplies.com.au**. DNS is on Vercel
nameservers with no mail records, so use ImprovMX (free) to forward it:

1. Sign up free at https://improvmx.com with any login email.
2. Add domain `urbanlandscapesupplies.com.au`, alias `info` →
   `urbanlandscapesupplies@gmail.com`.
3. Vercel dashboard → the **urban-landscape-supplies** project → Settings →
   Domains → `urbanlandscapesupplies.com.au` → DNS records (or Team → Domains
   → DNS), add:
   | Type | Name | Value | Priority |
   |---|---|---|---|
   | MX | @ | `mx1.improvmx.com` | 10 |
   | MX | @ | `mx2.improvmx.com` | 20 |
   | TXT | @ | `v=spf1 include:spf.improvmx.com ~all` | — |
4. Wait ~10 minutes; ImprovMX dashboard shows the domain as verified.
5. Test: send an email to info@urbanlandscapesupplies.com.au from any account
   → should land in the gmail inbox.

Note: this handles **receiving** only. The site's own outgoing emails (order
confirmations etc.) keep sending via Resend from the verified domain — no change.

## 2. Route form/order notifications to the gmail (~2 min)

Vercel dashboard → **urban-landscape-supplies** project → Settings →
Environment Variables (Production):

- `EMAIL_TO` = `urbanlandscapesupplies@gmail.com`  (contact form, quotes, trade applications)
- `EMAIL_TO_STAFF` = `urbanlandscapesupplies@gmail.com`  (order/dispatch staff copies)

Then Deployments → ⋯ on the latest → **Redeploy** (env changes need a redeploy).
Test with one contact-form submit on the live site.

## 3. CRM cron secret (outstanding from the CRM build, ~2 min)

Vercel dashboard → **urban-crm** project → Settings → Environment Variables
(all environments):

- `CRON_SECRET` = output of `openssl rand -hex 32` (any long random string)

Protects the daily low-stock and quote-expiry cron endpoints.

## For the client's awareness

- The 1300 number has been removed everywhere and replaced with 0433 132 406
  (site, Google structured data, order emails). If a real 1300/landline is
  provisioned later, it's a one-line change.
- All delivery pricing is gone: checkout charges materials only and tells the
  customer delivery is quoted separately; order confirmation emails say the
  same. **Staff must now contact each customer to quote/collect delivery** —
  the CRM's manual-order form has a "Delivery fee (quoted)" field for phone
  orders.
- Blog is live at /blog with 3 starter articles; new posts = add an entry to
  `data/blog.json` + a body file in `content/blog/` and run
  `node scripts/prerender-blog.js` (or just ask Claude).
