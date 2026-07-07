/*
  Shared client-side Klaviyo sync helper for the Sneakies waitlist + Claim
  Flow. Loaded by both sections/sneakies-landing.liquid and
  sections/sneakies-claim.liquid so the sync logic exists in exactly one
  place instead of being duplicated across the two pages.

  IMPORTANT — scope/safety:
  - Uses ONLY Klaviyo's public API key (safe to ship in browser JS — this is
    the same mechanism Klaviyo's own onsite embed/forms use). It never touches
    a private/secret key, and it never creates, edits, or deletes Klaviyo
    Lists, Segments, Flows, or Metrics — it only identifies profiles and adds
    them to the existing "Sneakies Launch List", exactly as instructed.
  - All calls are fire-and-forget: if Klaviyo is slow, unreachable, or errors,
    nothing here throws or blocks the UI. Marketing sync should never be able
    to break the claim funnel.
  - The subscribe request body follows Klaviyo's public "Subscribe Profiles"
    Client API shape as documented at the time this was written:
    https://developers.klaviyo.com/en/reference/subscribe_profiles
    Klaviyo periodically revises this API's `revision` header — verify this
    still matches their current docs before relying on it in production.
*/
(function(){
  var COMPANY_ID = 'X43p2u';       // Sneakies Klaviyo public API key (safe client-side)
  var LAUNCH_LIST_ID = 'RKXLks';   // "Sneakies Launch List" (existing list — not modified)
  var REVISION = '2024-10-15';

  // Sets/updates profile properties on a Klaviyo profile via the classic
  // onsite "identify" queue. Safe to call even before the onsite embed's own
  // script has finished loading — it just queues until Klaviyo is ready.
  function identify(properties){
    if(!properties) return;
    try{
      window.klaviyo = window.klaviyo || [];
      window.klaviyo.push(['identify', properties]);
    }catch(e){ /* never let marketing sync break the UI */ }
  }

  // Adds/updates a profile as a member of the Sneakies Launch List.
  function subscribeToLaunchList(email, firstName){
    if(!email) return;
    var attributes = { email: email };
    if(firstName) attributes.first_name = firstName;

    var body = {
      data: {
        type: 'subscription',
        attributes: {
          profile: {
            data: {
              type: 'profile',
              attributes: attributes
            }
          }
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

  window.SneakiesKlaviyo = {
    identify: identify,
    subscribeToLaunchList: subscribeToLaunchList
  };
})();
