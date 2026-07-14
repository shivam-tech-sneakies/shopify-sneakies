/*
  Server-side mirror of the "Sneakies Claim Form Validation Specification"
  already enforced client-side in sections/sneakies-claim.liquid's validate()
  function. Field rules below are copied verbatim from that function so the
  two never silently diverge — if that spec ever changes, update both places.

  This module does ONLY field-shape validation. Duplicate-claim detection is
  a separate concern (see lib/shopify.js#findExistingClaim), because it needs
  real Shopify order data, not just the submitted fields.

  No dependencies, no network calls — pure functions, easy to unit test.
*/

const NAME_RE = /^[A-Za-z\s'-]+$/;
const CITY_RE = /^[A-Za-z0-9\s'.-]+$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ZIP_RE = /^\d{5}(-\d{4})?$/;

// Same normalization sneakies-claim.liquid uses: strip everything but
// digits, then drop a leading US country-code "1" if the result is 11
// digits long, so "323-232-3232", "(323) 232-3232", and "+1 323 232 3232"
// all resolve identically.
function normalizedPhoneDigits(raw) {
  let digits = String(raw || '').replace(/[^\d]/g, '');
  if (digits.length === 11 && digits.charAt(0) === '1') digits = digits.slice(1);
  return digits;
}

function trimStr(v) {
  return typeof v === 'string' ? v.trim() : '';
}

/**
 * @param {object} fields - { first_name, last_name, email, phone, address1, address2, city, state, zip }
 * @returns {{ valid: boolean, fields: Record<string,string>, normalized: object }}
 */
function validateClaim(fields) {
  fields = fields || {};
  const errors = {};

  const firstName = trimStr(fields.first_name);
  if (!firstName || firstName.length > 50 || !NAME_RE.test(firstName)) {
    errors.first_name = 'Please enter your first name.';
  }

  const lastName = trimStr(fields.last_name);
  if (!lastName || lastName.length > 50 || !NAME_RE.test(lastName)) {
    errors.last_name = 'Please enter your last name.';
  }

  const email = trimStr(fields.email).toLowerCase();
  if (!email || email.length > 254 || !EMAIL_RE.test(email)) {
    errors.email = 'Please enter a valid email address.';
  }

  const phoneRaw = trimStr(fields.phone);
  let phone = '';
  if (phoneRaw) {
    const digits = normalizedPhoneDigits(phoneRaw);
    if (digits.length !== 10) {
      errors.phone = 'Please enter a valid 10-digit phone number.';
    } else {
      phone = digits;
    }
  }

  const address1 = trimStr(fields.address1);
  if (!address1 || address1.length < 5 || address1.length > 100 || !/[A-Za-z0-9]/.test(address1)) {
    errors.address1 = 'Please enter your street address.';
  }

  const address2 = trimStr(fields.address2);
  if (address2.length > 50) {
    errors.address2 = 'Please keep this under 50 characters.';
  }

  const city = trimStr(fields.city);
  if (!city || city.length < 2 || city.length > 60 || !CITY_RE.test(city) || !/[A-Za-z]/.test(city)) {
    errors.city = 'Please enter your city.';
  }

  const state = trimStr(fields.state);
  if (!state) {
    errors.state = 'Please select your state.';
  }

  const zip = trimStr(fields.zip);
  if (!zip || !ZIP_RE.test(zip)) {
    errors.zip = 'Please enter a valid 5-digit or ZIP+4 code.';
  }

  return {
    valid: Object.keys(errors).length === 0,
    fields: errors,
    normalized: {
      first_name: firstName,
      last_name: lastName,
      email,
      phone,
      address1,
      address2,
      city,
      state,
      zip,
    },
  };
}

module.exports = { validateClaim, normalizedPhoneDigits };
