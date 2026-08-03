const PROVIDER_ID = 'planning-json';

export function createDashboard(host) {
  const { esc } = host.h;
  const t = (key, params) => host.i18n.t(key, params);
  let providerStatus = 'loading';
  let generation = 0;
  let disposed = false;
  let lastSignature = '';

  async function initialize() {
    if (disposed || !host.role.isDM()) return;
    const current = ++generation;
    providerStatus = 'loading';
    try {
      const listed = await host.imports.listProviders();
      if (disposed || current !== generation || !host.role.isDM()) return;
      providerStatus = listed.providers.some(provider => provider.id === PROVIDER_ID)
        ? 'ready'
        : 'missing';
    } catch {
      if (disposed || current !== generation || !host.role.isDM()) return;
      providerStatus = 'error';
    }
    host.ui.rerender();
  }

  function leave() {
    ++generation;
    providerStatus = 'loading';
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
    return result.filter(record => (
      record && typeof record === 'object' && record.schemaVersion === 2
    ));
  }

  function summarize(items) {
    return {
      total: items.length,
      plotlines: items.filter(item => item.kind === 'plotline').length,
      quests: items.filter(item => item.kind === 'quest').length,
      encounters: items.filter(item => item.kind === 'event' && item.eventType === 'encounter').length,
      notes: host.store.collection('dm_notes').list().length,
    };
  }

  function announceUpdate(items, summary) {
    const newest = items.reduce((value, item) => Math.max(value, item.updatedAt || 0), 0);
    const signature = `${summary.total}:${summary.plotlines}:${summary.quests}:${summary.notes}:${newest}`;
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
        ? `<p class="codex-warnings">${esc(t('dashboard.importError'))}</p>`
        : '';
    const cards = [
      ['#/dm-plans', 'dashboard.planning.title', 'dashboard.planning.body'],
      ['#/dm-import', 'dashboard.import.title', 'dashboard.import.body'],
    ];
    return `<section class="settings-panel" aria-labelledby="dm-tools-workflow-title">
      <h3 id="dm-tools-workflow-title">${esc(t('dashboard.workflow.title'))}</h3>
      <p class="settings-hint">${esc(t('dashboard.workflow.body'))}</p>
      ${providerWarning}
      <nav class="codex-auto-grid codex-auto-grid-wide" aria-label="${esc(t('dashboard.workflow.label'))}">
        ${cards.map(([href, title, body]) => `<a class="codex-link-tile" href="${href}">
          <strong>${esc(t(title))}</strong>
          <span class="settings-hint">${esc(t(body))}</span>
        </a>`).join('')}
      </nav>
    </section>`;
  }

  function itemListHtml(items) {
    const prioritized = items.slice().sort((left, right) => (
      Number(right.updatedAt || 0) - Number(left.updatedAt || 0)
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
      <div class="codex-stack codex-stack-compact">
        ${prioritized.map(item => `<a class="codex-link-row" href="${item.kind === 'plotline' || item.kind === 'quest'
          ? `#/dm-plans/${encodeURIComponent(item.id)}`
          : item.parentId ? `#/dm-plans/${encodeURIComponent(item.parentId)}` : '#/dm-plans'}">
          <div>
            <strong>${esc(item.title || t('dashboard.unnamed'))}</strong>
            ${item.summary ? `<div class="settings-hint">${esc(item.summary)}</div>` : ''}
          </div>
          <div>
            <span class="codex-badge">${esc(t(
              item.kind === 'event'
                ? `planner.eventType.${item.eventType}`
                : item.kind === 'branch'
                  ? `planner.branchType.${item.branchType}`
                  : `planner.kind.${item.kind}`,
            ))}</span>
          </div>
        </a>`).join('')}
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
    } catch {
      return `<section class="addon-dm-tools-dashboard settings-panel" role="alert">
        <h2>${esc(t('dashboard.title'))}</h2>
        <h3>${esc(t('dashboard.error.title'))}</h3>
        <p>${esc(t('dashboard.error.body'))}</p>
        ${workflowHtml()}
      </section>`;
    }
    const summary = summarize(items);
    announceUpdate(items, summary);
    return `<div class="addon-dm-tools-dashboard codex-stack codex-stack-loose">
      <section class="settings-panel">
        <h2>${esc(t('dashboard.title'))}</h2>
        <p class="settings-hint">${esc(t('dashboard.description'))}</p>
        <div class="codex-cluster">
          ${tile('total', summary.total, true)}
          ${tile('plotlines', summary.plotlines)}
          ${tile('quests', summary.quests)}
          ${tile('encounters', summary.encounters)}
          ${tile('notes', summary.notes)}
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
      disposed,
      hasSignature: !!lastSignature,
    }),
  };
}
