/*
  POST /api/precheck-claim

  Authoritative pre-submission check for the Free Sample Box claim flow.
  Called by the claim page BEFORE it calls the existing, unchanged
  window.SneakiesStorefront.createFreeBoxCart() — this endpoint never
  creates a cart, order, or checkout itself. It only decides whether the
  client should be allowed to proceed to that existing call.

  Request body: { first_name, last_name, email, phone, address1, address2,
                   city, state, zip }

  Responses:
    200 { ok: true }
    200 { ok: false, reason: "validation", fields: { <field>: <message> } }
    200 { ok: false, reason: "sold_out" }
    200 { ok: false, reason: "duplicate" }
    400 { ok: false, reason: "bad_request", message }
    500 { ok: false, reason: "server_error", message }
    502 { ok: false, reason: "upstream_error", message }
*/

const { validateClaim } = require('../../lib/validateClaim');
const { checkAvailability, findExistingClaim } = require('../../lib/shopify');

function corsHeaders() {
  const origin = process.env.ALLOWED_ORIGIN || '';
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };
}

function respond(statusCode, body) {
  return { statusCode, headers: corsHeaders(), body: JSON.stringify(body) };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders(), body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return respond(405, { ok: false, reason: 'method_not_allowed', message: 'Use POST.' });
  }

  let fields;
  try {
    fields = JSON.parse(event.body || '{}');
  } catch (e) {
    return respond(400, { ok: false, reason: 'bad_request', message: 'Body must be valid JSON.' });
  }

  const result = validateClaim(fields);
  if (!result.valid) {
    return respond(200, { ok: false, reason: 'validation', fields: result.fields });
  }

  try {
    const availability = await checkAvailability();
    if (!availability.available) {
      return respond(200, { ok: false, reason: 'sold_out' });
    }

    const dedupe = await findExistingClaim({
      email: result.normalized.email,
      address1: result.normalized.address1,
      zip: result.normalized.zip,
    });
    if (dedupe.duplicate) {
      return respond(200, { ok: false, reason: 'duplicate' });
    }

    return respond(200, { ok: true });
  } catch (err) {
    if (err && err.code === 'MISSING_ENV') {
      return respond(500, { ok: false, reason: 'server_error', message: err.message });
    }
    return respond(502, { ok: false, reason: 'upstream_error', message: err.message || 'Shopify lookup failed.' });
  }
};
