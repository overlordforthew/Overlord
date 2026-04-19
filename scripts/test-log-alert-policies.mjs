import assert from 'node:assert/strict';

import {
  buildAlertSignalKey,
  describeTransientAlertLifecycle,
  getAlertPolicyTarget,
  getTransientAlertThresholdPolicy,
} from '../lib/log-alert-policies.js';

const hlPolicy = getTransientAlertThresholdPolicy({
  container: 'hl-dashboard',
  friendly: 'hl-dashboard',
  errorText: 'upstream failed: api.hyperliquid.xyz returned bad gateway',
});
assert.equal(hlPolicy?.family, 'hyperliquid-upstream');
assert.equal(hlPolicy?.recoveryWindowMs, 15 * 60 * 1000);
assert.equal(
  describeTransientAlertLifecycle({
    container: 'hl-dashboard',
    friendly: 'hl-dashboard',
    errorText: 'upstream failed: api.hyperliquid.xyz returned bad gateway',
  }, hlPolicy)?.degradedTitle,
  'hl-dashboard live market data'
);

const weatherPolicy = getTransientAlertThresholdPolicy({
  container: 'mastercommander',
  friendly: 'MasterCommander',
  errorText: '[weather-service] forecast error: All weather providers failed for 16,-61.75',
});
assert.equal(weatherPolicy?.family, 'weather-provider-upstream');
assert.equal(buildAlertSignalKey({
  container: 'mastercommander',
  friendly: 'MasterCommander',
}, weatherPolicy.family), 'log-page:mastercommander:weather-provider-upstream');

const dnsPolicy = getTransientAlertThresholdPolicy({
  container: 'app-okw0cwwgskcow8k8o08gsok0-142440148969',
  friendly: 'Lumina',
  errorText: 'DB init error: Error: getaddrinfo EAI_AGAIN db',
});
assert.equal(dnsPolicy?.family, 'startup-db-dns');

const authPolicy = getTransientAlertThresholdPolicy({
  container: 'qkggs84cs88o0gww4wc80gwo-133106713958',
  friendly: 'Onlyhulls',
  errorText: '{"err":{"message":"OpenRouter HTTP 401: {\\"error\\":{\\"message\\":\\"User not found.\\",\\"code\\":401}}"}}',
});
assert.equal(authPolicy?.family, 'openrouter-auth');
assert.equal(getAlertPolicyTarget({
  container: 'qkggs84cs88o0gww4wc80gwo-133106713958',
  friendly: 'Onlyhulls',
}), 'Onlyhulls');
assert.equal(getAlertPolicyTarget({
  container: 'ef34a1efef0d_mastercommander',
  friendly: '',
}), 'mastercommander');
assert.equal(buildAlertSignalKey({
  container: 'qkggs84cs88o0gww4wc80gwo-133106713958',
  friendly: 'Onlyhulls',
}, authPolicy.family), 'log-page:onlyhulls:openrouter-auth');

const fkPolicy = getTransientAlertThresholdPolicy({
  container: 'mastercommander-staging-db',
  friendly: 'mastercommander-staging-db',
  errorText: 'ERROR: insert or update on table "safety_events" violates foreign key constraint "safety_events_boat_id_fkey"',
});
assert.equal(fkPolicy?.family, 'boat-fk-violation');
assert.equal(
  describeTransientAlertLifecycle({
    container: 'mastercommander-staging-db',
    friendly: 'mastercommander-staging-db',
    errorText: 'ERROR: insert or update on table "safety_events" violates foreign key constraint "safety_events_boat_id_fkey"',
  }, fkPolicy)?.recoveredDetail,
  'Safety and anchor event writes resumed normally.'
);

console.log('log-alert policy checks passed');
