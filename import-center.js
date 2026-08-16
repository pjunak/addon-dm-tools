const CONTRACT = 'codex.import-adapter';
const LINK_BASE = 'https://codex.invalid';

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
    if (!api || api.apiVersion !== 1 || typeof api.descriptor !== 'function' || typeof api.render !== 'function') return null;
    const descriptor = api.descriptor();
    if (!descriptor || typeof descriptor !== 'object') return null;
    const id = typeof descriptor.id === 'string' && /^[a-z0-9][a-z0-9-]{1,63}$/.test(descriptor.id)
      ? descriptor.id
      : '';
    const label = typeof descriptor.label === 'string' ? descriptor.label : '';
    if (!id || !label.trim()) return null;
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
        links: Object.freeze(links),
      }),
    });
  } catch (_) {
    return null;
  }
}

export function createImportCenter(host) {
  const { esc } = host.h;
  const t = (key, params) => host.i18n.t(key, params);
  const active = new Map();
  let disposed = false;

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
    for (const adapter of available) {
      const current = active.get(adapter.key);
      if (current?.adapter.api === adapter.api) continue;
      if (current) stopAdapter(current, { leave: true });
      let deactivate = null;
      if (typeof adapter.api.activate === 'function') {
        try {
          const cleanup = adapter.api.activate({ invalidate: () => host.ui.rerender() });
          if (typeof cleanup === 'function') deactivate = cleanup;
        } catch (_) {}
      }
      active.set(adapter.key, { adapter, deactivate });
    }
    return available;
  }

  function adapterBody(adapter) {
    if (!adapter) return `<div class="codex-notice"><strong>${esc(t('center.noneTitle'))}</strong><p>${esc(t('center.noneBody'))}</p></div>`;
    let body;
    try { body = adapter.api.render(); }
    catch { body = `<div class="codex-notice"><strong>${esc(t('center.failedTitle'))}</strong><p>${esc(t('center.failedBody'))}</p></div>`; }
    const links = adapter.descriptor.links.length
      ? `<nav class="codex-cluster" aria-label="${esc(t('center.resources'))}">${adapter.descriptor.links.map(link => (
        `<a class="inline-create-btn" href="${esc(link.href)}" target="_blank" rel="noopener">${esc(link.label)}</a>`
      )).join('')}</nav>`
      : '';
    return `<section class="dmt-import-adapter" data-import-adapter="${esc(adapter.key)}">
      <div class="codex-section-head"><div><h2>${esc(adapter.descriptor.label)}</h2>
        ${adapter.descriptor.description ? `<p class="settings-hint">${esc(adapter.descriptor.description)}</p>` : ''}</div>${links}</div>
      ${typeof body === 'string' ? body : ''}
    </section>`;
  }

  function render() {
    if (!host.role.isDM()) return `<div class="codex-notice">${esc(t('page.dmOnly'))}</div>`;
    const available = ensureActive(adapters());
    const body = available.length
      ? `<div class="codex-stack codex-stack-loose">${available.map(adapterBody).join('')}</div>`
      : adapterBody(null);
    return `<div class="dmt-import-center">
      <header class="page-header"><div><p class="codex-meta">${esc(t('center.kicker'))}</p>
        <h1>⌁ ${esc(t('center.title'))}</h1><p class="subtitle">${esc(t('center.intro'))}</p></div></header>
      ${body}
    </div>`;
  }

  async function leave() {
    if (disposed) return;
    await Promise.all([...active.values()].map(entry => stopAdapter(entry, { leave: true })));
  }

  async function dispose() {
    if (disposed) return;
    await leave();
    disposed = true;
  }

  return Object.freeze({ render, leave, dispose });
}
