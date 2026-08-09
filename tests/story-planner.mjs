import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { createStoryPlanner } from '../story-planner.js';
import { STORY_PLANNER_STYLES } from '../story-planner-styles.js';
import {
  itemAncestors,
  itemSubtreeIds,
  normalizePositions,
  orthogonalPath,
  projectScope,
} from '../story-planner-model.js';

const en = JSON.parse(await readFile(new URL('../locales/en.json', import.meta.url), 'utf8'));

class FakeFormData {
  constructor(form) {
    this.fields = form.fields;
  }

  get(name) {
    const value = this.fields[name];
    return Array.isArray(value) ? value[0] ?? null : value ?? null;
  }

  getAll(name) {
    const value = this.fields[name];
    if (value === undefined) return [];
    return Array.isArray(value) ? value : [value];
  }
}

function interpolate(value, params = {}) {
  return String(value).replace(
    /\{([A-Za-z0-9_]+)\}/g,
    (_match, key) => String(params[key] ?? `{${key}}`),
  );
}

function planningItem(overrides = {}) {
  return {
    id: 'plotline-dragons',
    schemaVersion: 2,
    kind: 'plotline',
    parentId: null,
    title: 'The Waking Dragons',
    summary: 'Ancient dragons stir.',
    body: '',
    objective: '',
    setup: '',
    resolution: '',
    tags: [],
    updatedAt: 100,
    ...overrides,
  };
}

test('scope projection shows only direct children and rolls deeper flow to their owner', () => {
  const plotline = planningItem();
  const quest = planningItem({
    id: 'quest-earthquake',
    kind: 'quest',
    parentId: plotline.id,
    title: 'Investigate the Earthquake',
  });
  const nested = planningItem({
    id: 'event-cultists',
    kind: 'event',
    eventType: 'encounter',
    parentId: quest.id,
    title: 'Cultist Ambush',
  });
  const decision = planningItem({
    id: 'branch-route',
    kind: 'branch',
    branchType: 'decision',
    parentId: plotline.id,
    title: 'Choose a route',
  });
  const projected = projectScope({
    scopeId: plotline.id,
    items: [plotline, quest, nested, decision],
    flowLinks: [{
      id: 'flow-nested',
      sourceId: nested.id,
      targetId: decision.id,
      kind: 'continues',
      label: '',
    }],
    notes: [{
      id: 'note',
      anchorIds: [quest.id],
    }],
  });
  assert.deepEqual(projected.nodes.map(node => node.item.id).sort(), [
    'branch-route',
    'quest-earthquake',
  ]);
  assert.equal(projected.flowLinks[0].sourceId, quest.id);
  assert.equal(projected.flowLinks[0].rolledUp, true);
  assert.equal(projected.nodes.find(node => node.item.id === quest.id).noteCount, 1);
  assert.deepEqual(itemAncestors(nested.id, [plotline, quest, nested]), [
    plotline,
    quest,
    nested,
  ]);
});

test('positions snap to the planner grid and orthogonal paths remain deterministic', () => {
  assert.deepEqual(normalizePositions({
    alpha: { x: 25, y: 71 },
    invalid: { x: Infinity, y: 0 },
  }), {
    alpha: { x: 24, y: 72 },
  });
  assert.equal(
    orthogonalPath(
      { x: 0, y: 0, width: 240, height: 116 },
      { x: 500, y: 180, width: 240, height: 116 },
    ),
    'M 240 58 H 358 Q 370 58 370 70 V 226 Q 370 238 382 238 H 500',
  );
});

test('item subtrees include every nested descendant once', () => {
  const plotline = planningItem();
  const quest = planningItem({ id: 'quest', kind: 'quest', parentId: plotline.id });
  const event = planningItem({
    id: 'event',
    kind: 'event',
    eventType: 'story',
    parentId: quest.id,
  });
  assert.deepEqual(itemSubtreeIds(plotline.id, [plotline, quest, event]), [
    plotline.id,
    quest.id,
    event.id,
  ]);
});

test('desktop canvas height is independent from inspector content', () => {
  assert.match(
    STORY_PLANNER_STYLES,
    /\.dmt-planner-workbench\{[^}]*height:max\(42rem,calc\(72vh \+ 3rem\)\)/,
  );
  assert.match(
    STORY_PLANNER_STYLES,
    /\.dmt-planner-stage\{[^}]*grid-template-rows:auto minmax\(0,1fr\)[^}]*min-height:0/,
  );
  assert.match(
    STORY_PLANNER_STYLES,
    /\.dmt-planner-inspector\{min-height:0;overflow:auto/,
  );
  assert.match(
    STORY_PLANNER_STYLES,
    /@media\(max-width:1100px\)\{[\s\S]*?\.dmt-planner-workbench\{[^}]*height:auto/,
  );
});

function fixture() {
  const stores = Object.fromEntries([
    'planning_items',
    'planning_flow_links',
    'planning_references',
    'planning_consequences',
    'dm_notes',
    'planning_views',
  ].map(name => [name, new Map()]));
  stores.planning_items.set('plotline-dragons', {
    schemaVersion: 2,
    kind: 'plotline',
    parentId: null,
    title: 'The Waking Dragons',
    summary: 'Ancient dragons stir.',
    body: '',
    objective: '',
    setup: '',
    resolution: '',
    tags: [],
    updatedAt: 100,
  });
  let sequence = 0;
  const scheduled = [];
  const announcements = [];
  const host = {
    h: {
      esc: value => String(value ?? '').replace(/[&<>"']/g, character => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
      }[character])),
      dataAction: () => '',
      dataOn: () => '',
      breadcrumb: values => values.map(value => value.label).join(' / '),
      renderMarkdown: value => String(value),
    },
    action: name => `dm-tools:${name}`,
    i18n: {
      t: (key, params) => interpolate(en[key] ?? key, params),
    },
    role: { isDM: () => true },
    store: {
      generateId(prefix) {
        sequence++;
        return `${String(prefix).toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 80)}-${sequence}`;
      },
      collection(name) {
        const values = stores[name];
        if (!values) throw new Error(`unexpected collection ${name}`);
        return {
          list: () => [...values].map(([id, value]) => ({ id, ...structuredClone(value) })),
          get: id => values.has(id) ? { id, ...structuredClone(values.get(id)) } : null,
          async save(record) {
            const value = structuredClone(record);
            delete value.id;
            values.set(record.id, value);
            return record;
          },
          async remove(id) {
            values.delete(id);
          },
        };
      },
      async transaction(names, callback) {
        const allowed = new Set(names);
        return callback({
          collection(name) {
            if (!allowed.has(name)) throw new Error(`unexpected transaction collection ${name}`);
            const values = stores[name];
            return {
              remove: id => values.delete(id),
              put(record) {
                const stored = structuredClone(record);
                delete stored.id;
                values.set(record.id, stored);
                return record;
              },
            };
          },
        });
      },
      getCharacters: () => [{ id: 'mira', name: 'Mira Vel' }],
      getFactions: () => ({}),
      getLocations: () => [],
      getMysteries: () => [],
      getCollection: () => [],
      getEvents: () => [],
    },
    ui: {
      rerender() {},
      announce: message => announcements.push(message),
      toast() {},
    },
  };
  const planner = createStoryPlanner(host, {
    schedule(callback) {
      scheduled.push(callback);
      return scheduled.length - 1;
    },
    cancelSchedule(token) {
      scheduled[token] = null;
    },
  });
  return { planner, stores, announcements, host };
}

function event(fields) {
  return {
    preventDefault() {},
    currentTarget: { fields },
  };
}

test('unified route renders one canvas and manually creates a nested quest', async t => {
  const original = globalThis.FormData;
  globalThis.FormData = FakeFormData;
  t.after(() => { globalThis.FormData = original; });
  const value = fixture();
  const rootHtml = value.planner.render();
  assert.match(rootHtml, /Story Planner/);
  assert.match(rootHtml, /dmt-story-canvas/);
  assert.doesNotMatch(rootHtml, /Planning Graph|Folder|Named sections/);

  value.planner.render('plotline-dragons', ['dm-plans', 'plotline-dragons']);
  value.planner.createItem('quest');
  const draft = value.planner.getState().draft.item;
  await value.planner.saveItem(event({
    id: draft.id,
    kind: 'quest',
    parentId: 'plotline-dragons',
    title: 'Investigate the Earthquake',
    summary: 'Find the source.',
    objective: 'Reach the ruined observatory.',
    body: '',
    setup: '',
    resolution: '',
    tags: 'dragon, mystery',
  }));
  assert.equal(value.stores.planning_items.get(draft.id).parentId, 'plotline-dragons');
  assert.equal(value.stores.planning_items.get(draft.id).kind, 'quest');
  assert.deepEqual(value.stores.planning_items.get(draft.id).tags, ['dragon', 'mystery']);
});

test('manual flows and named references can cross nested canvas scopes', async t => {
  const original = globalThis.FormData;
  globalThis.FormData = FakeFormData;
  t.after(() => { globalThis.FormData = original; });
  const value = fixture();
  value.stores.planning_items.set('branch-choice', {
    schemaVersion: 2,
    kind: 'branch',
    branchType: 'decision',
    parentId: null,
    title: 'Choose a route',
    summary: '',
    body: '',
    objective: '',
    setup: '',
    resolution: '',
    tags: [],
    updatedAt: 100,
  });
  value.stores.planning_items.set('event-tremor', {
    schemaVersion: 2,
    kind: 'event',
    eventType: 'story',
    parentId: 'plotline-dragons',
    title: 'The earth trembles',
    summary: '',
    body: '',
    objective: '',
    setup: '',
    resolution: '',
    tags: [],
    updatedAt: 100,
  });
  await value.planner.saveFlow({
    preventDefault() {},
    currentTarget: {
      fields: {
        targetId: 'plotline-dragons',
        kind: 'option',
        label: 'Wake the dragon',
      },
    },
  }, 'branch-choice');
  const [flow] = value.stores.planning_flow_links.values();
  assert.equal(flow.kind, 'option');
  assert.equal(flow.label, 'Wake the dragon');

  await value.planner.saveFlow(event({
    targetId: 'branch-choice',
    kind: 'continues',
    label: 'Forces a choice',
  }), 'event-tremor');
  assert.equal(value.stores.planning_flow_links.size, 2);

  await value.planner.savePlanningReference(event({
    targetId: 'event-tremor',
    name: 'Foreshadows the tremor',
    relation: 'reveals',
    quantity: '1',
    notes: '',
  }), 'branch-choice');
  const [reference] = value.stores.planning_references.values();
  assert.deepEqual(reference.target, { scope: 'planning', itemId: 'event-tremor' });

  await value.planner.saveConsequence(event({
    anchor: 'item:branch-choice',
    kind: 'world',
    title: 'The city closes its gates',
    body: '',
    target: 'planning:event-tremor',
  }), 'branch-choice');
  const [consequence] = value.stores.planning_consequences.values();
  assert.deepEqual(consequence.target, { scope: 'planning', itemId: 'event-tremor' });
});

test('deleting a populated plotline confirms and removes only its planning subtree', async t => {
  const originalWindow = globalThis.window;
  let confirmed = false;
  let confirmation = '';
  globalThis.window = {
    location: { hash: '' },
    confirm(message) {
      confirmation = message;
      return confirmed;
    },
  };
  t.after(() => { globalThis.window = originalWindow; });
  const value = fixture();
  const add = (store, record) => {
    const stored = structuredClone(record);
    delete stored.id;
    value.stores[store].set(record.id, stored);
  };
  add('planning_items', planningItem({
    id: 'quest-child',
    kind: 'quest',
    parentId: 'plotline-dragons',
    title: 'Nested quest',
  }));
  add('planning_items', planningItem({
    id: 'event-grandchild',
    kind: 'event',
    eventType: 'story',
    parentId: 'quest-child',
    title: 'Nested event',
  }));
  add('planning_items', planningItem({
    id: 'plotline-survivor',
    title: 'Unrelated plotline',
  }));
  add('planning_flow_links', {
    id: 'flow-out',
    schemaVersion: 2,
    sourceId: 'event-grandchild',
    targetId: 'plotline-survivor',
    kind: 'continues',
    label: '',
    updatedAt: 100,
  });
  add('planning_references', {
    id: 'reference-out',
    schemaVersion: 2,
    itemId: 'plotline-survivor',
    name: 'Points into deleted plan',
    relation: 'related',
    target: { scope: 'planning', itemId: 'event-grandchild' },
    quantity: 1,
    notes: '',
    updatedAt: 100,
  });
  add('planning_consequences', {
    id: 'consequence-out',
    schemaVersion: 2,
    anchor: { scope: 'item', itemId: 'plotline-survivor' },
    kind: 'world',
    title: 'Points into deleted plan',
    body: '',
    target: { scope: 'planning', itemId: 'quest-child' },
    updatedAt: 100,
  });
  add('dm_notes', {
    id: 'shared-note',
    schemaVersion: 2,
    title: 'Shared note',
    body: '',
    anchorIds: ['event-grandchild', 'plotline-survivor'],
    updatedAt: 100,
  });
  add('planning_views', {
    id: 'scope-plotline-dragons',
    schemaVersion: 2,
    scopeId: 'plotline-dragons',
    positions: { 'quest-child': { x: 72, y: 72 } },
    updatedAt: 100,
  });
  add('planning_views', {
    id: 'scope-campaign',
    schemaVersion: 2,
    scopeId: null,
    positions: {
      'plotline-dragons': { x: 72, y: 72 },
      'plotline-survivor': { x: 384, y: 72 },
    },
    updatedAt: 100,
  });

  await value.planner.deleteItem('plotline-dragons');
  assert.match(confirmation, /nested planning items \(2\)/);
  assert.equal(value.stores.planning_items.has('plotline-dragons'), true);

  confirmed = true;
  await value.planner.deleteItem('plotline-dragons');
  assert.deepEqual([...value.stores.planning_items.keys()], ['plotline-survivor']);
  assert.equal(value.stores.planning_flow_links.size, 0);
  assert.equal(value.stores.planning_references.size, 0);
  assert.equal(value.stores.planning_consequences.size, 0);
  assert.deepEqual(value.stores.dm_notes.get('shared-note').anchorIds, ['plotline-survivor']);
  assert.equal(value.stores.planning_views.has('scope-plotline-dragons'), false);
  assert.deepEqual(value.stores.planning_views.get('scope-campaign').positions, {
    'plotline-survivor': { x: 384, y: 72 },
  });
});
