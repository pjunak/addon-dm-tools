import test from 'node:test';
import assert from 'node:assert/strict';

import { createImportCenter } from '../import-center.js';

function interpolate(key, params = {}) {
  return String(key).replace(/\{([A-Za-z0-9_]+)\}/g, (_match, name) => String(params[name] ?? `{${name}}`));
}

function fixture(handles) {
  const rec = { rerenders: 0, announces: [], leaves: [], activations: [] };
  const host = {
    listServices: contract => {
      assert.equal(contract, 'codex.import-adapter');
      return handles;
    },
    role: { isDM: () => true },
    i18n: { t: interpolate },
    ui: {
      rerender: () => { rec.rerenders++; },
      announce: value => rec.announces.push(value),
    },
    h: {
      esc: value => String(value ?? '').replace(/[&<>"']/g, character => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
      }[character])),
      dataAction: (action, ...args) => ` data-action="${action}" data-args='${JSON.stringify(args)}'`,
      dataOn: (kind, action, ...args) => ` data-on-${kind}="${action}" data-args='${JSON.stringify(args)}'`,
      breadcrumb: crumbs => `<nav class="wiki-breadcrumb">${crumbs.map(crumb => crumb.label).join(' › ')}</nav>`,
    },
    action: name => `dm-tools:${name}`,
  };
  return { center: createImportCenter(host), rec, host };
}

function adapter(addonId, id, label, format, body = `<p>${id}</p>`) {
  const calls = { opened: [] };
  return {
    calls,
    provider: { addonId, contractVersion: '1.1.0' },
    api: {
      apiVersion: 1,
      descriptor: () => ({
        id,
        label,
        description: `${label} description`,
        formats: [format],
        links: [],
      }),
      activate: () => () => {},
      open: async file => { calls.opened.push(file); },
      render: () => body,
      leave: async () => {},
    },
  };
}

function jsonFile(format, name = 'import.json') {
  return {
    name,
    size: 100,
    text: async () => JSON.stringify({ format, schemaVersion: 1 }),
  };
}

test('Import Center presents one chooser and discovers document formats without known addon ids', () => {
  const { center } = fixture([
    adapter('core', 'campaign-bundle', 'Campaign', 'ttrpg-codex-campaign-bundle'),
    adapter('third-party-content', 'homebrew-items', 'Homebrew items', 'homebrew-items'),
  ]);
  const html = center.render();
  assert.match(html, /wiki-breadcrumb">breadcrumb\.tools › center\.title/);
  assert.match(html, /Campaign/);
  assert.match(html, /Homebrew items/);
  assert.match(html, /ttrpg-codex-campaign-bundle/);
  assert.equal(html.match(/type="file"/g)?.length, 1);
  assert.doesNotMatch(html, /<p>campaign-bundle<\/p>/);
  assert.doesNotMatch(html, /role="tablist"/);
});

test('the document format routes the untouched file to exactly one owner workflow', async () => {
  const campaign = adapter('core', 'campaign-bundle', 'Campaign', 'ttrpg-codex-campaign-bundle');
  const planning = adapter('dm-tools', 'planning-json', 'Planning JSON', 'dm-tools-planning');
  const { center } = fixture([campaign, planning]);
  center.render();
  const file = jsonFile('dm-tools-planning', 'planning.json');

  await center.selectFile({ files: [file] });

  assert.deepEqual(planning.calls.opened, [file]);
  assert.deepEqual(campaign.calls.opened, []);
  const html = center.render();
  assert.match(html, /planning\.json/);
  assert.match(html, /center\.handledBy/);
  assert.match(html, /<p>planning-json<\/p>/);
  assert.doesNotMatch(html, /<p>campaign-bundle<\/p>/);
  assert.doesNotMatch(html, /type="file"/);
});

test('malformed, missing, unknown, and ambiguously owned formats never open an adapter', async () => {
  const first = adapter('first', 'first-json', 'First', 'shared-format');
  const second = adapter('second', 'second-json', 'Second', 'shared-format');
  const { center } = fixture([first, second]);
  center.render();

  await center.selectFile({ files: [{ name: 'bad.json', text: async () => '{' }] });
  assert.match(center.render(), /center\.invalidJson/);
  await center.selectFile({ files: [{ name: 'missing.json', text: async () => '{}' }] });
  assert.match(center.render(), /center\.formatMissing/);
  await center.selectFile({ files: [jsonFile('not-installed')] });
  assert.match(center.render(), /center\.formatUnsupported/);
  await center.selectFile({ files: [jsonFile('shared-format')] });
  assert.match(center.render(), /center\.formatAmbiguous/);
  assert.deepEqual(first.calls.opened, []);
  assert.deepEqual(second.calls.opened, []);
});

test('all adapters activate together and leave together', async () => {
  const calls = [];
  const first = adapter('core', 'campaign-bundle', 'Campaign', 'campaign-bundle');
  first.api.activate = () => { calls.push('activate:campaign'); return () => calls.push('deactivate:campaign'); };
  first.api.leave = async () => { calls.push('leave:campaign'); };
  const second = adapter('notes', 'notes-json', 'Notes', 'notes-json');
  second.api.activate = () => { calls.push('activate:notes'); return () => calls.push('deactivate:notes'); };
  second.api.leave = async () => { calls.push('leave:notes'); };
  const { center } = fixture([first, second]);

  center.render();
  center.render();
  assert.deepEqual(calls, ['activate:campaign', 'activate:notes']);
  await center.leave();
  assert.deepEqual(calls, [
    'activate:campaign', 'activate:notes',
    'deactivate:campaign', 'leave:campaign',
    'deactivate:notes', 'leave:notes',
  ]);
});

test('adapter descriptors, failures, duplicate identities, and unsafe links are isolated', async () => {
  const broken = adapter('broken-addon', 'broken', '<Broken>', 'broken-format');
  broken.api.render = () => { throw new Error('boom'); };
  broken.api.descriptor = () => ({
    id: 'broken',
    label: '<Broken>',
    formats: ['broken-format'],
    links: [{ label: 'bad', href: 'https://example.invalid' }],
  });
  const duplicate = adapter('broken-addon', 'broken', 'Duplicate', 'duplicate-format');
  const invalid = { provider: { addonId: 'invalid' }, api: { apiVersion: 99 } };
  const { center } = fixture([broken, duplicate, invalid]);
  center.render();
  await center.selectFile({ files: [jsonFile('broken-format')] });
  const html = center.render();
  assert.match(html, /&lt;Broken&gt;/);
  assert.doesNotMatch(html, /https:\/\/example/);
  assert.match(html, /center.failedTitle/);
  assert.doesNotMatch(html, /Duplicate/);
});

test('throwing descriptor properties cannot break another import adapter', () => {
  const malformed = adapter('malformed-addon', 'malformed', 'Malformed', 'malformed');
  malformed.api.descriptor = () => ({
    id: 'malformed',
    get label() { throw new Error('bad label'); },
  });
  const { center } = fixture([malformed, adapter('healthy-addon', 'healthy', 'Healthy', 'healthy')]);
  assert.doesNotThrow(() => center.render());
  assert.match(center.render(), /Healthy/);
  assert.doesNotMatch(center.render(), /malformed-addon/);
});

test('resource links remain on the current origin after URL parsing', async () => {
  const linked = adapter('linked-addon', 'linked', 'Linked', 'linked');
  let changingHrefReads = 0;
  linked.api.descriptor = () => ({
    id: 'linked',
    label: 'Linked',
    formats: ['linked'],
    links: [
      { label: 'Safe', href: '/api/addon/linked/schema?version=1' },
      { label: 'Backslash escape', href: '/\\evil.example/path' },
      {
        label: 'Snapshotted',
        href: '/safe-once',
      },
    ],
  });
  const { center } = fixture([linked]);
  center.render();
  await center.selectFile({ files: [jsonFile('linked')] });
  const html = center.render();
  assert.match(html, /\/api\/addon\/linked\/schema\?version=1/);
  assert.match(html, /\/safe-once/);
  assert.doesNotMatch(html, /evil\.example/);
  assert.equal(changingHrefReads, 0);
});

test('players never receive adapter content', () => {
  const secret = adapter('secret-addon', 'secret', 'Secret', 'secret', '<input type="file">');
  const { center, host } = fixture([secret]);
  host.role.isDM = () => false;
  const html = center.render();
  assert.match(html, /page.dmOnly/);
  assert.doesNotMatch(html, /type="file"/);
});
