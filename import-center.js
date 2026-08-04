const CONTRACT = 'codex.import-adapter';

function normalizeAdapter(handle) {
  const api = handle?.api;
  const provider = handle?.provider;
  if (!api || api.apiVersion !== 1 || typeof api.descriptor !== 'function' || typeof api.render !== 'function') return null;
  let descriptor;
  try { descriptor = api.descriptor(); } catch { return null; }
  if (!descriptor || typeof descriptor !== 'object') return null;
  const id = typeof descriptor.id === 'string' && /^[a-z0-9][a-z0-9-]{1,63}$/.test(descriptor.id)
    ? descriptor.id
    : '';
  if (!id || typeof descriptor.label !== 'string' || !descriptor.label.trim()) return null;
  const links = Array.isArray(descriptor.links) ? descriptor.links.filter(link => (
    link && typeof link.label === 'string' && typeof link.href === 'string' && /^\/(?!\/)/.test(link.href)
  )).slice(0, 8) : [];
  return {
    key: `${provider?.addonId || 'unknown'}:${id}`,
    api,
    provider,
    descriptor: {
      id,
      label: descriptor.label,
      description: typeof descriptor.description === 'string' ? descriptor.description : '',
      links,
    },
  };
}

export function createImportCenter(host) {
  const { esc, dataAction } = host.h;
  const t = (key, params) => host.i18n.t(key, params);
  let activeKey = '';
  let active = null;
  let deactivate = null;
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

  function stopActive({ leave = false } = {}) {
    if (deactivate) {
      try { deactivate(); } catch (_) {}
      deactivate = null;
    }
    if (leave && active?.api && typeof active.api.leave === 'function') {
      Promise.resolve(active.api.leave()).catch(() => {});
    }
    active = null;
  }

  function ensureActive(available) {
    const next = available.find(adapter => adapter.key === activeKey) || available[0] || null;
    if (!next) {
      stopActive({ leave: true });
      activeKey = '';
      return null;
    }
    if (active?.key === next.key) return active;
    stopActive({ leave: true });
    active = next;
    activeKey = next.key;
    if (typeof next.api.activate === 'function') {
      try {
        const cleanup = next.api.activate({ invalidate: () => host.ui.rerender() });
        if (typeof cleanup === 'function') deactivate = cleanup;
      } catch (_) {
        deactivate = null;
      }
    }
    return active;
  }

  function select(key) {
    if (disposed || !host.role.isDM()) return;
    const available = adapters();
    if (!available.some(adapter => adapter.key === key)) return;
    activeKey = key;
    ensureActive(available);
    host.ui.rerender();
    host.ui.announce(t('center.adapterSelected'));
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
    const available = adapters();
    const current = ensureActive(available);
    const tabs = available.length > 1 ? `<div class="codex-tab-strip" role="tablist" aria-label="${esc(t('center.adapters'))}">
      ${available.map(adapter => `<button type="button" role="tab" aria-selected="${adapter.key === current?.key}"
        class="codex-tab${adapter.key === current?.key ? ' is-active' : ''}"${dataAction(host.action('selectImportAdapter'), adapter.key)}>
        ${esc(adapter.descriptor.label)}</button>`).join('')}
    </div>` : '';
    return `<div class="dmt-import-center">
      <header class="page-header"><div><p class="codex-meta">${esc(t('center.kicker'))}</p>
        <h1>⌁ ${esc(t('center.title'))}</h1><p class="subtitle">${esc(t('center.intro'))}</p></div></header>
      ${tabs}${adapterBody(current)}
    </div>`;
  }

  async function leave() {
    if (disposed) return;
    const current = active;
    stopActive();
    if (current?.api && typeof current.api.leave === 'function') await Promise.resolve(current.api.leave()).catch(() => {});
  }

  async function dispose() {
    if (disposed) return;
    await leave();
    disposed = true;
  }

  return Object.freeze({ render, select, leave, dispose });
}
