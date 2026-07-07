/*
  Shared client-side Storefront API helper for the Sneakies Claim Flow's
  real-commerce backend. Loaded only by sections/sneakies-claim.liquid.
  Mutation/query shapes below were validated directly against Shopify's
  live Storefront API schema (2026-07) before shipping.

  WHAT THIS DOES
  - checkAvailability(): live read of the Sneakies Sample Box variant's
    inventory — the single source of truth for Free Box vs 50% Off. No
    custom counter, no cached/manual value.
  - createFreeBoxCart(details): builds a Cart (product line + buyer
    identity + shipping address + the 100%-off discount) entirely via the
    public-safe Storefront API — no Shopify page is shown for any of this.
    Returns { id, checkoutUrl }; the Claim Flow only ever visits
    checkoutUrl itself, once, right after the Survey step.

  SETUP REQUIRED BEFORE THIS WORKS (one-time, in Shopify Admin):
  1. Settings > Apps and sales channels > Develop apps > Create an app.
  2. Configure Storefront API scopes: unauthenticated_read_product_listings,
     unauthenticated_read_product_inventory, unauthenticated_write_checkouts
     (cart) / unauthenticated_read_checkouts, unauthenticated_write_customers
     if collecting phone/marketing consent via the cart.
  3. Install the app, reveal the Storefront API access token, and paste it
     into STOREFRONT_ACCESS_TOKEN below.
  Until that token exists, every call here fails gracefully (caught,
  surfaced as a friendly inline error on the Address Form) rather than
  hanging — this is expected until setup is complete, not a bug.

  The discount code below (SNEAKIESFREEBOX) already exists in Shopify:
  100% off, scoped to the Sneakies Sample Box product only, once per
  customer, no end date.
*/
(function(){
  var SHOP_DOMAIN = 'sneakies2.myshopify.com';
  var API_VERSION = '2026-07';
  var STOREFRONT_ACCESS_TOKEN = 'f2647ee55f19d9addfa615cad803afd8'; // <-- set once the custom app above exists
  var VARIANT_ID = 'gid://shopify/ProductVariant/47536862068885'; // Sneakies Sample Box
  var DISCOUNT_CODE = 'SNEAKIESFREEBOX';
  // The product discount above only covers the $19.99 item price — Shopify still
  // charges a real shipping rate (e.g. $4.90 Economy) unless a shipping discount
  // is also applied. QA found real checkout wasn't actually $0 despite the Claim
  // Flow's own copy promising "no payment required" / "$0 today". Fixed by adding
  // a second, internal-only free-shipping code (never shown to customers) that
  // stacks with the product discount so the Free Box truly costs $0 all-in.
  var SHIPPING_DISCOUNT_CODE = 'SNEAKIESFREESHIP';

  var COUNTRY_CODES = {
    'United States': 'US',
    'Canada': 'CA',
    'United Kingdom': 'GB',
    'Australia': 'AU'
  };

  // Shopify's Storefront API requires buyerIdentity.phone in E.164 format
  // (e.g. "+15551234567") — a plain local-format number like the Address
  // Form's own "(555) 123-4567" placeholder suggests fails cartCreate with
  // "Phone is invalid" and blocks the entire Free Box claim. Normalize
  // whatever the customer typed into E.164 using their selected country's
  // calling code before it's ever sent to Shopify.
  var COUNTRY_CALLING_CODES = { 'US': '1', 'CA': '1', 'GB': '44', 'AU': '61' };

  function normalizePhone(phone, countryCode){
    if(!phone) return null;
    var trimmed = String(phone).trim();
    if(!trimmed) return null;
    if(trimmed.charAt(0) === '+'){
      // Already has a country code — just strip formatting characters.
      return '+' + trimmed.slice(1).replace(/[^\d]/g, '');
    }
    var digits = trimmed.replace(/[^\d]/g, '');
    if(!digits) return null;
    // Domestic numbers are sometimes typed with a leading trunk 0 (common
    // outside North America) — that's never part of the E.164 number.
    digits = digits.replace(/^0+/, '');
    var callingCode = COUNTRY_CALLING_CODES[countryCode] || '1';
    return '+' + callingCode + digits;
  }

  function endpoint(){
    return 'https://' + SHOP_DOMAIN + '/api/' + API_VERSION + '/graphql.json';
  }

  function request(query, variables){
    if(!STOREFRONT_ACCESS_TOKEN){
      return Promise.reject(new Error('Storefront API is not configured yet.'));
    }
    return fetch(endpoint(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Storefront-Access-Token': STOREFRONT_ACCESS_TOKEN
      },
      body: JSON.stringify({ query: query, variables: variables || {} })
    }).then(function(res){ return res.json(); }).then(function(json){
      if(json.errors && json.errors.length) throw new Error(json.errors[0].message);
      return json.data;
    });
  }

  // Live inventory check — replaces the old manual counter entirely.
  function checkAvailability(){
    var query = 'query($id: ID!) { node(id: $id) { ... on ProductVariant { availableForSale quantityAvailable } } }';
    return request(query, { id: VARIANT_ID }).then(function(data){
      var v = data && data.node;
      if(!v) throw new Error('Sample Box variant not found.');
      return { available: !!v.availableForSale, quantity: v.quantityAvailable };
    });
  }

  // Builds the Free Box Cart: product line, buyer identity, shipping
  // address, and the Free Box discount — nothing here shows a Shopify
  // page; only the returned checkoutUrl is ever visited.
  function createFreeBoxCart(details){
    var mutation = 'mutation($input: CartInput!) {' +
      ' cartCreate(input: $input) {' +
      '   cart { id checkoutUrl }' +
      '   userErrors { field message }' +
      ' }' +
      '}';

    var countryCode = COUNTRY_CODES[details.country] || 'US';

    var input = {
      lines: [{ merchandiseId: VARIANT_ID, quantity: 1 }],
      discountCodes: [DISCOUNT_CODE, SHIPPING_DISCOUNT_CODE],
      buyerIdentity: {
        email: details.email,
        phone: normalizePhone(details.phone, countryCode)
      },
      delivery: {
        addresses: [{
          selected: true,
          address: {
            deliveryAddress: {
              firstName: details.firstName,
              lastName: details.lastName,
              address1: details.address1,
              address2: details.address2 || null,
              city: details.city,
              provinceCode: details.province,
              zip: details.zip,
              countryCode: countryCode
            }
          }
        }]
      }
    };

    return request(mutation, { input: input }).then(function(data){
      var result = data && data.cartCreate;
      if(result && result.userErrors && result.userErrors.length){
        throw new Error(result.userErrors.map(function(e){ return e.message; }).join(' '));
      }
      if(!result || !result.cart) throw new Error('Cart could not be created.');
      return result.cart; // { id, checkoutUrl }
    });
  }

  window.SneakiesStorefront = {
    checkAvailability: checkAvailability,
    createFreeBoxCart: createFreeBoxCart
  };
})();
