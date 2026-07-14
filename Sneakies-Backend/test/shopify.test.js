const test = require('node:test');
const assert = require('node:assert/strict');

// lib/shopify.js reads env vars at CALL time (inside each function), not at
// require time, so tests can freely set/unset process.env per test without
// needing to reset the require cache.
const shopify = require('../lib/shopify');

const ENV = {
  SHOPIFY_STORE_DOMAIN: 'sneakies2.myshopify.com',
  SHOPIFY_ADMIN_API_ACCESS_TOKEN: 'shpat_test_token',
  SHOPIFY_ADMIN_API_VERSION: '2026-07',
  SHOPIFY_SAMPLE_BOX_VARIANT_ID: '47563934072981',
};

function setEnv(overrides) {
  Object.assign(process.env, ENV, overrides);
}
function clearEnv() {
  Object.keys(ENV).forEach((k) => delete process.env[k]);
}

function mockFetchOnce(responseBody, status = 200) {
  const calls = [];
  global.fetch = async (url, opts) => {
    calls.push({ url, opts });
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => responseBody,
      text: async () => JSON.stringify(responseBody),
    };
  };
  return calls;
}

function mockFetchSequence(responses) {
  const calls = [];
  let i = 0;
  global.fetch = async (url, opts) => {
    calls.push({ url, opts });
    const r = responses[Math.min(i, responses.length - 1)];
    i += 1;
    return {
      ok: true,
      status: 200,
      json: async () => r,
      text: async () => JSON.stringify(r),
    };
  };
  return calls;
}

test.afterEach(() => {
  clearEnv();
  delete global.fetch;
});

test('checkAvailability throws a clear MISSING_ENV error when token is not configured', async () => {
  clearEnv();
  await assert.rejects(() => shopify.checkAvailability(), (err) => {
    assert.equal(err.code, 'MISSING_ENV');
    // Whichever required var is checked first (order isn't significant —
    // all four are cleared), the error should name it clearly.
    assert.match(
      err.message,
      /SHOPIFY_STORE_DOMAIN|SHOPIFY_ADMIN_API_VERSION|SHOPIFY_ADMIN_API_ACCESS_TOKEN|SHOPIFY_SAMPLE_BOX_VARIANT_ID/
    );
    return true;
  });
});

test('checkAvailability returns available:true when in stock', async () => {
  setEnv();
  mockFetchOnce({ data: { productVariant: { availableForSale: true, inventoryQuantity: 489 } } });
  const result = await shopify.checkAvailability();
  assert.deepEqual(result, { available: true, quantity: 489 });
});

test('checkAvailability returns available:false when Shopify reports sold out', async () => {
  setEnv();
  mockFetchOnce({ data: { productVariant: { availableForSale: false, inventoryQuantity: 0 } } });
  const result = await shopify.checkAvailability();
  assert.equal(result.available, false);
});

test('checkAvailability sends the access token header and correct endpoint', async () => {
  setEnv();
  const calls = mockFetchOnce({ data: { productVariant: { availableForSale: true, inventoryQuantity: 5 } } });
  await shopify.checkAvailability();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://sneakies2.myshopify.com/admin/api/2026-07/graphql.json');
  assert.equal(calls[0].opts.headers['X-Shopify-Access-Token'], 'shpat_test_token');
});

test('checkAvailability surfaces Shopify GraphQL errors', async () => {
  setEnv();
  mockFetchOnce({ errors: [{ message: 'Throttled' }] });
  await assert.rejects(() => shopify.checkAvailability(), /Throttled/);
});

test('findExistingClaim returns duplicate:false when no matching orders exist', async () => {
  setEnv();
  mockFetchSequence([{ data: { orders: { edges: [] } } }, { data: { orders: { edges: [] } } }]);
  const result = await shopify.findExistingClaim({ email: 'new@person.com', address1: '1 New St', zip: '90210' });
  assert.equal(result.duplicate, false);
});

test('findExistingClaim detects a duplicate by email when the order contains the Sample Box variant', async () => {
  setEnv();
  mockFetchSequence([
    {
      data: {
        orders: {
          edges: [
            {
              node: {
                id: 'gid://shopify/Order/1',
                name: '#1071',
                email: 'repeat@person.com',
                lineItems: { edges: [{ node: { variant: { id: 'gid://shopify/ProductVariant/47563934072981' } } }] },
                shippingAddress: { address1: '77 Timberline Ave', zip: '97201' },
              },
            },
          ],
        },
      },
    },
  ]);
  const result = await shopify.findExistingClaim({
    email: 'repeat@person.com',
    address1: '1 Different St',
    zip: '10001',
  });
  assert.equal(result.duplicate, true);
  assert.equal(result.reason, 'email_already_claimed');
});

test('findExistingClaim ignores a same-email order that does not contain the Sample Box variant', async () => {
  setEnv();
  mockFetchSequence([
    {
      data: {
        orders: {
          edges: [
            {
              node: {
                id: 'gid://shopify/Order/2',
                name: '#1080',
                email: 'someone@person.com',
                lineItems: { edges: [{ node: { variant: { id: 'gid://shopify/ProductVariant/99999999999' } } }] },
                shippingAddress: { address1: '5 Other Rd', zip: '10001' },
              },
            },
          ],
        },
      },
    },
    { data: { orders: { edges: [] } } },
  ]);
  const result = await shopify.findExistingClaim({
    email: 'someone@person.com',
    address1: '5 Other Rd',
    zip: '10001',
  });
  assert.equal(result.duplicate, false);
});

test('findExistingClaim detects a duplicate by matching shipping address under a different email', async () => {
  setEnv();
  mockFetchSequence([
    { data: { orders: { edges: [] } } }, // email signal: no match
    {
      data: {
        orders: {
          edges: [
            {
              node: {
                id: 'gid://shopify/Order/3',
                name: '#1090',
                email: 'first-account@person.com',
                lineItems: { edges: [{ node: { variant: { id: 'gid://shopify/ProductVariant/47563934072981' } } }] },
                shippingAddress: { address1: '9 Shared House Ln', zip: '30301' },
              },
            },
          ],
        },
      },
    },
  ]);
  const result = await shopify.findExistingClaim({
    email: 'second-account@person.com',
    address1: '9 Shared House Ln',
    zip: '30301',
  });
  assert.equal(result.duplicate, true);
  assert.equal(result.reason, 'address_already_claimed');
});

test('normalizedAddressKey is case- and whitespace-insensitive', () => {
  assert.equal(
    shopify.normalizedAddressKey(' 123 Main St ', '97201'),
    shopify.normalizedAddressKey('123 MAIN ST', ' 97201 ')
  );
});
