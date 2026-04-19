import assert from 'assert/strict';
import { mkdtempSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

const tempDir = mkdtempSync(path.join(tmpdir(), 'optional-openrouter-'));
process.env.OPTIONAL_OPENROUTER_STATE_PATH = path.join(tempDir, 'state.json');

const mod = await import('../lib/optional-openrouter.js');

const auth = mod.analyzeOptionalOpenRouterFailure({ status: 401, errorText: 'User not found.' });
assert.equal(auth.kind, 'auth');
assert.ok(auth.cooldownMs > 0);

const rateLimit = mod.analyzeOptionalOpenRouterFailure({ status: 429, errorText: 'Too many requests' });
assert.equal(rateLimit.kind, 'rate_limit');
assert.ok(rateLimit.cooldownMs > 0);

const upstream = mod.analyzeOptionalOpenRouterFailure({ status: 502, errorText: 'Bad gateway' });
assert.equal(upstream.summary, 'upstream unavailable');

const pause = mod.pauseOptionalOpenRouter('auth', 'credentials rejected', 60 * 60 * 1000);
assert.equal(mod.getOptionalOpenRouterPause()?.kind, 'auth');
assert.match(mod.describeOptionalOpenRouterPause(pause), /credentials rejected/);

const persisted = JSON.parse(readFileSync(process.env.OPTIONAL_OPENROUTER_STATE_PATH, 'utf8'));
assert.equal(persisted.kind, 'auth');

console.log('optional-openrouter tests passed');
