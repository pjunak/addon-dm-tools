import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { createMockHost } from '../../ttrpg-codex/web/js/addon-test-harness.mjs';
import { migratePlanningV2 } from '../planning-migration.js';

const manifest = JSON.parse(await readFile(new URL('../addon.json', import.meta.url), 'utf8'));
const en = JSON.parse(await readFile(new URL('../locales/en.json', import.meta.url), 'utf8'));
const cs = JSON.parse(await readFile(new URL('../locales/cs.json', import.meta.url), 'utf8'));

test('v2 migration translates legacy data once and retains original sources', async () => {
  const legacy = {
    id: 'legacy-scene',
    name: 'Legacy scene',
    summary: 'Preserved',
    status: 'active',
    tags: ['legacy'],
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
  const { host } = createMockHost(manifest, {
    isDM: true,
    catalogs: { en, cs },
    fixtures: {
      'collection:scenarios': [legacy],
    },
  });
  for (const descriptor of manifest.collections) host.registerCollection(descriptor.name);
  const first = await migratePlanningV2(host);
  assert.equal(first.migrated, 1);
  assert.deepEqual(first.conflicts, []);
  assert.deepEqual(host.store.collection('scenarios').list(), [legacy]);
  assert.equal(host.store.collection('planning_items').get('legacy-scene').title, 'Legacy scene');
  assert.equal(host.store.collection('planning_items').get('legacy-scene').eventType, 'story');
  assert.ok(host.store.collection('planning_views').get('planner-schema-v2'));

  const second = await migratePlanningV2(host);
  assert.deepEqual(second, { migrated: 0, conflicts: [] });
  assert.deepEqual(host.store.collection('scenarios').list(), [legacy]);
});

test('a conflicted legacy translation writes neither v2 data nor migration marker', async () => {
  const { host } = createMockHost(manifest, {
    isDM: true,
    catalogs: { en, cs },
    fixtures: {
      'collection:planning_items': {
        broken: {
          schemaVersion: 1,
          kind: 'unknown',
          title: 'Cannot translate',
          updatedAt: 1,
        },
      },
    },
  });
  for (const descriptor of manifest.collections) host.registerCollection(descriptor.name);
  const result = await migratePlanningV2(host);
  assert.ok(result.conflicts.includes('item:broken'));
  assert.equal(host.store.collection('planning_views').get('planner-schema-v2'), null);
  assert.equal(host.store.collection('planning_items').get('broken').schemaVersion, 1);
});
