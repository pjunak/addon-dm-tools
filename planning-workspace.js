import {
  CORE_REFERENCE_COLLECTIONS,
  PLANNING_KINDS,
  PLANNING_RELATIONS,
  PLANNING_SCHEMA_VERSION,
  PLANNING_STATES,
  normalizePlanningFolder,
  normalizePlanningItem,
  normalizePlanningLink,
  validatePlanningDataset,
} from './planning-contract.js';

const COLLECTIONS = Object.freeze({
  items: 'planning_items',
  folders: 'planning_folders',
  links: 'planning_links',
});

function formValue(form, name) {
  return new FormData(form).get(name)?.toString() || '';
}

function records(value) {
  if (Array.isArray(value)) return value;
  return Object.entries(value || {}).map(([id, record]) => (
    record && typeof record === 'object' ? { id, ...record } : { id }
  ));
}

function endpointIdentity(endpoint) {
  if (endpoint.scope === 'planning') {
    return `planning:${endpoint.itemId}:${endpoint.sectionId || ''}`;
  }
  if (endpoint.scope === 'core') return `core:${endpoint.collection}:${endpoint.id}`;
  return `external:${endpoint.addonId}:${endpoint.kind}:${endpoint.id}`;
}

function endpointTouchesItem(endpoint, itemId) {
  return endpoint.scope === 'planning' && endpoint.itemId === itemId;
}

function parsePlanningTarget(value) {
  const [itemId, sectionId = ''] = String(value || '').split('#');
  return itemId
    ? { scope: 'planning', itemId, ...(sectionId ? { sectionId } : {}) }
    : null;
}

export function createPlanningWorkspace(host) {
  const { esc, dataAction, dataOn } = host.h;
  const t = (key, params) => host.i18n.t(key, params);
  let selectedId = '';
  let draft = null;
  let errors = [];
  let itemFilter = '';

  const collection = key => host.store.collection(COLLECTIONS[key]);
  const items = () => collection('items').list();
  const folders = () => collection('folders').list();
  const links = () => collection('links').list();

  function coreRecords() {
    return {
      characters: records(host.store.getCharacters()),
      factions: records(host.store.getFactions()),
      locations: records(host.store.getLocations()),
      mysteries: records(host.store.getMysteries()),
      artifacts: records(host.store.getCollection('artifacts')),
      events: records(host.store.getEvents()),
    };
  }

  function coreIds() {
    return Object.fromEntries(Object.entries(coreRecords()).map(([name, values]) => [
      name,
      values.map(value => value?.id).filter(id => typeof id === 'string'),
    ]));
  }

  function currentItem() {
    if (draft?.id === selectedId) return draft;
    return items().find(item => item.id === selectedId) || null;
  }

  function report(nextErrors) {
    errors = nextErrors;
    host.ui.rerender();
    if (errors.length) host.ui.announce(t('planning.validation.failed'));
  }

  function validateDataset(next = {}) {
    const current = {
      items: next.items || items(),
      folders: next.folders || folders(),
      links: next.links || links(),
    };
    return validatePlanningDataset(current);
  }

  function selectItem(id) {
    selectedId = id;
    draft = null;
    errors = [];
    host.ui.rerender();
  }

  function filterItems(value) {
    itemFilter = String(value || '').trimStart();
    host.ui.rerender();
    if (typeof document !== 'undefined' && typeof requestAnimationFrame === 'function') requestAnimationFrame(() => {
      const input = document.getElementById('dm-planning-filter');
      if (!input) return;
      input.focus();
      input.setSelectionRange?.(input.value.length, input.value.length);
    });
  }

  function createItem(kind) {
    if (!PLANNING_KINDS.includes(kind)) return;
    selectedId = host.store.generateId(kind);
    draft = {
      id: selectedId,
      schemaVersion: PLANNING_SCHEMA_VERSION,
      kind,
      title: '',
      summary: '',
      body: '',
      folderId: null,
      tags: [],
      state: 'idea',
      pinned: false,
      sections: [],
      updatedAt: Date.now(),
    };
    errors = [];
    host.ui.rerender();
  }

  function itemFromForm(form, base) {
    const data = new FormData(form);
    const sectionIds = data.getAll('section-id').map(String);
    const sectionTitles = data.getAll('section-title').map(String);
    const sectionBodies = data.getAll('section-body').map(String);
    return {
      id: base.id,
      schemaVersion: PLANNING_SCHEMA_VERSION,
      kind: formValue(form, 'kind'),
      title: formValue(form, 'title'),
      summary: formValue(form, 'summary'),
      body: formValue(form, 'body'),
      folderId: formValue(form, 'folderId') || null,
      tags: formValue(form, 'tags').split(',').map(tag => tag.trim()).filter(Boolean),
      state: formValue(form, 'state'),
      pinned: data.has('pinned'),
      sections: sectionIds.map((id, index) => ({
        id,
        title: sectionTitles[index] || '',
        body: sectionBodies[index] || '',
      })),
      updatedAt: Math.max(Date.now(), Number(base.updatedAt || 0) + 1),
    };
  }

  async function saveItem(event) {
    event?.preventDefault();
    const base = currentItem();
    if (!base || !event?.currentTarget) return;
    const normalized = normalizePlanningItem(
      itemFromForm(event.currentTarget, base),
      ['items', base.id],
    );
    if (!normalized.value) return report(normalized.errors);
    const nextItems = items().filter(item => item.id !== base.id);
    nextItems.push(normalized.value);
    const validation = validateDataset({ items: nextItems });
    if (validation.length) return report(validation);
    await collection('items').save(normalized.value);
    draft = null;
    errors = [];
    host.ui.announce(t('planning.item.saved'));
    host.ui.rerender();
  }

  function preserveDraft(event) {
    const form = event?.currentTarget?.closest?.('form');
    const base = currentItem();
    if (form && base) draft = itemFromForm(form, base);
    return draft;
  }

  function addSection(event) {
    const value = preserveDraft(event);
    if (!value) return;
    value.sections.push({
      id: host.store.generateId('section'),
      title: '',
      body: '',
    });
    errors = [];
    host.ui.rerender();
  }

  function removeSection(event, sectionId) {
    const value = preserveDraft(event);
    if (!value) return;
    if (links().some(link => (
      (endpointTouchesItem(link.source, value.id) && link.source.sectionId === sectionId)
      || (endpointTouchesItem(link.target, value.id) && link.target.sectionId === sectionId)
    ))) {
      return report([{
        code: 'PLANNING_SECTION_IN_USE',
        message: t('planning.section.inUse'),
        path: ['items', value.id, 'sections', sectionId],
      }]);
    }
    value.sections = value.sections.filter(section => section.id !== sectionId);
    errors = [];
    host.ui.rerender();
  }

  async function deleteItem(id) {
    if (typeof window !== 'undefined' && !window.confirm(t('planning.item.deleteConfirm'))) return;
    if (!collection('items').get(id)) {
      selectedId = '';
      draft = null;
      errors = [];
      host.ui.rerender();
      return;
    }
    const related = links().filter(link => (
      endpointTouchesItem(link.source, id) || endpointTouchesItem(link.target, id)
    ));
    await host.store.transaction(
      [COLLECTIONS.items, COLLECTIONS.links],
      tx => {
        tx.collection(COLLECTIONS.items).remove(id);
        const linkCollection = tx.collection(COLLECTIONS.links);
        related.forEach(link => linkCollection.remove(link.id));
      },
      { timeoutMs: 10_000 },
    );
    selectedId = '';
    draft = null;
    errors = [];
    host.ui.announce(t('planning.item.deleted'));
    host.ui.rerender();
  }

  async function saveFolder(event, id = '') {
    event?.preventDefault();
    const form = event?.currentTarget;
    if (!form) return;
    const current = id ? collection('folders').list().find(folder => folder.id === id) : null;
    const normalized = normalizePlanningFolder({
      id: id || host.store.generateId(formValue(form, 'name')),
      schemaVersion: PLANNING_SCHEMA_VERSION,
      name: formValue(form, 'name'),
      parentId: formValue(form, 'parentId') || null,
      order: current?.order || 0,
      updatedAt: Math.max(Date.now(), Number(current?.updatedAt || 0) + 1),
    }, ['folders', id || 'new']);
    if (!normalized.value) return report(normalized.errors);
    const nextFolders = folders().filter(folder => folder.id !== id);
    nextFolders.push(normalized.value);
    const validation = validateDataset({ folders: nextFolders });
    if (validation.length) return report(validation);
    await collection('folders').save(normalized.value);
    errors = [];
    host.ui.announce(t('planning.folder.saved'));
    host.ui.rerender();
  }

  async function deleteFolder(id) {
    if (folders().some(folder => folder.parentId === id) || items().some(item => item.folderId === id)) {
      return report([{
        code: 'PLANNING_FOLDER_IN_USE',
        message: t('planning.folder.inUse'),
        path: ['folders', id],
      }]);
    }
    await collection('folders').remove(id);
    errors = [];
    host.ui.announce(t('planning.folder.deleted'));
    host.ui.rerender();
  }

  function buildLink({ id, name, type, source, target, notes = '' }) {
    return normalizePlanningLink({
      id: id || host.store.generateId(name),
      schemaVersion: PLANNING_SCHEMA_VERSION,
      name,
      type,
      source,
      target,
      notes,
      updatedAt: Date.now(),
    }, ['links', id || 'new']);
  }

  async function persistLink(result) {
    if (!result.value) return report(result.errors);
    const nextLinks = links().filter(link => link.id !== result.value.id);
    nextLinks.push(result.value);
    const validation = [
      ...validateDataset({ links: nextLinks }),
      ...validatePlanningDataset({
        items: items(),
        folders: folders(),
        links: [result.value],
        coreIds: coreIds(),
      }),
    ];
    if (validation.length) return report(validation);
    await collection('links').save(result.value);
    errors = [];
    host.ui.announce(t('planning.link.saved'));
    host.ui.rerender();
  }

  async function saveEntityLink(event) {
    event?.preventDefault();
    const item = currentItem();
    if (!event?.currentTarget || !item) return;
    const entity = formValue(event.currentTarget, 'entity');
    const separator = entity.indexOf(':');
    const collectionName = separator >= 0 ? entity.slice(0, separator) : '';
    const id = separator >= 0 ? entity.slice(separator + 1) : '';
    const sectionId = formValue(event.currentTarget, 'sectionId');
    await persistLink(buildLink({
      name: formValue(event.currentTarget, 'name'),
      type: formValue(event.currentTarget, 'type'),
      source: { scope: 'core', collection: collectionName, id },
      target: {
        scope: 'planning',
        itemId: item.id,
        ...(sectionId ? { sectionId } : {}),
      },
      notes: formValue(event.currentTarget, 'notes'),
    }));
  }

  async function saveItemLink(event) {
    event?.preventDefault();
    const item = currentItem();
    if (!event?.currentTarget || !item) return;
    const target = parsePlanningTarget(formValue(event.currentTarget, 'target'));
    if (!target) return;
    await persistLink(buildLink({
      name: formValue(event.currentTarget, 'name'),
      type: formValue(event.currentTarget, 'type'),
      source: { scope: 'planning', itemId: item.id },
      target,
      notes: formValue(event.currentTarget, 'notes'),
    }));
  }

  async function saveExternalLink(event) {
    event?.preventDefault();
    const item = currentItem();
    if (!event?.currentTarget || !item) return;
    const sectionId = formValue(event.currentTarget, 'sectionId');
    await persistLink(buildLink({
      name: formValue(event.currentTarget, 'name'),
      type: formValue(event.currentTarget, 'type'),
      source: {
        scope: 'external',
        addonId: formValue(event.currentTarget, 'addonId'),
        kind: formValue(event.currentTarget, 'kind'),
        id: formValue(event.currentTarget, 'recordId'),
        label: formValue(event.currentTarget, 'label'),
      },
      target: {
        scope: 'planning',
        itemId: item.id,
        ...(sectionId ? { sectionId } : {}),
      },
      notes: formValue(event.currentTarget, 'notes'),
    }));
  }

  async function updateLink(event, id) {
    event?.preventDefault();
    const current = links().find(link => link.id === id);
    if (!event?.currentTarget || !current) return;
    const next = buildLink({
      id,
      name: formValue(event.currentTarget, 'name'),
      type: formValue(event.currentTarget, 'type'),
      source: current.source,
      target: current.target,
      notes: formValue(event.currentTarget, 'notes'),
    });
    if (next.value) {
      next.value.updatedAt = Math.max(
        next.value.updatedAt,
        Number(current.updatedAt || 0) + 1,
      );
    }
    await persistLink(next);
  }

  async function deleteLink(id) {
    await collection('links').remove(id);
    errors = [];
    host.ui.announce(t('planning.link.deleted'));
    host.ui.rerender();
  }

  function options(values, selected, label) {
    return values.map(value => (
      `<option value="${esc(value)}"${value === selected ? ' selected' : ''}>`
      + `${esc(t(`${label}.${value}`))}</option>`
    )).join('');
  }

  function folderOptions(selected, exclude = '') {
    const available = folders().filter(folder => folder.id !== exclude);
    return `<option value="">${esc(t('planning.folder.none'))}</option>${available
      .sort((left, right) => left.name.localeCompare(right.name))
      .map(folder => `<option value="${esc(folder.id)}"${folder.id === selected ? ' selected' : ''}>${esc(folder.name)}</option>`)
      .join('')}`;
  }

  function errorHtml() {
    if (!errors.length) return '';
    return `<section class="codex-warnings" role="alert">
      <strong>${esc(t('planning.validation.title'))}</strong>
      <ul>${errors.slice(0, 10).map(error => `<li>${esc(error.message || error.code)}</li>`).join('')}</ul>
    </section>`;
  }

  function folderHtml() {
    const existing = folders().sort((left, right) => left.name.localeCompare(right.name));
    return `<details class="settings-panel dmt-folder-manager">
      <summary><strong>${esc(t('planning.folder.title'))}</strong> <span class="codex-badge">${esc(String(existing.length))}</span></summary>
      <form${dataOn('submit', host.action('saveFolder'), '$ev')}>
        <div class="dmt-folder-create">
          <input class="edit-input" name="name" required maxlength="160" placeholder="${esc(t('planning.folder.name'))}" aria-label="${esc(t('planning.folder.name'))}">
          <select class="edit-input" name="parentId" aria-label="${esc(t('planning.folder.parent'))}">${folderOptions('')}</select>
          <button class="inline-create-btn" type="submit">${esc(t('planning.action.add'))}</button>
        </div>
      </form>
      <div style="display:grid;gap:var(--space-2);margin-top:var(--space-3)">
        ${existing.map(folder => `<form class="codex-link-row"${dataOn('submit', host.action('saveFolder'), '$ev', folder.id)}>
          <input class="edit-input" name="name" required maxlength="160" value="${esc(folder.name)}" aria-label="${esc(t('planning.folder.name'))}">
          <select class="edit-input" name="parentId" aria-label="${esc(t('planning.folder.parent'))}">${folderOptions(folder.parentId, folder.id)}</select>
          <button class="inline-create-btn" type="submit">${esc(t('planning.action.save'))}</button>
          <button class="edit-delete-btn" type="button" aria-label="${esc(t('planning.folder.deleteLabel', { name: folder.name }))}"${dataAction(host.action('deleteFolder'), folder.id)}>${esc(t('planning.action.delete'))}</button>
        </form>`).join('')}
      </div>
    </details>`;
  }

  function navigationHtml() {
    const byFolder = new Map();
    const allItems = items();
    const query = itemFilter.trim().toLocaleLowerCase();
    const visibleItems = query
      ? allItems.filter(item => [
          item.title,
          item.summary,
          ...(item.tags || []),
        ].some(value => String(value || '').toLocaleLowerCase().includes(query)))
      : allItems;
    for (const item of visibleItems) {
      const key = item.folderId || '';
      if (!byFolder.has(key)) byFolder.set(key, []);
      byFolder.get(key).push(item);
    }
    const groups = [
      { id: '', name: t('planning.folder.none') },
      ...folders().sort((left, right) => left.name.localeCompare(right.name)),
    ];
    return `<section class="settings-panel">
      <div class="page-header">
        <h2>${esc(t('planning.items.title'))}</h2>
        <span class="codex-badge">${esc(query ? `${visibleItems.length} / ${allItems.length}` : String(allItems.length))}</span>
      </div>
      <input id="dm-planning-filter" class="edit-input" type="search" value="${esc(itemFilter)}"
        placeholder="${esc(t('planning.items.search'))}" aria-label="${esc(t('planning.items.search'))}"
        ${dataOn('input', host.action('filterItems'), '$value')}>
      <div style="display:flex;flex-wrap:wrap;gap:var(--space-2);margin-bottom:var(--space-3)">
        ${PLANNING_KINDS.map(kind => `<button class="inline-create-btn" type="button"${dataAction(host.action('createItem'), kind)}>+ ${esc(t(`planning.kind.${kind}`))}</button>`).join('')}
      </div>
      ${groups.map(group => {
        const groupItems = (byFolder.get(group.id) || []).sort((left, right) => (
          Number(right.pinned) - Number(left.pinned)
          || left.title.localeCompare(right.title)
        ));
        if (!groupItems.length && group.id) return '';
        return `<div style="margin-top:var(--space-3)">
          <h3>${esc(group.name)}</h3>
          ${groupItems.length ? groupItems.map(item => `<button type="button" class="codex-link-row${item.id === selectedId ? ' is-active' : ''}" style="width:100%;text-align:left"${item.id === selectedId ? ' aria-current="true"' : ''}${dataAction(host.action('selectItem'), item.id)}>
            <span><strong>${esc(item.title)}</strong><span class="settings-hint">${esc(item.summary || '')}</span></span>
            <span class="codex-badge">${esc(t(`planning.kind.${item.kind}`))}</span>
          </button>`).join('') : (!query || group.id === '' ? `<p class="settings-hint">${esc(t(query ? 'planning.items.noMatch' : 'planning.items.empty'))}</p>` : '')}
        </div>`;
      }).join('')}
    </section>`;
  }

  function sectionOptions(item, selected = '') {
    return `<option value="">${esc(t('planning.link.wholeItem'))}</option>${item.sections.map(section => (
      `<option value="${esc(section.id)}"${section.id === selected ? ' selected' : ''}>${esc(section.title || section.id)}</option>`
    )).join('')}`;
  }

  function endpointLabel(endpoint, allItems, entities) {
    if (endpoint.scope === 'planning') {
      const item = allItems.find(value => value.id === endpoint.itemId);
      const section = item?.sections.find(value => value.id === endpoint.sectionId);
      return section ? `${item?.title || endpoint.itemId} / ${section.title}` : item?.title || endpoint.itemId;
    }
    if (endpoint.scope === 'core') {
      const entity = entities[endpoint.collection]?.find(value => value.id === endpoint.id);
      return entity?.name || entity?.title || endpoint.id;
    }
    return endpoint.label;
  }

  function linkFormFields(link = {}) {
    return `<label>${esc(t('planning.link.name'))}
        <input class="edit-input" name="name" required maxlength="200" value="${esc(link.name || '')}">
      </label>
      <label>${esc(t('graph.connect.relation'))}
        <select class="edit-input" name="type">${options(PLANNING_RELATIONS, link.type || 'related', 'planning.relation')}</select>
      </label>
      <label>${esc(t('planning.link.notes'))}
        <input class="edit-input" name="notes" maxlength="2000" value="${esc(link.notes || '')}">
      </label>`;
  }

  function relationshipsHtml(item) {
    const allItems = items();
    const entities = coreRecords();
    const related = links().filter(link => (
      endpointTouchesItem(link.source, item.id) || endpointTouchesItem(link.target, item.id)
    ));
    const entityOptions = CORE_REFERENCE_COLLECTIONS.flatMap(collectionName => (
      entities[collectionName].map(entity => ({
        value: `${collectionName}:${entity.id}`,
        label: `${t(`planning.core.${collectionName}`)} — ${entity.name || entity.title || entity.id}`,
      }))
    )).sort((left, right) => left.label.localeCompare(right.label));
    const planningTargets = allItems.filter(value => value.id !== item.id).flatMap(value => [
      { value: value.id, label: value.title },
      ...value.sections.map(section => ({
        value: `${value.id}#${section.id}`,
        label: `${value.title} / ${section.title}`,
      })),
    ]);
    return `<section class="settings-panel dmt-planning-links">
      <h2>${esc(t('planning.links.title'))}</h2>
      <p class="settings-hint">${esc(t('planning.links.help'))}</p>
      <details>
        <summary>${esc(t('planning.link.entity'))}</summary>
        <form style="display:grid;gap:var(--space-2);margin-top:var(--space-2)"${dataOn('submit', host.action('saveEntityLink'), '$ev')}>
          <label>${esc(t('planning.link.chooseEntity'))}<select class="edit-input" name="entity" required><option value="">${esc(t('planning.link.chooseEntity'))}</option>${entityOptions.map(option => `<option value="${esc(option.value)}">${esc(option.label)}</option>`).join('')}</select></label>
          <label>${esc(t('planning.sections.title'))}<select class="edit-input" name="sectionId">${sectionOptions(item)}</select></label>
          ${linkFormFields()}
          <button class="inline-create-btn" type="submit">${esc(t('planning.action.add'))}</button>
        </form>
      </details>
      <details>
        <summary>${esc(t('planning.link.item'))}</summary>
        <form style="display:grid;gap:var(--space-2);margin-top:var(--space-2)"${dataOn('submit', host.action('saveItemLink'), '$ev')}>
          <label>${esc(t('planning.link.chooseItem'))}<select class="edit-input" name="target" required><option value="">${esc(t('planning.link.chooseItem'))}</option>${planningTargets.map(option => `<option value="${esc(option.value)}">${esc(option.label)}</option>`).join('')}</select></label>
          ${linkFormFields()}
          <button class="inline-create-btn" type="submit">${esc(t('planning.action.add'))}</button>
        </form>
      </details>
      <details>
        <summary>${esc(t('planning.link.external'))}</summary>
        <form style="display:grid;gap:var(--space-2);margin-top:var(--space-2)"${dataOn('submit', host.action('saveExternalLink'), '$ev')}>
          <label>${esc(t('planning.link.addonId'))}<input class="edit-input" name="addonId" required maxlength="39"></label>
          <label>${esc(t('planning.link.kind'))}<input class="edit-input" name="kind" required maxlength="80"></label>
          <label>${esc(t('planning.link.recordId'))}<input class="edit-input" name="recordId" required maxlength="120"></label>
          <label>${esc(t('planning.link.label'))}<input class="edit-input" name="label" required maxlength="200"></label>
          <label>${esc(t('planning.sections.title'))}<select class="edit-input" name="sectionId">${sectionOptions(item)}</select></label>
          ${linkFormFields()}
          <button class="inline-create-btn" type="submit">${esc(t('planning.action.add'))}</button>
        </form>
      </details>
      <div style="display:grid;gap:var(--space-2);margin-top:var(--space-3)">
        ${related.length ? related.map(link => `<form class="codex-link-row"${dataOn('submit', host.action('updateLink'), '$ev', link.id)}>
          <div>
            <strong>${esc(endpointLabel(link.source, allItems, entities))} → ${esc(endpointLabel(link.target, allItems, entities))}</strong>
            <div style="display:grid;gap:var(--space-1);margin-top:var(--space-1)">${linkFormFields(link)}</div>
          </div>
          <div>
            <button class="inline-create-btn" type="submit">${esc(t('planning.action.save'))}</button>
            <button class="edit-delete-btn" type="button" aria-label="${esc(t('planning.link.deleteLabel', { name: link.name }))}"${dataAction(host.action('deleteLink'), link.id)}>${esc(t('planning.action.delete'))}</button>
          </div>
        </form>`).join('') : `<p class="settings-hint">${esc(t('planning.links.empty'))}</p>`}
      </div>
    </section>`;
  }

  function editorHtml(item) {
    return `<div class="dmt-planning-editor">
      <form class="settings-panel"${dataOn('submit', host.action('saveItem'), '$ev')}>
        <div class="page-header">
          <h2>${esc(item.title || t('planning.item.new'))}</h2>
          <button class="edit-delete-btn" type="button" aria-label="${esc(t('planning.item.deleteLabel', { name: item.title || t('planning.item.new') }))}"${dataAction(host.action('deleteItem'), item.id)}>${esc(t('planning.action.delete'))}</button>
        </div>
        <div style="display:grid;gap:var(--space-3)">
          <label>${esc(t('planning.item.kind'))}<select class="edit-input" name="kind">${options(PLANNING_KINDS, item.kind, 'planning.kind')}</select></label>
          <label>${esc(t('planning.item.title'))}<input class="edit-input" name="title" required maxlength="160" value="${esc(item.title)}"></label>
          <label>${esc(t('planning.item.summary'))}<textarea class="edit-input" name="summary" maxlength="2000" rows="3">${esc(item.summary)}</textarea></label>
          <label>${esc(t('planning.item.body'))}<textarea class="edit-input" name="body" maxlength="80000" rows="12">${esc(item.body)}</textarea></label>
          <label>${esc(t('planning.folder.single'))}<select class="edit-input" name="folderId">${folderOptions(item.folderId)}</select></label>
          <label>${esc(t('planning.item.tags'))}<input class="edit-input" name="tags" value="${esc(item.tags.join(', '))}"></label>
          <label>${esc(t('planning.item.state'))}<select class="edit-input" name="state">${options(PLANNING_STATES, item.state, 'planning.state')}</select></label>
          <label><input type="checkbox" name="pinned"${item.pinned ? ' checked' : ''}> ${esc(t('planning.item.pinned'))}</label>
          <section>
            <div class="page-header">
              <h3>${esc(t('planning.sections.title'))}</h3>
              <button class="inline-create-btn" type="button"${dataAction(host.action('addSection'), '$ev')}>+ ${esc(t('planning.section.add'))}</button>
            </div>
            <p class="settings-hint">${esc(t('planning.sections.help'))}</p>
            ${item.sections.map(section => `<article class="edit-section">
              <input type="hidden" name="section-id" value="${esc(section.id)}">
              <label>${esc(t('planning.section.title'))}<input class="edit-input" name="section-title" required maxlength="160" value="${esc(section.title)}"></label>
              <label>${esc(t('planning.section.body'))}<textarea class="edit-input" name="section-body" maxlength="30000" rows="5">${esc(section.body)}</textarea></label>
              <button class="edit-delete-btn" type="button" aria-label="${esc(t('planning.section.deleteLabel', { name: section.title || t('planning.section.title') }))}"${dataAction(host.action('removeSection'), '$ev', section.id)}>${esc(t('planning.action.delete'))}</button>
            </article>`).join('')}
          </section>
          <button class="edit-save-btn" type="submit">${esc(t('planning.action.save'))}</button>
        </div>
      </form>
      ${collection('items').get(item.id) ? relationshipsHtml(item) : `<section class="settings-panel"><p>${esc(t('planning.links.saveFirst'))}</p></section>`}
    </div>`;
  }

  function styleHtml() {
    return `<style>
      .addon-dm-tools .dmt-planning-layout{display:grid;grid-template-columns:minmax(18rem,24rem) minmax(0,1fr);gap:var(--space-4);align-items:start}
      .addon-dm-tools .dmt-planning-sidebar,.addon-dm-tools .dmt-planning-editor{display:grid;gap:var(--space-4);min-width:0}
      .addon-dm-tools .dmt-planning-sidebar{position:sticky;top:var(--space-3)}
      .addon-dm-tools #dm-planning-filter{margin-bottom:var(--space-3)}
      .addon-dm-tools .dmt-folder-manager>summary{display:flex;align-items:center;justify-content:space-between;gap:var(--space-2);cursor:pointer}
      .addon-dm-tools .dmt-folder-manager>form{margin-top:var(--space-3)}
      .addon-dm-tools .dmt-folder-create{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr) auto;gap:var(--space-2)}
      .addon-dm-tools .dmt-folder-manager .codex-link-row{display:grid;grid-template-columns:minmax(8rem,1fr) minmax(8rem,1fr) auto auto}
      .addon-dm-tools .dmt-planning-editor label,.addon-dm-tools .dmt-planning-links label{display:grid;gap:var(--space-1);color:var(--text-muted);font-size:var(--text-sm)}
      .addon-dm-tools .dmt-planning-links details{padding-block:var(--space-2)}
      .addon-dm-tools .dmt-planning-links details>summary{min-height:2.75rem;color:var(--accent-gold);font-weight:700;cursor:pointer}
      @media(max-width:1100px){.addon-dm-tools .dmt-planning-layout{grid-template-columns:1fr}.addon-dm-tools .dmt-planning-sidebar{position:static}}
      @media(max-width:768px){.addon-dm-tools .dmt-folder-create,.addon-dm-tools .dmt-folder-manager .codex-link-row{grid-template-columns:1fr}.addon-dm-tools .dmt-planning-editor .page-header{align-items:flex-start;gap:var(--space-2)}}
    </style>`;
  }

  function render() {
    if (!host.role.isDM()) {
      return `<section class="settings-panel" role="alert">${esc(t('planning.forbidden'))}</section>`;
    }
    const item = currentItem();
    return `<main class="addon-dm-tools">
      ${styleHtml()}
      ${host.h.breadcrumb([
        { label: t('breadcrumb.tools'), href: '#/dm' },
        { label: t('planning.page.title') },
      ])}
      <div class="page-header"><h1>${esc(t('planning.page.title'))}</h1></div>
      <p class="settings-hint">${esc(t('planning.page.description'))}</p>
      ${errorHtml()}
      <div class="dmt-planning-layout">
        <div class="dmt-planning-sidebar">${navigationHtml()}${folderHtml()}</div>
        ${item ? editorHtml(item) : `<section class="settings-panel"><h2>${esc(t('planning.welcome.title'))}</h2><p>${esc(t('planning.welcome.body'))}</p></section>`}
      </div>
    </main>`;
  }

  return Object.freeze({
    render,
    selectItem,
    filterItems,
    createItem,
    saveItem,
    addSection,
    removeSection,
    deleteItem,
    saveFolder,
    deleteFolder,
    saveEntityLink,
    saveItemLink,
    saveExternalLink,
    updateLink,
    deleteLink,
    getState: () => ({
      selectedId,
      draft: draft ? structuredClone(draft) : null,
      errors: structuredClone(errors),
    }),
  });
}
