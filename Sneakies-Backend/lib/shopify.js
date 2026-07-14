/*
  Read-only Shopify Admin API client.

  Deliberately does NOT create, update, or complete orders/carts/drafts of
  any kind — see SNEAKIES_BACKEND_ARCHITECTURE_REVIEW_AND_REVISED_PLAN for
  why (orderCreate's single-discount-code limit breaks the existing
  SNEAKIESFREEBOX + SNEAKIESFREESHIP setup, and Shopify requires every
  order, including $0 ones, to complete through hosted checkout regardless).
  Only two things happen here: an availability read, and a duplicate-claim
  lookup against real order history. Both are read scopes only
  (read_products, read_inventory, read_orders) — no write_orders,
  write_draft_orders, or write_customers scope is requested anywhere in this
  backend.

  Query shapes below were validated directly against the live Shopify Admin
  GraphQL API (2026-07) before shipping, the same way sn-storefront.js's
  Storefront API calls were validated in the theme.
*/

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    const err = new Error(`Missing required environment variable: ${name}`);
    err.code = 'MISSING_ENV';
    throw err;
  }
  return value;
}

function endpoint() {
  const domain = requireEnv('SHOPIFY_STORE_DOMAIN');
  const version = requireEnv('SHOPIFY_ADMIN_API_VERSION');
  return `https://${domain}/admin/api/${version}/graphql.json`;
}

async function adminGraphQL(query, variables) {
  const token = requireEnv('SHOPIFY_ADMIN_API_ACCESS_TOKEN');
  const res = await fetch(endpoint(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': token,
    },
    body: JSON.stringify({ query, variables: variables || {} }),
  });
  const json = await res.json();
  if (json.errors && json.errors.length) {
    throw new Error(`Shopify Admin API error: ${json.errors.map((e) => e.message).join(' ')}`);
  }
  return json.data;
}

function sampleBoxVariantGid() {
  const raw = requireEnv('SHOPIFY_SAMPLE_BOX_VARIANT_ID');
  return raw.indexOf('gid://') === 0 ? raw : `gid://shopify/ProductVariant/${raw}`;
}

/**
 * Live availability read for the Sneakies Sample Box variant — the same
 * signal sn-storefront.js's checkAvailability() already uses client-side
 * (via the Storefront API), re-exposed here so a pre-submit backend check
 * can use the same source of truth without a second, divergent counter.
 */
async function checkAvailability() {
  const query = `
    query CheckAvailability($id: ID!) {
      productVariant(id: $id) {
        availableForSale
        inventoryQuantity
      }
    }
  `;
  const data = await adminGraphQL(query, { id: sampleBoxVariantGid() });
  const variant = data && data.productVariant;
  if (!variant) throw new Error('Sample Box variant not found.');
  // Mirrors assets/sn-storefront.js's checkAvailability() exactly:
  // availableForSale alone is the source of truth (it already accounts for
  // Shopify's own inventory policy, e.g. "continue selling when out of
  // stock"), not a separate quantity>0 condition layered on top — adding
  // one here would silently diverge from what the client already does.
  return {
    available: !!variant.availableForSale,
    quantity: variant.inventoryQuantity,
  };
}

function normalizedAddressKey(address1, zip) {
  return `${String(address1 || '').trim().toLowerCase()}|${String(zip || '').trim().toLowerCase()}`;
}

/**
 * Authoritative duplicate-claim check against real Shopify order history —
 * replaces/augments the client-only localStorage check in
 * sections/sneakies-claim.liquid, which is trivially bypassed by clearing
 * storage or switching browsers.
 *
 * Two signals, both scoped to orders that actually contain the Sample Box
 * variant (so a customer who legitimately bought something else first isn't
 * wrongly flagged):
 *   1. Same email has a prior Sample Box order (exact match — Shopify's
 *      `email:` search filter is precise).
 *   2. Same normalized shipping address (address1 + zip) appears on a prior
 *      Sample Box order, regardless of email (catches the same-household,
 *      different-email case the client-side spec also covers). This is a
 *      best-effort text-search match, not an indexed exact filter — Shopify's
 *      order search doesn't support filtering on shipping address fields
 *      directly, so this is intentionally a secondary, softer signal, and is
 *      documented as such in the implementation report.
 *
 * @param {{ email: string, address1: string, zip: string }} claim
 */
async function findExistingClaim(claim) {
  const variantGid = sampleBoxVariantGid();
  const email = String(claim.email || '').trim().toLowerCase();
  const targetAddressKey = normalizedAddressKey(claim.address1, claim.zip);

  const query = `
    query FindOrders($q: String!) {
      orders(first: 10, query: $q) {
        edges {
          node {
            id
            name
            email
            lineItems(first: 10) {
              edges { node { variant { id } } }
            }
            shippingAddress { address1 zip }
          }
        }
      }
    }
  `;

  function orderContainsSampleBox(order) {
    return order.lineItems.edges.some((e) => e.node.variant && e.node.variant.id === variantGid);
  }

  // Signal 1: exact email match.
  if (email) {
    const data = await adminGraphQL(query, { q: `email:${email}` });
    const orders = (data.orders && data.orders.edges) || [];
    const match = orders.find((e) => orderContainsSampleBox(e.node));
    if (match) {
      return { duplicate: true, reason: 'email_already_claimed', orderName: match.node.name };
    }
  }

  // Signal 2: same normalized shipping address, any email. Best-effort —
  // uses the zip as a full-text search term (Shopify's order search matches
  // shipping address text loosely), then confirms the match in code.
  if (claim.zip) {
    const data = await adminGraphQL(query, { q: String(claim.zip).trim() });
    const orders = (data.orders && data.orders.edges) || [];
    const match = orders.find((e) => {
      if (!orderContainsSampleBox(e.node)) return false;
      const addr = e.node.shippingAddress;
      if (!addr) return false;
      return normalizedAddressKey(addr.address1, addr.zip) === targetAddressKey;
    });
    if (match) {
      return { duplicate: true, reason: 'address_already_claimed', orderName: match.node.name };
    }
  }

  return { duplicate: false, reason: null, orderName: null };
}

module.exports = {
  checkAvailability,
  findExistingClaim,
  normalizedAddressKey,
  requireEnv,
};
