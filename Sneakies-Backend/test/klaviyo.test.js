const test = require('node:test');
const assert = require('node:assert/strict');
const klaviyo = require('../lib/klaviyo');

function setEnv() {
  process.env.KLAVIYO_PRIVATE_API_KEY = 'pk_test_key';
}
function clearEnv() {
  delete process.env.KLAVIYO_PRIVATE_API_KEY;
}

function mockFetchOnce(status = 200, body = {}) {
  const calls = [];
  global.fetch = async (url, opts) => {
    calls.push({ url, opts });
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
      text: async () => JSON.stringify(body),
    };
  };
  return calls;
}

test.afterEach(() => {
  clearEnv();
  delete global.fetch;
});

test('upsertProfileProperties throws MISSING_ENV without an API key', async () => {
  clearEnv();
  await assert.rejects(
    () => klaviyo.upsertProfileProperties('a@b.com', {}, { free_box: true }),
    (err) => {
      assert.equal(err.code, 'MISSING_ENV');
      return true;
    }
  );
});

test('upsertProfileProperties calls the profile-import upsert endpoint with correct shape', async () => {
  setEnv();
  const calls = mockFetchOnce(200, { data: { id: 'prof_123' } });
  await klaviyo.upsertProfileProperties(
    'jamie@email.com',
    { firstName: 'Jamie', lastName: "O'Rivera" },
    { free_box: true, address_collected: true, sample_order_created: true, has_shipping_address: true }
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://a.klaviyo.com/api/profile-import');
  assert.equal(calls[0].opts.headers.Authorization, 'Klaviyo-API-Key pk_test_key');
  assert.equal(calls[0].opts.headers.revision, '2024-10-15');

  const body = JSON.parse(calls[0].opts.body);
  assert.equal(body.data.type, 'profile');
  assert.equal(body.data.attributes.email, 'jamie@email.com');
  assert.equal(body.data.attributes.first_name, 'Jamie');
  assert.equal(body.data.attributes.properties.free_box, true);
  assert.equal(body.data.attributes.properties.sample_order_created, true);
});

test('upsertProfileProperties is a no-op when email or properties are missing', async () => {
  setEnv();
  const calls = mockFetchOnce(200, {});
  const result1 = await klaviyo.upsertProfileProperties('', {}, { free_box: true });
  const result2 = await klaviyo.upsertProfileProperties('a@b.com', {}, null);
  assert.equal(result1, null);
  assert.equal(result2, null);
  assert.equal(calls.length, 0);
});

test('upsertProfileProperties surfaces a non-2xx Klaviyo response as an error', async () => {
  setEnv();
  mockFetchOnce(422, { errors: [{ detail: 'Invalid email' }] });
  await assert.rejects(
    () => klaviyo.upsertProfileProperties('bad', {}, { free_box: true }),
    /Klaviyo profile-import failed \(422\)/
  );
});

test('trackEvent posts to the events endpoint with metric/profile/properties', async () => {
  setEnv();
  const calls = mockFetchOnce(202, {});
  await klaviyo.trackEvent(
    'jamie@email.com',
    'Sneakies Sample Box Order Confirmed',
    { order_id: 123, order_name: '#1074' },
    { firstName: 'Jamie' }
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://a.klaviyo.com/api/events');
  const body = JSON.parse(calls[0].opts.body);
  assert.equal(body.data.type, 'event');
  assert.equal(body.data.attributes.metric.data.attributes.name, 'Sneakies Sample Box Order Confirmed');
  assert.equal(body.data.attributes.profile.data.attributes.email, 'jamie@email.com');
  assert.equal(body.data.attributes.properties.order_name, '#1074');
});

test('trackEvent is a no-op without an email or metric name', async () => {
  setEnv();
  const calls = mockFetchOnce(202, {});
  await klaviyo.trackEvent('', 'Some Event', {});
  await klaviyo.trackEvent('a@b.com', '', {});
  assert.equal(calls.length, 0);
});

test('trackEvent surfaces a non-2xx Klaviyo response as an error', async () => {
  setEnv();
  mockFetchOnce(500, { errors: [{ detail: 'Server error' }] });
  await assert.rejects(() => klaviyo.trackEvent('a@b.com', 'Event', {}), /Klaviyo create-event failed \(500\)/);
});
