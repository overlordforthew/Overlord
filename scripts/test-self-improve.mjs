import assert from 'node:assert/strict';

import { summarizeJobRuns } from './self-improve.mjs';

const nowMs = Date.parse('2026-04-14T21:30:00Z');

const runs = [
  {
    jobId: 'git-review',
    label: 'Git auto-review',
    status: 'skipped',
    startedAt: '2026-04-14T18:00:00Z',
  },
  {
    jobId: 'git-review',
    label: 'Git auto-review',
    status: 'skipped',
    startedAt: '2026-04-14T19:00:00Z',
  },
  {
    jobId: 'git-review',
    label: 'Git auto-review',
    status: 'ok',
    startedAt: '2026-04-14T20:00:00Z',
  },
  {
    jobId: 'cron-health',
    label: 'Cron health monitor',
    status: 'failed',
    startedAt: '2026-04-14T19:00:00Z',
  },
  {
    jobId: 'cron-health',
    label: 'Cron health monitor',
    status: 'failed',
    startedAt: '2026-04-14T19:05:00Z',
  },
  {
    jobId: 'cron-health',
    label: 'Cron health monitor',
    status: 'ok',
    startedAt: '2026-04-14T19:20:00Z',
  },
  {
    jobId: 'lumina-watch',
    label: 'Lumina watch',
    status: 'failed',
    startedAt: '2026-04-14T20:45:00Z',
  },
  {
    jobId: 'lumina-watch',
    label: 'Lumina watch',
    status: 'failed',
    startedAt: '2026-04-14T21:05:00Z',
  },
];

const summary = summarizeJobRuns(runs, nowMs);

assert.equal(summary.length, 2);
assert.equal(summary[0].jobId, 'lumina-watch');
assert.equal(summary[0].openIncidentCount, 1);
assert.equal(summary[0].failedAttempts, 2);

const cron = summary.find((job) => job.jobId === 'cron-health');
assert.ok(cron);
assert.equal(cron.incidents.length, 1);
assert.equal(cron.openIncidentCount, 0);
assert.equal(cron.failedAttempts, 2);

assert.equal(summary.some((job) => job.jobId === 'git-review'), false);

console.log('self-improve reliability checks passed');
