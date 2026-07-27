import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

import {
  createPlanningGraphPage,
  planningToGraph,
} from '../planning-graph.js';

const en = JSON.parse(await readFile(new URL('../locales/en.json', import.meta.url), 'utf8'));

const quest = {
  id: 'quest-sigil',
  kind: 'quest',
  title: 'Recover the Sigil',
  summary: 'Court investigation',
  sections: [
    { id: 'audience', title: 'Audience with the Duke', body: '' },
  ],
};
const npcLink = {
  id: 'link-mira-audience',
  name: 'Requests a discreet investigation',
  type: 'involves',
  source: { scope: 'core', collection: 'characters', id: 'mira' },
  target: { scope: 'planning', itemId: 'quest-sigil', sectionId: 'audience' },
};
const core = { characters: [{ id: 'mira', name: 'Mira Vel' }] };

function interpolate(value, params = {}) {
  return String(value).replace(
    /\{([A-Za-z0-9_]+)\}/g,
    (_match, key) => String(params[key] ?? `{${key}}`),
  );
}

test('named NPC link rolls up while collapsed and targets the exact expanded quest section', () => {
  const collapsed = planningToGraph({
    items: [quest],
    links: [npcLink],
    core,
  });
  assert.equal(collapsed.nodes.length, 2);
  assert.equal(collapsed.edges.length, 1);
  assert.equal(collapsed.edges[0].label, 'Requests a discreet investigation');
  const questNode = collapsed.nodes.find(node => node.label === 'Recover the Sigil');
  assert.equal(collapsed.edges[0].target, questNode.id);

  const expanded = planningToGraph({
    items: [quest],
    links: [npcLink],
    core,
    expandedItems: ['quest-sigil'],
    sectionLabel: 'section',
  });
  const sectionNode = expanded.nodes.find(node => node.label === 'Audience with the Duke');
  assert.ok(sectionNode);
  assert.equal(expanded.edges.find(edge => edge.label === npcLink.name).target, sectionNode.id);
  assert.ok(expanded.edges.some(edge => edge.label === 'section'));
});

function fixture({ available = true, isDM = true, mountError = null } = {}) {
  const scheduled = [];
  const calls = [];
  const handlers = new Map();
  const announcements = [];
  const views = new Map();
  const host = {
    h: {
      esc: value => String(value ?? '').replace(/[&<>"']/g, character => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
      }[character])),
      dataAction: (name, ...args) => ` data-action="${name}" data-args='${JSON.stringify(args)}'`,
      breadcrumb: () => '',
    },
    action: name => `dm-tools:${name}`,
    i18n: {
      t: (key, params) => interpolate(en[key] ?? key, params),
      plural: (key, n) => interpolate(en[key]?.[n === 1 ? 'one' : 'other'] ?? key, { n }),
    },
    role: { isDM: () => isDM },
    store: {
      collection(name) {
        if (name === 'planning_items') return { list: () => [quest] };
        if (name === 'planning_folders') return { list: () => [] };
        if (name === 'planning_links') return { list: () => [npcLink] };
        if (name === 'planning_views') return {
          list: () => [...views.values()],
          get: id => views.get(id),
          async save(record) { views.set(record.id, structuredClone(record)); },
          async remove(id) { views.delete(id); },
        };
        throw new Error(`unexpected collection ${name}`);
      },
      generateId: () => 'new-link',
      getCharacters: () => core.characters,
      getFactions: () => ({}),
      getLocations: () => [],
      getMysteries: () => [],
      getCollection: () => [],
      getEvents: () => [],
    },
    ui: {
      rerender: () => calls.push(['rerender']),
      announce: message => announcements.push(message),
      toast: message => calls.push(['toast', message]),
    },
    graphs: {
      available: () => available,
      status: () => ({
        features: ['node-position', 'node-drag'],
        layouts: ['preset'],
      }),
      async mount(container, spec) {
        calls.push(['mount', container, spec]);
        if (mountError) throw mountError;
        return {
          select: ids => calls.push(['select', ids]),
          focus: (ids, options) => calls.push(['focus', ids, options]),
          fit: (ids, options) => calls.push(['fit', ids, options]),
          on(event, handler) {
            handlers.set(event, handler);
            return () => handlers.delete(event);
          },
          destroy: () => calls.push(['destroy']),
        };
      },
    },
  };
  const page = createPlanningGraphPage(host, {
    schedule(callback) {
      scheduled.push(callback);
      return scheduled.length - 1;
    },
    cancelSchedule(token) {
      scheduled[token] = null;
    },
    findContainer: () => ({ id: 'dm-planning-graph' }),
  });
  return {
    page,
    calls,
    handlers,
    announcements,
    views,
    async runScheduled() {
      for (const callback of scheduled.splice(0)) callback?.();
      await Promise.resolve();
      await Promise.resolve();
    },
  };
}

test('page mounts through the facade, expands sections, and retains an accessible list', async () => {
  const value = fixture();
  const html = value.page.render();
  assert.match(html, /Planning Graph/);
  assert.match(html, /Requests a discreet investigation/);
  assert.match(html, /aria-busy="true"/);
  await value.runScheduled();
  const mounted = value.calls.find(call => call[0] === 'mount');
  assert.equal(mounted[2].layout, 'preset');
  assert.deepEqual(Object.keys(mounted[2].nodes[0].position).sort(), ['x', 'y']);
  assert.equal(mounted[2].edges[0].label, npcLink.name);
  value.handlers.get('move')({
    nodeId: mounted[2].nodes.find(node => node.label === quest.title).id,
    position: { x: 25, y: 75 },
  });
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(
    value.views.get('campaign-map').positions['planning:quest-sigil'],
    { x: 25, y: 75 },
  );
  value.page.toggleExpand('quest-sigil');
  assert.deepEqual(value.page.getState().expandedItems, ['quest-sigil']);
  assert.ok(value.calls.some(call => call[0] === 'rerender'));
});

test('unavailable, failed, denied, and disposal states remain bounded', async () => {
  assert.match(fixture({ available: false }).page.render(), /accessible list below remains fully usable/i);
  assert.match(fixture({ isDM: false }).page.render(), /effective DM/);

  const error = new Error('adapter detail');
  error.code = 'GRAPH_ADAPTER_FAILED';
  const failed = fixture({ mountError: error });
  failed.page.render();
  await failed.runScheduled();
  assert.equal(failed.page.getState().state, 'error');
  assert.doesNotMatch(failed.page.render(), /GRAPH_ADAPTER_FAILED/);
  assert.doesNotMatch(failed.page.render(), /adapter detail/);

  const disposed = fixture();
  disposed.page.render();
  disposed.page.leave();
  await disposed.runScheduled();
  assert.equal(disposed.calls.some(call => call[0] === 'mount'), false);
});
