import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

import {
  createScenarioGraphPage,
  scenariosToGraph,
} from '../scenario-graph.js';

const en = JSON.parse(await readFile(new URL('../locales/en.json', import.meta.url), 'utf8'));
const cs = JSON.parse(await readFile(new URL('../locales/cs.json', import.meta.url), 'utf8'));

function interpolate(value, params = {}) {
  return String(value).replace(/\{([A-Za-z0-9_]+)\}/g, (_match, key) => String(params[key] ?? `{${key}}`));
}

function fixture({
  records = [],
  locale = 'en',
  isDM = true,
  available = true,
  mountError = null,
} = {}) {
  const catalog = locale === 'cs' ? cs : en;
  const scheduled = [];
  const calls = [];
  const announcements = [];
  const container = { id: 'dm-scenario-graph' };
  let eventHandler = null;
  const host = {
    h: {
      esc: value => String(value ?? '').replace(/[&<>"']/g, char => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
      }[char])),
      dataAction: (name, ...args) => ` data-action="${name}" data-args='${JSON.stringify(args)}'`,
      breadcrumb: () => '',
    },
    action: name => `dm-tools:${name}`,
    i18n: {
      t: (key, params) => interpolate(catalog[key] ?? en[key] ?? key, params),
    },
    role: { isDM: () => isDM },
    store: {
      collection: name => {
        assert.equal(name, 'scenarios');
        return { list: () => records.slice() };
      },
    },
    ui: {
      rerender: () => calls.push(['rerender']),
      announce: message => announcements.push(message),
    },
    graphs: {
      available: () => available,
      async mount(target, spec) {
        calls.push(['mount', target, spec]);
        if (mountError) throw mountError;
        return {
          focus(ids, options) { calls.push(['focus', ids, options]); },
          fit(ids, options) { calls.push(['fit', ids, options]); },
          on(event, handler) {
            calls.push(['on', event]);
            eventHandler = handler;
            return () => { eventHandler = null; };
          },
          destroy() { calls.push(['destroy']); },
        };
      },
    },
  };
  const page = createScenarioGraphPage(host, {
    schedule: callback => {
      scheduled.push(callback);
      return scheduled.length - 1;
    },
    cancelSchedule: token => { scheduled[token] = null; },
    findContainer: () => container,
  });
  return {
    page,
    calls,
    announcements,
    scheduled,
    container,
    async runScheduled() {
      for (const callback of scheduled.splice(0)) callback?.();
      await Promise.resolve();
      await Promise.resolve();
    },
    emitSelect(id) { eventHandler?.({ nodeId: id }); },
  };
}

const scenarios = [
  {
    id: 'completed',
    name: 'Last',
    summary: 'Done',
    status: 'completed',
    tags: [],
    updatedAt: '2026-01-03T00:00:00.000Z',
  },
  {
    id: 'active',
    name: 'Middle',
    summary: 'Now',
    status: 'active',
    tags: [],
    updatedAt: '2026-01-02T00:00:00.000Z',
  },
  {
    id: 'planned',
    name: 'First',
    summary: 'Next',
    status: 'planned',
    tags: [],
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
];

test('scenario mapping is deterministic, node-only, and does not invent relationships', () => {
  const mapped = scenariosToGraph([scenarios[0], scenarios[2], scenarios[1]]);
  assert.deepEqual(mapped, {
    nodes: [
      { id: 'planned', label: 'First', kind: 'planned' },
      { id: 'active', label: 'Middle', kind: 'active' },
      { id: 'completed', label: 'Last', kind: 'completed' },
    ],
    edges: [],
  });
});

test('page exposes accessible loading, mounts through the facade, and supports focus, fit, and events', async () => {
  const value = fixture({ records: scenarios });
  const html = value.page.render();
  assert.match(html, /Scenario Graph/);
  assert.match(html, /aria-busy="true"/);
  assert.match(html, /codex-graph-canvas/);
  await value.runScheduled();
  const mount = value.calls.find(call => call[0] === 'mount');
  assert.equal(mount[1], value.container);
  assert.equal(mount[2].layout, 'grid');
  assert.deepEqual(mount[2].edges, []);
  assert.equal(value.page.getState().mounted, true);

  value.page.focus('active');
  value.page.fit();
  assert.ok(value.calls.some(call => call[0] === 'focus' && call[1] === 'active'));
  assert.ok(value.calls.some(call => call[0] === 'fit'));
  value.emitSelect('active');
  assert.deepEqual(value.announcements, ['Selected scenario: Middle']);
});

test('empty, unavailable, adapter-error, Czech, and effective-player states remain useful', async () => {
  assert.match(fixture().page.render(), /No scenarios to graph/);
  assert.match(fixture({ records: scenarios, available: false }).page.render(), /Graph rendering is unavailable/);
  assert.match(fixture({ records: scenarios, isDM: false }).page.render(), /effective DM/);

  const unavailable = fixture({ records: scenarios, locale: 'cs', available: false });
  assert.match(unavailable.page.render(), /Vykreslení grafu není dostupné/);

  const error = new Error('broken adapter');
  error.code = 'GRAPH_ADAPTER_FAILED';
  const failed = fixture({ records: scenarios, mountError: error });
  failed.page.render();
  await failed.runScheduled();
  assert.equal(failed.page.getState().state, 'error');
  assert.match(failed.page.render(), /could not be rendered/);
  assert.match(failed.page.render(), /GRAPH_ADAPTER_FAILED/);
});

test('hostile scenario text is escaped and never becomes graph-page HTML', () => {
  const hostile = '<img src=x onerror=alert(1)>';
  const value = fixture({
    records: [{
      id: 'hostile',
      name: hostile,
      summary: '<script>alert(1)</script>',
      status: 'planned',
    }],
  });
  const html = value.page.render();
  assert.doesNotMatch(html, /<img|<script>/);
  assert.match(html, /&lt;img/);
  assert.match(html, /&lt;script&gt;/);
});

test('leaving before mount and repeated render dispose scheduled and mounted work without leaks', async () => {
  const beforeMount = fixture({ records: scenarios });
  beforeMount.page.render();
  beforeMount.page.leave();
  await beforeMount.runScheduled();
  assert.equal(beforeMount.calls.some(call => call[0] === 'mount'), false);

  const mounted = fixture({ records: scenarios });
  mounted.page.render();
  await mounted.runScheduled();
  mounted.page.render();
  assert.equal(mounted.calls.filter(call => call[0] === 'destroy').length, 1);
  await mounted.runScheduled();
  await mounted.page.dispose();
  assert.equal(mounted.calls.filter(call => call[0] === 'destroy').length, 2);
});
