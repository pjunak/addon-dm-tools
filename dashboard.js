const PROVIDER_ID = 'planning-json';

export function createDashboard(host) {
  const { esc } = host.h;
  const t = (key, params) => host.i18n.t(key, params);
  let providerStatus = 'loading';
  let providerError = '';
  let generation = 0;
  let disposed = false;
  let lastSignature = '';

  async function initialize() {
    if (disposed || !host.role.isDM()) return;
    const current = ++generation;
    providerStatus = 'loading';
    providerError = '';
    try {
      const listed = await host.imports.listProviders();
      if (disposed || current !== generation || !host.role.isDM()) return;
      providerStatus = listed.providers.some(provider => provider.id === PROVIDER_ID)
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
    lastSignature = '';
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    leave();
  }

  function readItems() {
    const result = host.store.collection('planning_items').list();
    if (!Array.isArray(result)) throw new Error('Planning collection is unavailable.');
    return result.filter(record => record && typeof record === 'object');
  }

  function summarize(items) {
    return {
      total: items.length,
      active: items.filter(item => item.state === 'active').length,
      ready: items.filter(item => item.state === 'ready').length,
      encounters: items.filter(item => item.kind === 'encounter').length,
      pinned: items.filter(item => item.pinned).length,
    };
  }

  function announceUpdate(items, summary) {
    const newest = items.reduce((value, item) => Math.max(value, item.updatedAt || 0), 0);
    const signature = `${summary.total}:${summary.active}:${summary.ready}:${summary.pinned}:${newest}`;
    if (lastSignature && signature !== lastSignature) {
      host.ui.announce(host.i18n.plural('dashboard.announce.updated', summary.total));
    }
    lastSignature = signature;
  }

  function tile(key, value, accent = false) {
    return `<div class="codex-tile${accent ? ' codex-tile-accent' : ''}">
      <div class="codex-tile-label">${esc(t(`dashboard.status.${key}`))}</div>
      <div class="codex-tile-value">${esc(host.i18n.formatNumber(value))}</div>
    </div>`;
  }

  function workflowHtml() {
    const providerWarning = providerStatus === 'missing'
      ? `<p class="codex-warnings">${esc(t('dashboard.importMissing'))}</p>`
      : providerStatus === 'error'
        ? `<p class="codex-warnings">${esc(t('dashboard.importError', {
          code: providerError || t('dashboard.unknownError'),
        }))}</p>`
        : '';
    const graphWarning = host.graphs.available()
      ? ''
      : `<p class="codex-warnings">${esc(t('dashboard.graphUnavailable'))}</p>`;
    const cards = [
      ['#/dm-plans', 'dashboard.planning.title', 'dashboard.planning.body'],
      ['#/dm-scenarios', 'dashboard.graph.title', 'dashboard.graph.body'],
      ['#/dm-import', 'dashboard.import.title', 'dashboard.import.body'],
    ];
    return `<section class="settings-panel" aria-labelledby="dm-tools-workflow-title">
      <h3 id="dm-tools-workflow-title">${esc(t('dashboard.workflow.title'))}</h3>
      <p class="settings-hint">${esc(t('dashboard.workflow.body'))}</p>
      ${providerWarning}${graphWarning}
      <nav aria-label="${esc(t('dashboard.workflow.label'))}"
        style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,16rem),1fr));gap:var(--space-3)">
        ${cards.map(([href, title, body]) => `<a class="codex-link-tile" href="${href}">
          <strong>${esc(t(title))}</strong>
          <span class="settings-hint">${esc(t(body))}</span>
        </a>`).join('')}
      </nav>
    </section>`;
  }

  function itemListHtml(items) {
    const prioritized = items.slice().sort((left, right) => (
      Number(right.pinned) - Number(left.pinned)
      || Number(right.updatedAt || 0) - Number(left.updatedAt || 0)
      || left.title.localeCompare(right.title)
    )).slice(0, 12);
    if (!prioritized.length) {
      return `<section class="settings-panel">
        <h3>${esc(t('dashboard.items.title'))}</h3>
        <p>${esc(t('dashboard.empty.body'))}</p>
        <a class="inline-create-btn" href="#/dm-plans">${esc(t('dashboard.empty.action'))}</a>
      </section>`;
    }
    return `<section class="settings-panel">
      <h3>${esc(t('dashboard.items.title'))}</h3>
      <div style="display:grid;gap:var(--space-2)">
        ${prioritized.map(item => `<article class="codex-link-row">
          <div>
            <strong>${esc(item.title || t('dashboard.unnamed'))}</strong>
            ${item.summary ? `<div class="settings-hint">${esc(item.summary)}</div>` : ''}
          </div>
          <div>
            ${item.pinned ? `<span class="codex-badge codex-badge-accent">${esc(t('dashboard.pinned'))}</span>` : ''}
            <span class="codex-badge">${esc(t(`planning.kind.${item.kind}`))}</span>
          </div>
        </article>`).join('')}
      </div>
    </section>`;
  }

  function render() {
    if (disposed || !host.role.isDM()) {
      return `<section class="settings-panel" role="alert">${esc(t('dashboard.forbidden'))}</section>`;
    }
    if (providerStatus === 'loading') {
      return `<section class="addon-dm-tools-dashboard settings-panel" aria-busy="true">
        <h2>${esc(t('dashboard.title'))}</h2>
        <p>${esc(t('dashboard.loading'))}</p>
      </section>`;
    }
    let items;
    try {
      items = readItems();
    } catch (error) {
      return `<section class="addon-dm-tools-dashboard settings-panel" role="alert">
        <h2>${esc(t('dashboard.title'))}</h2>
        <h3>${esc(t('dashboard.error.title'))}</h3>
        <p>${esc(t('dashboard.error.body', { code: error?.code || t('dashboard.unknownError') }))}</p>
        ${workflowHtml()}
      </section>`;
    }
    const summary = summarize(items);
    announceUpdate(items, summary);
    return `<div class="addon-dm-tools-dashboard" style="display:grid;gap:var(--space-5)">
      <section class="settings-panel">
        <h2>${esc(t('dashboard.title'))}</h2>
        <p class="settings-hint">${esc(t('dashboard.description'))}</p>
        <div style="display:flex;flex-wrap:wrap;gap:var(--space-2)">
          ${tile('total', summary.total, true)}
          ${tile('active', summary.active, summary.active > 0)}
          ${tile('ready', summary.ready)}
          ${tile('encounters', summary.encounters)}
          ${tile('pinned', summary.pinned)}
        </div>
      </section>
      ${workflowHtml()}
      ${itemListHtml(items)}
    </div>`;
  }

  return {
    initialize,
    leave,
    dispose,
    render,
    getState: () => ({
      providerStatus,
      providerError,
      disposed,
      hasSignature: !!lastSignature,
    }),
  };
}
