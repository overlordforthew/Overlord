import assert from 'node:assert/strict';
import {
  buildDiskPruneAlertMessage,
  classifyDiskPressure,
  parseDfBytesLine,
  parseSizeToGb,
  shouldSendDiskPruneAlert,
  summarizeDockerSystemDf,
  updateDiskPruneAlertState,
} from '../lib/disk-prune-alert.js';

const thresholds = {
  warningPct: 90,
  criticalPct: 95,
  recoveryPct: 88,
  warningFreeGb: 8,
  criticalFreeGb: 5,
  repeatMs: 6 * 60 * 60 * 1000,
};

const disk = parseDfBytesLine('/dev/sda1 80530636800 76000000000 4530636800 94% /');
assert.equal(disk.usedPct, 94);
assert.equal(disk.mount, '/');

assert.equal(parseSizeToGb('512MB').toFixed(2), '0.50');
assert.equal(parseSizeToGb('2.5GB'), 2.5);
assert.equal(parseSizeToGb('1TB'), 1024);

const dockerSummary = summarizeDockerSystemDf(`
TYPE            TOTAL     ACTIVE    SIZE      RECLAIMABLE
Images          31        21        28.4GB    9.2GB (32%)
Containers      22        18        1.2GB     280MB (22%)
Local Volumes   37        30        6.4GB     0B (0%)
Build Cache     112       0         13.1GB    13.1GB
`);
assert.equal(dockerSummary.reclaimable[0].type, 'Build Cache');
assert.equal(dockerSummary.reclaimable[1].type, 'Images');

let classification = classifyDiskPressure(disk, thresholds);
assert.equal(classification.level, 'critical');
assert.equal(classification.shouldAlert, true);

let decision = shouldSendDiskPruneAlert({}, classification, disk, thresholds, Date.parse('2026-04-18T10:00:00Z'));
assert.deepEqual(decision, { send: true, kind: 'alert', reason: 'first_alert' });

let state = updateDiskPruneAlertState({}, classification, disk, decision, Date.parse('2026-04-18T10:00:00Z'));
decision = shouldSendDiskPruneAlert(state, classification, disk, thresholds, Date.parse('2026-04-18T11:00:00Z'));
assert.equal(decision.send, false);
assert.equal(decision.reason, 'cooldown');

decision = shouldSendDiskPruneAlert(state, classification, { ...disk, usedPct: 97 }, thresholds, Date.parse('2026-04-18T11:00:00Z'));
assert.equal(decision.send, true);
assert.equal(decision.reason, 'usage_increased');

decision = shouldSendDiskPruneAlert(state, classification, disk, thresholds, Date.parse('2026-04-18T16:01:00Z'));
assert.equal(decision.send, true);
assert.equal(decision.reason, 'repeat_cooldown_elapsed');

state = { ...state, lastLevel: 'warning' };
classification = classifyDiskPressure({ ...disk, usedPct: 96, availBytes: 6 * 1024 ** 3 }, thresholds);
decision = shouldSendDiskPruneAlert(state, classification, disk, thresholds, Date.parse('2026-04-18T11:00:00Z'));
assert.equal(decision.send, true);
assert.equal(decision.reason, 'severity_escalated');

state = { ...state, lastLevel: 'critical' };
classification = classifyDiskPressure({ ...disk, usedPct: 86, availBytes: 10 * 1024 ** 3 }, thresholds);
decision = shouldSendDiskPruneAlert(state, classification, disk, thresholds, Date.parse('2026-04-18T11:00:00Z'));
assert.deepEqual(decision, { send: true, kind: 'recovery', reason: 'recovered' });

const message = buildDiskPruneAlertMessage({ disk, dockerSummary, classification: { level: 'critical' }, thresholds });
assert.match(message, /Disk prune alert/);
assert.match(message, /docker builder prune -af/);
assert.match(message, /docker image prune -f/);
assert.match(message, /docker volume prune/);
assert.match(message, /Build Cache: 13.1GB reclaimable/);

const unavailableMessage = buildDiskPruneAlertMessage({
  disk,
  dockerSummary: { rows: [], reclaimable: [], unavailable: true },
  classification: { level: 'critical' },
  thresholds,
});
assert.match(unavailableMessage, /Docker reclaimable snapshot is unavailable/);

console.log('disk-prune-alert tests passed');
