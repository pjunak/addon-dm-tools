import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

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
    schemaVersion: 2,
    generatedAt,
    items: [{
      id: 'plotline-dragons',
      schemaVersion: 2,
      operation: 'create',
      kind: 'plotline',
      parentId: null,
      title: 'The Waking Dragons',
      summary: 'Ancient dragons stir.',
      body: '',
      objective: 'Discover who is breaking the seals.',
      setup: '',
      resolution: '',
      tags: ['dragons'],
    }, {
      id: 'quest-earthquake',
      schemaVersion: 2,
      operation: 'create',
      kind: 'quest',
      parentId: 'plotline-dragons',
      title: 'Investigate the Earthquake',
      summary: '',
      body: '',
      objective: '',
      setup: '',
      resolution: '',
      tags: [],
    }, {
      id: 'event-tremor',
      schemaVersion: 2,
      operation: 'create',
      kind: 'event',
      parentId: 'plotline-dragons',
      eventType: 'story',
      title: 'The Earth Shakes',
      summary: '',
      body: '',
      objective: '',
      setup: '',
      resolution: '',
      tags: [],
    }],
    flowLinks: [{
      id: 'flow-investigate',
      schemaVersion: 2,
      operation: 'create',
      sourceId: 'event-tremor',
      targetId: 'quest-earthquake',
      kind: 'continues',
      label: 'The tremor draws attention',
    }],
    references: [{
      id: 'reference-mira',
      schemaVersion: 2,
      operation: 'create',
      itemId: 'quest-earthquake',
      name: 'Asks the party to investigate',
      relation: 'involves',
      target: { scope: 'core', collection: 'characters', id: 'mira' },
      quantity: 1,
      notes: '',
    }],
    consequences: [{
      id: 'consequence-town',
      schemaVersion: 2,
      operation: 'create',
      anchor: { scope: 'item', itemId: 'quest-earthquake' },
      kind: 'world',
      title: 'The town becomes friendly',
      body: '',
    }],
    notes: [{
      id: 'note-duke',
      schemaVersion: 2,
      operation: 'create',
      title: 'The duke distrusts the party',
      body: 'Observed during play.',
      anchorIds: ['quest-earthquake'],
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
    contentRevision: 'dm-tools-planning-v2-test',
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

test('server composition registers only the v2 planner and its bundle contribution', async () => {
  const providers = [];
  const contributors = [];
  await serverEntry.init({
    registerImportProvider(value) {
      providers.push(value);
    },
    registerCampaignBundleContributor(value) {
      contributors.push(value);
    },
  });
  assert.deepEqual(providers.map(provider => [provider.id, provider.schemaVersion]), [
    ['planning-json', 2],
  ]);
  assert.deepEqual(contributors, [{ id: 'planning', providerId: 'planning-json' }]);
});

test('v2 preview is read-only and commits the full story structure atomically', async () => {
  const instance = harness();
  const ready = await preview(instance, document());
  assert.equal(ready.committable, true);
  assert.equal(ready.plan.operations.length, 7);
  assert.deepEqual(instance.collection('planning_items'), {});
  assert.equal(instance.events(), 0);

  const result = await instance.manager.commit(ready.id, 'mock-session', ready.previewToken);
  assert.equal(result.operationCount, 7);
  assert.equal(instance.collection('planning_items')['quest-earthquake'].parentId, 'plotline-dragons');
  assert.equal(instance.collection('planning_references')['reference-mira'].quantity, 1);
  assert.equal(instance.collection('dm_notes')['note-duke'].body, 'Observed during play.');
  assert.equal(instance.events(), 1);
  await instance.dispose();
});

test('missing ownership and campaign references block the complete import', async () => {
  const source = document();
  source.items[1].parentId = 'missing-plotline';
  source.references[0].target.id = 'missing-character';
  const instance = harness();
  const ready = await preview(instance, source);
  assert.equal(ready.committable, false);
  assert.ok(ready.plan.diagnostics.some(entry => entry.code === 'PLANNING_PARENT_MISSING'));
  assert.ok(ready.plan.diagnostics.some(entry => entry.code === 'PLANNING_CORE_REFERENCE_MISSING'));
  await assert.rejects(
    instance.manager.commit(ready.id, 'mock-session', ready.previewToken),
    error => error.code === 'IMPORT_PLAN_INVALID',
  );
  assert.deepEqual(instance.collection('planning_items'), {});
  await instance.dispose();
});

test('updates require the exact local timestamp', async () => {
  const local = {
    schemaVersion: 2,
    kind: 'plotline',
    parentId: null,
    title: 'The Waking Dragons',
    summary: 'Old',
    body: '',
    objective: '',
    setup: '',
    resolution: '',
    tags: [],
    updatedAt: 100,
  };
  const instance = harness({ planning_items: { 'plotline-dragons': local } });
  const source = document({
    items: [{
      ...document().items[0],
      operation: 'update',
      expectedUpdatedAt: 99,
      summary: 'Changed',
    }],
    flowLinks: [],
    references: [],
    consequences: [],
    notes: [],
  });
  const ready = await preview(instance, source);
  assert.equal(ready.committable, false);
  assert.ok(ready.plan.diagnostics.some(entry => entry.code === 'PLANNING_CONFLICT'));
  await instance.dispose();
});

test('an older dangling core reference does not block an unrelated note import', async () => {
  const instance = harness({
    planning_items: {
      existing: {
        schemaVersion: 2,
        kind: 'event',
        eventType: 'story',
        parentId: null,
        title: 'Existing event',
        summary: '',
        body: '',
        objective: '',
        setup: '',
        resolution: '',
        tags: [],
        updatedAt: 10,
      },
    },
    planning_references: {
      old: {
        schemaVersion: 2,
        itemId: 'existing',
        name: 'Former contact',
        relation: 'related',
        target: { scope: 'core', collection: 'characters', id: 'deleted-character' },
        quantity: 1,
        notes: '',
        updatedAt: 10,
      },
    },
  });
  const ready = await preview(instance, document({
    items: [],
    flowLinks: [],
    references: [],
    consequences: [],
    notes: [{
      id: 'note-new',
      schemaVersion: 2,
      operation: 'create',
      title: 'New observation',
      body: '',
      anchorIds: ['existing'],
    }],
  }));
  assert.equal(ready.committable, true);
  assert.equal(ready.plan.operations.length, 1);
  await instance.dispose();
});
