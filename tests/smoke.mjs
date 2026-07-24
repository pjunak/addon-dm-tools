import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {
  createMockHost,
  disposeMockHost,
  dryRunRegister,
} from '../../ttrpg-codex/web/js/addon-test-harness.mjs';
import register from '../entry.js';

const require = createRequire(import.meta.url);
const { validateManifest } = require('../../ttrpg-codex/server/addons.cjs');
const manifest = JSON.parse(await readFile(new URL('../addon.json', import.meta.url), 'utf8'));

test('manifest is a valid API-v2 DM collection declaration', () => {
  const result = validateManifest(manifest);
  assert.equal(result.ok, true, result.errors.join('; '));
  assert.equal(manifest.id, 'dm-tools');
  assert.deepEqual(manifest.collections, [
    { name: 'scenarios', keyed: false, access: 'dm' },
  ]);
  assert.ok(manifest.capabilities.required.includes('collections.dm'));
});

test('an incapable host rejects the addon instead of widening access', () => {
  assert.throws(
    () => createMockHost(manifest, {
      isDM: true,
      capabilities: ['lifecycle.dispose', 'content.revision'],
    }),
    /collections\.dm.*unavailable/,
  );
});

test('effective DM registration provides list CRUD and lifecycle cleanup', async () => {
  const result = dryRunRegister(register, manifest, { isDM: true });
  assert.equal(result.ok, true, result.error);
  assert.deepEqual(result.rec.collections, [
    { name: 'scenarios', keyed: false, access: 'dm' },
  ]);

  const { host, rec } = createMockHost(manifest, { isDM: true });
  host.registerCollection('scenarios');
  const scenarios = host.store.collection('scenarios');
  const saved = scenarios.save({ name: 'Reference scenario' });
  assert.equal(scenarios.get(saved.id).name, 'Reference scenario');
  scenarios.remove(saved.id);
  assert.deepEqual(scenarios.list(), []);
  assert.equal((await disposeMockHost(rec)).started, true);
});

test('effective player registration exposes no collection', async () => {
  const result = dryRunRegister(register, manifest, {
    isDM: false,
    fixtures: {
      'collection:scenarios': [{ id: 'hidden', name: 'Hidden scenario' }],
    },
  });
  assert.equal(result.ok, true, result.error);
  assert.deepEqual(result.rec.collections, []);
  await disposeMockHost(result.rec);
});
