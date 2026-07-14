/*
  POST /api/shopify-order-webhook

  Not called by the frontend — register this URL as a Shopify webhook
  subscription (topic: orders/create) in Shopify Admin or via the Admin API.
  Shopify calls this for EVERY order in the store, not just Sample Box
  claims, so this handler must no-op cleanly for unrelated orders.

  Purpose: fire Klaviyo profile-property updates + an order-linked event
  from a verified, server-to-server signal tied to a REAL completed order —
  strictly more reliable than the existing best-effort client-side
  sn-klaviyo.js call, which an ad blocker or a closed tab can skip entirely.
  This function has no ability to affect the order, discount, or inventory
  that already exists by the time it runs — it only reads the webhook
  payload and writes to Klaviyo.
*/

const { verifyShopifyWebhook } = require('../../lib/verifyShopifyWebhook');
const { upsertProfileProperties, trackEvent } = require('../../lib/klaviyo');

function sampleBoxVariantId() {
  const raw = process.env.SHOPIFY_SAMPLE_BOX_VARIANT_ID || '';
  // Webhook payloads use the plain numeric id (no gid:// prefix), same form
  // as the env var's documented default in .env.example.
  const match = raw.match(/(\d+)\s*$/);
  return match ? match[1] : raw;
}

function orderContainsSampleBox(order) {
  const variantId = sampleBoxVariantId();
  if (!variantId || !Array.isArray(order.line_items)) return false;
  return order.line_items.some((item) => String(item.variant_id) === String(variantId));
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Use POST.' };
  }

  const signature =
    (event.headers && (event.headers['x-shopify-hmac-sha256'] || event.headers['X-Shopify-Hmac-Sha256'])) || '';
  const secret = process.env.SHOPIFY_WEBHOOK_SECRET;

  if (!secret) {
    return { statusCode: 500, body: 'Missing required environment variable: SHOPIFY_WEBHOOK_SECRET' };
  }

  const rawBody = event.body || '';
  if (!verifyShopifyWebhook(rawBody, signature, secret)) {
    return { statusCode: 401, body: 'Invalid webhook signature.' };
  }

  let order;
  try {
    order = JSON.parse(rawBody);
  } catch (e) {
    return { statusCode: 400, body: 'Invalid JSON payload.' };
  }

  // Orders for any other product in the store are expected and not an
  // error — just nothing for this backend to do.
  if (!orderContainsSampleBox(order)) {
    return { statusCode: 200, body: 'Ignored: order does not contain the Sample Box variant.' };
  }

  const email = order.email || (order.customer && order.customer.email) || null;
  const shipping = order.shipping_address || {};
  const firstName = shipping.first_name || (order.customer && order.customer.first_name) || null;
  const lastName = shipping.last_name || (order.customer && order.customer.last_name) || null;

  if (!email) {
    return { statusCode: 200, body: 'Ignored: order has no email to attribute to a profile.' };
  }

  try {
    await upsertProfileProperties(
      email,
      { firstName, lastName },
      {
        free_box: true,
        address_collected: true,
        sample_order_created: true,
        has_shipping_address: true,
      }
    );

    await trackEvent(
      email,
      'Sneakies Sample Box Order Confirmed',
      {
        order_id: order.id,
        order_name: order.name,
        order_number: order.order_number,
      },
      { firstName, lastName }
    );

    return { statusCode: 200, body: 'OK' };
  } catch (err) {
    // Non-2xx so Shopify retries the webhook delivery — a transient Klaviyo
    // failure shouldn't silently drop the sync.
    return { statusCode: 502, body: `Klaviyo sync failed: ${err.message || 'unknown error'}` };
  }
};
