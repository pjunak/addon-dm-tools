const STATUSES = ['planned', 'active', 'completed'];

export function createDashboard(host) {
  const { esc } = host.h;
  const t = (key, params) => host.i18n.t(key, params);
  let providerStatus = 'loading';
  let providerError = '';
  let generation = 0;
  let disposed = false;
  let lastScenarioSignature = '';

  async function initialize() {
    if (disposed || !host.role.isDM()) return;
    const current = ++generation;
    providerStatus = 'loading';
    providerError = '';
    try {
      const listed = await host.imports.listProviders();
      if (disposed || current !== generation || !host.role.isDM()) return;
      providerStatus = listed.providers.some(provider => provider.id === 'scenario-json')
        ? 'ready'
        : 'missing';
    } catch (error) {
      if (disposed || current !== generation || !host.role.isDM()) return;
      providerStatus = 'error';
      providerError = error?.code || error?.message || '';
    }
    host.ui.rerender();
  }

  function leave() {
    ++generation;
    providerStatus = 'loading';
    providerError = '';
    lastScenarioSignature = '';
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    leave();
  }

  function readScenarios() {
    const handle = host.store.collection('scenarios');
    const records = handle.list();
    if (!Array.isArray(records)) throw new Error('Scenario collection is unavailable.');
    return records.filter(record => record && typeof record === 'object');
  }

  function statusOf(record) {
    return STATUSES.includes(record?.status) ? record.status : 'unknown';
  }

  function counts(records) {
    const result = { total: records.length, planned: 0, active: 0, completed: 0, unknown: 0 };
    for (const record of records) result[statusOf(record)]++;
    return result;
  }

  function scenarioSignature(records, summary) {
    const newest = records.reduce((value, record) => {
      const stamp = typeof record.updatedAt === 'string' ? record.updatedAt : '';
      return stamp > value ? stamp : value;
    }, '');
    return `${summary.total}:${summary.planned}:${summary.active}:${summary.completed}:${summary.unknown}:${newest}`;
  }

  function announceUpdate(records, summary) {
    const signature = scenarioSignature(records, summary);
    if (lastScenarioSignature && signature !== lastScenarioSignature) {
      host.ui.announce(host.i18n.plural('dashboard.announce.updated', summary.total));
    }
    lastScenarioSignature = signature;
  }

  function statusTile(status, value, accent = false) {
    return `<div class="codex-tile${accent ? ' codex-tile-accent' : ''}">
      <div class="codex-tile-label">${esc(t(`dashboard.status.${status}`))}</div>
      <div class="codex-tile-value">${esc(host.i18n.formatNumber(value))}</div>
    </div>`;
  }

  function workflowHtml() {
    const graphAvailable = host.graphs.available();
    const providerWarning = providerStatus === 'missing'
      ? `<p class="codex-warnings">${esc(t('dashboard.importMissing'))}</p>`
      : providerStatus === 'error'
        ? `<p class="codex-warnings">${esc(t('dashboard.importError', { code: providerError || t('dashboard.unknownError') }))}</p>`
        : '';
    const graphWarning = graphAvailable
      ? ''
      : `<p class="codex-warnings">${esc(t('dashboard.graphUnavailable'))}</p>`;
    return `<section class="settings-panel" aria-labelledby="dm-tools-workflow-title">
      <h3 id="dm-tools-workflow-title">${esc(t('dashboard.workflow.title'))}</h3>
      <p class="settings-hint">${esc(t('dashboard.workflow.body'))}</p>
      ${providerWarning}
      ${graphWarning}
      <nav aria-label="${esc(t('dashboard.workflow.label'))}"
        style="display:flex;flex-wrap:wrap;gap:var(--space-3)">
        <a class="codex-link-tile" href="#/dm-import" style="flex:1">
          <strong>${esc(t('dashboard.import.title'))}</strong>
          <span class="settings-hint">${esc(t('dashboard.import.body'))}</span>
        </a>
        <a class="codex-link-tile" href="#/dm-scenarios" style="flex:1">
          <strong>${esc(t('dashboard.graph.title'))}</strong>
          <span class="settings-hint">${esc(t('dashboard.graph.body'))}</span>
        </a>
      </nav>
    </section>`;
  }

  function scenarioListHtml(records) {
    if (!records.length) {
      return `<section class="settings-panel" aria-labelledby="dm-tools-scenarios-title">
        <h3 id="dm-tools-scenarios-title">${esc(t('dashboard.scenarios.title'))}</h3>
        <p>${esc(t('dashboard.empty.body'))}</p>
        <a class="inline-create-btn" href="#/dm-import">${esc(t('dashboard.empty.action'))}</a>
      </section>`;
    }
    const ordered = records.slice().sort((left, right) => {
      const leftStamp = typeof left.updatedAt === 'string' ? left.updatedAt : '';
      const rightStamp = typeof right.updatedAt === 'string' ? right.updatedAt : '';
      return rightStamp.localeCompare(leftStamp) || String(left.id || '').localeCompare(String(right.id || ''));
    });
    return `<section class="settings-panel" aria-labelledby="dm-tools-scenarios-title">
      <h3 id="dm-tools-scenarios-title">${esc(t('dashboard.scenarios.title'))}</h3>
      <div style="display:grid;gap:var(--space-2)">
        ${ordered.map(record => {
          const name = record.name || record.id || t('dashboard.unnamed');
          const summary = typeof record.summary === 'string' ? record.summary : '';
          const status = statusOf(record);
          return `<article class="codex-link-row">
            <div>
              <strong>${esc(name)}</strong>
              ${summary ? `<div class="settings-hint">${esc(summary)}</div>` : ''}
            </div>
            <span class="codex-badge${status === 'active' ? ' codex-badge-accent' : ''}">${esc(t(`dashboard.status.${status}`))}</span>
          </article>`;
        }).join('')}
      </div>
    </section>`;
  }

  function render() {
    if (disposed || !host.role.isDM()) {
      return `<section class="settings-panel" role="alert">${esc(t('dashboard.forbidden'))}</section>`;
    }
    if (providerStatus === 'loading') {
      return `<section class="addon-dm-tools-dashboard settings-panel" aria-busy="true" aria-labelledby="dm-tools-dashboard-title">
        <h2 id="dm-tools-dashboard-title" tabindex="-1">${esc(t('dashboard.title'))}</h2>
        <p>${esc(t('dashboard.loading'))}</p>
      </section>`;
    }

    let records;
    try {
      records = readScenarios();
    } catch (error) {
      const message = error?.code || error?.message || t('dashboard.unknownError');
      return `<section class="addon-dm-tools-dashboard settings-panel" role="alert" aria-labelledby="dm-tools-dashboard-title">
        <h2 id="dm-tools-dashboard-title" tabindex="-1">${esc(t('dashboard.title'))}</h2>
        <h3>${esc(t('dashboard.error.title'))}</h3>
        <p>${esc(t('dashboard.error.body', { code: message }))}</p>
        ${workflowHtml()}
      </section>`;
    }

    const summary = counts(records);
    announceUpdate(records, summary);
    return `<div class="addon-dm-tools-dashboard" aria-labelledby="dm-tools-dashboard-title"
      style="display:grid;gap:var(--space-5)">
      <section class="settings-panel">
        <h2 id="dm-tools-dashboard-title" tabindex="-1">${esc(t('dashboard.title'))}</h2>
        <p class="settings-hint">${esc(t('dashboard.description'))}</p>
        <div style="display:flex;flex-wrap:wrap;gap:var(--space-2)">
          ${statusTile('total', summary.total, true)}
          ${statusTile('planned', summary.planned)}
          ${statusTile('active', summary.active, summary.active > 0)}
          ${statusTile('completed', summary.completed)}
          ${summary.unknown ? statusTile('unknown', summary.unknown) : ''}
        </div>
      </section>
      ${workflowHtml()}
      ${scenarioListHtml(records)}
    </div>`;
  }

  function getState() {
    return {
      providerStatus,
      providerError,
      disposed,
      hasScenarioSignature: !!lastScenarioSignature,
    };
  }

  return { initialize, leave, dispose, render, getState };
}
