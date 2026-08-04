import test from 'node:test';
import assert from 'node:assert/strict';

import { createImportCenter } from '../import-center.js';

function fixture(handles) {
  const rec = { rerenders: 0, announces: [], leaves: [], activations: [] };
  const host = {
    listServices: contract => {
      assert.equal(contract, 'codex.import-adapter');
      return handles;
    },
    role: { isDM: () => true },
    i18n: { t: key => key },
    ui: {
      rerender: () => { rec.rerenders++; },
      announce: value => rec.announces.push(value),
    },
    h: {
      esc: value => String(value ?? '').replace(/[&<>"']/g, character => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
      }[character])),
      dataAction: (action, ...args) => ` data-action="${action}" data-args='${JSON.stringify(args)}'`,
    },
    action: name => `dm-tools:${name}`,
  };
  return { center: createImportCenter(host), rec, host };
}

function adapter(addonId, id, label, body = `<p>${id}</p>`) {
  return {
    provider: { addonId, contractVersion: '1.0.0' },
    api: {
      apiVersion: 1,
      descriptor: () => ({ id, label, description: `${label} description`, links: [] }),
      activate: () => () => {},
      render: () => body,
      leave: async () => {},
    },
  };
}

test('Import Center composes unknown adapter ids without source changes or a whitelist', () => {
  const { center } = fixture([
    adapter('core', 'campaign-bundle', 'Campaign'),
    adapter('third-party-content', 'homebrew-items', 'Homebrew items'),
  ]);
  const html = center.render();
  assert.match(html, /Campaign/);
  assert.match(html, /Homebrew items/);
  assert.match(html, /campaign-bundle/);

  center.select('third-party-content:homebrew-items');
  assert.match(center.render(), /homebrew-items/);
});

test('adapter descriptors, failures, duplicate identities, and unsafe links are isolated', () => {
  const broken = adapter('broken-addon', 'broken', '<Broken>');
  broken.api.render = () => { throw new Error('boom'); };
  broken.api.descriptor = () => ({
    id: 'broken',
    label: '<Broken>',
    links: [{ label: 'bad', href: 'https://example.invalid' }],
  });
  const duplicate = adapter('broken-addon', 'broken', 'Duplicate');
  const invalid = { provider: { addonId: 'invalid' }, api: { apiVersion: 99 } };
  const { center } = fixture([broken, duplicate, invalid]);
  const html = center.render();
  assert.match(html, /&lt;Broken&gt;/);
  assert.doesNotMatch(html, /https:\/\/example/);
  assert.match(html, /center.failedTitle/);
  assert.doesNotMatch(html, /Duplicate/);
});

test('players never receive adapter content', () => {
  const { center, host } = fixture([adapter('secret-addon', 'secret', 'Secret', '<input type="file">')]);
  host.role.isDM = () => false;
  const html = center.render();
  assert.match(html, /page.dmOnly/);
  assert.doesNotMatch(html, /type="file"/);
});

