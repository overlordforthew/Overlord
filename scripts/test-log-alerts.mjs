import assert from 'node:assert/strict';

import { normalizeAlertHashText, shouldIgnoreContainerLogLine } from '../lib/log-alert-utils.js';

const parserNoise = '2026-04-13 08:06:56.799 UTC [698942] ERROR: syntax error at or near "YYYY" at character 98';
const parserNoiseVariant = '2026-04-13 08:06:57.003 UTC [698949] ERROR: syntax error at or near "YYYY" at character 98';
const dbFatal = '2026-04-13 08:08:11.003 UTC [700111] FATAL: terminating connection due to administrator command';
const staleDeployNoise = 'Error: Failed to find Server Action "abc123". This request might be from an older or newer deployment.';
const nginxTestNoise = '2026/04/14 19:03:25 [error] 24#24: *3 open() "/usr/share/nginx/html/en.html" failed (13: Permission denied)';

assert.equal(
  shouldIgnoreContainerLogLine('namibarden-db', parserNoise, []),
  true,
  'DB parser noise should be suppressed'
);

assert.equal(
  shouldIgnoreContainerLogLine('namibarden-db', dbFatal, []),
  false,
  'Real DB fatal errors must still alert'
);

assert.equal(
  shouldIgnoreContainerLogLine('namibarden', parserNoise, []),
  false,
  'App-container syntax errors should remain visible'
);

assert.equal(
  shouldIgnoreContainerLogLine('onlyhulls', staleDeployNoise, []),
  true,
  'Stale deploy server-action noise should be suppressed'
);

assert.equal(
  shouldIgnoreContainerLogLine('namibarden-nginx-test', nginxTestNoise, []),
  true,
  'Ephemeral nginx deploy smoke-test containers should be suppressed'
);

assert.equal(
  normalizeAlertHashText(parserNoise),
  normalizeAlertHashText(parserNoiseVariant),
  'Timestamp and PID differences should collapse to the same alert hash'
);

console.log('log-alert regression checks passed');
