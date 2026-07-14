const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const handlerModule = require('../../netlify/functions/shopify-order-webhook');

const SECRET = 'whsec_test_secret';
const VARIANT_ID = '47563934072981';

function setEnv() {
  process.env.SHOPIFY_WEBHOOK_SECRET = SECRET;
  process.env.SHOPIFY_SAMPLE_BOX_VARIANT_ID = VARIANT_ID;
  process.env.KLAVIYO_PRIVATE_API_KEY = 'pk_test_key';
}
function clearEnv() {
  delete process.env.SHOPIFY_WEBHOOK_SECRET;
  delete process.env.SHOPIFY_SAMPLE_BOX_VARIANT_ID;
  delete process.env.KLAVIYO_PRIVATE_API_KEY;
}

function sign(body, secret = SECRET) {
  return crypto.createHmac('sha256', secret).update(body, 'utf8').digest('base64');
}

function sampleBoxOrderPayload(overrides = {}) {
  return JSON.stringify({
    id: 7174312624277,
    name: '#1074',
    order_number: 1074,
    email: 'jamie@email.com',
    line_items: [{ variant_id: Number(VARIANT_ID), title: 'Sneakies Sample Box - New' }],
    shipping_address: { first_name: 'Jamie', last_name: 'Rivera' },
    ...overrides,
  });
}

function unrelatedOrderPayload() {
  return JSON.stringify({
    id: 999,
    name: '#2000',
    email: 'someone@email.com',
    line_items: [{ variant_id: 11111111111, title: 'Some Other Product' }],
    shipping_address: { first_name: 'Sam', last_name: 'Someone' },
  });
}

test.beforeEach(setEnv);
test.afterEach(() => {
  clearEnv();
  delete global.fetch;
});

function makeEvent(rawBody, headerOverrides) {
  return {
    httpMethod: 'POST',
    body: rawBody,
    headers: { 'x-shopify-hmac-sha256': sign(rawBody), ...headerOverrides },
  };
}

test('rejects non-POST methods', async () => {
  const res = await handlerModule.handler({ httpMethod: 'GET' });
  assert.equal(res.statusCode, 405);
});

test('rejects an unsigned/invalid webhook', async () => {
  const body = sampleBoxOrderPayload();
  const res = await handlerModule.handler({ httpMethod: 'POST', body, headers: { 'x-shopify-hmac-sha256': 'forged' } });
  assert.equal(res.statusCode, 401);
});

test('rejects when SHOPIFY_WEBHOOK_SECRET is not configured', async () => {
  delete process.env.SHOPIFY_WEBHOOK_SECRET;
  const body = sampleBoxOrderPayload();
  const res = await handlerModule.handler({ httpMethod: 'POST', body, headers: { 'x-shopify-hmac-sha256': sign(body) } });
  assert.equal(res.statusCode, 500);
});

test('ignores a correctly signed order that does not contain the Sample Box variant', async () => {
  let fetchCalled = false;
  global.fetch = async () => {
    fetchCalled = true;
    throw new Error('Klaviyo should not be called for unrelated orders');
  };
  const body = unrelatedOrderPayload();
  const res = await handlerModule.handler(makeEvent(body));
  assert.equal(res.statusCode, 200);
  assert.equal(fetchCalled, false);
});

test('syncs Klaviyo profile + event for a Sample Box order', async () => {
  const calls = [];
  global.fetch = async (url, opts) => {
    calls.push({ url, opts });
    return { ok: true, status: 200, json: async () => ({}), text: async () => '' };
  };
  const body = sampleBoxOrderPayload();
  const res = await handlerModule.handler(makeEvent(body));
  assert.equal(res.statusCode, 200);

  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, 'https://a.klaviyo.com/api/profile-import');
  const profileBody = JSON.parse(calls[0].opts.body);
  assert.equal(profileBody.data.attributes.email, 'jamie@email.com');
  assert.equal(profileBody.data.attributes.properties.free_box, true);
  assert.equal(profileBody.data.attributes.properties.sample_order_created, true);

  assert.equal(calls[1].url, 'https://a.klaviyo.com/api/events');
  const eventBody = JSON.parse(calls[1].opts.body);
  assert.equal(eventBody.data.attributes.metric.data.attributes.name, 'Sneakies Sample Box Order Confirmed');
  assert.equal(eventBody.data.attributes.properties.order_name, '#1074');
});

test('returns 502 (triggering a Shopify retry) when Klaviyo sync fails', async () => {
  global.fetch = async () => ({ ok: false, status: 500, json: async () => ({}), text: async () => 'boom' });
  const body = sampleBoxOrderPayload();
  const res = await handlerModule.handler(makeEvent(body));
  assert.equal(res.statusCode, 502);
});

test('ignores a Sample Box order with no email to attribute', async () => {
  let fetchCalled = false;
  global.fetch = async () => {
    fetchCalled = true;
    return { ok: true, status: 200, json: async () => ({}), text: async () => '' };
  };
  const body = sampleBoxOrderPayload({ email: null, customer: null });
  const res = await handlerModule.handler(makeEvent(body));
  assert.equal(res.statusCode, 200);
  assert.equal(fetchCalled, false);
});

test('rejects invalid JSON even with a matching signature over that raw text', async () => {
  const body = 'not json but still signed';
  const res = await handlerModule.handler(makeEvent(body));
  assert.equal(res.statusCode, 400);
});
