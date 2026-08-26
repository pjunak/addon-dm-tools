const CONTRACT = 'codex.import-adapter';
const LINK_BASE = 'https://codex.invalid';
const FORMAT_PATTERN = /^[a-z][a-z0-9.-]{1,127}$/;

function normalizeLink(link) {
  try {
    if (!link) return null;
    const label = link.label;
    const href = link.href;
    if (typeof label !== 'string' || typeof href !== 'string') return null;
    if (!href.startsWith('/') || href.startsWith('//') || /[\\\u0000-\u001f\u007f]/.test(href)) return null;
    const parsed = new URL(href, LINK_BASE);
    if (parsed.origin !== LINK_BASE) return null;
    return Object.freeze({ label, href });
  } catch (_) {
    return null;
  }
}

function normalizeAdapter(handle) {
  try {
    const api = handle?.api;
    const provider = handle?.provider;
    if (!api || api.apiVersion !== 1 || typeof api.descriptor !== 'function'
        || typeof api.open !== 'function' || typeof api.render !== 'function') return null;
    const descriptor = api.descriptor();
    if (!descriptor || typeof descriptor !== 'object') return null;
    const id = typeof descriptor.id === 'string' && /^[a-z0-9][a-z0-9-]{1,63}$/.test(descriptor.id)
      ? descriptor.id
      : '';
    const label = typeof descriptor.label === 'string' ? descriptor.label : '';
    const descriptorFormats = descriptor.formats;
    const formats = Array.isArray(descriptorFormats)
      ? [...new Set(descriptorFormats.slice(0, 16).filter(format => (
        typeof format === 'string' && FORMAT_PATTERN.test(format)
      )))]
      : [];
    if (!id || !label.trim() || !formats.length) return null;
    const descriptorLinks = descriptor.links;
    const rawLinks = Array.isArray(descriptorLinks) ? descriptorLinks.slice(0, 8) : [];
    const links = rawLinks.map(normalizeLink).filter(Boolean);
    return Object.freeze({
      key: `${provider?.addonId || 'unknown'}:${id}`,
      api,
      provider,
      descriptor: Object.freeze({
        id,
        label,
        description: typeof descriptor.description === 'string' ? descriptor.description : '',
        formats: Object.freeze(formats),
        links: Object.freeze(links),
      }),
    });
  } catch (_) {
    return null;
  }
}

function initialState() {
  return {
    selectedKey: '',
    fileName: '',
    format: '',
    busy: false,
    errorKey: '',
    errorParams: null,
  };
}

export function createImportCenter(host) {
  const { esc, dataAction, dataOn } = host.h;
  const t = (key, params) => host.i18n.t(key, params);
  const active = new Map();
  let state = initialState();
  let generation = 0;
  let disposed = false;

  const refresh = () => { try { host.ui.rerender(); } catch (_) {} };
  const announce = key => { try { host.ui.announce(t(key)); } catch (_) {} };

  function adapters() {
    const seen = new Set();
    return host.listServices(CONTRACT)
      .map(normalizeAdapter)
      .filter(adapter => {
        if (!adapter || seen.has(adapter.key)) return false;
        seen.add(adapter.key);
        return true;
      });
  }

  function returnToChooser(key) {
    if (state.selectedKey !== key) return;
    generation++;
    state = initialState();
    refresh();
  }

  function stopAdapter(entry, { leave = false } = {}) {
    if (!entry) return Promise.resolve();
    active.delete(entry.adapter.key);
    if (entry.deactivate) {
      try { entry.deactivate(); } catch (_) {}
    }
    if (leave && typeof entry.adapter.api.leave === 'function') {
      return Promise.resolve(entry.adapter.api.leave()).catch(() => {});
    }
    return Promise.resolve();
  }

  function ensureActive(available) {
    const availableKeys = new Set(available.map(adapter => adapter.key));
    for (const entry of active.values()) {
      if (!availableKeys.has(entry.adapter.key)) stopAdapter(entry, { leave: true });
    }
    if (state.selectedKey && !availableKeys.has(state.selectedKey)) {
      state = { ...initialState(), errorKey: 'center.adapterUnavailable' };
    }
    for (const adapter of available) {
      const current = active.get(adapter.key);
      if (current?.adapter.api === adapter.api) continue;
      if (current) stopAdapter(current, { leave: true });
      let deactivate = null;
      if (typeof adapter.api.activate === 'function') {
        try {
          const cleanup = adapter.api.activate({
            invalidate: refresh,
            returnToChooser: () => returnToChooser(adapter.key),
          });
          if (typeof cleanup === 'function') deactivate = cleanup;
        } catch (_) {}
      }
      active.set(adapter.key, { adapter, deactivate });
    }
    return available;
  }

  function resourceLinks(adapter) {
    if (!adapter?.descriptor.links.length) return '';
    return `<nav class="codex-cluster" aria-label="${esc(t('center.resources'))}">${adapter.descriptor.links.map(link => (
      `<a class="inline-create-btn" href="${esc(link.href)}" target="_blank" rel="noopener">${esc(link.label)}</a>`
    )).join('')}</nav>`;
  }

  function adapterBody(adapter) {
    let body;
    try { body = adapter.api.render(); }
    catch { body = `<div class="codex-notice"><strong>${esc(t('center.failedTitle'))}</strong><p>${esc(t('center.failedBody'))}</p></div>`; }
    return `<section class="dmt-import-adapter codex-stack" data-import-adapter="${esc(adapter.key)}">
      <div class="codex-section-head"><div><h2>${esc(adapter.descriptor.label)}</h2>
        ${adapter.descriptor.description ? `<p class="settings-hint">${esc(adapter.descriptor.description)}</p>` : ''}</div>${resourceLinks(adapter)}</div>
      ${typeof body === 'string' ? body : ''}
    </section>`;
  }

  function supportedAdapters(available) {
    return `<section class="codex-stack codex-stack-compact" aria-labelledby="dm-import-supported-heading">
      <div class="codex-section-head"><div><h2 id="dm-import-supported-heading">${esc(t('center.supportedTitle'))}</h2>
        <p class="settings-hint">${esc(t('center.supportedBody'))}</p></div></div>
      ${available.map(adapter => `<article class="codex-surface">
        <div class="codex-section-head"><div><strong>${esc(adapter.descriptor.label)}</strong>${adapter.descriptor.description ? `<div class="codex-muted">${esc(adapter.descriptor.description)}</div>` : ''}</div>
          <div class="codex-cluster">${adapter.descriptor.formats.map(format => `<code class="codex-badge">${esc(format)}</code>`).join('')}</div></div>
      </article>`).join('')}
    </section>`;
  }

  function chooser(available) {
    if (!available.length) {
      return `<div class="codex-notice"><strong>${esc(t('center.noneTitle'))}</strong><p>${esc(t('center.noneBody'))}</p></div>`;
    }
    const error = state.errorKey
      ? `<div class="import-error" id="dm-import-routing-error" role="alert"><strong>${esc(t('center.routingError'))}</strong> ${esc(t(state.errorKey, state.errorParams || undefined))}</div>`
      : '';
    return `<div class="codex-stack codex-stack-loose">
      ${error}
      <section class="import-dropzone"${state.busy ? ' aria-busy="true"' : ''}>
        <div class="import-drop-icon" aria-hidden="true">⌁</div>
        <div><h2>${esc(t('center.chooseTitle'))}</h2><p>${esc(t(state.busy ? 'center.inspecting' : 'center.chooseBody'))}</p></div>
        <label class="inline-create-btn import-file-button">${esc(t('center.chooseFile'))}
          <input id="dm-import-file" type="file" accept=".json,application/json"${state.busy ? ' disabled' : ''}${dataOn('change', host.action('selectImportFile'), '$el')}>
        </label>
      </section>
      ${supportedAdapters(available)}
    </div>`;
  }

  function routed(adapter) {
    return `<div class="codex-stack codex-stack-loose">
      <section class="codex-surface codex-surface-accent" aria-label="${esc(t('center.routeTitle'))}">
        <div class="codex-cluster">
          <div class="codex-stack codex-stack-compact"><span class="codex-meta">${esc(t('center.document'))}</span><strong>${esc(state.fileName)}</strong>
            <code class="codex-badge">${esc(state.format)}</code></div>
          <span aria-hidden="true">→</span>
          <div class="codex-stack codex-stack-compact"><span class="codex-meta">${esc(t('center.handledBy'))}</span><strong>${esc(adapter.descriptor.label)}</strong></div>
          <button class="inline-create-btn codex-push-end" type="button"${dataAction(host.action('resetImportCenter'))}>${esc(t('center.chooseAnother'))}</button>
        </div>
      </section>
      ${adapterBody(adapter)}
    </div>`;
  }

  function render() {
    if (!host.role.isDM()) return `<div class="codex-notice">${esc(t('page.dmOnly'))}</div>`;
    const available = ensureActive(adapters());
    const selected = available.find(adapter => adapter.key === state.selectedKey);
    return `<main class="addon-dm-tools dmt-import-center">
      ${host.h.breadcrumb([{ label: t('breadcrumb.tools'), href: '#/dm' }, { label: t('center.title') }])}
      <div class="page-header"><h1>${esc(t('center.title'))}</h1></div>
      <p class="settings-hint">${esc(t('center.intro'))}</p>
      ${selected ? routed(selected) : chooser(available)}
    </main>`;
  }

  function routingFailure(key, params) {
    state = { ...initialState(), errorKey: key, errorParams: params || null };
    refresh();
    announce('center.routingFailed');
  }

  async function selectFile(input) {
    const file = input?.files?.[0] || null;
    if (!file || disposed || state.busy) return;
    const current = ++generation;
    state = { ...initialState(), fileName: typeof file.name === 'string' ? file.name : '', busy: true };
    refresh();
    announce('center.inspectingAnnounce');
    let documentValue;
    try {
      documentValue = JSON.parse(await file.text());
    } catch (_) {
      if (current === generation && !disposed) routingFailure('center.invalidJson');
      return;
    }
    if (current !== generation || disposed) return;
    const format = documentValue && typeof documentValue === 'object' && !Array.isArray(documentValue)
      ? documentValue.format
      : undefined;
    if (typeof format !== 'string' || !format) {
      routingFailure('center.formatMissing');
      return;
    }
    const available = ensureActive(adapters());
    const matches = available.filter(adapter => adapter.descriptor.formats.includes(format));
    if (!matches.length) {
      routingFailure('center.formatUnsupported', { format });
      return;
    }
    if (matches.length > 1) {
      routingFailure('center.formatAmbiguous', { format });
      return;
    }
    const adapter = matches[0];
    state = {
      ...initialState(),
      selectedKey: adapter.key,
      fileName: typeof file.name === 'string' ? file.name : '',
      format,
    };
    refresh();
    announce('center.routed');
    try {
      await adapter.api.open(file);
    } catch (_) {
      await Promise.resolve(adapter.api.leave?.()).catch(() => {});
      if (current === generation && !disposed) {
        routingFailure('center.openFailed', { label: adapter.descriptor.label });
      }
    }
  }

  async function reset() {
    const selectedKey = state.selectedKey;
    generation++;
    state = initialState();
    const entry = active.get(selectedKey);
    if (entry && typeof entry.adapter.api.leave === 'function') {
      await Promise.resolve(entry.adapter.api.leave()).catch(() => {});
    }
    if (!disposed) refresh();
  }

  async function leave() {
    if (disposed) return;
    generation++;
    state = initialState();
    await Promise.all([...active.values()].map(entry => stopAdapter(entry, { leave: true })));
  }

  async function dispose() {
    if (disposed) return;
    await leave();
    disposed = true;
  }

  return Object.freeze({ render, selectFile, reset, leave, dispose });
}
