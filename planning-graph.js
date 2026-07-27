import {
  PLANNING_RELATIONS,
  PLANNING_SCHEMA_VERSION,
  normalizePlanningLink,
  validatePlanningDataset,
} from './planning-contract.js';
import {
  coreRecords,
  endpointIdentity,
  normalizePlanningPositions,
  planningToGraph,
} from './planning-graph-model.js';

export { planningToGraph } from './planning-graph-model.js';

const VIEW_COLLECTION = 'planning_views';
const VIEW_ID = 'campaign-map';

function formValue(form, name) {
  return new FormData(form).get(name)?.toString() || '';
}

function parsePlanningTarget(value) {
  const [itemId, sectionId = ''] = String(value || '').split('#');
  return itemId
    ? { scope: 'planning', itemId, ...(sectionId ? { sectionId } : {}) }
    : null;
}

export function createPlanningGraphPage(host, options = {}) {
  const { esc, dataAction, dataOn } = host.h;
  const t = (key, params) => host.i18n.t(key, params);
  const schedule = options.schedule || (callback => {
    if (typeof requestAnimationFrame === 'function') return requestAnimationFrame(callback);
    return setTimeout(callback, 0);
  });
  const cancelSchedule = options.cancelSchedule || (token => {
    if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(token);
    else clearTimeout(token);
  });
  const findContainer = options.findContainer || (() => (
    typeof document === 'undefined' ? null : document.getElementById('dm-planning-graph')
  ));
  const findInspector = options.findInspector || (() => (
    typeof document === 'undefined' ? null : document.getElementById('dm-planning-inspector')
  ));

  let graphHandle = null;
  let scheduled = null;
  let generation = 0;
  let state = 'idle';
  let errorCode = '';
  let currentGraph = null;
  let currentData = null;
  let selectedNodeId = '';
  let positionState = {};
  let viewWrite = Promise.resolve();
  let viewUpdatedAt = 0;
  const expandedItems = new Set();

  const collection = name => host.store.collection(name);

  function readCore() {
    return {
      characters: host.store.getCharacters(),
      factions: host.store.getFactions(),
      locations: host.store.getLocations(),
      mysteries: host.store.getMysteries(),
      artifacts: host.store.getCollection('artifacts'),
      events: host.store.getEvents(),
    };
  }

  function readView() {
    const record = collection(VIEW_COLLECTION).get?.(VIEW_ID)
      || collection(VIEW_COLLECTION).list().find(value => value.id === VIEW_ID);
    viewUpdatedAt = Math.max(viewUpdatedAt, Number(record?.updatedAt || 0));
    positionState = {
      ...normalizePlanningPositions(record?.positions),
      ...normalizePlanningPositions(positionState),
    };
  }

  function readData() {
    readView();
    return {
      items: collection('planning_items').list(),
      folders: collection('planning_folders').list(),
      links: collection('planning_links').list(),
      core: readCore(),
      positions: positionState,
    };
  }

  function cleanup() {
    generation++;
    if (scheduled !== null) {
      cancelSchedule(scheduled);
      scheduled = null;
    }
    graphHandle?.destroy();
    graphHandle = null;
    currentGraph = null;
    currentData = null;
  }

  function graphData(data) {
    return planningToGraph({
      ...data,
      expandedItems,
      sectionLabel: t('graph.edge.section'),
    });
  }

  function selectedMeta() {
    return currentGraph?.nodeMeta.get(selectedNodeId) || null;
  }

  function endpointTouches(endpoint, meta) {
    if (!endpoint || !meta) return false;
    if (meta.scope !== endpoint.scope) return false;
    if (meta.scope === 'planning') {
      if (endpoint.itemId !== meta.itemId) return false;
      return !meta.sectionId || endpoint.sectionId === meta.sectionId;
    }
    return endpointIdentity(endpoint) === meta.identity;
  }

  function endpointLabel(endpoint) {
    if (!currentData) return '';
    if (endpoint.scope === 'planning') {
      const item = currentData.items.find(value => value.id === endpoint.itemId);
      const section = item?.sections?.find(value => value.id === endpoint.sectionId);
      return section
        ? `${item?.title || endpoint.itemId} / ${section.title}`
        : item?.title || endpoint.itemId;
    }
    if (endpoint.scope === 'core') {
      const record = coreRecords(currentData.core[endpoint.collection])
        .find(value => value.id === endpoint.id);
      return record?.name || record?.title || endpoint.id;
    }
    return endpoint.label;
  }

  function relationOptions(selected = 'related') {
    return PLANNING_RELATIONS.map(value => (
      `<option value="${esc(value)}"${value === selected ? ' selected' : ''}>`
      + `${esc(t(`planning.relation.${value}`))}</option>`
    )).join('');
  }

  function targetOptions(meta) {
    if (!currentData) return '';
    const options = [];
    for (const item of currentData.items) {
      const identity = `planning:${item.id}`;
      if (identity !== meta?.identity) options.push({
        value: item.id,
        label: item.title,
      });
      for (const section of item.sections || []) {
        const sectionIdentity = `planning:${item.id}:${section.id}`;
        if (sectionIdentity !== meta?.identity) options.push({
          value: `${item.id}#${section.id}`,
          label: `${item.title} / ${section.title}`,
        });
      }
    }
    return options
      .sort((left, right) => left.label.localeCompare(right.label))
      .map(option => `<option value="${esc(option.value)}">${esc(option.label)}</option>`)
      .join('');
  }

  function inspectorHtml() {
    const meta = selectedMeta();
    if (!meta) {
      return `<div class="dmt-graph-inspector-empty">
        <h2>${esc(t('graph.inspector.empty.title'))}</h2>
        <p>${esc(t('graph.inspector.empty.body'))}</p>
      </div>`;
    }
    const related = (currentData?.links || []).filter(link => (
      endpointTouches(link.source, meta) || endpointTouches(link.target, meta)
    ));
    const planning = meta.scope === 'planning';
    const source = planning
      ? {
          scope: 'planning',
          itemId: meta.itemId,
          ...(meta.sectionId ? { sectionId: meta.sectionId } : {}),
        }
      : null;
    const details = planning
      ? `<p>${esc(meta.section?.body || meta.item?.summary || meta.item?.body || t('graph.inspector.noNotes'))}</p>
         <div class="dmt-graph-inspector-meta">
           <span class="codex-badge">${esc(t(`planning.kind.${meta.itemKind}`))}</span>
           ${meta.item?.state ? `<span class="codex-badge">${esc(t(`planning.state.${meta.item.state}`))}</span>` : ''}
         </div>
         <button type="button" class="inline-create-btn"${dataAction(host.action('graphEditPlanning'), meta.itemId)}>
           ${esc(t('graph.action.editPlan'))}
         </button>`
      : `<p>${esc(t('graph.inspector.reference', {
          kind: meta.collection || meta.kind || meta.addonId || t('graph.inspector.external'),
          id: meta.id,
        }))}</p>`;
    const connect = source
      ? `<details class="dmt-graph-connect">
          <summary>${esc(t('graph.connect.title'))}</summary>
          <form${dataOn('submit', host.action('graphCreateLink'), '$ev')}>
            <label>${esc(t('graph.connect.target'))}
              <select class="edit-input" name="target" required>
                <option value="">${esc(t('planning.link.chooseItem'))}</option>
                ${targetOptions(meta)}
              </select>
            </label>
            <label>${esc(t('planning.link.name'))}
              <input class="edit-input" name="name" required maxlength="200">
            </label>
            <label>${esc(t('graph.connect.relation'))}
              <select class="edit-input" name="type">${relationOptions()}</select>
            </label>
            <label>${esc(t('planning.link.notes'))}
              <textarea class="edit-input" name="notes" maxlength="2000" rows="3"></textarea>
            </label>
            <button class="edit-save-btn" type="submit">${esc(t('graph.connect.save'))}</button>
          </form>
        </details>`
      : '';
    return `<div class="dmt-graph-inspector-content">
      <p class="dmt-graph-eyebrow">${esc(
        meta.sectionId ? t('graph.inspector.section') : planning
          ? t('graph.inspector.plan') : t('graph.inspector.referenceTitle'),
      )}</p>
      <h2>${esc(meta.label)}</h2>
      ${details}
      ${connect}
      <section class="dmt-graph-related">
        <h3>${esc(t('graph.links.title'))}</h3>
        ${related.length ? related.map(link => `<article>
          <div>
            <strong>${esc(link.name)}</strong>
            <span>${esc(endpointLabel(link.source))} → ${esc(endpointLabel(link.target))}</span>
          </div>
          <button class="edit-delete-btn" type="button" aria-label="${esc(t('graph.link.deleteLabel', { name: link.name }))}"${dataAction(host.action('graphDeleteLink'), link.id)}>
            ${esc(t('planning.action.delete'))}
          </button>
        </article>`).join('') : `<p class="settings-hint">${esc(t('graph.links.empty'))}</p>`}
      </section>
    </div>`;
  }

  function updateInspector() {
    const target = findInspector();
    if (target) target.innerHTML = inspectorHtml();
  }

  function graphCapabilities() {
    const status = host.graphs.status?.() || { features: [], layouts: [] };
    return {
      draggable: status.features?.includes('node-drag')
        && status.features?.includes('node-position')
        && status.layouts?.includes('preset'),
    };
  }

  async function persistPosition(nodeId, position) {
    const meta = currentGraph?.nodeMeta.get(nodeId);
    if (!meta?.identity) return;
    positionState = {
      ...positionState,
      [meta.identity]: { x: position.x, y: position.y },
    };
    const snapshot = normalizePlanningPositions(positionState);
    viewWrite = viewWrite.then(async () => {
      viewUpdatedAt = Math.max(Date.now(), viewUpdatedAt + 1);
      await collection(VIEW_COLLECTION).save({
        id: VIEW_ID,
        schemaVersion: 1,
        positions: snapshot,
        updatedAt: viewUpdatedAt,
      });
    }).catch(() => {
      host.ui.toast?.(t('graph.position.failed'));
    });
    await viewWrite;
  }

  async function mount(current, data) {
    const container = findContainer();
    if (!container || current !== generation || !host.role.isDM()) return;
    try {
      currentData = data;
      currentGraph = graphData(data);
      const { draggable } = graphCapabilities();
      const nodes = draggable
        ? currentGraph.nodes
        : currentGraph.nodes.map(({ position: _position, ...node }) => node);
      graphHandle = await host.graphs.mount(container, {
        nodes,
        edges: currentGraph.edges,
        layout: draggable ? 'preset' : (currentGraph.edges.length ? 'dagre' : 'grid'),
        accessibleLabel: t('graph.canvas.label'),
        fitPadding: 40,
      });
      if (current !== generation || !host.role.isDM()) {
        graphHandle.destroy();
        graphHandle = null;
        return;
      }
      graphHandle.on('select', event => {
        const meta = currentGraph?.nodeMeta.get(event.nodeId);
        if (!meta) return;
        selectedNodeId = event.nodeId;
        updateInspector();
        host.ui.announce(t('graph.announce.selected', { name: meta.label }));
      });
      graphHandle.on('activate', event => {
        const meta = currentGraph?.nodeMeta.get(event.nodeId);
        if (meta?.scope === 'planning' && !meta.sectionId) toggleExpand(meta.itemId);
      });
      if (draggable) {
        graphHandle.on('move', event => {
          if (event.nodeId && event.position) {
            persistPosition(event.nodeId, event.position);
            const meta = currentGraph?.nodeMeta.get(event.nodeId);
            if (meta) host.ui.announce(t('graph.announce.moved', { name: meta.label }));
          }
        });
      }
      if (!selectedNodeId || !currentGraph.nodeMeta.has(selectedNodeId)) {
        selectedNodeId = currentGraph.nodes.find(node => (
          currentGraph.nodeMeta.get(node.id)?.scope === 'planning'
        ))?.id || currentGraph.nodes[0]?.id || '';
      }
      updateInspector();
      state = 'ready';
    } catch (error) {
      if (current !== generation) return;
      state = error?.code === 'GRAPH_UNAVAILABLE' ? 'unavailable' : 'error';
      errorCode = error?.code || 'GRAPH_FAILED';
      host.ui.rerender();
    }
  }

  function graphPanel(data) {
    if (!host.graphs.available() || state === 'unavailable') {
      return `<section class="settings-panel" role="status">
        <h2>${esc(t('graph.unavailable.title'))}</h2>
        <p class="settings-hint">${esc(t('graph.unavailable.body'))}</p>
      </section>`;
    }
    if (state === 'error') {
      return `<section class="settings-panel" role="alert">
        <h2>${esc(t('graph.error.title'))}</h2>
        <p class="settings-hint">${esc(t('graph.error.body'))}</p>
      </section>`;
    }
    state = 'loading';
    errorCode = '';
    currentData = data;
    currentGraph = graphData(data);
    const current = generation;
    scheduled = schedule(() => {
      scheduled = null;
      mount(current, data);
    });
    const draggable = graphCapabilities().draggable;
    return `<section class="dmt-graph-workbench">
      <div class="dmt-graph-stage">
        <div class="dmt-graph-toolbar" aria-label="${esc(t('graph.toolbar.label'))}">
          <div class="dmt-graph-toolbar-copy">
            <span>${esc(draggable ? t('graph.toolbar.dragHint') : t('graph.toolbar.readOnly'))}</span>
            <span>${esc(host.i18n.plural('graph.toolbar.nodes', currentGraph.nodes.length))} · ${esc(host.i18n.plural('graph.toolbar.links', currentGraph.edges.length))}</span>
          </div>
          <div>
            <a class="inline-create-btn" href="#/dm-plans">${esc(t('graph.action.openPlans'))}</a>
            <button class="inline-create-btn" type="button"${dataAction(host.action('graphFit'))}>
              ${esc(t('graph.action.fit'))}
            </button>
            <button class="inline-create-btn" type="button"${dataAction(host.action('graphExpandAll'))}>
              ${esc(t('graph.action.expandAll'))}
            </button>
            ${expandedItems.size ? `<button class="inline-create-btn" type="button"${dataAction(host.action('graphCollapseAll'))}>
              ${esc(t('graph.action.collapseAll'))}
            </button>` : ''}
            ${draggable ? `<button class="inline-create-btn" type="button"${dataAction(host.action('graphResetLayout'))}>
              ${esc(t('graph.action.resetLayout'))}
            </button>` : ''}
          </div>
        </div>
        <div id="dm-planning-graph" class="codex-graph-canvas dmt-graph-canvas" aria-busy="true" role="status">
          ${esc(t('graph.loading'))}
        </div>
      </div>
      <aside id="dm-planning-inspector" class="dmt-graph-inspector" aria-label="${esc(t('graph.inspector.label'))}">
        ${inspectorHtml()}
      </aside>
    </section>`;
  }

  function listPanel(data) {
    const open = !host.graphs.available() || state === 'unavailable' || state === 'error'
      || globalThis.matchMedia?.('(max-width: 768px)').matches;
    return `<details class="settings-panel dmt-graph-fallback"${open ? ' open' : ''}>
      <summary><strong>${esc(t('graph.list.title'))}</strong></summary>
      <div class="dmt-graph-list">
        ${data.items.map(item => `<article class="codex-link-row">
          <div>
            <strong>${esc(item.title)}</strong>
            <p class="settings-hint">${esc(item.summary || '')}</p>
          </div>
          <div>
            <span class="codex-badge">${esc(t(`planning.kind.${item.kind}`))}</span>
            ${item.sections?.length ? `<button class="inline-create-btn" type="button"${dataAction(host.action('graphToggleExpand'), item.id)}>
              ${esc(t(expandedItems.has(item.id) ? 'graph.action.collapse' : 'graph.action.expand'))}
            </button>` : ''}
            <button class="inline-create-btn" type="button"${dataAction(host.action('graphFocus'), item.id)}>
              ${esc(t('graph.action.focus'))}
            </button>
          </div>
        </article>`).join('')}
      </div>
      <h3>${esc(t('graph.links.title'))}</h3>
      ${data.links.length ? `<ul>${data.links.map(link => `<li>
        <strong>${esc(link.name)}</strong>:
        ${esc(endpointLabel(link.source))} → ${esc(endpointLabel(link.target))}
      </li>`).join('')}</ul>` : `<p class="settings-hint">${esc(t('graph.links.empty'))}</p>`}
    </details>`;
  }

  function styleHtml() {
    return `<style>
      .addon-dm-tools .dmt-graph-workbench{display:grid;grid-template-columns:minmax(0,1fr) minmax(18rem,24rem);min-height:38rem;border:1px solid var(--border-subtle);border-radius:var(--radius-lg);overflow:hidden;background:var(--bg-raised);box-shadow:var(--shadow-md)}
      .addon-dm-tools .dmt-graph-stage{display:grid;grid-template-rows:auto minmax(32rem,70vh);min-width:0;background:var(--bg-dark)}
      .addon-dm-tools .dmt-graph-toolbar{display:flex;justify-content:space-between;align-items:center;gap:var(--space-3);padding:var(--space-2) var(--space-3);border-bottom:1px solid var(--border-subtle);color:var(--text-muted);font-size:var(--text-xs)}
      .addon-dm-tools .dmt-graph-toolbar>div{display:flex;flex-wrap:wrap;gap:var(--space-1)}
      .addon-dm-tools .dmt-graph-toolbar .dmt-graph-toolbar-copy{display:grid;gap:2px}
      .addon-dm-tools .dmt-graph-canvas{height:100%;min-height:32rem;border:0;border-radius:0;touch-action:none}
      .addon-dm-tools .dmt-graph-inspector{overflow:auto;padding:var(--space-4);background:var(--bg-surface);border-left:1px solid var(--border-subtle)}
      .addon-dm-tools .dmt-graph-eyebrow{margin:0;color:var(--accent-gold);font-size:var(--text-xs);font-weight:700;letter-spacing:.08em;text-transform:uppercase}
      .addon-dm-tools .dmt-graph-inspector h2{margin:var(--space-1) 0 var(--space-3);color:var(--text-parchment)}
      .addon-dm-tools .dmt-graph-inspector-meta{display:flex;flex-wrap:wrap;gap:var(--space-1);margin:var(--space-3) 0}
      .addon-dm-tools .dmt-graph-connect{margin-top:var(--space-4);padding-top:var(--space-3);border-top:1px solid var(--border-subtle)}
      .addon-dm-tools .dmt-graph-connect summary{cursor:pointer;color:var(--accent-gold);font-weight:700}
      .addon-dm-tools .dmt-graph-connect form{display:grid;gap:var(--space-2);margin-top:var(--space-3)}
      .addon-dm-tools .dmt-graph-connect label{display:grid;gap:var(--space-1);color:var(--text-muted);font-size:var(--text-xs)}
      .addon-dm-tools .dmt-graph-related{margin-top:var(--space-5)}
      .addon-dm-tools .dmt-graph-related article{display:flex;align-items:flex-start;justify-content:space-between;gap:var(--space-2);padding:var(--space-2) 0;border-bottom:1px solid var(--border-subtle)}
      .addon-dm-tools .dmt-graph-related article div{display:grid;gap:2px;min-width:0}
      .addon-dm-tools .dmt-graph-related article span{color:var(--text-muted);font-size:var(--text-xs)}
      .addon-dm-tools .dmt-graph-fallback{margin-top:var(--space-4)}
      .addon-dm-tools .dmt-graph-fallback summary{cursor:pointer}
      .addon-dm-tools .dmt-graph-list{display:grid;gap:var(--space-2);margin-top:var(--space-3)}
      @media(max-width:1100px){.addon-dm-tools .dmt-graph-workbench{grid-template-columns:1fr}.addon-dm-tools .dmt-graph-inspector{border-left:0;border-top:1px solid var(--border-subtle);max-height:none}.addon-dm-tools .dmt-graph-stage{grid-template-rows:auto minmax(28rem,58vh)}}
      @media(max-width:768px){.addon-dm-tools .dmt-graph-toolbar{align-items:flex-start;flex-direction:column}.addon-dm-tools .dmt-graph-stage{grid-template-rows:auto minmax(25rem,52vh)}}
    </style>`;
  }

  function render() {
    cleanup();
    if (!host.role.isDM()) {
      return `<section class="settings-panel" role="alert">${esc(t('graph.forbidden'))}</section>`;
    }
    const data = readData();
    if (!data.items.length) {
      return `<main class="addon-dm-tools">
        ${host.h.breadcrumb([{ label: t('breadcrumb.tools'), href: '#/dm' }, { label: t('graph.page.title') }])}
        <section class="settings-panel" role="status">
          <h1>${esc(t('graph.empty.title'))}</h1>
          <p class="settings-hint">${esc(t('graph.empty.body'))}</p>
          <a class="inline-create-btn" href="#/dm-plans">${esc(t('graph.empty.plan'))}</a>
        </section>
      </main>`;
    }
    currentData = data;
    currentGraph = graphData(data);
    return `<main class="addon-dm-tools">
      ${styleHtml()}
      ${host.h.breadcrumb([{ label: t('breadcrumb.tools'), href: '#/dm' }, { label: t('graph.page.title') }])}
      <div class="page-header"><h1>${esc(t('graph.page.title'))}</h1></div>
      <p class="settings-hint">${esc(t('graph.page.description'))}</p>
      ${graphPanel(data)}
      ${listPanel(data)}
    </main>`;
  }

  function focus(itemId) {
    const id = currentGraph?.nodesByIdentity.get(`planning:${itemId}`);
    if (!id) return;
    selectedNodeId = id;
    graphHandle?.select?.(id);
    graphHandle?.focus(id, { padding: 60 });
    updateInspector();
  }

  function fit() {
    graphHandle?.fit(undefined, { padding: 40 });
  }

  async function resetLayout() {
    if (typeof window !== 'undefined' && !window.confirm(t('graph.action.resetConfirm'))) return;
    positionState = {};
    await collection(VIEW_COLLECTION).remove(VIEW_ID);
    host.ui.announce(t('graph.announce.reset'));
    host.ui.rerender();
  }

  function toggleExpand(itemId) {
    if (expandedItems.has(itemId)) expandedItems.delete(itemId);
    else expandedItems.add(itemId);
    host.ui.rerender();
  }

  function expandAll() {
    for (const item of currentData?.items || []) {
      if (item.sections?.length) expandedItems.add(item.id);
    }
    host.ui.rerender();
  }

  function collapseAll() {
    expandedItems.clear();
    host.ui.rerender();
  }

  async function createLink(event) {
    event?.preventDefault();
    const meta = selectedMeta();
    const form = event?.currentTarget;
    if (!form || meta?.scope !== 'planning') return;
    const target = parsePlanningTarget(formValue(form, 'target'));
    if (!target) return;
    const source = {
      scope: 'planning',
      itemId: meta.itemId,
      ...(meta.sectionId ? { sectionId: meta.sectionId } : {}),
    };
    const normalized = normalizePlanningLink({
      id: host.store.generateId(formValue(form, 'name')),
      schemaVersion: PLANNING_SCHEMA_VERSION,
      name: formValue(form, 'name'),
      type: formValue(form, 'type'),
      source,
      target,
      notes: formValue(form, 'notes'),
      updatedAt: Date.now(),
    }, ['links', 'new']);
    if (!normalized.value) {
      host.ui.toast?.(t('planning.validation.failed'));
      return;
    }
    const data = readData();
    const errors = validatePlanningDataset({
      items: data.items,
      folders: data.folders,
      links: [...data.links, normalized.value],
    });
    if (errors.length) {
      host.ui.toast?.(errors[0].message || t('planning.validation.failed'));
      return;
    }
    await collection('planning_links').save(normalized.value);
    host.ui.announce(t('planning.link.saved'));
    host.ui.rerender();
  }

  async function deleteLink(id) {
    if (typeof window !== 'undefined' && !window.confirm(t('graph.link.deleteConfirm'))) return;
    await collection('planning_links').remove(id);
    host.ui.announce(t('planning.link.deleted'));
    host.ui.rerender();
  }

  function leave() {
    cleanup();
    state = 'idle';
    errorCode = '';
  }

  return Object.freeze({
    render,
    focus,
    fit,
    resetLayout,
    toggleExpand,
    expandAll,
    collapseAll,
    createLink,
    deleteLink,
    leave,
    dispose: async () => {
      leave();
      await viewWrite;
    },
    getState: () => ({
      state,
      errorCode,
      mounted: !!graphHandle,
      selectedNodeId,
      expandedItems: [...expandedItems],
      positions: structuredClone(positionState),
    }),
  });
}
