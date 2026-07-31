import {
  PLANNING_SCHEMA_VERSION,
  normalizeDmNote,
  normalizePlanningConsequence,
  normalizePlanningFlow,
  normalizePlanningItem,
  normalizePlanningReference,
  validatePlanningDataset,
} from './planning-contract.js';
import { mountStoryCanvas } from './story-planner-interactions.js';
import {
  normalizePositions,
  projectScope,
} from './story-planner-model.js';
import {
  buildRenderData,
  renderCanvasPage,
  renderDetailPage,
  renderInspector,
} from './story-planner-render.js';

const COLLECTIONS = Object.freeze({
  items: 'planning_items',
  flowLinks: 'planning_flow_links',
  references: 'planning_references',
  consequences: 'planning_consequences',
  notes: 'dm_notes',
  views: 'planning_views',
});
const VALIDATION_GROUPS = Object.freeze({
  PLANNING_PARENT_MISSING: 'ownership',
  PLANNING_PARENT_KIND_INVALID: 'ownership',
  PLANNING_HIERARCHY_CYCLE: 'ownership',
  PLANNING_FLOW_ENDPOINT_MISSING: 'flow',
  PLANNING_FLOW_OPTION_SOURCE_INVALID: 'flow',
  PLANNING_FLOW_CYCLE: 'flow',
  PLANNING_ITEM_REFERENCE_MISSING: 'reference',
  PLANNING_FLOW_REFERENCE_MISSING: 'reference',
  PLANNING_CORE_REFERENCE_MISSING: 'reference',
});

function formValue(form, name) {
  return new FormData(form).get(name)?.toString() || '';
}

function formValues(form, name) {
  return new FormData(form).getAll(name).map(String);
}

function consequenceTarget(form) {
  const encoded = formValue(form, 'target');
  if (encoded.startsWith('planning:')) {
    return { scope: 'planning', itemId: encoded.slice('planning:'.length) };
  }
  if (encoded.startsWith('core:')) {
    const separator = encoded.indexOf(':', 'core:'.length);
    if (separator > 0) {
      return {
        scope: 'core',
        collection: encoded.slice('core:'.length, separator),
        id: encoded.slice(separator + 1),
      };
    }
  }
  const addonId = formValue(form, 'targetAddonId');
  const kind = formValue(form, 'targetKind');
  const id = formValue(form, 'targetRecordId');
  const label = formValue(form, 'targetLabel');
  if (addonId || kind || id || label) {
    return { scope: 'external', addonId, kind, id, label };
  }
  return undefined;
}

export function createStoryPlanner(host, options = {}) {
  const t = (key, params) => host.i18n.t(key, params);
  const schedule = options.schedule || (callback => (
    typeof requestAnimationFrame === 'function'
      ? requestAnimationFrame(callback)
      : setTimeout(callback, 0)
  ));
  const cancelSchedule = options.cancelSchedule || (token => {
    if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(token);
    else clearTimeout(token);
  });
  let scopeId = null;
  let detailId = '';
  let selectedId = '';
  let draft = null;
  let errors = [];
  let connectionSource = '';
  let cleanupInteractions = () => {};
  let scheduled = null;
  let viewWrite = Promise.resolve();
  let disposed = false;

  const collection = key => host.store.collection(COLLECTIONS[key]);

  function normalizedList(key, normalize) {
    return collection(key).list().map(record => normalize(record, [key, record?.id || '']).value)
      .filter(Boolean);
  }

  function readData() {
    return buildRenderData(host, {
      items: normalizedList('items', normalizePlanningItem),
      flowLinks: normalizedList('flowLinks', normalizePlanningFlow),
      references: normalizedList('references', normalizePlanningReference),
      consequences: normalizedList('consequences', normalizePlanningConsequence),
      notes: normalizedList('notes', normalizeDmNote),
    });
  }

  function viewId(value = scopeId) {
    return `scope-${value || 'campaign'}`;
  }

  function readPositions() {
    const views = collection('views');
    const record = views.get?.(viewId())
      || views.list().find(value => value.id === viewId());
    return normalizePositions(record?.positions);
  }

  function cleanupMount() {
    cleanupInteractions();
    cleanupInteractions = () => {};
    if (scheduled !== null) {
      cancelSchedule(scheduled);
      scheduled = null;
    }
  }

  function report(nextErrors) {
    errors = nextErrors.map(error => ({
      ...error,
      display: t(`planner.validation.${VALIDATION_GROUPS[error.code] || 'field'}`),
    }));
    host.ui.announce(t('planner.validation.failed'));
    host.ui.rerender();
  }

  function validateCandidate(data) {
    return validatePlanningDataset(data);
  }

  function navigate(hash) {
    if (typeof window !== 'undefined') window.location.hash = hash;
  }

  function openItem(id) {
    const item = readData().items.find(value => value.id === id);
    if (!item) return;
    if (item.kind === 'plotline' || item.kind === 'quest') {
      navigate(`#/dm-plans/${encodeURIComponent(item.id)}`);
    } else if (item.kind === 'event' && ['encounter', 'puzzle'].includes(item.eventType)) {
      navigate(`#/dm-plans/${encodeURIComponent(item.id)}/detail`);
    }
  }

  function updateSelection(id) {
    const data = readData();
    if (!data.items.some(item => item.id === id)) return;
    selectedId = id;
    draft = null;
    errors = [];
    if (typeof document === 'undefined') return;
    document.querySelectorAll('.dmt-story-node.is-selected')
      .forEach(node => node.classList.remove('is-selected'));
    document.querySelector(`[data-dmt-node="${CSS.escape(id)}"]`)?.classList.add('is-selected');
    const inspector = document.getElementById('dm-story-inspector');
    if (inspector) {
      inspector.innerHTML = renderInspector({
        host,
        data,
        selectedId,
        draft,
        errors,
      });
    }
    host.ui.announce(t('planner.announce.selected', {
      title: data.items.find(item => item.id === id)?.title || id,
    }));
  }

  function persistPosition(itemId, position) {
    const id = viewId();
    const current = collection('views').get?.(id)
      || collection('views').list().find(value => value.id === id)
      || {};
    const positions = {
      ...normalizePositions(current.positions),
      [itemId]: position,
    };
    viewWrite = viewWrite.then(() => collection('views').save({
      id,
      schemaVersion: PLANNING_SCHEMA_VERSION,
      scopeId,
      positions,
      updatedAt: Math.max(Date.now(), Number(current.updatedAt || 0) + 1),
    })).catch(() => host.ui.toast(t('planner.layout.failed')));
    return viewWrite;
  }

  async function saveFlowBetween(sourceId, targetId, { kind = '', label = '' } = {}) {
    const data = readData();
    const source = data.items.find(item => item.id === sourceId);
    const target = data.items.find(item => item.id === targetId);
    if (!source || !target) {
      host.ui.toast(t('planner.validation.reference'));
      return;
    }
    const result = normalizePlanningFlow({
      id: host.store.generateId(`flow-${sourceId}-${targetId}`),
      schemaVersion: PLANNING_SCHEMA_VERSION,
      sourceId,
      targetId,
      kind: kind || (source.kind === 'branch' ? 'option' : 'continues'),
      label,
      updatedAt: Date.now(),
    }, ['flowLinks', 'new']);
    if (!result.value) return report(result.errors);
    const next = { ...data, flowLinks: [...data.flowLinks, result.value] };
    const validation = validateCandidate(next);
    if (validation.length) return report(validation);
    await collection('flowLinks').save(result.value);
    connectionSource = '';
    host.ui.announce(t('planner.flow.saved'));
    host.ui.rerender();
  }

  function mount() {
    if (disposed || typeof document === 'undefined') return;
    const root = document.querySelector('.addon-route-page[data-addon-id="dm-tools"] .dmt-planner-shell');
    if (!root) return;
    cleanupInteractions = mountStoryCanvas({
      root,
      onSelect: updateSelection,
      onOpen: openItem,
      onMove: persistPosition,
      onConnect: (source, target) => saveFlowBetween(source, target),
      onConnectStart: source => {
        connectionSource = source;
        host.ui.announce(t(source ? 'planner.canvas.connecting' : 'planner.canvas.connectionCancelled'));
      },
    });
  }

  function render(sub = '', parts = []) {
    cleanupMount();
    if (!host.role.isDM()) {
      return `<section class="settings-panel" role="alert">${host.h.esc(t('planner.forbidden'))}</section>`;
    }
    const data = readData();
    detailId = parts[2] === 'detail' ? sub : '';
    scopeId = detailId ? null : (sub || null);
    if (detailId) {
      const item = data.items.find(value => value.id === detailId);
      if (!item || item.kind !== 'event' || !['encounter', 'puzzle'].includes(item.eventType)) {
        return `<main class="addon-dm-tools"><section class="settings-panel" role="alert">
          <h1>${host.h.esc(t('planner.notFound.title'))}</h1>
          <p>${host.h.esc(t('planner.notFound.body'))}</p>
          <a class="back-btn" href="#/dm-plans">← ${host.h.esc(t('planner.action.backToCanvas'))}</a>
        </section></main>`;
      }
      if (draft?.item.id !== item.id) {
        draft = null;
        errors = [];
      }
      selectedId = item.id;
      return renderDetailPage({ host, data, item, draft, errors });
    }
    const scope = scopeId ? data.items.find(value => value.id === scopeId) : null;
    if (scopeId && (!scope || (scope.kind !== 'plotline' && scope.kind !== 'quest'))) {
      return `<main class="addon-dm-tools"><section class="settings-panel" role="alert">
        <h1>${host.h.esc(t('planner.notFound.title'))}</h1>
        <p>${host.h.esc(t('planner.notFound.body'))}</p>
        <a class="back-btn" href="#/dm-plans">← ${host.h.esc(t('planner.action.backToCanvas'))}</a>
      </section></main>`;
    }
    const projection = projectScope({
      ...data,
      scopeId,
      positions: readPositions(),
    });
    if (!projection.nodes.some(node => node.item.id === selectedId)) {
      selectedId = projection.nodes[0]?.item.id || '';
      if (draft?.item.parentId !== scopeId) draft = null;
    }
    scheduled = schedule(() => {
      scheduled = null;
      mount();
    });
    return renderCanvasPage({
      host,
      data,
      projection,
      scopeId,
      selectedId,
      draft,
      errors,
      connectionSource,
    });
  }

  function createItem(kind, subtype = '') {
    const id = host.store.generateId(`${kind}-${Date.now()}`);
    const item = {
      id,
      schemaVersion: PLANNING_SCHEMA_VERSION,
      kind,
      parentId: scopeId,
      title: '',
      summary: '',
      body: '',
      objective: '',
      setup: '',
      resolution: '',
      ...(kind === 'event' ? { eventType: subtype || 'story' } : {}),
      ...(kind === 'branch' ? { branchType: subtype || 'decision' } : {}),
      tags: [],
      updatedAt: Date.now(),
    };
    selectedId = id;
    draft = { isNew: true, item };
    errors = [];
    host.ui.rerender();
  }

  function editItem(id) {
    const item = readData().items.find(value => value.id === id);
    if (!item) return;
    selectedId = id;
    draft = { isNew: false, item: structuredClone(item) };
    errors = [];
    host.ui.rerender();
  }

  function cancelEdit() {
    draft = null;
    errors = [];
    host.ui.rerender();
  }

  function itemFromForm(form, current) {
    const kind = formValue(form, 'kind');
    return {
      id: current.id,
      schemaVersion: PLANNING_SCHEMA_VERSION,
      kind,
      parentId: formValue(form, 'parentId') || null,
      title: formValue(form, 'title'),
      summary: formValue(form, 'summary'),
      body: formValue(form, 'body'),
      objective: formValue(form, 'objective'),
      setup: formValue(form, 'setup'),
      resolution: formValue(form, 'resolution'),
      ...(kind === 'event' ? { eventType: formValue(form, 'eventType') || 'story' } : {}),
      ...(kind === 'branch' ? { branchType: formValue(form, 'branchType') || 'decision' } : {}),
      tags: formValue(form, 'tags').split(',').map(value => value.trim()).filter(Boolean),
      updatedAt: Math.max(Date.now(), Number(current.updatedAt || 0) + 1),
    };
  }

  async function saveItem(event) {
    event?.preventDefault();
    if (!event?.currentTarget || !draft) return;
    const result = normalizePlanningItem(
      itemFromForm(event.currentTarget, draft.item),
      ['items', draft.item.id],
    );
    if (!result.value) return report(result.errors);
    const data = readData();
    const nextItems = data.items.filter(item => item.id !== result.value.id);
    nextItems.push(result.value);
    const validation = validateCandidate({ ...data, items: nextItems });
    if (validation.length) return report(validation);
    await collection('items').save(result.value);
    draft = null;
    errors = [];
    selectedId = result.value.id;
    host.ui.announce(t('planner.item.saved'));
    if (detailId && result.value.id === detailId
        && !(result.value.kind === 'event' && ['encounter', 'puzzle'].includes(result.value.eventType))) {
      navigate(result.value.parentId
        ? `#/dm-plans/${encodeURIComponent(result.value.parentId)}`
        : '#/dm-plans');
      return;
    }
    host.ui.rerender();
  }

  async function deleteItem(id) {
    const data = readData();
    const item = data.items.find(value => value.id === id);
    if (!item) return;
    if (data.items.some(value => value.parentId === id)) {
      host.ui.toast(t('planner.item.hasChildren'));
      return;
    }
    if (typeof window !== 'undefined' && !window.confirm(t('planner.item.deleteConfirm', {
      title: item.title,
    }))) return;
    const relatedFlows = data.flowLinks.filter(flow => flow.sourceId === id || flow.targetId === id);
    const flowIds = new Set(relatedFlows.map(flow => flow.id));
    await host.store.transaction(Object.values(COLLECTIONS).filter(name => name !== COLLECTIONS.views), tx => {
      tx.collection(COLLECTIONS.items).remove(id);
      const flowCollection = tx.collection(COLLECTIONS.flowLinks);
      relatedFlows.forEach(flow => flowCollection.remove(flow.id));
      const referenceCollection = tx.collection(COLLECTIONS.references);
      data.references.filter(reference => (
        reference.itemId === id
        || (reference.target?.scope === 'planning' && reference.target.itemId === id)
      )).forEach(reference => referenceCollection.remove(reference.id));
      const consequenceCollection = tx.collection(COLLECTIONS.consequences);
      data.consequences.filter(value => (
        (value.anchor?.scope === 'item' && value.anchor.itemId === id)
        || (value.anchor?.scope === 'flow' && flowIds.has(value.anchor.flowId))
      )).forEach(value => consequenceCollection.remove(value.id));
      const noteCollection = tx.collection(COLLECTIONS.notes);
      data.notes.filter(note => note.anchorIds.includes(id)).forEach(note => noteCollection.put({
        ...note,
        anchorIds: note.anchorIds.filter(anchorId => anchorId !== id),
        updatedAt: Math.max(Date.now(), note.updatedAt + 1),
      }));
    }, { timeoutMs: 10_000 });
    draft = null;
    selectedId = '';
    errors = [];
    host.ui.announce(t('planner.item.deleted'));
    navigate(item.parentId ? `#/dm-plans/${encodeURIComponent(item.parentId)}` : '#/dm-plans');
  }

  async function saveFlow(event, sourceId) {
    event?.preventDefault();
    if (!event?.currentTarget) return;
    await saveFlowBetween(sourceId, formValue(event.currentTarget, 'targetId'), {
      kind: formValue(event.currentTarget, 'kind'),
      label: formValue(event.currentTarget, 'label'),
    });
  }

  async function deleteFlow(id) {
    const data = readData();
    const consequences = data.consequences.filter(value => (
      value.anchor?.scope === 'flow' && value.anchor.flowId === id
    ));
    await host.store.transaction([COLLECTIONS.flowLinks, COLLECTIONS.consequences], tx => {
      tx.collection(COLLECTIONS.flowLinks).remove(id);
      consequences.forEach(value => tx.collection(COLLECTIONS.consequences).remove(value.id));
    }, { timeoutMs: 10_000 });
    host.ui.announce(t('planner.flow.deleted'));
    host.ui.rerender();
  }

  async function updateFlow(event, id) {
    event?.preventDefault();
    const data = readData();
    const current = data.flowLinks.find(value => value.id === id);
    if (!event?.currentTarget || !current) return;
    const result = normalizePlanningFlow({
      ...current,
      kind: formValue(event.currentTarget, 'kind'),
      label: formValue(event.currentTarget, 'label'),
      updatedAt: Math.max(Date.now(), current.updatedAt + 1),
    }, ['flowLinks', id]);
    if (!result.value) return report(result.errors);
    const flowLinks = data.flowLinks.filter(value => value.id !== id);
    flowLinks.push(result.value);
    const validation = validateCandidate({ ...data, flowLinks });
    if (validation.length) return report(validation);
    await collection('flowLinks').save(result.value);
    host.ui.announce(t('planner.flow.saved'));
    host.ui.rerender();
  }

  async function persistReference(source) {
    const result = normalizePlanningReference(source, ['references', 'new']);
    if (!result.value) return report(result.errors);
    const data = readData();
    const validation = validateCandidate({
      ...data,
      references: [...data.references, result.value],
    });
    if (validation.length) return report(validation);
    await collection('references').save(result.value);
    host.ui.announce(t('planner.reference.saved'));
    host.ui.rerender();
  }

  async function saveCoreReference(event, itemId) {
    event?.preventDefault();
    if (!event?.currentTarget) return;
    const encoded = formValue(event.currentTarget, 'target');
    const separator = encoded.indexOf(':');
    if (separator < 1) return;
    await persistReference({
      id: host.store.generateId(`reference-${itemId}`),
      schemaVersion: PLANNING_SCHEMA_VERSION,
      itemId,
      name: formValue(event.currentTarget, 'name'),
      relation: formValue(event.currentTarget, 'relation'),
      target: {
        scope: 'core',
        collection: encoded.slice(0, separator),
        id: encoded.slice(separator + 1),
      },
      quantity: Number(formValue(event.currentTarget, 'quantity') || 1),
      notes: formValue(event.currentTarget, 'notes'),
      updatedAt: Date.now(),
    });
  }

  async function saveExternalReference(event, itemId) {
    event?.preventDefault();
    if (!event?.currentTarget) return;
    await persistReference({
      id: host.store.generateId(`reference-${itemId}`),
      schemaVersion: PLANNING_SCHEMA_VERSION,
      itemId,
      name: formValue(event.currentTarget, 'name'),
      relation: formValue(event.currentTarget, 'relation'),
      target: {
        scope: 'external',
        addonId: formValue(event.currentTarget, 'addonId'),
        kind: formValue(event.currentTarget, 'kind'),
        id: formValue(event.currentTarget, 'recordId'),
        label: formValue(event.currentTarget, 'label'),
      },
      quantity: Number(formValue(event.currentTarget, 'quantity') || 1),
      notes: formValue(event.currentTarget, 'notes'),
      updatedAt: Date.now(),
    });
  }

  async function savePlanningReference(event, itemId) {
    event?.preventDefault();
    if (!event?.currentTarget) return;
    await persistReference({
      id: host.store.generateId(`reference-${itemId}`),
      schemaVersion: PLANNING_SCHEMA_VERSION,
      itemId,
      name: formValue(event.currentTarget, 'name'),
      relation: formValue(event.currentTarget, 'relation'),
      target: {
        scope: 'planning',
        itemId: formValue(event.currentTarget, 'targetId'),
      },
      quantity: Number(formValue(event.currentTarget, 'quantity') || 1),
      notes: formValue(event.currentTarget, 'notes'),
      updatedAt: Date.now(),
    });
  }

  async function deleteReference(id) {
    await collection('references').remove(id);
    host.ui.announce(t('planner.reference.deleted'));
    host.ui.rerender();
  }

  async function updateReference(event, id) {
    event?.preventDefault();
    const data = readData();
    const current = data.references.find(value => value.id === id);
    if (!event?.currentTarget || !current) return;
    const result = normalizePlanningReference({
      ...current,
      name: formValue(event.currentTarget, 'name'),
      relation: formValue(event.currentTarget, 'relation'),
      quantity: Number(formValue(event.currentTarget, 'quantity') || 1),
      notes: formValue(event.currentTarget, 'notes'),
      updatedAt: Math.max(Date.now(), current.updatedAt + 1),
    }, ['references', id]);
    if (!result.value) return report(result.errors);
    const references = data.references.filter(value => value.id !== id);
    references.push(result.value);
    const validation = validateCandidate({ ...data, references });
    if (validation.length) return report(validation);
    await collection('references').save(result.value);
    host.ui.announce(t('planner.reference.saved'));
    host.ui.rerender();
  }

  async function saveConsequence(event, itemId) {
    event?.preventDefault();
    if (!event?.currentTarget) return;
    const [scope, anchorId] = formValue(event.currentTarget, 'anchor').split(':');
    const result = normalizePlanningConsequence({
      id: host.store.generateId(`consequence-${itemId}`),
      schemaVersion: PLANNING_SCHEMA_VERSION,
      anchor: scope === 'flow'
        ? { scope: 'flow', flowId: anchorId }
        : { scope: 'item', itemId },
      kind: formValue(event.currentTarget, 'kind'),
      title: formValue(event.currentTarget, 'title'),
      body: formValue(event.currentTarget, 'body'),
      target: consequenceTarget(event.currentTarget),
      updatedAt: Date.now(),
    }, ['consequences', 'new']);
    if (!result.value) return report(result.errors);
    const data = readData();
    const validation = validateCandidate({
      ...data,
      consequences: [...data.consequences, result.value],
    });
    if (validation.length) return report(validation);
    await collection('consequences').save(result.value);
    host.ui.announce(t('planner.consequence.saved'));
    host.ui.rerender();
  }

  async function deleteConsequence(id) {
    await collection('consequences').remove(id);
    host.ui.announce(t('planner.consequence.deleted'));
    host.ui.rerender();
  }

  async function updateConsequence(event, id) {
    event?.preventDefault();
    const data = readData();
    const current = data.consequences.find(value => value.id === id);
    if (!event?.currentTarget || !current) return;
    const result = normalizePlanningConsequence({
      ...current,
      kind: formValue(event.currentTarget, 'kind'),
      title: formValue(event.currentTarget, 'title'),
      body: formValue(event.currentTarget, 'body'),
      target: consequenceTarget(event.currentTarget),
      updatedAt: Math.max(Date.now(), current.updatedAt + 1),
    }, ['consequences', id]);
    if (!result.value) return report(result.errors);
    const consequences = data.consequences.filter(value => value.id !== id);
    consequences.push(result.value);
    const validation = validateCandidate({ ...data, consequences });
    if (validation.length) return report(validation);
    await collection('consequences').save(result.value);
    host.ui.announce(t('planner.consequence.saved'));
    host.ui.rerender();
  }

  async function saveNote(event, itemId) {
    event?.preventDefault();
    if (!event?.currentTarget) return;
    const anchorIds = new Set(formValues(event.currentTarget, 'anchorIds'));
    anchorIds.add(itemId);
    const result = normalizeDmNote({
      id: host.store.generateId(`note-${itemId}`),
      schemaVersion: PLANNING_SCHEMA_VERSION,
      title: formValue(event.currentTarget, 'title'),
      body: formValue(event.currentTarget, 'body'),
      anchorIds: [...anchorIds],
      updatedAt: Date.now(),
    }, ['notes', 'new']);
    if (!result.value) return report(result.errors);
    const data = readData();
    const validation = validateCandidate({ ...data, notes: [...data.notes, result.value] });
    if (validation.length) return report(validation);
    await collection('notes').save(result.value);
    host.ui.announce(t('planner.notes.saved'));
    host.ui.rerender();
  }

  async function deleteNote(id) {
    await collection('notes').remove(id);
    host.ui.announce(t('planner.notes.deleted'));
    host.ui.rerender();
  }

  async function updateNote(event, id) {
    event?.preventDefault();
    const data = readData();
    const current = data.notes.find(value => value.id === id);
    if (!event?.currentTarget || !current) return;
    const result = normalizeDmNote({
      ...current,
      title: formValue(event.currentTarget, 'title'),
      body: formValue(event.currentTarget, 'body'),
      anchorIds: formValues(event.currentTarget, 'anchorIds'),
      updatedAt: Math.max(Date.now(), current.updatedAt + 1),
    }, ['notes', id]);
    if (!result.value) return report(result.errors);
    const notes = data.notes.filter(value => value.id !== id);
    notes.push(result.value);
    const validation = validateCandidate({ ...data, notes });
    if (validation.length) return report(validation);
    await collection('notes').save(result.value);
    host.ui.announce(t('planner.notes.saved'));
    host.ui.rerender();
  }

  async function resetLayout() {
    if (typeof window !== 'undefined' && !window.confirm(t('planner.layout.resetConfirm'))) return;
    await collection('views').remove(viewId());
    host.ui.announce(t('planner.layout.reset'));
    host.ui.rerender();
  }

  function leave() {
    cleanupMount();
    connectionSource = '';
  }

  return Object.freeze({
    render,
    openItem,
    selectItem: updateSelection,
    createItem,
    editItem,
    cancelEdit,
    saveItem,
    deleteItem,
    saveFlow,
    updateFlow,
    deleteFlow,
    saveCoreReference,
    saveExternalReference,
    savePlanningReference,
    updateReference,
    deleteReference,
    saveConsequence,
    updateConsequence,
    deleteConsequence,
    saveNote,
    updateNote,
    deleteNote,
    resetLayout,
    leave,
    dispose: async () => {
      disposed = true;
      leave();
      await viewWrite;
    },
    getState: () => ({
      scopeId,
      detailId,
      selectedId,
      draft: draft ? structuredClone(draft) : null,
      errors: structuredClone(errors),
      connectionSource,
    }),
  });
}
