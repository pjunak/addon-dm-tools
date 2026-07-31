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
      providers: [{ addonId: 'dm-tools', id: 'planning-json' }],
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
    { name: 'planning_items', keyed: true, access: 'dm' },
    { name: 'planning_folders', keyed: true, access: 'dm' },
    { name: 'planning_links', keyed: true, access: 'dm' },
    { name: 'planning_flow_links', keyed: true, access: 'dm' },
    { name: 'planning_references', keyed: true, access: 'dm' },
    { name: 'planning_consequences', keyed: true, access: 'dm' },
    { name: 'dm_notes', keyed: true, access: 'dm' },
    { name: 'planning_views', keyed: true, access: 'dm' },
  ]);
  assert.ok(manifest.capabilities.required.includes('collections.dm'));
  assert.ok(manifest.capabilities.required.includes('collections.transactions'));
  assert.ok(manifest.capabilities.required.includes('imports.providers'));
  assert.ok(manifest.capabilities.required.includes('i18n.catalogs'));
  assert.ok(!manifest.capabilities.required.includes('graphs.facade'));
  assert.ok(!manifest.permissions.includes('ui:graph'));
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
    { name: 'planning_items', keyed: true, access: 'dm' },
    { name: 'planning_folders', keyed: true, access: 'dm' },
    { name: 'planning_links', keyed: true, access: 'dm' },
    { name: 'planning_flow_links', keyed: true, access: 'dm' },
    { name: 'planning_references', keyed: true, access: 'dm' },
    { name: 'planning_consequences', keyed: true, access: 'dm' },
    { name: 'dm_notes', keyed: true, access: 'dm' },
    { name: 'planning_views', keyed: true, access: 'dm' },
  ]);
  assert.deepEqual(result.rec.routes.map(route => route.segment), [
    'dm-plans',
    'dm-import',
  ]);
  assert.deepEqual(result.rec.slots.map(slot => slot.slotId), ['dm:dashboard']);
  assert.equal(result.rec.sidebar[0].role, 'dm');
  assert.equal(result.rec.sidebar[1].role, 'dm');
  assert.equal(result.rec.sidebar.length, 2);
  assert.ok(result.rec.actions.some(action => action.name === 'commit'));
  assert.ok(smokeRegistrations(result.rec).ok);
  assert.deepEqual(result.rec.i18nMissing, []);
  await disposeMockHost(result.rec);
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
  const html = result.rec.routes.find(route => route.segment === 'dm-import').render();
  assert.match(html, /Centrum importu/);
  assert.match(html, /Preview and atomically import/);
  assert.deepEqual(result.rec.i18nMissing, []);
  await disposeMockHost(result.rec);
});

test('transaction capability commits buffered planning changes atomically', async () => {
  const { host } = createMockHost(manifest, {
    isDM: true,
    catalogs: { en, cs },
    locale: 'en',
    fetch: providerFetch,
    fixtures: {
      'collection:planning_items': {
        seed: { title: 'Seed', kind: 'quest' },
      },
    },
  });
  host.registerCollection('planning_items');
  const result = await host.store.transaction(['planning_items'], async tx => {
    const planning = tx.collection('planning_items');
    assert.equal(planning.get('seed').title, 'Seed');
    planning.put({ id: 'replacement', title: 'Replacement', kind: 'quest' });
    planning.remove('seed');
    return 'reference-result';
  });
  assert.equal(result.value, 'reference-result');
  assert.deepEqual(host.store.collection('planning_items').list(), [
    { id: 'replacement', title: 'Replacement', kind: 'quest' },
  ]);
});

test('transaction callback failure leaves the planning collection unchanged', async () => {
  const { host } = createMockHost(manifest, {
    isDM: true,
    catalogs: { en, cs },
    locale: 'en',
    fetch: providerFetch,
    fixtures: {
      'collection:planning_items': {
        seed: { title: 'Seed', kind: 'quest' },
      },
    },
  });
  host.registerCollection('planning_items');
  await assert.rejects(
    host.store.transaction(['planning_items'], tx => {
      tx.collection('planning_items').put({ id: 'ghost', title: 'Must not commit' });
      throw new Error('expected callback failure');
    }),
    /expected callback failure/,
  );
  assert.deepEqual(host.store.collection('planning_items').list(), [
    { id: 'seed', title: 'Seed', kind: 'quest' },
  ]);
});
