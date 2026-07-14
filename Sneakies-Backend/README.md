# Sneakies Backend

Standalone Netlify Functions backend for the Sneakies Free Sample Box claim
flow. Implements the architecture in
`SNEAKIES_BACKEND_ARCHITECTURE_REVIEW_AND_REVISED_PLAN` (the repo's `docs/`
folder has the full write-up). This folder is completely self-contained —
it does not import or depend on anything else in the `shopify-sneakies`
theme repo, and deploying it does not touch the live theme, Klaviyo flows,
templates, or the existing checkout flow in any way.

**What this backend does NOT do:** it never creates, modifies, or completes
a Shopify cart, checkout, draft order, or order. Cart/checkout creation
stays exactly where it is today, in `assets/sn-storefront.js`. See the
architecture review doc for why (short version: Shopify's `orderCreate`
only supports one discount code per order — Sneakies uses two — and every
order, including $0 ones, must complete through Shopify's hosted checkout
regardless of API used; no backend can change that).

**What it does do:**
1. An authoritative, server-side pre-submission check (validation +
   duplicate-claim detection against real Shopify order history) that the
   claim page can call before it creates a cart.
2. A Shopify webhook receiver that syncs Klaviyo profile properties and
   fires an order-linked event once a Sample Box order genuinely exists —
   reliable, server-to-server, not dependent on the customer's browser
   still being open.

## Folder structure

```
Sneakies-Backend/
├── netlify/functions/
│   ├── precheck-claim.js         POST /api/precheck-claim
│   └── shopify-order-webhook.js  POST /api/shopify-order-webhook
├── lib/
│   ├── validateClaim.js          Field validation (mirrors the claim page's spec)
│   ├── shopify.js                Read-only Admin API (availability + dedupe)
│   ├── klaviyo.js                Private API (profile upsert + event tracking)
│   └── verifyShopifyWebhook.js   HMAC signature verification
├── test/                         node:test suite — see "Testing" below
├── package.json
├── netlify.toml
├── .env.example
└── README.md
```

## Deploying to Netlify

You only need to do three things:

1. **Deploy this folder.** Either:
   - Drag-and-drop this `Sneakies-Backend` folder directly onto
     [app.netlify.com/drop](https://app.netlify.com/drop), or
   - Connect this repository as its own Netlify site and set the site's
     **Base directory** to `Sneakies-Backend` in Site configuration > Build
     & deploy.
   No build command is needed — there's no bundler step, just functions.
2. **Configure environment variables** in Site configuration > Environment
   variables, using `.env.example` as the checklist. Do not commit a real
   `.env` file anywhere.
3. **Deploy.** Netlify will pick up `netlify.toml` automatically
   (`node_bundler = "esbuild"`, functions directory, and the `/api/*` →
   `/.netlify/functions/*` redirect that gives the endpoints their documented
   paths).

After deploying, register the webhook subscription in Shopify (Admin >
Settings > Notifications > Webhooks, or via the Admin API):
- Topic: `orders/create`
- Format: JSON
- URL: `https://<your-site>.netlify.app/api/shopify-order-webhook`
- Use the signing secret Shopify gives you for `SHOPIFY_WEBHOOK_SECRET`.

Give the deployed site URL back for the frontend integration step (calling
`/api/precheck-claim` from `sections/sneakies-claim.liquid`) — that's a
separate, later change, intentionally not made yet.

## Environment variables

See `.env.example` for the full list with descriptions. Summary:

| Variable | Used by |
|---|---|
| `SHOPIFY_STORE_DOMAIN` | precheck-claim (via lib/shopify.js) |
| `SHOPIFY_ADMIN_API_ACCESS_TOKEN` | precheck-claim |
| `SHOPIFY_ADMIN_API_VERSION` | precheck-claim |
| `SHOPIFY_SAMPLE_BOX_VARIANT_ID` | precheck-claim, shopify-order-webhook |
| `SHOPIFY_WEBHOOK_SECRET` | shopify-order-webhook |
| `KLAVIYO_PRIVATE_API_KEY` | shopify-order-webhook (via lib/klaviyo.js) |
| `ALLOWED_ORIGIN` | precheck-claim (CORS) |

The Shopify Admin API custom app backing `SHOPIFY_ADMIN_API_ACCESS_TOKEN`
should be granted **only** `read_customers`, `read_orders`, `read_products`,
and `read_inventory`. Do not grant any write scope — this backend has no
code path that writes to Shopify.

## Endpoints

### `POST /api/precheck-claim`
Called by the claim page before it creates a cart (frontend wiring is a
separate, later step). Request body mirrors the address form fields.
Responses:
```
200 { ok: true }
200 { ok: false, reason: "validation", fields: { <field>: "<message>" } }
200 { ok: false, reason: "sold_out" }
200 { ok: false, reason: "duplicate" }
400 { ok: false, reason: "bad_request", message }
500 { ok: false, reason: "server_error", message }   // missing env var
502 { ok: false, reason: "upstream_error", message } // Shopify unreachable
```

### `POST /api/shopify-order-webhook`
Not called by the frontend. Shopify calls this for every order in the
store; it verifies the HMAC signature, ignores any order that doesn't
contain the Sample Box variant, and otherwise upserts Klaviyo profile
properties (`free_box`, `address_collected`, `sample_order_created`,
`has_shipping_address` — same names `assets/sn-klaviyo.js` already writes)
and fires a `Sneakies Sample Box Order Confirmed` event.

## Testing

Zero external test dependencies — uses Node's built-in test runner.

```
npm test
```

61 tests across 6 files, covering: field validation (every rule in the
spec, both individually and combined), duplicate detection (by email and by
shared address, including the "legitimate other purchase" non-match case),
Shopify reads (mocked HTTP — real endpoint/header/query shape asserted),
Klaviyo profile + event calls (mocked HTTP — real endpoint/body shape
asserted), webhook signature verification (valid, tampered, wrong secret,
missing header/body), and error handling (missing env vars, upstream
failures, malformed input) for both functions end-to-end.

**What isn't covered by this test suite:** live network calls to Shopify or
Klaviyo. This environment has no real Shopify Admin API token or Klaviyo
private API key to test against safely, so every Shopify/Klaviyo test
mocks the HTTP layer and asserts the request Netlify would actually send
(URL, headers, body shape) rather than hitting the real APIs. The GraphQL
query shapes in `lib/shopify.js` were separately validated by hand against
the live Shopify Admin API schema and real store data before being written
into this backend. Once real credentials are in place in Netlify, a smoke
test against a real (test) claim is recommended before relying on this in
production — see the implementation report's deployment checklist.
