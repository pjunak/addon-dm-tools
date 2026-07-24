import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {
  createMockHost,
  disposeMockHost,
  dryRunRegister,
  smokeRegistrations,
  validateAddonCatalogs,
} from '../../ttrpg-codex/web/js/addon-test-harness.mjs';
import register from '../entry.js';

const require = createRequire(import.meta.url);
const { validateManifest } = require('../../ttrpg-codex/server/addons.cjs');
const manifest = JSON.parse(await readFile(new URL('../addon.json', import.meta.url), 'utf8'));
const en = JSON.parse(await readFile(new URL('../locales/en.json', import.meta.url), 'utf8'));
const cs = JSON.parse(await readFile(new URL('../locales/cs.json', import.meta.url), 'utf8'));

const providerFetch = async () => ({
  ok: true,
  status: 200,
  async json() {
    return {
      version: 1,
      providers: [{ addonId: 'dm-tools', id: 'scenario-json' }],
      limits: { maxInputBytes: 262144 },
    };
  },
});

test('manifest is a valid API-v2 DM collection declaration', () => {
  const result = validateManifest(manifest);
  assert.equal(result.ok, true, result.errors.join('; '));
  assert.equal(manifest.id, 'dm-tools');
  assert.deepEqual(manifest.collections, [
    { name: 'scenarios', keyed: false, access: 'dm' },
  ]);
  assert.ok(manifest.capabilities.required.includes('collections.dm'));
  assert.ok(manifest.capabilities.required.includes('collections.transactions'));
  assert.ok(manifest.capabilities.required.includes('imports.providers'));
  assert.ok(manifest.capabilities.required.includes('i18n.catalogs'));
  assert.ok(manifest.capabilities.required.includes('graphs.facade'));
  assert.ok(manifest.permissions.includes('ui:graph'));
  assert.ok(manifest.permissions.includes('ui:slot:dm'));
  assert.deepEqual(manifest.locales, {
    en: 'locales/en.json',
    cs: 'locales/cs.json',
  });
  assert.ok(validateAddonCatalogs(manifest, { en, cs }).ok);
});

test('an incapable host rejects the addon instead of widening access', () => {
  assert.throws(
    () => createMockHost(manifest, {
      isDM: true,
      capabilities: ['collections.dm', 'lifecycle.dispose', 'content.revision'],
    }),
    /collections\.transactions.*unavailable/,
  );
});

test('effective DM registration provides Import Center UI and lifecycle cleanup', async () => {
  const result = dryRunRegister(register, manifest, {
    isDM: true,
    catalogs: { en, cs },
    locale: 'en',
    fetch: providerFetch,
  });
  assert.equal(result.ok, true, result.error);
  assert.deepEqual(result.rec.collections, [
    { name: 'scenarios', keyed: false, access: 'dm' },
  ]);
  assert.deepEqual(result.rec.routes.map(route => route.segment), ['dm-import', 'dm-scenarios']);
  assert.deepEqual(result.rec.slots.map(slot => slot.slotId), ['dm:dashboard']);
  assert.equal(result.rec.sidebar[0].role, 'dm');
  assert.equal(result.rec.sidebar[1].role, 'dm');
  assert.ok(result.rec.actions.some(action => action.name === 'commit'));
  assert.ok(smokeRegistrations(result.rec).ok);
  assert.deepEqual(result.rec.i18nMissing, []);
  await disposeMockHost(result.rec);

  const { host, rec } = createMockHost(manifest, {
    isDM: true,
    catalogs: { en, cs },
    locale: 'en',
    fetch: providerFetch,
  });
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
    catalogs: { en, cs },
    locale: 'cs',
    fetch: providerFetch,
    fixtures: {
      'collection:scenarios': [{ id: 'hidden', name: 'Hidden scenario' }],
    },
  });
  assert.equal(result.ok, true, result.error);
  assert.deepEqual(result.rec.collections, []);
  assert.deepEqual(result.rec.routes, []);
  assert.deepEqual(result.rec.sidebar, []);
  assert.deepEqual(result.rec.slots, []);
  await disposeMockHost(result.rec);
});

test('regional locale uses Czech and a partial translation falls back to English', async () => {
  const partialCs = { 'page.title': 'Centrum importu' };
  const result = dryRunRegister(register, manifest, {
    isDM: true,
    catalogs: { en, cs: partialCs },
    locale: 'cs-CZ',
    fetch: providerFetch,
  });
  assert.equal(result.ok, true, result.error);
  const html = result.rec.routes[0].render();
  assert.match(html, /Centrum importu/);
  assert.match(html, /Preview and review/);
  assert.deepEqual(result.rec.i18nMissing, []);
  await disposeMockHost(result.rec);
});

test('transaction capability commits buffered scenario changes atomically', async () => {
  const { host } = createMockHost(manifest, {
    isDM: true,
    catalogs: { en, cs },
    locale: 'en',
    fetch: providerFetch,
    fixtures: {
      'collection:scenarios': [{ id: 'seed', name: 'Seed scenario' }],
    },
  });
  host.registerCollection('scenarios');
  const result = await host.store.transaction(['scenarios'], async tx => {
    const scenarios = tx.collection('scenarios');
    assert.equal(scenarios.get('seed').name, 'Seed scenario');
    scenarios.put({ id: 'replacement', name: 'Replacement scenario' });
    scenarios.remove('seed');
    return 'reference-result';
  });
  assert.equal(result.value, 'reference-result');
  assert.deepEqual(host.store.collection('scenarios').list(), [
    { id: 'replacement', name: 'Replacement scenario' },
  ]);
});

test('transaction callback failure leaves the scenario collection unchanged', async () => {
  const { host } = createMockHost(manifest, {
    isDM: true,
    catalogs: { en, cs },
    locale: 'en',
    fetch: providerFetch,
    fixtures: {
      'collection:scenarios': [{ id: 'seed', name: 'Seed scenario' }],
    },
  });
  host.registerCollection('scenarios');
  await assert.rejects(
    host.store.transaction(['scenarios'], tx => {
      tx.collection('scenarios').put({ id: 'ghost', name: 'Must not commit' });
      throw new Error('expected callback failure');
    }),
    /expected callback failure/,
  );
  assert.deepEqual(host.store.collection('scenarios').list(), [
    { id: 'seed', name: 'Seed scenario' },
  ]);
});
