import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { createImportReviewPreview } from '../import-review-preview.js';
import { createStoryPlanner } from '../story-planner.js';
import {
  itemAncestors,
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

test('campaign import preview reuses the real planner projection, canvas, and node styles', () => {
  const { host } = fixture();
  const preview = createImportReviewPreview(host);
  const plotline = planningItem();
  const quest = planningItem({
    id: 'quest-earthquake',
    kind: 'quest',
    parentId: plotline.id,
    title: 'Investigate the Earthquake',
  });
  const branch = planningItem({
    id: 'branch-route',
    kind: 'branch',
    branchType: 'decision',
    parentId: plotline.id,
    title: 'Choose a route',
  });
  const view = preview.project({
    document: {
      format: 'dm-tools-planning',
      schemaVersion: 2,
      items: [plotline, quest, branch],
      flowLinks: [{
        id: 'flow-choice',
        sourceId: quest.id,
        targetId: branch.id,
        kind: 'continues',
        label: 'The trail forks',
      }],
      references: [],
      consequences: [],
      notes: [],
    },
  });
  const html = preview.render({ view, inspectorHtml: '<strong>Editable import</strong>' });

  assert.equal(view.scopeId, plotline.id);
  assert.deepEqual(view.projection.nodes.map(node => node.item.id).sort(), [
    branch.id,
    quest.id,
  ]);
  assert.match(html, /dmt-planner-workbench/);
  assert.match(html, /dmt-story-canvas/);
  assert.match(html, /data-kind="quest"/);
  assert.match(html, /data-kind="branch"/);
  assert.match(html, /dmt-story-edge/);
  assert.match(html, /Editable import/);
  const campaign = preview.project({
    document: view.data,
    scopeId: '',
  });
  assert.deepEqual(campaign.projection.nodes.map(node => node.item.id), [plotline.id]);
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
