import { createDashboard } from './dashboard.js';
import { createImportCenter } from './import-center.js';
import { createImportReviewPreview } from './import-review-preview.js';
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

  const center = createImportCenter(host);
  const planner = createStoryPlanner(host);
  const dashboard = createDashboard(host);
  const importReviewPreview = createImportReviewPreview(host);

  host.provide(Object.freeze({
    apiVersion: 1,
    campaignImportReview: importReviewPreview,
  }));

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

  host.registerAction('selectFile', input => center.selectFile(input));
  host.registerAction('preview', () => center.requestPreview());
  host.registerAction('review', () => center.review());
  host.registerAction('confirm', checked => center.confirm(checked));
  host.registerAction('commit', () => center.commit());
  host.registerAction('status', () => center.recoverStatus());
  host.registerAction('cancel', () => center.cancel());
  host.registerAction('reset', () => center.reset());

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
    center.initialize();
    dashboard.initialize();
  };
  if (typeof window !== 'undefined') window.addEventListener('hashchange', routeChanged);
  if (typeof window !== 'undefined') window.addEventListener('role:changed', roleChanged);
  host.onDispose(async () => {
    if (typeof window !== 'undefined') window.removeEventListener('hashchange', routeChanged);
    if (typeof window !== 'undefined') window.removeEventListener('role:changed', roleChanged);
    await Promise.all([center.dispose(), planner.dispose(), dashboard.dispose()]);
  });

  center.initialize();
  dashboard.initialize();
  migratePlanningV2(host).then(result => {
    if (result.migrated) {
      host.ui.announce(host.i18n.t('planner.migration.completed', { n: result.migrated }));
      host.ui.rerender();
    }
    if (result.conflicts.length) host.ui.toast(host.i18n.t('planner.migration.conflict'));
  }).catch(() => host.ui.toast(host.i18n.t('planner.migration.failed')));
}
