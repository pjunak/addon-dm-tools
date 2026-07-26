import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

import { createPlanningWorkspace } from '../planning-workspace.js';

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

  has(name) {
    return Object.prototype.hasOwnProperty.call(this.fields, name);
  }
}

function fixture() {
  const stores = {
    planning_items: new Map(),
    planning_folders: new Map(),
    planning_links: new Map(),
  };
  let sequence = 0;
  const host = {
    h: {
      esc: value => String(value ?? '').replace(/[&<>"']/g, character => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
      }[character])),
      dataAction: () => '',
      dataOn: () => '',
      breadcrumb: () => '',
    },
    action: name => `dm-tools:${name}`,
    i18n: { t: (key, params = {}) => String(en[key] ?? key).replace(/\{n\}/g, params.n ?? '') },
    role: { isDM: () => true },
    store: {
      generateId(prefix) {
        sequence++;
        return `${String(prefix).toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${sequence}`;
      },
      collection(name) {
        const values = stores[name];
        if (!values) throw new Error(`unexpected collection ${name}`);
        return {
          list: () => [...values.entries()].map(([id, value]) => ({ id, ...structuredClone(value) })),
          get: id => values.has(id) ? structuredClone(values.get(id)) : null,
          save(record) {
            const value = structuredClone(record);
            delete value.id;
            values.set(record.id, value);
            return record;
          },
          remove: id => values.delete(id),
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
      announce() {},
    },
  };
  return { workspace: createPlanningWorkspace(host), stores };
}

function event(fields, closest) {
  const form = { fields };
  return {
    preventDefault() {},
    currentTarget: closest
      ? { closest: () => form }
      : form,
  };
}

test('manual workflow creates an item, a stable section, and a named NPC link', async t => {
  const original = globalThis.FormData;
  globalThis.FormData = FakeFormData;
  t.after(() => { globalThis.FormData = original; });
  const value = fixture();

  value.workspace.createItem('quest');
  const id = value.workspace.getState().selectedId;
  value.workspace.addSection(event({
    kind: 'quest',
    title: 'Recover the Sigil',
    summary: 'Court investigation',
    body: '',
    folderId: '',
    tags: 'court',
    state: 'ready',
  }, true));
  const sectionId = value.workspace.getState().draft.sections[0].id;
  await value.workspace.saveItem(event({
    kind: 'quest',
    title: 'Recover the Sigil',
    summary: 'Court investigation',
    body: '',
    folderId: '',
    tags: 'court',
    state: 'ready',
    pinned: 'on',
    'section-id': [sectionId],
    'section-title': ['Audience with the Duke'],
    'section-body': ['Mira requests discretion.'],
  }));
  assert.equal(value.stores.planning_items.get(id).title, 'Recover the Sigil');

  await value.workspace.saveEntityLink(event({
    entity: 'characters:mira',
    sectionId,
    name: 'Requests a discreet investigation',
    type: 'involves',
    notes: '',
  }));
  const [link] = value.stores.planning_links.values();
  assert.equal(link.name, 'Requests a discreet investigation');
  assert.deepEqual(link.source, { scope: 'core', collection: 'characters', id: 'mira' });
  assert.deepEqual(link.target, { scope: 'planning', itemId: id, sectionId });
  assert.match(value.workspace.render(), /Requests a discreet investigation/);
});
