/*
  Shared client-side Klaviyo sync helper for the Sneakies waitlist + Claim
  Flow. Loaded by both sections/sneakies-landing.liquid and
  sections/sneakies-claim.liquid so the sync logic exists in exactly one
  place instead of being duplicated across the two pages.

  ROOT CAUSE / WHY THIS FILE LOOKS THE WAY IT DOES (2026-07-09):
  This account's public Klaviyo API key is only able to reliably write via
  the "Subscribe Profiles" client endpoint (/client/subscriptions/). Live
  testing confirmed the onsite embed script IS present and window.klaviyo
  IS the real Klaviyo SDK (not a dead queue) — but both the legacy
  window.klaviyo.push(['identify', ...]) queue AND the modern
  window.klaviyo.identify(...) promise API, as well as a raw POST to
  /client/profiles/ and /client/events/, all return 202 Accepted and then
  silently never persist anything, for every profile tested. Only
  /client/subscriptions/ reliably creates/updates a profile — and it turns
  out that endpoint also accepts an arbitrary custom `properties` object
  on the profile it creates/updates. So every property write in this file
  goes through that one proven-reliable endpoint instead of identify().

  - Uses ONLY Klaviyo's public API key (safe client-side — this is the
    same mechanism Klaviyo's own onsite embed/forms use). It never touches
    a private/secret key, and it never creates, edits, or deletes Klaviyo
    Lists, Segments, Flows, or Metrics — it only writes profile fields and
    adds profiles to the existing "Sneakies Launch List", exactly as
    instructed.
  - All calls are fire-and-forget: if Klaviyo is slow, unreachable, or
    errors, nothing here throws or blocks the UI. Marketing sync should
    never be able to break the claim funnel.
  - Request body follows Klaviyo's public "Subscribe Profiles" Client API
    shape: https://developers.klaviyo.com/en/reference/subscribe_profiles
    Klaviyo periodically revises this API's `revision` header — verify
    this still matches their current docs before relying on it long-term.
*/
(function(){
  var COMPANY_ID = 'X43p2u';       // Sneakies Klaviyo public API key (safe client-side)
  var LAUNCH_LIST_ID = 'RKXLks';   // "Sneakies Launch List" (existing list — not modified)
  var REVISION = '2024-10-15';

  // Every profile this funnel ever touches uses a real, easily-recognized
  // QA/test email domain (see the many "qa.*@example.com" test profiles
  // created during this project's testing). Flagging that automatically
  // keeps the "Suppress - Internal Test" segment populated without any
  // manual tagging step, and without risking a false-positive on a real
  // customer's address.
  function isInternalTestEmail(email){
    return !!email && email.toLowerCase().indexOf('@example.com') !== -1;
  }

  // Single reliable write path: Klaviyo's "Subscribe Profiles" client
  // endpoint. Confirmed via live testing to actually persist both the
  // base profile fields AND an arbitrary custom `properties` object,
  // unlike identify()/track() on this account's public key.
  function postProfile(attributes){
    if(!attributes || !attributes.email) return;
    var body = {
      data: {
        type: 'subscription',
        attributes: {
          profile: { data: { type: 'profile', attributes: attributes } }
        },
        relationships: {
          list: { data: { type: 'list', id: LAUNCH_LIST_ID } }
        }
      }
    };
    try{
      fetch('https://a.klaviyo.com/client/subscriptions/?company_id=' + COMPANY_ID, {
        method: 'POST',
        keepalive: true,
        headers: {
          'Content-Type': 'application/json',
          'revision': REVISION
        },
        body: JSON.stringify(body)
      }).catch(function(){ /* fail silently — never block the claim flow */ });
    }catch(e){ /* fail silently */ }
  }

  // Adds/updates a profile as a member of the Sneakies Launch List. Also
  // always sets internal_test explicitly (true/false) so every profile
  // this funnel ever creates has a real value for it, not "not set".
  function subscribeToLaunchList(email, firstName){
    if(!email) return;
    var attributes = { email: email, properties: { internal_test: isInternalTestEmail(email) } };
    if(firstName) attributes.first_name = firstName;
    postProfile(attributes);
  }

  // Writes custom claim-flow properties (free_box, fifty_off,
  // address_collected, sample_order_created, etc.) reliably. Every call
  // also explicitly sets existing_customer/existing_contact to false and
  // internal_test to its detected value, unless the caller overrides
  // them — every profile reaching this function came through the new
  // (non-"existing customer") signup path, so writing an explicit false
  // (instead of leaving the property unset) is what keeps profiles out of
  // segments that use "not set" as part of their existing-customer logic.
  function updateProperties(email, extra, properties){
    if(!email || !properties) return;
    var merged = { existing_customer: false, existing_contact: false, internal_test: isInternalTestEmail(email) };
    for(var key in properties){ if(Object.prototype.hasOwnProperty.call(properties, key)) merged[key] = properties[key]; }
    var attributes = { email: email, properties: merged };
    if(extra && extra.firstName) attributes.first_name = extra.firstName;
    if(extra && extra.lastName) attributes.last_name = extra.lastName;
    postProfile(attributes);
  }

  window.SneakiesKlaviyo = {
    subscribeToLaunchList: subscribeToLaunchList,
    updateProperties: updateProperties
  };
})();
