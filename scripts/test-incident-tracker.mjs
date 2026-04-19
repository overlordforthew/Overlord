import assert from 'node:assert/strict';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

import { createIncidentTracker, formatDuration, getIncidentStatusSummary } from '../lib/incident-tracker.js';

const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'incident-tracker-'));
const tracker = createIncidentTracker({ dataDir });

await tracker.recordObservation({
  key: 'log-page:hl-dashboard:hyperliquid-upstream',
  service: 'hl-dashboard',
  family: 'hyperliquid-upstream',
  degradedTitle: 'hl-dashboard live market data',
  degradedDetail: 'Upstream market data is unstable.',
  recoveredTitle: 'hl-dashboard live market data',
  recoveredDetail: 'Upstream responses stabilized.',
  recoveryWindowMs: 50,
});

const opened = await tracker.openIncident({
  key: 'log-page:hl-dashboard:hyperliquid-upstream',
  service: 'hl-dashboard',
  family: 'hyperliquid-upstream',
  degradedTitle: 'hl-dashboard live market data',
  degradedDetail: 'Upstream market data is unstable.',
  recoveredTitle: 'hl-dashboard live market data',
  recoveredDetail: 'Upstream responses stabilized.',
  recoveryWindowMs: 50,
});
assert.equal(opened.opened, true);

const summaryWhileOpen = await getIncidentStatusSummary(dataDir, 24);
assert.equal(summaryWhileOpen.open.length, 1);

await new Promise((resolve) => setTimeout(resolve, 60));
const recovered = await tracker.recoverQuietIncidents();
assert.equal(recovered.length, 1);
assert.equal(recovered[0].isOpen, false);
assert.match(formatDuration(recovered[0].lastDurationMs || 0), /\d+[smh]/);

const summaryAfterRecovery = await getIncidentStatusSummary(dataDir, 24);
assert.equal(summaryAfterRecovery.open.length, 0);
assert.equal(summaryAfterRecovery.recovered.length, 1);

console.log('incident tracker checks passed');
