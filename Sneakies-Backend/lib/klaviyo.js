/*
  Server-side Klaviyo client using Klaviyo's PRIVATE Events + Profile-Import
  APIs (KLAVIYO_PRIVATE_API_KEY). This is a different API surface from the
  PUBLIC company_id-based Subscriptions API assets/sn-klaviyo.js already uses
  client-side — that file is untouched and keeps working exactly as before
  for the waitlist-signup flow. This module exists so the same claim-flow
  properties can also be written reliably, from a verified Shopify webhook,
  tied to a real completed order — not best-effort client JS that an ad
  blocker or a closed tab can skip entirely.

  Uses the single-call "Create or Update Profile" (profile-import) upsert
  endpoint rather than a create-then-409-then-patch dance — one request,
  identified by email, matches how sn-klaviyo.js already writes profile
  properties and keeps this module small.
*/

const KLAVIYO_REVISION = '2024-10-15';

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    const err = new Error(`Missing required environment variable: ${name}`);
    err.code = 'MISSING_ENV';
    throw err;
  }
  return value;
}

function headers() {
  return {
    'Content-Type': 'application/json',
    Authorization: `Klaviyo-API-Key ${requireEnv('KLAVIYO_PRIVATE_API_KEY')}`,
    revision: KLAVIYO_REVISION,
  };
}

/**
 * Upserts a profile's identity + custom properties. `properties` should be
 * the same shape sn-klaviyo.js already writes client-side (free_box,
 * fifty_off, address_collected, sample_order_created, has_shipping_address,
 * existing_customer, existing_contact, internal_test) — same property names,
 * so existing Klaviyo segments/flows keyed off them behave identically
 * regardless of which path wrote them.
 */
async function upsertProfileProperties(email, extra, properties) {
  if (!email || !properties) return null;
  const attributes = { email, properties };
  if (extra && extra.firstName) attributes.first_name = extra.firstName;
  if (extra && extra.lastName) attributes.last_name = extra.lastName;

  const body = { data: { type: 'profile', attributes } };

  const res = await fetch('https://a.klaviyo.com/api/profile-import', {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Klaviyo profile-import failed (${res.status}): ${text}`);
  }
  return res.json().catch(() => null);
}

/**
 * Fires a Klaviyo event tied to a real, completed order — used only from
 * netlify/functions/shopify-order-webhook.js, never from the pre-submit
 * check (no order exists yet at that point).
 */
async function trackEvent(email, metricName, properties, extra) {
  if (!email || !metricName) return null;
  const profileAttributes = { email };
  if (extra && extra.firstName) profileAttributes.first_name = extra.firstName;
  if (extra && extra.lastName) profileAttributes.last_name = extra.lastName;

  const body = {
    data: {
      type: 'event',
      attributes: {
        profile: { data: { type: 'profile', attributes: profileAttributes } },
        metric: { data: { type: 'metric', attributes: { name: metricName } } },
        properties: properties || {},
        time: new Date().toISOString(),
      },
    },
  };

  const res = await fetch('https://a.klaviyo.com/api/events', {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Klaviyo create-event failed (${res.status}): ${text}`);
  }
  return true;
}

module.exports = { upsertProfileProperties, trackEvent, requireEnv };
