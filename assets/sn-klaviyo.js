(function(){
  var COMPANY_ID = 'X43p2u';
  var LAUNCH_LIST_ID = 'RKXLks';
  var REVISION = '2024-10-15';

  function isInternalTestEmail(email){
    return !!email && email.toLowerCase().indexOf('@example.com') !== -1;
  }

  function sendSubscription(body, isRetry){
    try{
      fetch('https://a.klaviyo.com/client/subscriptions/?company_id=' + COMPANY_ID, {
        method: 'POST',
        keepalive: true,
        headers: {
          'Content-Type': 'application/json',
          'revision': REVISION
        },
        body: JSON.stringify(body)
      }).then(function(res){
        if(!res.ok && !isRetry){
          setTimeout(function(){ sendSubscription(body, true); }, 1200);
        }
      }).catch(function(){
        if(!isRetry){ setTimeout(function(){ sendSubscription(body, true); }, 1200); }
      });
    }catch(e){ /* fail silently */ }
  }

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
    sendSubscription(body, false);
  }

  function subscribeToLaunchList(email, firstName){
    if(!email) return;
    var attributes = { email: email, properties: { internal_test: isInternalTestEmail(email) } };
    if(firstName) attributes.first_name = firstName;
    postProfile(attributes);
  }

  // Writes custom claim-flow properties (free_box, fifty_off,
  // address_collected, sample_order_created, etc.) reliably. Every call
  // now explicitly sets the FULL set of claim-flow state properties to
  // false by default (free_box, fifty_off, address_collected,
  // sample_order_created, existing_customer, existing_contact) and
  // internal_test to its detected value, unless the caller overrides them.
  // 2026-07-09 (Task C production audit): previously only
  // existing_customer/existing_contact defaulted to false, so
  // address_collected/sample_order_created/free_box/fifty_off were left
  // "not set" on every write that didn't explicitly touch them — segments
  // that key off "equals false" (not "not set") never matched. Every
  // profile reaching this function came through this funnel, so writing an
  // explicit false for every state property (instead of leaving it unset)
  // is required for accurate segment membership.
  function updateProperties(email, extra, properties){
    if(!email || !properties) return;
    var merged = {
      free_box: false,
      fifty_off: false,
      address_collected: false,
      sample_order_created: false,
      existing_customer: false,
      existing_contact: false,
      internal_test: isInternalTestEmail(email)
    };
    var merged = {
      free_box: false,
      fifty_off: false,
      address_collected: false,
      sample_order_created: false,
      existing_customer: false,
      existing_contact: false,
      internal_test: isInternalTestEmail(email)
    };
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
