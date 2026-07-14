const test = require('node:test');
const assert = require('node:assert/strict');
const handlerModule = require('../../netlify/functions/precheck-claim');

const VALID_FIELDS = {
  first_name: 'Jamie',
  last_name: 'Rivera',
  email: 'jamie@email.com',
  phone: '',
  address1: '123 Orchard Way',
  address2: '',
  city: 'Portland',
  state: 'OR',
  zip: '97201',
};

function setEnv() {
  Object.assign(process.env, {
    SHOPIFY_STORE_DOMAIN: 'sneakies2.myshopify.com',
    SHOPIFY_ADMIN_API_ACCESS_TOKEN: 'shpat_test_token',
    SHOPIFY_ADMIN_API_VERSION: '2026-07',
    SHOPIFY_SAMPLE_BOX_VARIANT_ID: '47563934072981',
    ALLOWED_ORIGIN: 'https://eatsneakies.com',
  });
}
function clearEnv() {
  ['SHOPIFY_STORE_DOMAIN', 'SHOPIFY_ADMIN_API_ACCESS_TOKEN', 'SHOPIFY_ADMIN_API_VERSION', 'SHOPIFY_SAMPLE_BOX_VARIANT_ID', 'ALLOWED_ORIGIN'].forEach(
    (k) => delete process.env[k]
  );
}

// Routes the mocked Admin API response by inspecting the GraphQL query text
// sent, so a single mock covers both the availability check and the
// duplicate-order lookups the handler makes in sequence.
function mockShopify({ available = true, quantity = 100, existingOrders = [] } = {}) {
  global.fetch = async (url, opts) => {
    const parsed = JSON.parse(opts.body);
    if (parsed.query.includes('productVariant')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ data: { productVariant: { availableForSale: available, inventoryQuantity: quantity } } }),
        text: async () => '',
      };
    }
    // orders query — same canned result for both the email-signal and
    // address-signal calls in this simplified mock.
    return {
      ok: true,
      status: 200,
      json: async () => ({ data: { orders: { edges: existingOrders } } }),
      text: async () => '',
    };
  };
}

test.beforeEach(setEnv);
test.afterEach(() => {
  clearEnv();
  delete global.fetch;
});

function makeEvent(body, method = 'POST') {
  return { httpMethod: method, body: typeof body === 'string' ? body : JSON.stringify(body) };
}

test('rejects non-POST methods', async () => {
  const res = await handlerModule.handler(makeEvent({}, 'GET'));
  assert.equal(res.statusCode, 405);
});

test('handles CORS preflight', async () => {
  const res = await handlerModule.handler(makeEvent({}, 'OPTIONS'));
  assert.equal(res.statusCode, 204);
  assert.equal(res.headers['Access-Control-Allow-Origin'], 'https://eatsneakies.com');
});

test('returns 400 for invalid JSON body', async () => {
  const res = await handlerModule.handler(makeEvent('{not json', 'POST'));
  assert.equal(res.statusCode, 400);
  const body = JSON.parse(res.body);
  assert.equal(body.ok, false);
  assert.equal(body.reason, 'bad_request');
});

test('returns validation errors without ever calling Shopify', async () => {
  let fetchCalled = false;
  global.fetch = async () => {
    fetchCalled = true;
    throw new Error('should not be called');
  };
  const res = await handlerModule.handler(makeEvent({ ...VALID_FIELDS, email: 'not-an-email' }));
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.ok, false);
  assert.equal(body.reason, 'validation');
  assert.ok(body.fields.email);
  assert.equal(fetchCalled, false);
});

test('returns sold_out when Shopify reports no availability', async () => {
  mockShopify({ available: false });
  const res = await handlerModule.handler(makeEvent(VALID_FIELDS));
  const body = JSON.parse(res.body);
  assert.equal(res.statusCode, 200);
  assert.equal(body.ok, false);
  assert.equal(body.reason, 'sold_out');
});

test('returns duplicate when the email already has a Sample Box order', async () => {
  mockShopify({
    available: true,
    existingOrders: [
      {
        node: {
          id: 'gid://shopify/Order/1',
          name: '#1071',
          email: VALID_FIELDS.email,
          lineItems: { edges: [{ node: { variant: { id: 'gid://shopify/ProductVariant/47563934072981' } } }] },
          shippingAddress: { address1: 'some other address', zip: '00000' },
        },
      },
    ],
  });
  const res = await handlerModule.handler(makeEvent(VALID_FIELDS));
  const body = JSON.parse(res.body);
  assert.equal(body.ok, false);
  assert.equal(body.reason, 'duplicate');
});

test('returns ok:true for a valid, available, non-duplicate claim', async () => {
  mockShopify({ available: true, existingOrders: [] });
  const res = await handlerModule.handler(makeEvent(VALID_FIELDS));
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.deepEqual(body, { ok: true });
});

test('returns 500 with a clear message when required env vars are missing', async () => {
  clearEnv();
  const res = await handlerModule.handler(makeEvent(VALID_FIELDS));
  assert.equal(res.statusCode, 500);
  const body = JSON.parse(res.body);
  assert.equal(body.reason, 'server_error');
  assert.match(body.message, /Missing required environment variable/);
});

test('returns 502 when Shopify is unreachable/errors', async () => {
  setEnv();
  global.fetch = async () => {
    throw new Error('network down');
  };
  const res = await handlerModule.handler(makeEvent(VALID_FIELDS));
  assert.equal(res.statusCode, 502);
  const body = JSON.parse(res.body);
  assert.equal(body.reason, 'upstream_error');
});
