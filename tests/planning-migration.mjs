import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

import { createMockHost } from '../../ttrpg-codex/web/js/addon-test-harness.mjs';
import { migrateLegacyScenarios } from '../planning-migration.js';

const manifest = JSON.parse(await readFile(new URL('../addon.json', import.meta.url), 'utf8'));
const en = JSON.parse(await readFile(new URL('../locales/en.json', import.meta.url), 'utf8'));
const cs = JSON.parse(await readFile(new URL('../locales/cs.json', import.meta.url), 'utf8'));

test('legacy migration copies scenarios once and never deletes or overwrites source data', async () => {
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
      'collection:planning_items': {},
    },
  });
  host.registerCollection('scenarios');
  host.registerCollection('planning_items');
  const first = await migrateLegacyScenarios(host);
  assert.deepEqual(first, { migrated: 1, conflicts: [] });
  assert.deepEqual(host.store.collection('scenarios').list(), [legacy]);
  assert.equal(
    host.store.collection('planning_items').list()[0].title,
    'Legacy scene',
  );

  const second = await migrateLegacyScenarios(host);
  assert.deepEqual(second, { migrated: 0, conflicts: [] });
  assert.deepEqual(host.store.collection('scenarios').list(), [legacy]);
});
