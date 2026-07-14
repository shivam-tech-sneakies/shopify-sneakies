const test = require('node:test');
const assert = require('node:assert/strict');
const { validateClaim } = require('../lib/validateClaim');

const VALID = {
  first_name: 'Jamie',
  last_name: "O'Rivera",
  email: 'Jamie@Email.com',
  phone: '(555) 123-4567',
  address1: '123 Orchard Way',
  address2: 'Apt 4B',
  city: 'Portland',
  state: 'OR',
  zip: '97201',
};

test('accepts a fully valid claim', () => {
  const result = validateClaim(VALID);
  assert.equal(result.valid, true);
  assert.deepEqual(result.fields, {});
});

test('normalizes email to lowercase', () => {
  const result = validateClaim(VALID);
  assert.equal(result.normalized.email, 'jamie@email.com');
});

test('normalizes phone to 10 digits, dropping country code', () => {
  const result = validateClaim({ ...VALID, phone: '+1 (555) 123-4567' });
  assert.equal(result.valid, true);
  assert.equal(result.normalized.phone, '5551234567');
});

test('phone is optional', () => {
  const result = validateClaim({ ...VALID, phone: '' });
  assert.equal(result.valid, true);
});

test('rejects a phone that is not 10 digits', () => {
  const result = validateClaim({ ...VALID, phone: '555-1234' });
  assert.equal(result.valid, false);
  assert.ok(result.fields.phone);
});

test('rejects digits in first/last name', () => {
  const result = validateClaim({ ...VALID, first_name: 'Jamie2' });
  assert.equal(result.valid, false);
  assert.ok(result.fields.first_name);
});

test('rejects missing first name', () => {
  const result = validateClaim({ ...VALID, first_name: '  ' });
  assert.equal(result.valid, false);
  assert.ok(result.fields.first_name);
});

test('rejects first name over 50 characters', () => {
  const result = validateClaim({ ...VALID, first_name: 'A'.repeat(51) });
  assert.equal(result.valid, false);
  assert.ok(result.fields.first_name);
});

test('rejects invalid email format', () => {
  const result = validateClaim({ ...VALID, email: 'not-an-email' });
  assert.equal(result.valid, false);
  assert.ok(result.fields.email);
});

test('rejects address shorter than 5 characters', () => {
  const result = validateClaim({ ...VALID, address1: '12 A' });
  assert.equal(result.valid, false);
  assert.ok(result.fields.address1);
});

test('rejects punctuation-only address', () => {
  const result = validateClaim({ ...VALID, address1: '-----' });
  assert.equal(result.valid, false);
  assert.ok(result.fields.address1);
});

test('rejects address2 over 50 characters', () => {
  const result = validateClaim({ ...VALID, address2: 'A'.repeat(51) });
  assert.equal(result.valid, false);
  assert.ok(result.fields.address2);
});

test('address2 is optional', () => {
  const result = validateClaim({ ...VALID, address2: '' });
  assert.equal(result.valid, true);
});

test('rejects numbers-only city', () => {
  const result = validateClaim({ ...VALID, city: '12345' });
  assert.equal(result.valid, false);
  assert.ok(result.fields.city);
});

test('rejects city under 2 characters', () => {
  const result = validateClaim({ ...VALID, city: 'A' });
  assert.equal(result.valid, false);
  assert.ok(result.fields.city);
});

test('rejects missing state', () => {
  const result = validateClaim({ ...VALID, state: '' });
  assert.equal(result.valid, false);
  assert.ok(result.fields.state);
});

test('rejects malformed zip', () => {
  const result = validateClaim({ ...VALID, zip: '9720' });
  assert.equal(result.valid, false);
  assert.ok(result.fields.zip);
});

test('accepts ZIP+4', () => {
  const result = validateClaim({ ...VALID, zip: '97201-1234' });
  assert.equal(result.valid, true);
});

test('reports every invalid field at once, not just the first', () => {
  const result = validateClaim({ ...VALID, first_name: '', email: 'bad', zip: 'bad' });
  assert.equal(result.valid, false);
  assert.ok(result.fields.first_name);
  assert.ok(result.fields.email);
  assert.ok(result.fields.zip);
  assert.equal(Object.keys(result.fields).length, 3);
});

test('handles completely empty submission without throwing', () => {
  const result = validateClaim({});
  assert.equal(result.valid, false);
  assert.equal(Object.keys(result.fields).length > 0, true);
});
