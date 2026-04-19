import assert from 'node:assert/strict';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

import {
  createJobRuntime,
  drainDeliveryQueue,
  JobDelivery,
  JobExecutor,
  loadDeliveryQueue,
  loadJobState,
} from '../lib/job-runtime.js';

const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'job-runtime-'));
const runtime = createJobRuntime({ dataDir });

const jobs = Array.from({ length: 24 }, (_, index) => ({
  id: `job-${index}`,
  label: `Job ${index}`,
}));

await Promise.all(jobs.map((job, index) => runtime.updateState(job.id, {
  id: job.id,
  label: job.label,
  trigger: 'test',
  lastRunAt: `seed-${index}`,
})));

let state = await loadJobState(dataDir);
assert.equal(Object.keys(state.jobs).length, jobs.length);
for (const [index, job] of jobs.entries()) {
  assert.equal(state.jobs[job.id]?.lastRunAt, `seed-${index}`);
}

await Promise.all(jobs.slice(0, 6).map((job) => runtime.runJob({
  id: job.id,
  label: job.label,
  trigger: 'test',
  executor: JobExecutor.CONTAINER,
  delivery: JobDelivery.HYBRID,
}, async () => ({
  summary: `${job.label} completed`,
  writeReport: false,
  suppressSuccessAlert: true,
}))));

state = await loadJobState(dataDir);
for (const job of jobs.slice(0, 6)) {
  assert.equal(state.jobs[job.id]?.lastRunStatus, 'ok');
  assert.ok(state.jobs[job.id]?.lastSuccessAt);
}

const deliveryReports = [];
const flakyRuntime = createJobRuntime({
  dataDir,
  adminJid: 'admin@example.test',
  sendAdminText: async () => {
    throw new Error('Connection Closed');
  },
  writeReport: (type, text) => {
    deliveryReports.push({ type, text });
  },
});

const softDeliveryRun = await flakyRuntime.runJob({
  id: 'delivery-soft-fail',
  label: 'Delivery soft fail',
  trigger: 'test',
  executor: JobExecutor.CONTAINER,
  delivery: JobDelivery.WHATSAPP_FIRST,
  allowDeliveryFailure: true,
  reportType: 'delivery-soft-fail',
}, async () => ({
  message: 'report delivered to disk',
}));

assert.equal(softDeliveryRun.ok, true);
assert.match(softDeliveryRun.deliveryError || '', /Connection Closed/);
assert.equal(deliveryReports.length, 1);

state = await loadJobState(dataDir);
assert.equal(state.jobs['delivery-soft-fail']?.lastRunStatus, 'ok');
assert.match(state.jobs['delivery-soft-fail']?.lastDeliveryIssue || '', /Connection Closed/);

const queueDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'job-runtime-queue-'));
const queuedRuntime = createJobRuntime({
  dataDir: queueDataDir,
  adminJid: 'admin@example.test',
  sendAdminText: async () => {
    throw new Error('Socket offline');
  },
});

const queuedRun = await queuedRuntime.runJob({
  id: 'delivery-queued',
  label: 'Delivery queued',
  trigger: 'test',
  executor: JobExecutor.CONTAINER,
  delivery: JobDelivery.WHATSAPP_FIRST,
  reportType: 'delivery-queued',
}, async () => ({
  message: 'retry me later',
  suppressSuccessAlert: false,
}));

assert.equal(queuedRun.ok, true);
assert.equal(queuedRun.deliveryQueued, true);

let queue = await loadDeliveryQueue(dataDir);
assert.equal(queue.length, 1);
assert.equal(queue[0].jobId, 'delivery-soft-fail');

queue = await loadDeliveryQueue(queueDataDir);
assert.equal(queue.length, 1);
assert.equal(queue[0].jobId, 'delivery-queued');

const delivered = [];
const drainResult = await drainDeliveryQueue({
  dataDir: queueDataDir,
  sendAdminText: async (text, jid) => {
    delivered.push({ text, jid });
  },
});

assert.equal(drainResult.sent, 1);
assert.equal(delivered.length, 1);
assert.equal(delivered[0].text, 'retry me later');

queue = await loadDeliveryQueue(queueDataDir);
assert.equal(queue.length, 0);

state = await loadJobState(queueDataDir);
assert.equal(state.jobs['delivery-queued']?.lastDeliveryIssue, null);
assert.equal(state.jobs['delivery-queued']?.lastDeliveryPending, false);

console.log('job runtime checks passed');
