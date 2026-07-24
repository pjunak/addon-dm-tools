const STATUS_ORDER = Object.freeze({
  planned: 0,
  active: 1,
  completed: 2,
});

function scenarioStatus(value) {
  return STATUS_ORDER[value] === undefined ? 'planned' : value;
}

export function scenariosToGraph(scenarios) {
  const records = Array.isArray(scenarios) ? scenarios : [];
  const nodes = records
    .filter(record => record && typeof record.id === 'string' && typeof record.name === 'string')
    .map(record => ({
      id: record.id,
      label: record.name,
      kind: scenarioStatus(record.status),
    }))
    .sort((left, right) => (
      STATUS_ORDER[left.kind] - STATUS_ORDER[right.kind]
      || left.label.localeCompare(right.label, 'en')
      || left.id.localeCompare(right.id, 'en')
    ));
  return { nodes, edges: [] };
}

export function createScenarioGraphPage(host, options = {}) {
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
    typeof document === 'undefined' ? null : document.getElementById('dm-scenario-graph')
  ));
  let graphHandle = null;
  let scheduled = null;
  let generation = 0;
  let state = 'idle';
  let errorCode = '';

  function scenarios() {
    return host.store.collection('scenarios').list();
  }

  function cleanup() {
    generation++;
    if (scheduled !== null) {
      cancelSchedule(scheduled);
      scheduled = null;
    }
    graphHandle?.destroy();
    graphHandle = null;
  }

  function unavailableHtml() {
    return `<section class="settings-panel" role="status">
      <h2>${esc(t('graph.unavailable.title'))}</h2>
      <p class="settings-hint">${esc(t('graph.unavailable.body'))}</p>
    </section>`;
  }

  function errorHtml() {
    return `<section class="settings-panel" role="alert">
      <h2>${esc(t('graph.error.title'))}</h2>
      <p class="settings-hint">${esc(t('graph.error.body'))}</p>
      ${errorCode ? `<span class="codex-badge">${esc(errorCode)}</span>` : ''}
    </section>`;
  }

  function emptyHtml() {
    return `<section class="settings-panel" role="status">
      <h2>${esc(t('graph.empty.title'))}</h2>
      <p class="settings-hint">${esc(t('graph.empty.body'))}</p>
      <a class="inline-create-btn" href="#/dm-import">${esc(t('graph.empty.import'))}</a>
    </section>`;
  }

  function listHtml(records) {
    return `<section class="settings-panel" aria-labelledby="dm-scenario-list-heading">
      <h2 id="dm-scenario-list-heading">${esc(t('graph.list.title'))}</h2>
      <div>${records.map(record => `
        <article class="codex-link-row">
          <div>
            <strong>${esc(record.name)}</strong>
            <p class="settings-hint">${esc(record.summary || '')}</p>
          </div>
          <div>
            <span class="codex-badge">${esc(t(`graph.status.${scenarioStatus(record.status)}`))}</span>
            <button class="inline-create-btn" type="button"${dataAction(host.action('graphFocus'), record.id)}>
              ${esc(t('graph.action.focus'))}
            </button>
          </div>
        </article>`).join('')}</div>
    </section>`;
  }

  async function mount(current, records) {
    const container = findContainer();
    if (!container || current !== generation || !host.role.isDM()) return;
    try {
      graphHandle = await host.graphs.mount(container, {
        ...scenariosToGraph(records),
        layout: 'grid',
        accessibleLabel: t('graph.canvas.label'),
        fitPadding: 40,
      });
      if (current !== generation || !host.role.isDM()) {
        graphHandle.destroy();
        graphHandle = null;
        return;
      }
      graphHandle.on('select', event => {
        if (!event.nodeId) return;
        const record = records.find(item => item.id === event.nodeId);
        if (record) host.ui.announce(t('graph.announce.selected', { name: record.name }));
      });
      state = 'ready';
    } catch (error) {
      if (current !== generation) return;
      state = error?.code === 'GRAPH_UNAVAILABLE' ? 'unavailable' : 'error';
      errorCode = error?.code || 'GRAPH_FAILED';
      host.ui.rerender();
    }
  }

  function render() {
    cleanup();
    if (!host.role.isDM()) {
      return `<section class="settings-panel" role="alert">${esc(t('graph.forbidden'))}</section>`;
    }
    if (!host.graphs.available()) return unavailableHtml();
    const records = scenarios();
    if (!records.length) return emptyHtml();
    if (state === 'error') return errorHtml();
    if (state === 'unavailable') return unavailableHtml();
    state = 'loading';
    errorCode = '';
    const current = generation;
    scheduled = schedule(() => {
      scheduled = null;
      mount(current, records);
    });
    return `<main class="addon-dm-tools">
      ${host.h.breadcrumb([{ label: t('breadcrumb.tools'), href: '#/dm' }, { label: t('graph.page.title') }])}
      <div class="page-header"><h1>${esc(t('graph.page.title'))}</h1></div>
      <p class="settings-hint">${esc(t('graph.page.description'))}</p>
      <div id="dm-scenario-graph" class="codex-graph-canvas" aria-busy="true" role="status">
        ${esc(t('graph.loading'))}
      </div>
      <div style="display:flex;gap:var(--space-2);margin:var(--space-3) 0">
        <button class="inline-create-btn" type="button"${dataAction(host.action('graphFit'))}>
          ${esc(t('graph.action.fit'))}
        </button>
      </div>
      ${listHtml(records)}
    </main>`;
  }

  function focus(id) {
    if (!graphHandle) return;
    graphHandle.focus(id, { padding: 60 });
  }

  function fit() {
    graphHandle?.fit(undefined, { padding: 40 });
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
    leave,
    dispose: leave,
    getState: () => ({ state, errorCode, mounted: !!graphHandle }),
  });
}
