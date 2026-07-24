import { createImportCenter } from './import-center.js';
import { createScenarioGraphPage } from './scenario-graph.js';

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
  const center = createImportCenter(host);
  const graph = createScenarioGraphPage(host);
  host.registerRoute('dm-import', () => center.render());
  host.registerRoute('dm-scenarios', () => graph.render());
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

  const routeChanged = () => {
    if (typeof window === 'undefined') return;
    if (!window.location.hash.startsWith('#/dm-import')) center.leave();
    if (!window.location.hash.startsWith('#/dm-scenarios')) graph.leave();
  };
  if (typeof window !== 'undefined') window.addEventListener('hashchange', routeChanged);
  host.onDispose(async () => {
    if (typeof window !== 'undefined') window.removeEventListener('hashchange', routeChanged);
    await Promise.all([center.dispose(), graph.dispose()]);
  });
  center.initialize();
  return () => {};
}
