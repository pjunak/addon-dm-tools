import { itemAncestors, projectScope } from './story-planner-model.js';
import { renderStoryCanvas } from './story-planner-render.js';
import { STORY_PLANNER_STYLES } from './story-planner-styles.js';

const FORMAT = 'dm-tools-planning';
const SCHEMA_VERSION = 2;

function planningDocument(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (value.format !== FORMAT || value.schemaVersion !== SCHEMA_VERSION) return null;
  const arrays = ['items', 'flowLinks', 'references', 'consequences', 'notes'];
  if (arrays.some(field => !Array.isArray(value[field]))) return null;
  return value;
}

function scopePath(view, host) {
  const { esc } = host.h;
  const t = key => host.i18n.t(key);
  const scopes = view.scopeId ? itemAncestors(view.scopeId, view.data.items) : [];
  return [
    `<button type="button" data-dmt-import-scope="">${esc(t('planner.campaign'))}</button>`,
    ...scopes.map(item => (
      `<span aria-hidden="true">/</span><button type="button" data-dmt-import-scope="${esc(item.id)}">${esc(item.title)}</button>`
    )),
  ].join('');
}

export function createImportReviewPreview(host) {
  function project({ document, scopeId = null, selectedId = '' } = {}) {
    const source = planningDocument(document);
    if (!source) return null;
    const roots = source.items.filter(item => !item.parentId);
    const requestedScope = source.items.find(item => (
      item.id === scopeId && (item.kind === 'plotline' || item.kind === 'quest')
    ));
    const defaultScope = scopeId == null
      && roots.length === 1
      && (roots[0].kind === 'plotline' || roots[0].kind === 'quest')
      ? roots[0]
      : null;
    const resolvedScopeId = requestedScope?.id || defaultScope?.id || null;
    const projection = projectScope({
      ...source,
      scopeId: resolvedScopeId,
      positions: {},
    });
    const resolvedSelectedId = projection.nodes.some(node => node.item.id === selectedId)
      ? selectedId
      : projection.nodes[0]?.item.id || '';
    return {
      data: source,
      projection,
      scopeId: resolvedScopeId || '',
      selectedId: resolvedSelectedId,
    };
  }

  function render({ view, inspectorHtml = '' } = {}) {
    if (!view?.projection || !view.data) return '';
    const { esc } = host.h;
    const t = (key, params) => host.i18n.t(key, params);
    return `<div class="addon-dm-tools dmt-import-preview">
      ${STORY_PLANNER_STYLES}
      <style>
        .dmt-import-preview .dmt-planner-workbench{min-height:38rem}
        .dmt-import-preview .dmt-planner-stage{grid-template-rows:auto minmax(32rem,68vh)}
        .dmt-import-preview .dmt-story-node{cursor:pointer;touch-action:auto}
        .dmt-import-preview .dmt-story-node:active{cursor:pointer}
        .dmt-import-preview .dmt-node-port{display:none}
        .dmt-import-preview .dmt-import-scope-path{display:flex;align-items:center;gap:var(--space-1);flex-wrap:wrap}
        .dmt-import-preview .dmt-import-scope-path button{padding:0;border:0;background:none;color:var(--accent-gold);font:inherit;cursor:pointer}
        .dmt-import-preview .dmt-import-scope-path button:hover,
        .dmt-import-preview .dmt-import-scope-path button:focus-visible{text-decoration:underline}
        .dmt-import-preview .import-change{margin:0}
        .dmt-import-preview .import-diff{grid-template-columns:1fr}
      </style>
      <section class="dmt-planner-workbench">
        <div class="dmt-planner-stage">
          <div class="dmt-planner-stagebar">
            <span class="dmt-import-scope-path">${scopePath(view, host)}</span>
            <span>${esc(t('planner.canvas.counts', {
              nodes: view.projection.nodes.length,
              links: view.projection.flowLinks.length,
            }))}</span>
          </div>
          ${renderStoryCanvas(view.projection, view.selectedId, host)}
        </div>
        <aside class="dmt-planner-inspector" data-dmt-import-inspector
          aria-label="${esc(t('planner.inspector.title'))}">
          ${inspectorHtml || `<div>
            <p class="dmt-inspector-eyebrow">${esc(t('planner.inspector.title'))}</p>
            <h2>${esc(t('planner.inspector.emptyTitle'))}</h2>
            <p class="settings-hint">${esc(t('planner.inspector.emptyBody'))}</p>
          </div>`}
        </aside>
      </section>
    </div>`;
  }

  function mount({ root, onSelect, onScope } = {}) {
    if (!root) return () => {};
    const removers = [];
    const listen = (target, event, handler) => {
      target.addEventListener(event, handler);
      removers.push(() => target.removeEventListener(event, handler));
    };
    const select = id => {
      root.querySelectorAll('.dmt-story-node.is-selected')
        .forEach(node => node.classList.remove('is-selected'));
      root.querySelector(`[data-dmt-node="${CSS.escape(id)}"]`)?.classList.add('is-selected');
      onSelect?.(id);
    };
    for (const node of root.querySelectorAll('[data-dmt-node]')) {
      const id = node.dataset.dmtNode;
      listen(node, 'click', () => select(id));
      listen(node, 'dblclick', event => {
        event.preventDefault();
        const item = root.querySelector(`[data-dmt-node="${CSS.escape(id)}"]`);
        if (['plotline', 'quest'].includes(item?.dataset.kind)) onScope?.(id);
        else select(id);
      });
      listen(node, 'keydown', event => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        select(id);
      });
    }
    for (const button of root.querySelectorAll('[data-dmt-import-scope]')) {
      listen(button, 'click', () => onScope?.(button.dataset.dmtImportScope || ''));
    }
    return () => removers.splice(0).reverse().forEach(remove => remove());
  }

  return Object.freeze({
    apiVersion: 1,
    project,
    render,
    mount,
  });
}
