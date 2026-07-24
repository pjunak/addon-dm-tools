import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { createDashboard } from '../dashboard.js';

const en = JSON.parse(await readFile(new URL('../locales/en.json', import.meta.url), 'utf8'));
const cs = JSON.parse(await readFile(new URL('../locales/cs.json', import.meta.url), 'utf8'));

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function interpolate(value, params = {}) {
  return String(value).replace(/\{([A-Za-z0-9_]+)\}/g, (_match, key) => String(params[key] ?? `{${key}}`));
}

function plural(catalog, locale, key, n, params = {}) {
  const forms = catalog[key] ?? en[key];
  const bucket = new Intl.PluralRules(locale).select(n);
  return interpolate(forms?.[bucket] ?? forms?.other ?? key, { ...params, n });
}

function fixture({
  records = [],
  locale = 'en',
  isDM = true,
  providers = [{ id: 'scenario-json' }],
  providerError = null,
  providerPromise = null,
  graphAvailable = true,
  collectionError = null,
} = {}) {
  const state = {
    records,
    isDM,
    listCalls: 0,
    rerenders: 0,
    announcements: [],
  };
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
      plural: (key, n, params) => plural(catalog, locale, key, n, params),
      formatNumber: value => new Intl.NumberFormat(locale).format(value),
    },
    imports: {
      async listProviders() {
        if (providerPromise) return providerPromise;
        if (providerError) throw providerError;
        return { providers };
      },
    },
    graphs: { available: () => graphAvailable },
    store: {
      collection(name) {
        assert.equal(name, 'scenarios');
        return {
          list() {
            state.listCalls++;
            if (collectionError) throw collectionError;
            return state.records.slice();
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

const scenarios = [
  {
    id: 'opening',
    name: 'Opening scene',
    summary: 'Meet at the inn.',
    status: 'planned',
    updatedAt: '2026-07-22T10:00:00.000Z',
  },
  {
    id: 'ambush',
    name: 'Road ambush',
    summary: 'Bandits on the north road.',
    status: 'active',
    updatedAt: '2026-07-23T10:00:00.000Z',
  },
  {
    id: 'arrival',
    name: 'Arrival',
    summary: 'The party reached town.',
    status: 'completed',
    updatedAt: '2026-07-21T10:00:00.000Z',
  },
];

test('loading resolves to an empty dashboard with working Import Center and graph links', async () => {
  const gate = deferred();
  const value = fixture({ providerPromise: gate.promise });
  const initialization = value.dashboard.initialize();
  const loading = value.dashboard.render();
  assert.match(loading, /aria-busy="true"/);
  assert.match(loading, /Checking scenario and workflow capabilities/);

  gate.resolve({ providers: [{ id: 'scenario-json' }] });
  await initialization;
  const html = value.dashboard.render();
  assert.match(html, /Scenario Dashboard/);
  assert.match(html, /No scenarios are stored yet/);
  assert.match(html, /href="#\/dm-import"/);
  assert.match(html, /href="#\/dm-scenarios"/);
  assert.match(html, /tabindex="-1"/);
  assert.match(html, /aria-label="DM Tools workflows"/);
});

test('populated scenarios render status counts, current records, and escaped hostile text', async () => {
  const hostile = '<img src=x onerror=alert(1)>';
  const value = fixture({
    records: [
      ...scenarios,
      {
        id: 'hostile',
        name: hostile,
        summary: '<script>alert(1)</script>',
        status: 'planned',
        updatedAt: '2026-07-24T10:00:00.000Z',
      },
    ],
  });
  await value.dashboard.initialize();
  const html = value.dashboard.render();
  assert.match(html, /<div class="codex-tile-value">4<\/div>/);
  assert.match(html, /Road ambush/);
  assert.doesNotMatch(html, /<img|<script>/);
  assert.match(html, /&lt;img/);
  assert.match(html, /&lt;script&gt;/);
});

test('live collection reads update counts and announce through the host live region', async () => {
  const value = fixture({ records: [scenarios[0]] });
  await value.dashboard.initialize();
  value.dashboard.render();
  value.state.records.push(scenarios[1]);
  const html = value.dashboard.render();
  assert.match(html, /<div class="codex-tile-value">2<\/div>/);
  assert.deepEqual(value.state.announcements, [
    'Scenario dashboard updated. 2 scenarios are available.',
  ]);
  assert.equal(value.state.listCalls, 2);

  const singular = fixture({ records: [] });
  await singular.dashboard.initialize();
  singular.dashboard.render();
  singular.state.records.push(scenarios[0]);
  singular.dashboard.render();
  assert.deepEqual(singular.state.announcements, [
    'Scenario dashboard updated. 1 scenario is available.',
  ]);
});

test('missing import and graph capabilities remain useful without dead workflow routes', async () => {
  const value = fixture({
    records: scenarios,
    providers: [],
    graphAvailable: false,
  });
  await value.dashboard.initialize();
  const html = value.dashboard.render();
  assert.match(html, /scenario import provider is unavailable/i);
  assert.match(html, /Interactive graph rendering is unavailable/);
  assert.match(html, /href="#\/dm-import"/);
  assert.match(html, /href="#\/dm-scenarios"/);
});

test('provider and collection failures expose bounded recovery states', async () => {
  const providerError = new Error('sensitive provider detail');
  providerError.code = 'IMPORT_PROVIDER_FAILED';
  const provider = fixture({ providerError, records: scenarios });
  await provider.dashboard.initialize();
  assert.match(provider.dashboard.render(), /IMPORT_PROVIDER_FAILED/);
  assert.doesNotMatch(provider.dashboard.render(), /sensitive provider detail/);

  const collectionError = new Error('<script>bad collection</script>');
  collectionError.code = 'COLLECTION_UNAVAILABLE';
  const collection = fixture({ collectionError });
  await collection.dashboard.initialize();
  const html = collection.dashboard.render();
  assert.match(html, /Scenario data is unavailable/);
  assert.match(html, /COLLECTION_UNAVAILABLE/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /href="#\/dm-import"/);
});

test('Czech rendering, effective-player denial, return to DM, and disposal clear state', async () => {
  const value = fixture({ locale: 'cs', records: scenarios });
  await value.dashboard.initialize();
  assert.match(value.dashboard.render(), /Přehled scénářů/);
  assert.equal(value.dashboard.getState().hasScenarioSignature, true);

  value.state.isDM = false;
  value.dashboard.leave();
  const callsBeforeDeniedRender = value.state.listCalls;
  assert.match(value.dashboard.render(), /účinné roli PJ/);
  assert.equal(value.state.listCalls, callsBeforeDeniedRender);
  assert.equal(value.dashboard.getState().hasScenarioSignature, false);

  value.state.isDM = true;
  await value.dashboard.initialize();
  assert.match(value.dashboard.render(), /Road ambush/);
  assert.ok(value.state.listCalls > callsBeforeDeniedRender);

  value.dashboard.dispose();
  assert.equal(value.dashboard.getState().disposed, true);
  assert.equal(value.dashboard.getState().hasScenarioSignature, false);
  assert.match(value.dashboard.render(), /účinné roli PJ/);
});

test('late provider completion after disposal cannot rerender or restore state', async () => {
  const gate = deferred();
  const value = fixture({ providerPromise: gate.promise });
  const initialization = value.dashboard.initialize();
  value.dashboard.dispose();
  gate.resolve({ providers: [{ id: 'scenario-json' }] });
  await initialization;
  assert.equal(value.state.rerenders, 0);
  assert.equal(value.dashboard.getState().providerStatus, 'loading');
});
