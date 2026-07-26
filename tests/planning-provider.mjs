import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import assert from 'node:assert/strict';

import * as contract from '../planning-contract.js';

const require = createRequire(import.meta.url);
const { createMockImportHost } = require('../../ttrpg-codex/server/addon-import-harness.cjs');
const {
  descriptor,
  PROVIDER_ID,
} = require('../server/planning-provider.cjs');
const serverEntry = require('../server/index.cjs');
const manifest = JSON.parse(await readFile(new URL('../addon.json', import.meta.url), 'utf8'));

const generatedAt = 1785024000000;

function document(overrides = {}) {
  return {
    format: 'dm-tools-planning',
    schemaVersion: 1,
    generatedAt,
    folders: [{
      id: 'arc-court',
      schemaVersion: 1,
      operation: 'create',
      name: 'Court',
      parentId: null,
      order: 0,
    }],
    items: [{
      id: 'quest-sigil',
      schemaVersion: 1,
      operation: 'create',
      kind: 'quest',
      title: 'Recover the Sigil',
      summary: 'Court investigation',
      body: '',
      folderId: 'arc-court',
      tags: ['court'],
      state: 'ready',
      pinned: true,
      sections: [{ id: 'audience', title: 'Audience with the Duke', body: '' }],
    }],
    links: [{
      id: 'link-mira-audience',
      schemaVersion: 1,
      operation: 'create',
      name: 'Requests a discreet investigation',
      type: 'involves',
      source: { scope: 'core', collection: 'characters', id: 'mira' },
      target: { scope: 'planning', itemId: 'quest-sigil', sectionId: 'audience' },
      notes: '',
    }],
    ...overrides,
  };
}

function harness(collections = {}) {
  const instance = createMockImportHost({
    id: manifest.id,
    apiVersion: manifest.apiVersion,
    capabilities: manifest.capabilities,
    permissions: manifest.permissions,
    collections: manifest.collections,
    contentRevision: 'dm-tools-planning-test',
  }, {
    collections,
    coreCollections: {
      characters: [{ id: 'mira', name: 'Mira Vel' }],
      factions: [],
      locations: [],
      mysteries: [],
      artifacts: [],
      events: [],
    },
  });
  instance.host.registerImportProvider(descriptor(contract));
  return instance;
}

async function preview(instance, value) {
  const job = instance.createJob(PROVIDER_ID, value);
  return instance.manager.preview(job.id, 'mock-session');
}

test('server composition registers the planning and retained legacy providers', async () => {
  const providers = [];
  await serverEntry.init({
    registerImportProvider(value) {
      providers.push(value);
    },
  });
  assert.deepEqual(providers.map(provider => provider.id), [
    'planning-json',
    'scenario-json',
  ]);
});

test('valid multi-collection preview is read-only and commits one atomic event', async () => {
  const instance = harness();
  const ready = await preview(instance, document());
  assert.equal(ready.committable, true);
  assert.equal(ready.plan.operations.length, 3);
  assert.deepEqual(instance.collection('planning_items'), {});
  assert.deepEqual(instance.collection('planning_folders'), {});
  assert.deepEqual(instance.collection('planning_links'), {});
  assert.equal(instance.events(), 0);

  const result = await instance.manager.commit(ready.id, 'mock-session', ready.previewToken);
  assert.equal(result.operationCount, 3);
  assert.equal(instance.collection('planning_items')['quest-sigil'].updatedAt, generatedAt);
  assert.equal(instance.collection('planning_links')['link-mira-audience'].name, 'Requests a discreet investigation');
  assert.equal(instance.events(), 1);
  await instance.dispose();
});

test('missing core and section references block the complete import', async () => {
  const instance = harness();
  const invalid = document({
    links: [{
      ...document().links[0],
      source: { scope: 'core', collection: 'characters', id: 'unknown' },
      target: { scope: 'planning', itemId: 'quest-sigil', sectionId: 'missing' },
    }],
  });
  const ready = await preview(instance, invalid);
  assert.equal(ready.committable, false);
  assert.ok(ready.plan.diagnostics.some(entry => entry.code === 'PLANNING_CORE_REFERENCE_MISSING'));
  assert.ok(ready.plan.diagnostics.some(entry => entry.code === 'PLANNING_SECTION_REFERENCE_MISSING'));
  await assert.rejects(
    instance.manager.commit(ready.id, 'mock-session', ready.previewToken),
    error => error.code === 'IMPORT_PLAN_INVALID',
  );
  assert.deepEqual(instance.collection('planning_items'), {});
  await instance.dispose();
});

test('updates require the exact current timestamp and identical content skips', async () => {
  const local = {
    schemaVersion: 1,
    kind: 'quest',
    title: 'Recover the Sigil',
    summary: 'Old summary',
    body: '',
    folderId: null,
    tags: [],
    state: 'idea',
    pinned: false,
    sections: [],
    updatedAt: 100,
  };
  const instance = harness({ planning_items: { 'quest-sigil': local } });
  const stale = await preview(instance, document({
    folders: [],
    links: [],
    items: [{
      id: 'quest-sigil',
      schemaVersion: 1,
      operation: 'update',
      expectedUpdatedAt: 99,
      kind: 'quest',
      title: 'Recover the Sigil',
      summary: 'Changed',
      body: '',
      folderId: null,
      tags: [],
      state: 'idea',
      pinned: false,
      sections: [],
    }],
  }));
  assert.equal(stale.committable, false);
  assert.ok(stale.plan.diagnostics.some(entry => entry.code === 'PLANNING_CONFLICT'));
  await instance.dispose();

  const updateInstance = harness({ planning_items: { 'quest-sigil': local } });
  const ready = await preview(updateInstance, document({
    folders: [],
    links: [],
    items: [{
      id: 'quest-sigil',
      schemaVersion: 1,
      operation: 'update',
      expectedUpdatedAt: 100,
      kind: 'quest',
      title: 'Recover the Sigil',
      summary: 'Changed',
      body: '',
      folderId: null,
      tags: [],
      state: 'idea',
      pinned: false,
      sections: [],
    }],
  }));
  assert.equal(ready.committable, true);
  assert.equal(ready.plan.operations.length, 1);
  await updateInstance.dispose();
});

test('an older dangling core reference does not block unrelated planning imports', async () => {
  const existingItem = {
    schemaVersion: 1,
    kind: 'note',
    title: 'Old note',
    summary: '',
    body: '',
    folderId: null,
    tags: [],
    state: 'archived',
    pinned: false,
    sections: [],
    updatedAt: 10,
  };
  const existingLink = {
    schemaVersion: 1,
    name: 'Former contact',
    type: 'related',
    source: { scope: 'core', collection: 'characters', id: 'deleted-character' },
    target: { scope: 'planning', itemId: 'old-note' },
    notes: '',
    updatedAt: 10,
  };
  const instance = harness({
    planning_items: { 'old-note': existingItem },
    planning_links: { 'old-link': existingLink },
  });
  const ready = await preview(instance, document({
    folders: [],
    links: [],
    items: [{
      id: 'new-note',
      schemaVersion: 1,
      operation: 'create',
      kind: 'note',
      title: 'New note',
      summary: '',
      body: '',
      folderId: null,
      tags: [],
      state: 'idea',
      pinned: false,
      sections: [],
    }],
  }));
  assert.equal(ready.committable, true);
  assert.equal(ready.plan.operations.length, 1);
  await instance.dispose();
});
