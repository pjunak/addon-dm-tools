import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizePlanningFolder,
  normalizePlanningItem,
  normalizePlanningLink,
  validatePlanningDataset,
} from '../planning-contract.js';
import { scenarioToPlanningItem } from '../planning-migration.js';

const item = normalizePlanningItem({
  id: 'quest-sigil',
  schemaVersion: 1,
  kind: 'quest',
  title: 'Recover the Sigil',
  summary: '',
  body: '',
  folderId: 'arc-court',
  tags: ['court'],
  state: 'ready',
  pinned: true,
  sections: [{ id: 'audience', title: 'Audience', body: '' }],
  updatedAt: 100,
}).value;
const folder = normalizePlanningFolder({
  id: 'arc-court',
  schemaVersion: 1,
  name: 'Court',
  parentId: null,
  order: 0,
  updatedAt: 100,
}).value;
const link = normalizePlanningLink({
  id: 'link-mira-audience',
  schemaVersion: 1,
  name: 'Requests a discreet investigation',
  type: 'involves',
  source: { scope: 'core', collection: 'characters', id: 'mira' },
  target: { scope: 'planning', itemId: 'quest-sigil', sectionId: 'audience' },
  notes: '',
  updatedAt: 100,
}).value;

test('normalizes the shared folder, item, section, and named-link contract', () => {
  assert.equal(item.title, 'Recover the Sigil');
  assert.equal(item.sections[0].id, 'audience');
  assert.equal(link.name, 'Requests a discreet investigation');
  assert.deepEqual(validatePlanningDataset({
    folders: [folder],
    items: [item],
    links: [link],
    coreIds: { characters: ['mira'] },
  }), []);
});

test('rejects missing section/core references and folder cycles', () => {
  const brokenLink = {
    ...link,
    target: { scope: 'planning', itemId: item.id, sectionId: 'missing' },
  };
  const child = { ...folder, id: 'child', parentId: folder.id };
  const parent = { ...folder, parentId: child.id };
  const errors = validatePlanningDataset({
    folders: [parent, child],
    items: [item],
    links: [brokenLink, { ...link, id: 'missing-npc', source: { ...link.source, id: 'unknown' } }],
    coreIds: { characters: ['mira'] },
  });
  assert.ok(errors.some(error => error.code === 'PLANNING_FOLDER_CYCLE'));
  assert.ok(errors.some(error => error.code === 'PLANNING_SECTION_REFERENCE_MISSING'));
  assert.ok(errors.some(error => error.code === 'PLANNING_CORE_REFERENCE_MISSING'));
});

test('legacy scenarios map without mutating their original shape', () => {
  const legacy = {
    id: 'old-scenario',
    name: 'Old Scenario',
    summary: 'Preserved summary',
    status: 'completed',
    tags: ['legacy'],
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
  const before = structuredClone(legacy);
  const migrated = scenarioToPlanningItem(legacy);
  assert.deepEqual(legacy, before);
  assert.equal(migrated.kind, 'scenario');
  assert.equal(migrated.state, 'resolved');
  assert.equal(migrated.title, 'Old Scenario');
  assert.equal(migrated.updatedAt, Date.parse(legacy.updatedAt));
});
