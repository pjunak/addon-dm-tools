import { createImportCenter } from './import-center.js';

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
  if (!host.role.isDM()) return () => {};

  host.registerCollection('scenarios');
  const center = createImportCenter(host);
  host.registerRoute('dm-import', () => center.render());
  host.registerSidebarPage({
    route: '/dm-import',
    label: host.i18n.t('page.title'),
    icon: '⇩',
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

  const routeChanged = () => {
    if (typeof window !== 'undefined' && !window.location.hash.startsWith('#/dm-import')) {
      center.leave();
    }
  };
  if (typeof window !== 'undefined') window.addEventListener('hashchange', routeChanged);
  host.onDispose(async () => {
    if (typeof window !== 'undefined') window.removeEventListener('hashchange', routeChanged);
    await center.dispose();
  });
  center.initialize();
  return () => {};
}
