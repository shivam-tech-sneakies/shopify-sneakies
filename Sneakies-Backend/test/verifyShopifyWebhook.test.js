const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { verifyShopifyWebhook } = require('../lib/verifyShopifyWebhook');

const SECRET = 'test_webhook_secret';

function signatureFor(body, secret) {
  return crypto.createHmac('sha256', secret).update(body, 'utf8').digest('base64');
}

test('accepts a correctly signed payload', () => {
  const body = JSON.stringify({ id: 123, email: 'a@b.com' });
  const sig = signatureFor(body, SECRET);
  assert.equal(verifyShopifyWebhook(body, sig, SECRET), true);
});

test('rejects a tampered body against the original signature', () => {
  const body = JSON.stringify({ id: 123, email: 'a@b.com' });
  const sig = signatureFor(body, SECRET);
  const tamperedBody = JSON.stringify({ id: 999, email: 'a@b.com' });
  assert.equal(verifyShopifyWebhook(tamperedBody, sig, SECRET), false);
});

test('rejects a signature computed with the wrong secret', () => {
  const body = JSON.stringify({ id: 123 });
  const sig = signatureFor(body, 'wrong_secret');
  assert.equal(verifyShopifyWebhook(body, sig, SECRET), false);
});

test('rejects when signature header is missing', () => {
  const body = JSON.stringify({ id: 123 });
  assert.equal(verifyShopifyWebhook(body, '', SECRET), false);
  assert.equal(verifyShopifyWebhook(body, null, SECRET), false);
});

test('rejects when body is empty', () => {
  assert.equal(verifyShopifyWebhook('', 'anything', SECRET), false);
});

test('rejects when secret is missing', () => {
  const body = JSON.stringify({ id: 123 });
  const sig = signatureFor(body, SECRET);
  assert.equal(verifyShopifyWebhook(body, sig, ''), false);
});

test('does not throw on garbage signature input (length-mismatch safe compare)', () => {
  const body = JSON.stringify({ id: 123 });
  assert.doesNotThrow(() => verifyShopifyWebhook(body, 'not-base64-and-wrong-length', SECRET));
  assert.equal(verifyShopifyWebhook(body, 'short', SECRET), false);
});
