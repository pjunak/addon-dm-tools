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

function item(overrides = {}) {
  return normalizePlanningItem({
    id: 'plotline-dragons',
    schemaVersion: 3,
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

test('flow stays on one canvas, remains acyclic, and starts options at branches', () => {
  const root = item();
  const firstQuest = item({
    id: 'quest-mountain',
    kind: 'quest',
    parentId: root.id,
    title: 'Take the Mountain Road',
  });
  const secondQuest = item({
    id: 'quest-river',
    kind: 'quest',
    parentId: root.id,
    title: 'Follow the River',
  });
  const branch = item({
    id: 'branch-route',
    kind: 'branch',
    parentId: root.id,
    title: 'Choose route',
    branchType: 'decision',
  });
  const firstNested = item({
    id: 'event-mountain-pass',
    kind: 'event',
    parentId: firstQuest.id,
    title: 'Cross the Mountain Pass',
    eventType: 'story',
  });
  const secondNested = item({
    id: 'event-river-crossing',
    kind: 'event',
    parentId: secondQuest.id,
    title: 'Cross the River',
    eventType: 'story',
  });
  const option = normalizePlanningFlow({
    id: 'flow-option',
    schemaVersion: 3,
    sourceId: branch.id,
    targetId: firstQuest.id,
    kind: 'option',
    label: 'Take the mountain road',
    updatedAt: 100,
  }).value;
  assert.deepEqual(validatePlanningDataset({
    items: [root, firstQuest, secondQuest, branch, firstNested, secondNested],
    flowLinks: [option],
  }), []);
  const crossCanvas = {
    ...option,
    id: 'flow-cross-canvas',
    sourceId: firstNested.id,
    targetId: secondNested.id,
    kind: 'continues',
  };
  const invalidOption = {
    ...option,
    id: 'flow-invalid-option',
    sourceId: firstQuest.id,
    targetId: secondQuest.id,
  };
  const back = {
    ...option,
    id: 'flow-back',
    sourceId: firstQuest.id,
    targetId: branch.id,
    kind: 'continues',
  };
  const errors = validatePlanningDataset({
    items: [root, firstQuest, secondQuest, branch, firstNested, secondNested],
    flowLinks: [option, crossCanvas, invalidOption, back],
  });
  assert.ok(errors.some(error => error.code === 'PLANNING_FLOW_SCOPE_MISMATCH'));
  assert.ok(errors.some(error => error.code === 'PLANNING_FLOW_OPTION_SOURCE_INVALID'));
  assert.ok(errors.some(error => error.code === 'PLANNING_FLOW_CYCLE'));
});

test('named references retain quantities and validate campaign records', () => {
  const reference = normalizePlanningReference({
    id: 'reference-goblins',
    schemaVersion: 3,
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
    schemaVersion: 3,
    anchor: { scope: 'item', itemId: 'plotline-dragons' },
    kind: 'world',
    title: 'The town becomes friendly',
    body: '',
    updatedAt: 100,
  }).value;
  const note = normalizeDmNote({
    id: 'note-angry-noble',
    schemaVersion: 3,
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
