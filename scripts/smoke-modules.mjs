// Loads the built package both ways a consumer would: import (ESM) and require (CommonJS).
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const esm = await import('@knowall-ai/agent-pulse');
const cjs = require('@knowall-ai/agent-pulse');

for (const [label, mod] of [['import', esm], ['require', cjs]]) {
  for (const name of ['createPulse', 'noopPulse', 'maskPii', 'activityIdFrom', 'toEnvelope']) {
    assert.ok(name in mod, `${label}: missing export ${name}`);
  }
  assert.equal(mod.activityIdFrom('x'), esm.activityIdFrom('x'), `${label}: activityIdFrom differs`);
}
console.log('smoke: import and require both load @knowall-ai/agent-pulse');
