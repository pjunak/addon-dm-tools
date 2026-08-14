import {
  PLANNING_SCHEMA_VERSION,
  normalizeDmNote,
  normalizePlanningConsequence,
  normalizePlanningFlow,
  normalizePlanningItem,
  normalizePlanningReference,
  validatePlanningDataset,
} from './planning-contract.js';
import {
  mountPlannerDialog,
  mountStoryCanvas,
  requestPlannerFullscreen,
} from './story-planner-interactions.js';
import {
  itemSubtreeIds,
  normalizePositions,
  projectScope,
} from './story-planner-model.js';
import {
  buildRenderData,
  renderCanvasPage,
  renderDetailPage,
  renderSelectionToolbar,
} from './story-planner-render.js';
import { normalizeCanvasZoom } from './story-planner-zoom.js';

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
  PLANNING_FLOW_SCOPE_MISMATCH: 'flowScope',
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
  let selectedItemIds = new Set();
  let selectedFlowIds = new Set();
  let draft = null;
  let errors = [];
  let connectionSource = '';
  let dialogTab = 'details';
  let undoDelete = null;
  let fullscreen = false;
  let cleanupInteractions = () => {};
  let mountedViewId = '';
  let scheduled = null;
  let viewWrite = Promise.resolve();
  const viewportScroll = new Map();
  const viewportZoom = new Map();
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

  function currentZoom() {
    return normalizeCanvasZoom(viewportZoom.get(viewId()) ?? 1);
  }

  function exitPlannerFullscreen() {
    if (!fullscreen || typeof document === 'undefined') return;
    const root = document.querySelector(
      '.addon-route-page[data-addon-id="dm-tools"] .dmt-planner-shell',
    );
    if (root) void requestPlannerFullscreen(root, false);
  }

  function readPositions() {
    const views = collection('views');
    const record = views.get?.(viewId())
      || views.list().find(value => value.id === viewId());
    return record?.schemaVersion === PLANNING_SCHEMA_VERSION
      ? normalizePositions(record.positions)
      : {};
  }

  function cleanupMount() {
    if (mountedViewId && typeof document !== 'undefined') {
      const viewport = document.querySelector(
        '.addon-route-page[data-addon-id="dm-tools"] .dmt-planner-shell .dmt-story-viewport',
      );
      if (viewport) viewportScroll.set(mountedViewId, {
        left: viewport.scrollLeft,
        top: viewport.scrollTop,
      });
    }
    cleanupInteractions();
    cleanupInteractions = () => {};
    mountedViewId = '';
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

  function updateSelection(selection) {
    const data = readData();
    const payload = typeof selection === 'string'
      ? { itemIds: [selection], flowIds: [], primaryId: selection, announce: true }
      : (selection || {});
    const validItemIds = new Set(data.items.map(item => item.id));
    const validFlowIds = new Set(data.flowLinks.map(flow => flow.id));
    selectedItemIds = new Set((payload.itemIds || []).filter(id => validItemIds.has(id)));
    selectedFlowIds = new Set((payload.flowIds || []).filter(id => validFlowIds.has(id)));
    selectedId = selectedItemIds.has(payload.primaryId)
      ? payload.primaryId
      : ([...selectedItemIds][0] || '');
    errors = [];
    if (typeof document !== 'undefined') {
      const root = document.querySelector('.addon-route-page[data-addon-id="dm-tools"] .dmt-planner-shell');
      root?.querySelectorAll('[data-dmt-node]').forEach(node => {
        node.classList.toggle('is-selected', selectedItemIds.has(node.dataset.dmtNode));
      });
      root?.querySelectorAll('[data-dmt-edge-group]').forEach(group => {
        group.classList.toggle('is-selected', selectedFlowIds.has(group.dataset.dmtEdgeGroup));
      });
      const actions = root?.querySelector('[data-dmt-selection-actions]');
      if (actions) actions.innerHTML = renderSelectionToolbar(
        host,
        data,
        selectedItemIds,
        selectedFlowIds,
      );
    }
    if (payload.announce !== false) {
      const selectedItem = data.items.find(item => item.id === selectedId);
      if (selectedItemIds.size + selectedFlowIds.size > 1) {
        host.ui.announce(t('planner.announce.selectedMany', {
          n: selectedItemIds.size + selectedFlowIds.size,
        }));
      } else if (selectedItem) {
        host.ui.announce(t('planner.announce.selected', { title: selectedItem.title }));
      }
    }
  }

  function persistPositions(updates) {
    const id = viewId();
    viewWrite = viewWrite.then(() => {
      const stored = collection('views').get?.(id)
        || collection('views').list().find(value => value.id === id)
        || {};
      const current = stored.schemaVersion === PLANNING_SCHEMA_VERSION ? stored : {};
      return collection('views').save({
        id,
        schemaVersion: PLANNING_SCHEMA_VERSION,
        scopeId,
        positions: {
          ...normalizePositions(current.positions),
          ...normalizePositions(updates),
        },
        updatedAt: Math.max(Date.now(), Number(current.updatedAt || 0) + 1),
      });
    }).catch(() => host.ui.toast(t('planner.layout.failed')));
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
      selectedItemIds: [...selectedItemIds],
      selectedFlowIds: [...selectedFlowIds],
      onSelectionChange: updateSelection,
      onEdit: editItem,
      onOpen: openItem,
      onMove: persistPositions,
      onConnect: (source, target) => saveFlowBetween(source, target),
      onConnectStart: source => {
        connectionSource = source;
        host.ui.announce(t(source ? 'planner.canvas.connecting' : 'planner.canvas.connectionCancelled'));
      },
      onCreate: createItem,
      onDeleteSelection: deleteSelection,
      onUndo: undoLastDelete,
      onDialogTab: setDialogTab,
      onCancelEdit: cancelEdit,
      layoutText: host.h.layoutText,
      onTextLayoutInvalidated: host.h.onTextLayoutInvalidated,
      onZoom: value => viewportZoom.set(viewId(), value),
      onFullscreen: value => { fullscreen = value; },
    });
    const activeViewId = viewId();
    const savedScroll = viewportScroll.get(activeViewId);
    const viewport = root.querySelector('.dmt-story-viewport');
    if (savedScroll && viewport) {
      viewport.scrollLeft = savedScroll.left;
      viewport.scrollTop = savedScroll.top;
    }
    mountedViewId = activeViewId;
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
      exitPlannerFullscreen();
      fullscreen = false;
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
      selectedItemIds = new Set([item.id]);
      selectedFlowIds.clear();
      scheduled = schedule(() => {
        scheduled = null;
        mountDialogOnly();
      });
      return renderDetailPage({ host, data, item, draft, errors, dialogTab });
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
    const visibleItemIds = new Set(projection.nodes.map(node => node.item.id));
    const visibleFlowIds = new Set(projection.flowLinks.map(flow => flow.id));
    selectedItemIds = new Set([...selectedItemIds].filter(id => visibleItemIds.has(id)));
    selectedFlowIds = new Set([...selectedFlowIds].filter(id => visibleFlowIds.has(id)));
    selectedId = selectedItemIds.has(selectedId) ? selectedId : ([...selectedItemIds][0] || '');
    if (draft?.item.parentId !== scopeId) draft = null;
    scheduled = schedule(() => {
      scheduled = null;
      mount();
    });
    return renderCanvasPage({
      host,
      data,
      projection,
      scopeId,
      selectedItemIds,
      selectedFlowIds,
      draft,
      errors,
      connectionSource,
      dialogTab,
      canUndo: !!undoDelete,
      zoom: currentZoom(),
      fullscreen,
    });
  }

  function mountDialogOnly() {
    if (disposed || typeof document === 'undefined') return;
    const root = document.querySelector('.addon-route-page[data-addon-id="dm-tools"] .dmt-planner-shell');
    if (!root) return;
    cleanupInteractions = mountPlannerDialog({
      root,
      onDialogTab: setDialogTab,
      onCancelEdit: cancelEdit,
    });
  }

  async function createItem(kind, subtype = '', position = null) {
    const id = host.store.generateId(`${kind}-${Date.now()}`);
    const typeKey = kind === 'event'
      ? `planner.eventType.${subtype || 'story'}`
      : kind === 'branch'
        ? `planner.branchType.${subtype || 'decision'}`
        : `planner.kind.${kind}`;
    const item = {
      id,
      schemaVersion: PLANNING_SCHEMA_VERSION,
      kind,
      parentId: scopeId,
      title: t('planner.item.placeholderTitle', { kind: t(typeKey) }),
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
    const result = normalizePlanningItem(item, ['items', id]);
    if (!result.value) return report(result.errors);
    const data = readData();
    const validation = validateCandidate({ ...data, items: [...data.items, result.value] });
    if (validation.length) return report(validation);
    try {
      await collection('items').save(result.value);
      if (position) await persistPositions({ [id]: position });
    } catch {
      host.ui.toast(t('planner.item.createFailed'));
      return;
    }
    selectedId = id;
    selectedItemIds = new Set([id]);
    selectedFlowIds.clear();
    draft = null;
    errors = [];
    host.ui.announce(t('planner.item.created', { title: result.value.title }));
    host.ui.rerender();
  }

  function editItem(id) {
    const item = readData().items.find(value => value.id === id);
    if (!item) return;
    selectedId = id;
    selectedItemIds = new Set([id]);
    selectedFlowIds.clear();
    draft = { isNew: false, item: structuredClone(item) };
    dialogTab = 'details';
    errors = [];
    host.ui.rerender();
  }

  function cancelEdit() {
    draft = null;
    errors = [];
    host.ui.rerender();
  }

  function setDialogTab(value) {
    if (!draft || !['details', 'links', 'notes'].includes(value)) return;
    if (draft.isNew && value !== 'details') return;
    dialogTab = value;
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
    const draftPosition = draft.position;
    await collection('items').save(result.value);
    if (draftPosition && result.value.parentId === scopeId) {
      await persistPositions({ [result.value.id]: draftPosition });
    }
    draft = null;
    errors = [];
    selectedId = result.value.id;
    selectedItemIds = new Set([result.value.id]);
    selectedFlowIds.clear();
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

  async function deleteSelection(itemIds = [], flowIds = []) {
    await viewWrite;
    const data = readData();
    const roots = itemIds.map(id => data.items.find(item => item.id === id)).filter(Boolean);
    const deleteIds = new Set(roots.flatMap(item => itemSubtreeIds(item.id, data.items)));
    const explicitFlowIds = new Set(flowIds.filter(id => data.flowLinks.some(flow => flow.id === id)));
    if (!deleteIds.size && !explicitFlowIds.size) return;
    if (deleteIds.size && typeof window !== 'undefined') {
      let message;
      if (roots.length === 1) {
        const descendantCount = deleteIds.size - 1;
        message = t(descendantCount ? 'planner.item.deleteTreeConfirm' : 'planner.item.deleteConfirm', {
          title: roots[0].title,
          n: descendantCount,
        });
      } else {
        message = t('planner.selection.deleteConfirm', {
          n: deleteIds.size,
          links: explicitFlowIds.size,
        });
      }
      if (!window.confirm(message)) return;
    }
    const relatedFlows = data.flowLinks.filter(flow => (
      explicitFlowIds.has(flow.id)
      || deleteIds.has(flow.sourceId)
      || deleteIds.has(flow.targetId)
    ));
    const deletedFlowIds = new Set(relatedFlows.map(flow => flow.id));
    const relatedReferences = data.references.filter(reference => (
      deleteIds.has(reference.itemId)
      || (reference.target?.scope === 'planning' && deleteIds.has(reference.target.itemId))
    ));
    const relatedConsequences = data.consequences.filter(value => (
      (value.anchor?.scope === 'item' && deleteIds.has(value.anchor.itemId))
      || (value.anchor?.scope === 'flow' && deletedFlowIds.has(value.anchor.flowId))
      || (value.target?.scope === 'planning' && deleteIds.has(value.target.itemId))
    ));
    const relatedNotes = data.notes.filter(note => note.anchorIds.some(id => deleteIds.has(id)));
    const views = collection('views').list();
    const deletedViewIds = new Set([...deleteIds].map(itemId => viewId(itemId)));
    const relatedViews = views.filter(view => (
      deleteIds.has(view.scopeId)
      || deletedViewIds.has(view.id)
      || [...deleteIds].some(id => Object.prototype.hasOwnProperty.call(view.positions || {}, id))
    ));
    undoDelete = {
      items: data.items.filter(item => deleteIds.has(item.id)),
      flowLinks: relatedFlows,
      references: relatedReferences,
      consequences: relatedConsequences,
      notes: relatedNotes,
      views: relatedViews,
    };
    await host.store.transaction(Object.values(COLLECTIONS), tx => {
      const itemCollection = tx.collection(COLLECTIONS.items);
      deleteIds.forEach(itemId => itemCollection.remove(itemId));
      const flowCollection = tx.collection(COLLECTIONS.flowLinks);
      relatedFlows.forEach(flow => flowCollection.remove(flow.id));
      const referenceCollection = tx.collection(COLLECTIONS.references);
      relatedReferences.forEach(reference => referenceCollection.remove(reference.id));
      const consequenceCollection = tx.collection(COLLECTIONS.consequences);
      relatedConsequences.forEach(value => consequenceCollection.remove(value.id));
      const noteCollection = tx.collection(COLLECTIONS.notes);
      relatedNotes.forEach(note => noteCollection.put({
        ...note,
        anchorIds: note.anchorIds.filter(anchorId => !deleteIds.has(anchorId)),
        updatedAt: Math.max(Date.now(), note.updatedAt + 1),
      }));
      const viewCollection = tx.collection(COLLECTIONS.views);
      views.forEach(view => {
        if (deleteIds.has(view.scopeId) || deletedViewIds.has(view.id)) {
          viewCollection.remove(view.id);
          return;
        }
        if (!view.positions || typeof view.positions !== 'object' || Array.isArray(view.positions)) {
          return;
        }
        const positions = { ...view.positions };
        let changed = false;
        deleteIds.forEach(itemId => {
          if (!Object.prototype.hasOwnProperty.call(positions, itemId)) return;
          delete positions[itemId];
          changed = true;
        });
        if (changed) viewCollection.put({
          ...view,
          positions,
          updatedAt: Math.max(Date.now(), Number(view.updatedAt || 0) + 1),
        });
      });
    }, { timeoutMs: 10_000 });
    draft = null;
    selectedId = '';
    selectedItemIds.clear();
    selectedFlowIds.clear();
    errors = [];
    host.ui.announce(t(deleteIds.size ? 'planner.selection.deleted' : 'planner.flow.deleted'));
    if (detailId) {
      const parentId = roots.find(item => item.id === detailId)?.parentId;
      navigate(parentId ? `#/dm-plans/${encodeURIComponent(parentId)}` : '#/dm-plans');
    } else {
      host.ui.rerender();
    }
  }

  async function deleteItem(id) {
    return deleteSelection([id], []);
  }

  async function undoLastDelete() {
    if (!undoDelete) return;
    const snapshot = undoDelete;
    const current = readData();
    const currentByCollection = {
      items: new Map(current.items.map(value => [value.id, value])),
      flowLinks: new Map(current.flowLinks.map(value => [value.id, value])),
      references: new Map(current.references.map(value => [value.id, value])),
      consequences: new Map(current.consequences.map(value => [value.id, value])),
      notes: new Map(current.notes.map(value => [value.id, value])),
      views: new Map(collection('views').list().map(value => [value.id, value])),
    };
    await host.store.transaction(Object.values(COLLECTIONS), tx => {
      Object.entries(snapshot).forEach(([key, values]) => {
        const target = tx.collection(COLLECTIONS[key]);
        values.forEach(value => {
          const existing = currentByCollection[key].get(value.id);
          if (key === 'notes' && existing) {
            target.put({
              ...value,
              ...existing,
              anchorIds: [...new Set([...value.anchorIds, ...existing.anchorIds])],
              updatedAt: Math.max(Date.now(), Number(existing.updatedAt || 0) + 1),
            });
          } else if (key === 'views' && existing) {
            target.put({
              ...value,
              ...existing,
              positions: {
                ...normalizePositions(value.positions),
                ...normalizePositions(existing.positions),
              },
              updatedAt: Math.max(Date.now(), Number(existing.updatedAt || 0) + 1),
            });
          } else if (!existing) {
            target.put(value);
          }
        });
      });
    }, { timeoutMs: 10_000 });
    undoDelete = null;
    host.ui.announce(t('planner.selection.restored'));
    host.ui.rerender();
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
    return deleteSelection([], [id]);
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
    exitPlannerFullscreen();
    cleanupMount();
    connectionSource = '';
    fullscreen = false;
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
    deleteSelection,
    undoLastDelete,
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
      selectedItemIds: [...selectedItemIds],
      selectedFlowIds: [...selectedFlowIds],
      draft: draft ? structuredClone(draft) : null,
      errors: structuredClone(errors),
      connectionSource,
      dialogTab,
      canUndo: !!undoDelete,
      zoom: currentZoom(),
      fullscreen,
    }),
  });
}
