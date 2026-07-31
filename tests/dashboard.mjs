import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { createDashboard } from '../dashboard.js';

const en = JSON.parse(await readFile(new URL('../locales/en.json', import.meta.url), 'utf8'));
const cs = JSON.parse(await readFile(new URL('../locales/cs.json', import.meta.url), 'utf8'));

function interpolate(value, params = {}) {
  return String(value).replace(
    /\{([A-Za-z0-9_]+)\}/g,
    (_match, key) => String(params[key] ?? `{${key}}`),
  );
}

function fixture({
  items = [],
  locale = 'en',
  isDM = true,
  providers = [{ id: 'planning-json' }],
  collectionError = null,
} = {}) {
  const state = { items, isDM, announcements: [], rerenders: 0 };
  const catalog = locale === 'cs' ? cs : en;
  const host = {
    h: {
      esc: value => String(value ?? '').replace(/[&<>"']/g, character => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
      }[character])),
    },
    role: { isDM: () => state.isDM },
    i18n: {
      t: (key, params) => interpolate(catalog[key] ?? en[key] ?? key, params),
      plural: (key, n, params) => {
        const forms = catalog[key] ?? en[key];
        const bucket = new Intl.PluralRules(locale).select(n);
        return interpolate(forms[bucket] ?? forms.other, { ...params, n });
      },
      formatNumber: value => String(value),
    },
    imports: { listProviders: async () => ({ providers }) },
    store: {
      collection(name) {
        assert.ok(name === 'planning_items' || name === 'dm_notes');
        return {
          list() {
            if (collectionError) throw collectionError;
            return name === 'planning_items' ? state.items.slice() : [];
          },
        };
      },
    },
    ui: {
      rerender: () => { state.rerenders++; },
      announce: message => state.announcements.push(message),
    },
  };
  return { dashboard: createDashboard(host), state };
}

const items = [
  {
    id: 'quest',
    schemaVersion: 2,
    title: 'Recover the Sigil',
    summary: 'Court investigation',
    kind: 'quest',
    parentId: 'plotline',
    updatedAt: 100,
  },
  {
    id: 'ambush',
    schemaVersion: 2,
    title: 'Road Ambush',
    summary: 'Bandits on the north road',
    kind: 'event',
    eventType: 'encounter',
    parentId: null,
    updatedAt: 200,
  },
];

test('dashboard exposes the unified planner and import workflows with planning counts', async () => {
  const value = fixture({ items });
  assert.match(value.dashboard.render(), /aria-busy="true"/);
  await value.dashboard.initialize();
  const html = value.dashboard.render();
  assert.match(html, /Campaign Planning/);
  assert.match(html, /href="#\/dm-plans"/);
  assert.match(html, /href="#\/dm-import"/);
  assert.doesNotMatch(html, /dm-scenarios/);
  assert.match(html, /Recover the Sigil/);
  assert.match(html, /Road Ambush/);
  assert.match(html, /<div class="codex-tile-value">2<\/div>/);
});

test('dashboard reads live data, announces changes, and escapes planning text', async () => {
  const value = fixture({ items: [items[0]] });
  await value.dashboard.initialize();
  value.dashboard.render();
  value.state.items.push({
    ...items[1],
    title: '<img src=x onerror=alert(1)>',
    summary: '<script>alert(1)</script>',
  });
  const html = value.dashboard.render();
  assert.match(html, /&lt;img/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<img|<script>/);
  assert.deepEqual(value.state.announcements, [
    'Campaign planning updated. 2 items are available.',
  ]);
});

test('missing capabilities and collection failures keep recovery routes usable', async () => {
  const missing = fixture({ providers: [] });
  await missing.dashboard.initialize();
  const missingHtml = missing.dashboard.render();
  assert.match(missingHtml, /planning import provider is unavailable/i);
  assert.match(missingHtml, /href="#\/dm-plans"/);

  const error = new Error('sensitive detail');
  error.code = 'COLLECTION_UNAVAILABLE';
  const failed = fixture({ collectionError: error });
  await failed.dashboard.initialize();
  const failedHtml = failed.dashboard.render();
  assert.match(failedHtml, /Planning data is unavailable/);
  assert.doesNotMatch(failedHtml, /COLLECTION_UNAVAILABLE/);
  assert.doesNotMatch(failedHtml, /sensitive detail/);
});

test('Czech rendering, role denial, and disposal clear dashboard state', async () => {
  const value = fixture({ locale: 'cs', items });
  await value.dashboard.initialize();
  assert.match(value.dashboard.render(), /Plánování kampaně/);
  assert.equal(value.dashboard.getState().hasSignature, true);
  value.state.isDM = false;
  value.dashboard.leave();
  assert.match(value.dashboard.render(), /účinné roli PJ/);
  assert.equal(value.dashboard.getState().hasSignature, false);
  value.dashboard.dispose();
  assert.equal(value.dashboard.getState().disposed, true);
});
