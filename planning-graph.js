function hash(value, seed) {
  let result = seed >>> 0;
  for (let index = 0; index < value.length; index++) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return (result >>> 0).toString(16).padStart(8, '0');
}

function graphId(prefix, identity) {
  return `${prefix}:${hash(identity, 2166136261)}${hash(identity, 3339675911)}`;
}

function coreRecords(value) {
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

export function planningToGraph({
  items = [],
  links = [],
  core = {},
  expandedItems = [],
  sectionLabel = 'section',
} = {}) {
  const expanded = new Set(expandedItems);
  const itemById = new Map(items.map(item => [item.id, item]));
  const coreByCollection = new Map(Object.entries(core).map(([collection, values]) => [
    collection,
    new Map(coreRecords(values).map(record => [record.id, record])),
  ]));
  const nodes = [];
  const edges = [];
  const nodeMeta = new Map();
  const nodesByIdentity = new Map();

  function addNode(identity, label, kind, meta) {
    if (nodesByIdentity.has(identity)) return nodesByIdentity.get(identity);
    const id = graphId('node', identity);
    nodesByIdentity.set(identity, id);
    nodes.push({ id, label, kind });
    nodeMeta.set(id, { ...meta, label });
    return id;
  }

  function itemNode(item) {
    return addNode(
      `planning:${item.id}`,
      item.title,
      `planning-${item.kind}`,
      { scope: 'planning', itemId: item.id },
    );
  }

  for (const item of items) {
    const parentId = itemNode(item);
    if (!expanded.has(item.id)) continue;
    for (const section of item.sections || []) {
      const sectionId = addNode(
        `planning:${item.id}:${section.id}`,
        section.title,
        'planning-section',
        { scope: 'planning', itemId: item.id, sectionId: section.id },
      );
      edges.push({
        id: graphId('edge', `contains:${item.id}:${section.id}`),
        source: parentId,
        target: sectionId,
        label: sectionLabel,
      });
    }
  }

  function endpointNode(endpoint) {
    if (endpoint.scope === 'planning') {
      const item = itemById.get(endpoint.itemId);
      if (!item) return null;
      if (endpoint.sectionId && expanded.has(item.id)) {
        const section = item.sections?.find(value => value.id === endpoint.sectionId);
        if (!section) return null;
        return addNode(
          endpointIdentity(endpoint),
          section.title,
          'planning-section',
          { scope: 'planning', itemId: item.id, sectionId: section.id },
        );
      }
      return itemNode(item);
    }
    if (endpoint.scope === 'core') {
      const record = coreByCollection.get(endpoint.collection)?.get(endpoint.id);
      return addNode(
        endpointIdentity(endpoint),
        record?.name || record?.title || endpoint.id,
        `core-${endpoint.collection}`,
        { ...endpoint },
      );
    }
    return addNode(
      endpointIdentity(endpoint),
      endpoint.label,
      `external-${endpoint.kind}`,
      { ...endpoint },
    );
  }

  for (const link of links) {
    const source = endpointNode(link.source);
    const target = endpointNode(link.target);
    if (!source || !target) continue;
    edges.push({
      id: graphId('edge', `link:${link.id}`),
      source,
      target,
      label: link.name,
    });
  }

  nodes.sort((left, right) => (
    left.kind.localeCompare(right.kind)
    || left.label.localeCompare(right.label)
    || left.id.localeCompare(right.id)
  ));
  edges.sort((left, right) => left.id.localeCompare(right.id));
  return { nodes, edges, nodeMeta };
}

export function createPlanningGraphPage(host, options = {}) {
  const { esc, dataAction } = host.h;
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
  let graphHandle = null;
  let scheduled = null;
  let generation = 0;
  let state = 'idle';
  let errorCode = '';
  let currentGraph = null;
  const expandedItems = new Set();

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

  function readData() {
    return {
      items: host.store.collection('planning_items').list(),
      links: host.store.collection('planning_links').list(),
      core: readCore(),
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
  }

  function graphData(data) {
    return planningToGraph({
      ...data,
      expandedItems,
      sectionLabel: t('graph.edge.section'),
    });
  }

  async function mount(current, data) {
    const container = findContainer();
    if (!container || current !== generation || !host.role.isDM()) return;
    try {
      currentGraph = graphData(data);
      graphHandle = await host.graphs.mount(container, {
        nodes: currentGraph.nodes,
        edges: currentGraph.edges,
        layout: currentGraph.edges.length ? 'dagre' : 'grid',
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
        if (meta) host.ui.announce(t('graph.announce.selected', { name: meta.label }));
      });
      graphHandle.on('activate', event => {
        const meta = currentGraph?.nodeMeta.get(event.nodeId);
        if (meta?.scope === 'planning' && !meta.sectionId) toggleExpand(meta.itemId);
      });
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
        ${errorCode ? `<span class="codex-badge">${esc(errorCode)}</span>` : ''}
      </section>`;
    }
    state = 'loading';
    errorCode = '';
    const current = generation;
    scheduled = schedule(() => {
      scheduled = null;
      mount(current, data);
    });
    return `<section class="settings-panel">
      <div id="dm-planning-graph" class="codex-graph-canvas" aria-busy="true" role="status">
        ${esc(t('graph.loading'))}
      </div>
      <button class="inline-create-btn" type="button"${dataAction(host.action('graphFit'))}>
        ${esc(t('graph.action.fit'))}
      </button>
    </section>`;
  }

  function listPanel(data) {
    const byItem = new Map(data.items.map(item => [item.id, item]));
    const endpointLabel = endpoint => {
      if (endpoint.scope === 'planning') {
        const item = byItem.get(endpoint.itemId);
        const section = item?.sections?.find(value => value.id === endpoint.sectionId);
        return section ? `${item?.title || endpoint.itemId} / ${section.title}` : item?.title || endpoint.itemId;
      }
      if (endpoint.scope === 'core') {
        const record = coreRecords(data.core[endpoint.collection]).find(value => value.id === endpoint.id);
        return record?.name || record?.title || endpoint.id;
      }
      return endpoint.label;
    };
    return `<section class="settings-panel" aria-labelledby="dm-planning-list-heading">
      <h2 id="dm-planning-list-heading">${esc(t('graph.list.title'))}</h2>
      <div style="display:grid;gap:var(--space-2)">
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
    </section>`;
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
    return `<main class="addon-dm-tools">
      ${host.h.breadcrumb([{ label: t('breadcrumb.tools'), href: '#/dm' }, { label: t('graph.page.title') }])}
      <div class="page-header"><h1>${esc(t('graph.page.title'))}</h1></div>
      <p class="settings-hint">${esc(t('graph.page.description'))}</p>
      ${graphPanel(data)}
      ${listPanel(data)}
    </main>`;
  }

  function focus(itemId) {
    const id = currentGraph?.nodesByIdentity?.get?.(`planning:${itemId}`)
      || graphId('node', `planning:${itemId}`);
    graphHandle?.focus(id, { padding: 60 });
  }

  function fit() {
    graphHandle?.fit(undefined, { padding: 40 });
  }

  function toggleExpand(itemId) {
    if (expandedItems.has(itemId)) expandedItems.delete(itemId);
    else expandedItems.add(itemId);
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
    toggleExpand,
    leave,
    dispose: leave,
    getState: () => ({
      state,
      errorCode,
      mounted: !!graphHandle,
      expandedItems: [...expandedItems],
    }),
  });
}
