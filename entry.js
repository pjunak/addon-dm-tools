import { createDashboard } from './dashboard.js';
import { createImportCenter } from './import-center.js';
import { createPlanningImportAdapter } from './planning-import-adapter.js';
import { migratePlanningV2 } from './planning-migration.js';
import { createStoryPlanner } from './story-planner.js';

const REQUIRED_CAPABILITIES = Object.freeze([
  'collections.dm',
  'collections.transactions',
  'imports.providers',
  'i18n.catalogs',
]);

export default function register(host) {
  for (const capability of REQUIRED_CAPABILITIES) {
    if (!host.capabilities.has(capability)) {
      throw new Error(`DM Tools requires the ${capability} host capability.`);
    }
  }
  if (!host.role.isDM()) return () => {};

  [
    'scenarios',
    'planning_items',
    'planning_folders',
    'planning_links',
    'planning_flow_links',
    'planning_references',
    'planning_consequences',
    'dm_notes',
    'planning_views',
  ].forEach(name => host.registerCollection(name));

  const planningImport = createPlanningImportAdapter(host);
  host.provideService('codex.import-adapter', '1.0.0', Object.freeze({
    apiVersion: 1,
    descriptor: () => Object.freeze({
      id: 'planning-json',
      label: host.i18n.t('page.title'),
      description: host.i18n.t('page.description'),
      accept: '.json,application/json',
      links: Object.freeze([]),
    }),
    render: () => planningImport.render(),
    leave: () => planningImport.leave(),
  }));
  const center = createImportCenter(host);
  const planner = createStoryPlanner(host);
  const dashboard = createDashboard(host);

  host.registerSlot('dm:dashboard', () => dashboard.render());
  host.registerRoute('dm-plans', (sub, parts) => planner.render(sub, parts));
  host.registerRoute('dm-import', () => center.render());
  host.registerSidebarPage({
    route: '/dm-plans',
    label: host.i18n.t('planner.page.title'),
    icon: '✦',
    role: 'dm',
  });
  host.registerSidebarPage({
    route: '/dm-import',
    label: host.i18n.t('page.title'),
    icon: '⇩',
    role: 'dm',
  });

  host.registerAction('selectFile', input => planningImport.selectFile(input));
  host.registerAction('preview', () => planningImport.requestPreview());
  host.registerAction('review', () => planningImport.review());
  host.registerAction('confirm', checked => planningImport.confirm(checked));
  host.registerAction('commit', () => planningImport.commit());
  host.registerAction('status', () => planningImport.recoverStatus());
  host.registerAction('cancel', () => planningImport.cancel());
  host.registerAction('reset', () => planningImport.reset());
  host.registerAction('selectImportAdapter', key => center.select(key));

  host.registerAction('plannerOpenItem', id => planner.openItem(id));
  host.registerAction('plannerSelectItem', id => planner.selectItem(id));
  host.registerAction('plannerCreateItem', (kind, subtype) => planner.createItem(kind, subtype));
  host.registerAction('plannerEditItem', id => planner.editItem(id));
  host.registerAction('plannerCancelEdit', () => planner.cancelEdit());
  host.registerAction('plannerSaveItem', event => planner.saveItem(event));
  host.registerAction('plannerDeleteItem', id => planner.deleteItem(id));
  host.registerAction('plannerSaveFlow', (event, sourceId) => planner.saveFlow(event, sourceId));
  host.registerAction('plannerUpdateFlow', (event, id) => planner.updateFlow(event, id));
  host.registerAction('plannerDeleteFlow', id => planner.deleteFlow(id));
  host.registerAction('plannerSaveCoreReference', (event, itemId) => (
    planner.saveCoreReference(event, itemId)
  ));
  host.registerAction('plannerSaveExternalReference', (event, itemId) => (
    planner.saveExternalReference(event, itemId)
  ));
  host.registerAction('plannerSavePlanningReference', (event, itemId) => (
    planner.savePlanningReference(event, itemId)
  ));
  host.registerAction('plannerUpdateReference', (event, id) => (
    planner.updateReference(event, id)
  ));
  host.registerAction('plannerDeleteReference', id => planner.deleteReference(id));
  host.registerAction('plannerSaveConsequence', (event, itemId) => (
    planner.saveConsequence(event, itemId)
  ));
  host.registerAction('plannerUpdateConsequence', (event, id) => (
    planner.updateConsequence(event, id)
  ));
  host.registerAction('plannerDeleteConsequence', id => planner.deleteConsequence(id));
  host.registerAction('plannerSaveNote', (event, itemId) => planner.saveNote(event, itemId));
  host.registerAction('plannerUpdateNote', (event, id) => planner.updateNote(event, id));
  host.registerAction('plannerDeleteNote', id => planner.deleteNote(id));
  host.registerAction('plannerResetLayout', () => planner.resetLayout());

  const routeChanged = () => {
    if (typeof window === 'undefined') return;
    if (!window.location.hash.startsWith('#/dm-import')) center.leave();
    if (!window.location.hash.startsWith('#/dm-plans')) planner.leave();
  };
  const roleChanged = () => {
    if (!host.role.isDM()) {
      dashboard.leave();
      center.leave().catch(() => {});
      planner.leave();
      return;
    }
    planningImport.initialize();
    dashboard.initialize();
  };
  if (typeof window !== 'undefined') window.addEventListener('hashchange', routeChanged);
  if (typeof window !== 'undefined') window.addEventListener('role:changed', roleChanged);
  host.onDispose(async () => {
    if (typeof window !== 'undefined') window.removeEventListener('hashchange', routeChanged);
    if (typeof window !== 'undefined') window.removeEventListener('role:changed', roleChanged);
    await Promise.all([center.dispose(), planningImport.dispose(), planner.dispose(), dashboard.dispose()]);
  });

  planningImport.initialize();
  dashboard.initialize();
  migratePlanningV2(host).then(result => {
    if (result.migrated) {
      host.ui.announce(host.i18n.t('planner.migration.completed', { n: result.migrated }));
      host.ui.rerender();
    }
    if (result.conflicts.length) host.ui.toast(host.i18n.t('planner.migration.conflict'));
  }).catch(() => host.ui.toast(host.i18n.t('planner.migration.failed')));
}
