# Urban Landscape Supplies — Handover Notes

*Prepared 09/07/2026 for handover. Covers the retail website (urbanlandscapesupplies.com.au) and the Urban CRM (urban-crm.vercel.app).*

---

## How the website and CRM relate

Both apps read and write the **same Supabase database**. There is no sync process — an order placed on the website appears in the CRM instantly, and a product edit in the CRM is served by the website immediately (product *listings* sit behind a 5-minute CDN cache; stock levels are live with no cache).

**What the CRM manages that the website serves live:**

| Data | Sync behaviour |
|---|---|
| Product name, price, description, images, stock, in-stock flag | Live (listings ≤5 min CDN cache) |
| Orders, refunds, statuses | Live, both directions |
| Contact form messages, quote requests | Live — appear in CRM as they arrive |
| Trade applications | Live — appear in CRM Trade tab, approve/reject there |

**Known limitation — pebble bag prices:** the 20kg bag / 1-tonne bulk bag prices for the 5 decorative pebble products are set in code (`api/products.js` → `BAG_SIZES`), not in the database. Editing a pebble product's price in the CRM changes only the base price, not the bag options. Changing bag prices requires a code edit.

## CRM modules

Live: Dashboard, Orders, Products (incl. stock), Customers, Contacts, Quotes, Deliveries, Trade, Finance, Accounting, **Campaigns**, **Social**, Settings, AI chat.

**Integrations that need API keys before their module works** (Settings page shows connection status for each):

| Integration | Enables | Keys needed (Vercel → urban-crm → Env Vars) |
|---|---|---|
| Anthropic | AI chat panel | `ANTHROPIC_API_KEY` |
| Meta / Instagram | Social posting | `META_APP_ID`, `META_APP_SECRET` (Meta developer app) |
| Google | Gmail threads in Contacts | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` |
| Twilio | SMS campaigns | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER` |
| Xero | Accounting export | `XERO_CLIENT_ID`, `XERO_CLIENT_SECRET` |

Email campaigns already work — `RESEND_API_KEY` is configured.

## Outstanding go-live items (website)

1. **Email env vars** (from client): `EMAIL_USER`, `EMAIL_PASS` (Gmail App Password), `EMAIL_FROM`, `EMAIL_TO` — enables contact/quote/trade emails. Until then, submissions are stored in the CRM but send no notifications.
2. **Square production**: `SQUARE_ACCESS_TOKEN`, `SQUARE_LOCATION_ID`, `SQUARE_WEBHOOK_SIGNATURE_KEY`; set `SQUARE_ENVIRONMENT=production`. Configure the webhook in Square Developer Dashboard → point at `https://urbanlandscapesupplies.com.au/api/square-webhook`.
3. **End-to-end payment test** in sandbox before flipping to production (card `4111 1111 1111 1111`).
4. **Website admin (`/admin`) first-time setup**: Supabase → Authentication → URL Configuration → Site URL `https://urbanlandscapesupplies.com.au`; sign in once via magic link; then in SQL editor: `INSERT INTO admin_profiles (id, display_name, role) SELECT id, 'Name', 'admin' FROM auth.users WHERE email = 'their@email.com';`
5. `SUPPLIER_NOTIFICATION_EMAIL` — supplier order notifications (optional).

## Deferred / nice-to-have

- **Clerk (CRM login) is in test mode** — works fine, but sign-in emails carry Clerk branding. Switch to production keys in the Clerk dashboard when ready (needs a DNS CNAME).
- **CRM custom domain** — currently `urban-crm.vercel.app`; add e.g. `crm.urbanlandscapesupplies.com.au` in Vercel → Domains.
- Rate limiting on the contact form (needs Upstash Redis).
- Admin pagination beyond 50 orders.

## Deploy pipeline (both repos)

GitHub → Vercel auto-deploy on push to `main`.
- Website: `princesowah94-stack/urban-landscape-supplies`
- CRM: `princesowah94-stack/urban-crm`

Database schema changes: add a migration file under the **website repo's** `supabase/migrations/` and run `npx supabase db push` from there (the repo is CLI-linked; migration history is now clean).
