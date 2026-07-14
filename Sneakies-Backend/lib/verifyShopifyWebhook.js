/*
  Shopify webhook HMAC verification — standard requirement for any endpoint
  that receives Shopify webhooks (https://shopify.dev/docs/apps/build/webhooks).
  Shopify signs the raw request body with the webhook subscription's signing
  secret (HMAC-SHA256, base64-encoded) and sends it in the
  X-Shopify-Hmac-Sha256 header. Verifying it is what stops an attacker from
  POSTing a forged "order created" payload straight at this endpoint.

  Must be computed against the exact raw body bytes Shopify sent — do not
  parse-then-restringify the JSON first, that can change byte-for-byte
  formatting and break the signature.
*/

const crypto = require('crypto');

/**
 * @param {string} rawBody - the untouched request body string
 * @param {string} signatureHeader - value of the X-Shopify-Hmac-Sha256 header
 * @param {string} secret - the webhook subscription's signing secret
 * @returns {boolean}
 */
function verifyShopifyWebhook(rawBody, signatureHeader, secret) {
  if (!rawBody || !signatureHeader || !secret) return false;

  const computed = crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('base64');

  const a = Buffer.from(computed, 'utf8');
  const b = Buffer.from(String(signatureHeader), 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

module.exports = { verifyShopifyWebhook };
