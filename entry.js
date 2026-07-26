import { createImportCenter } from './import-center.js';
import { createPlanningGraphPage } from './planning-graph.js';
import { createPlanningWorkspace } from './planning-workspace.js';
import { migrateLegacyScenarios } from './planning-migration.js';
import { createDashboard } from './dashboard.js';

export default function register(host) {
  if (!host.capabilities.has('collections.dm')) {
    throw new Error('DM Tools requires the collections.dm host capability.');
  }
  if (!host.capabilities.has('collections.transactions')) {
    throw new Error('DM Tools requires the collections.transactions host capability.');
  }
  if (!host.capabilities.has('imports.providers')) {
    throw new Error('DM Tools requires the imports.providers host capability.');
  }
  if (!host.capabilities.has('i18n.catalogs')) {
    throw new Error('DM Tools requires the i18n.catalogs host capability.');
  }
  if (!host.capabilities.has('graphs.facade')) {
    throw new Error('DM Tools requires the graphs.facade host capability.');
  }
  if (!host.role.isDM()) return () => {};

  host.registerCollection('scenarios');
  host.registerCollection('planning_items');
  host.registerCollection('planning_folders');
  host.registerCollection('planning_links');
  host.registerCollection('planning_views');
  const center = createImportCenter(host);
  const graph = createPlanningGraphPage(host);
  const workspace = createPlanningWorkspace(host);
  const dashboard = createDashboard(host);
  host.registerSlot('dm:dashboard', () => dashboard.render());
  host.registerRoute('dm-import', () => center.render());
  host.registerRoute('dm-plans', () => workspace.render());
  host.registerRoute('dm-scenarios', () => graph.render());
  host.registerSidebarPage({
    route: '/dm-plans',
    label: host.i18n.t('planning.page.title'),
    icon: '✦',
    role: 'dm',
  });
  host.registerSidebarPage({
    route: '/dm-import',
    label: host.i18n.t('page.title'),
    icon: '⇩',
    role: 'dm',
  });
  host.registerSidebarPage({
    route: '/dm-scenarios',
    label: host.i18n.t('graph.page.title'),
    icon: '⌘',
    role: 'dm',
  });
  host.registerAction('selectFile', input => center.selectFile(input));
  host.registerAction('preview', () => center.requestPreview());
  host.registerAction('review', () => center.review());
  host.registerAction('confirm', checked => center.confirm(checked));
  host.registerAction('commit', () => center.commit());
  host.registerAction('status', () => center.recoverStatus());
  host.registerAction('cancel', () => center.cancel());
  host.registerAction('reset', () => center.reset());
  host.registerAction('graphFocus', id => graph.focus(id));
  host.registerAction('graphFit', () => graph.fit());
  host.registerAction('graphToggleExpand', id => graph.toggleExpand(id));
  host.registerAction('graphResetLayout', () => graph.resetLayout());
  host.registerAction('graphCreateLink', event => graph.createLink(event));
  host.registerAction('graphDeleteLink', id => graph.deleteLink(id));
  host.registerAction('graphEditPlanning', id => {
    workspace.selectItem(id);
    if (typeof window !== 'undefined') window.location.hash = '#/dm-plans';
  });
  host.registerAction('selectItem', id => workspace.selectItem(id));
  host.registerAction('createItem', kind => workspace.createItem(kind));
  host.registerAction('saveItem', event => workspace.saveItem(event));
  host.registerAction('addSection', event => workspace.addSection(event));
  host.registerAction('removeSection', (event, id) => workspace.removeSection(event, id));
  host.registerAction('deleteItem', id => workspace.deleteItem(id));
  host.registerAction('saveFolder', (event, id) => workspace.saveFolder(event, id));
  host.registerAction('deleteFolder', id => workspace.deleteFolder(id));
  host.registerAction('saveEntityLink', event => workspace.saveEntityLink(event));
  host.registerAction('saveItemLink', event => workspace.saveItemLink(event));
  host.registerAction('saveExternalLink', event => workspace.saveExternalLink(event));
  host.registerAction('updateLink', (event, id) => workspace.updateLink(event, id));
  host.registerAction('deleteLink', id => workspace.deleteLink(id));

  const routeChanged = () => {
    if (typeof window === 'undefined') return;
    if (!window.location.hash.startsWith('#/dm-import')) center.leave();
    if (!window.location.hash.startsWith('#/dm-scenarios')) graph.leave();
  };
  const roleChanged = () => {
    if (!host.role.isDM()) {
      dashboard.leave();
      Promise.all([center.leave(), graph.leave()]).catch(() => {});
      return;
    }
    center.initialize();
    dashboard.initialize();
  };
  if (typeof window !== 'undefined') window.addEventListener('hashchange', routeChanged);
  if (typeof window !== 'undefined') window.addEventListener('role:changed', roleChanged);
  host.onDispose(async () => {
    if (typeof window !== 'undefined') window.removeEventListener('hashchange', routeChanged);
    if (typeof window !== 'undefined') window.removeEventListener('role:changed', roleChanged);
    await Promise.all([center.dispose(), graph.dispose(), dashboard.dispose()]);
  });
  center.initialize();
  dashboard.initialize();
  migrateLegacyScenarios(host).then(result => {
    if (result.migrated) {
      host.ui.announce(host.i18n.plural('planning.migration.completed', result.migrated));
      host.ui.rerender();
    }
    if (result.conflicts.length) host.ui.toast(host.i18n.t('planning.migration.conflict'));
  }).catch(() => {
    host.ui.toast(host.i18n.t('planning.migration.failed'));
  });
}
