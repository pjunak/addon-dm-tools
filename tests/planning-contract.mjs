import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizeDmNote,
  normalizePlanningConsequence,
  normalizePlanningFlow,
  normalizePlanningItem,
  normalizePlanningReference,
  validatePlanningDataset,
} from '../planning-contract.js';
import { buildLegacyMigration } from '../planning-migration.js';

function item(overrides = {}) {
  return normalizePlanningItem({
    id: 'plotline-dragons',
    schemaVersion: 2,
    kind: 'plotline',
    parentId: null,
    title: 'The Waking Dragons',
    summary: 'Ancient dragons stir.',
    body: '',
    objective: 'Discover who is breaking the seals.',
    setup: '',
    resolution: '',
    tags: ['dragons'],
    updatedAt: 100,
    ...overrides,
  }).value;
}

test('normalizes nested plotlines, quests, typed events, and branch gates', () => {
  const quest = item({
    id: 'quest-earthquake',
    kind: 'quest',
    parentId: 'plotline-dragons',
    title: 'Investigate the Earthquake',
  });
  const encounter = item({
    id: 'event-cultists',
    kind: 'event',
    parentId: quest.id,
    title: 'Cultist Ambush',
    eventType: 'encounter',
  });
  const decision = item({
    id: 'branch-prisoner',
    kind: 'branch',
    parentId: quest.id,
    title: 'What happens to the prisoner?',
    branchType: 'decision',
  });
  assert.equal(encounter.eventType, 'encounter');
  assert.equal(decision.branchType, 'decision');
  assert.deepEqual(validatePlanningDataset({
    items: [item(), quest, encounter, decision],
  }), []);
});

test('rejects ownership cycles and children under leaf events', () => {
  const parent = item({ parentId: 'quest-child' });
  const child = item({
    id: 'quest-child',
    kind: 'quest',
    parentId: parent.id,
    title: 'Child',
  });
  const leaf = item({
    id: 'event-leaf',
    kind: 'event',
    eventType: 'story',
    title: 'Leaf',
  });
  const invalidChild = item({
    id: 'quest-under-event',
    kind: 'quest',
    parentId: leaf.id,
    title: 'Invalid child',
  });
  const errors = validatePlanningDataset({
    items: [parent, child, leaf, invalidChild],
  });
  assert.ok(errors.some(error => error.code === 'PLANNING_HIERARCHY_CYCLE'));
  assert.ok(errors.some(error => error.code === 'PLANNING_PARENT_KIND_INVALID'));
});

test('flow is acyclic, option links originate at branches, and may cross nested scopes', () => {
  const root = item();
  const quest = item({
    id: 'quest-earthquake',
    kind: 'quest',
    parentId: root.id,
    title: 'Earthquake',
  });
  const branch = item({
    id: 'branch-route',
    kind: 'branch',
    parentId: root.id,
    title: 'Choose route',
    branchType: 'decision',
  });
  const nested = item({
    id: 'event-nested',
    kind: 'event',
    parentId: quest.id,
    title: 'Nested event',
    eventType: 'story',
  });
  const option = normalizePlanningFlow({
    id: 'flow-option',
    schemaVersion: 2,
    sourceId: branch.id,
    targetId: nested.id,
    kind: 'option',
    label: 'Take the mountain road',
    updatedAt: 100,
  }).value;
  assert.deepEqual(validatePlanningDataset({
    items: [root, quest, branch, nested],
    flowLinks: [option],
  }), []);
  const invalidOption = { ...option, id: 'flow-invalid', sourceId: quest.id };
  const back = {
    ...option,
    id: 'flow-back',
    sourceId: nested.id,
    targetId: branch.id,
    kind: 'continues',
  };
  const errors = validatePlanningDataset({
    items: [root, quest, branch, nested],
    flowLinks: [option, invalidOption, back],
  });
  assert.ok(errors.some(error => error.code === 'PLANNING_FLOW_OPTION_SOURCE_INVALID'));
  assert.ok(errors.some(error => error.code === 'PLANNING_FLOW_CYCLE'));
});

test('named references retain quantities and validate campaign records', () => {
  const reference = normalizePlanningReference({
    id: 'reference-goblins',
    schemaVersion: 2,
    itemId: 'plotline-dragons',
    name: 'Guards the ruined gate',
    relation: 'opposes',
    target: {
      scope: 'external',
      addonId: 'example-bestiary',
      kind: 'monster',
      id: 'goblin',
      label: 'Goblin',
    },
    quantity: 6,
    notes: '',
    updatedAt: 100,
  }).value;
  assert.equal(reference.quantity, 6);
  const coreReference = normalizePlanningReference({
    ...reference,
    id: 'reference-mira',
    target: { scope: 'core', collection: 'characters', id: 'mira' },
    quantity: 1,
  }).value;
  const errors = validatePlanningDataset({
    items: [item()],
    references: [reference, coreReference],
    coreIds: { characters: [] },
  });
  assert.ok(errors.some(error => error.code === 'PLANNING_CORE_REFERENCE_MISSING'));
});

test('consequences and separate marginalia validate their anchors', () => {
  const consequence = normalizePlanningConsequence({
    id: 'consequence-town-friendly',
    schemaVersion: 2,
    anchor: { scope: 'item', itemId: 'plotline-dragons' },
    kind: 'world',
    title: 'The town becomes friendly',
    body: '',
    updatedAt: 100,
  }).value;
  const note = normalizeDmNote({
    id: 'note-angry-noble',
    schemaVersion: 2,
    title: 'The party angered the duke',
    body: 'Keep this separate from the planned quest structure.',
    anchorIds: ['plotline-dragons'],
    updatedAt: 100,
  }).value;
  assert.deepEqual(validatePlanningDataset({
    items: [item()],
    consequences: [consequence],
    notes: [note],
  }), []);
  const errors = validatePlanningDataset({
    items: [item()],
    notes: [{ ...note, anchorIds: ['missing'] }],
  });
  assert.ok(errors.some(error => error.code === 'PLANNING_ITEM_REFERENCE_MISSING'));
});

test('legacy folders, sections, notes, and named links translate without mutation', () => {
  const source = {
    scenarios: [],
    folders: [{
      id: 'arc-court',
      name: 'Court',
      parentId: null,
      updatedAt: 10,
    }],
    items: [{
      id: 'quest-sigil',
      schemaVersion: 1,
      kind: 'quest',
      title: 'Recover the Sigil',
      summary: '',
      body: '',
      folderId: 'arc-court',
      tags: [],
      state: 'ready',
      pinned: true,
      sections: [{ id: 'audience', title: 'Audience', body: 'Meet the duke.' }],
      updatedAt: 10,
    }, {
      id: 'note-duke',
      schemaVersion: 1,
      kind: 'note',
      title: 'The duke is suspicious',
      summary: '',
      body: 'A fact learned at the table.',
      folderId: 'arc-court',
      tags: [],
      state: 'idea',
      pinned: false,
      sections: [],
      updatedAt: 10,
    }],
    links: [{
      id: 'link-mira',
      schemaVersion: 1,
      name: 'Requests discretion',
      type: 'involves',
      source: { scope: 'core', collection: 'characters', id: 'mira' },
      target: { scope: 'planning', itemId: 'quest-sigil', sectionId: 'audience' },
      notes: '',
      updatedAt: 10,
    }],
  };
  const before = structuredClone(source);
  const result = buildLegacyMigration(source);
  assert.deepEqual(source, before);
  assert.deepEqual(result.conflicts, []);
  assert.ok(result.items.some(value => value.kind === 'plotline' && value.title === 'Court'));
  assert.ok(result.items.some(value => value.kind === 'event' && value.title === 'Audience'));
  assert.equal(result.references[0].name, 'Requests discretion');
  assert.equal(result.notes[0].title, 'The duke is suspicious');
});
