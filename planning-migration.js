import {
  PLANNING_SCHEMA_VERSION,
  normalizeDmNote,
  normalizePlanningFlow,
  normalizePlanningItem,
  normalizePlanningReference,
  validatePlanningDataset,
} from './planning-contract.js';

const COLLECTIONS = Object.freeze([
  'scenarios',
  'planning_items',
  'planning_folders',
  'planning_links',
  'planning_flow_links',
  'planning_references',
  'dm_notes',
  'planning_views',
]);
const MIGRATION_ID = 'planner-schema-v2';
const KIND_MAP = Object.freeze({
  thread: 'plotline',
  quest: 'quest',
  scenario: 'event',
  encounter: 'event',
  note: 'event',
});
const RELATION_MAP = Object.freeze({
  related: 'related',
  involves: 'involves',
  supports: 'supports',
  opposes: 'opposes',
  reveals: 'reveals',
  requires: 'requires',
});

function hash(value) {
  let result = 2166136261;
  for (let index = 0; index < value.length; index++) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return (result >>> 0).toString(16).padStart(8, '0');
}

function migrationId(prefix, identity) {
  return `${prefix}-${hash(identity)}`;
}

function records(value) {
  if (Array.isArray(value)) return value;
  return Object.entries(value || {}).map(([id, record]) => (
    record && typeof record === 'object' ? { id, ...record } : { id }
  ));
}

function timestamp(value) {
  if (Number.isSafeInteger(value) && value >= 0) return value;
  const parsed = typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function normalized(result, conflicts, identity) {
  if (result.value) return result.value;
  conflicts.push(identity);
  return null;
}

function folderItems(folders, conflicts) {
  const ids = new Map(folders.map(folder => [
    folder.id,
    migrationId('plotline', `folder:${folder.id}`),
  ]));
  return {
    ids,
    items: folders.map(folder => normalized(normalizePlanningItem({
      id: ids.get(folder.id),
      schemaVersion: PLANNING_SCHEMA_VERSION,
      kind: 'plotline',
      parentId: folder.parentId ? ids.get(folder.parentId) || null : null,
      title: folder.name,
      summary: '',
      body: '',
      objective: '',
      setup: '',
      resolution: '',
      tags: [],
      updatedAt: timestamp(folder.updatedAt),
    }, ['legacy', 'folders', folder.id]), conflicts, `folder:${folder.id}`)).filter(Boolean),
  };
}

function legacyItem(item, folderIds, conflicts) {
  const kind = KIND_MAP[item.kind];
  if (!kind) {
    conflicts.push(`item:${item.id}`);
    return { item: null, sections: [], note: null };
  }
  const eventType = item.kind === 'encounter' ? 'encounter' : 'story';
  const converted = normalized(normalizePlanningItem({
    id: item.id,
    schemaVersion: PLANNING_SCHEMA_VERSION,
    kind,
    parentId: item.folderId ? folderIds.get(item.folderId) || null : null,
    title: item.title,
    summary: item.summary || '',
    body: item.kind === 'note' ? '' : item.body || '',
    objective: '',
    setup: '',
    resolution: '',
    ...(kind === 'event' ? { eventType } : {}),
    tags: Array.isArray(item.tags) ? item.tags : [],
    updatedAt: timestamp(item.updatedAt),
  }, ['legacy', 'items', item.id]), conflicts, `item:${item.id}`);
  const sections = (Array.isArray(item.sections) ? item.sections : []).map(section => {
    const id = migrationId('event', `section:${item.id}:${section.id}`);
    return normalized(normalizePlanningItem({
      id,
      schemaVersion: PLANNING_SCHEMA_VERSION,
      kind: 'event',
      parentId: converted?.kind === 'plotline' || converted?.kind === 'quest'
        ? converted.id
        : converted?.parentId || null,
      title: section.title,
      summary: '',
      body: section.body || '',
      objective: '',
      setup: '',
      resolution: '',
      eventType: 'story',
      tags: [],
      updatedAt: timestamp(item.updatedAt),
    }, ['legacy', 'items', item.id, 'sections', section.id]), conflicts, `section:${item.id}:${section.id}`);
  }).filter(Boolean);
  const note = item.kind === 'note' && converted
    ? normalized(normalizeDmNote({
        id: migrationId('note', `item:${item.id}`),
        schemaVersion: PLANNING_SCHEMA_VERSION,
        title: item.title,
        body: item.body || item.summary || '',
        anchorIds: [converted.id],
        updatedAt: timestamp(item.updatedAt),
      }, ['legacy', 'notes', item.id]), conflicts, `note:${item.id}`)
    : null;
  return { item: converted, sections, note };
}

function legacyScenario(scenario, conflicts) {
  return normalized(normalizePlanningItem({
    id: scenario.id,
    schemaVersion: PLANNING_SCHEMA_VERSION,
    kind: 'event',
    parentId: null,
    title: scenario.name,
    summary: scenario.summary || '',
    body: '',
    objective: '',
    setup: '',
    resolution: '',
    eventType: 'story',
    tags: Array.isArray(scenario.tags) ? scenario.tags : [],
    updatedAt: timestamp(scenario.updatedAt),
  }, ['legacy', 'scenarios', scenario.id]), conflicts, `scenario:${scenario.id}`);
}

function endpointItemId(endpoint, sectionIds) {
  if (endpoint?.scope !== 'planning') return '';
  if (endpoint.sectionId) return sectionIds.get(`${endpoint.itemId}:${endpoint.sectionId}`) || '';
  return endpoint.itemId || '';
}

function targetFromEndpoint(endpoint, sectionIds) {
  if (endpoint?.scope === 'planning') {
    const itemId = endpointItemId(endpoint, sectionIds);
    return itemId ? { scope: 'planning', itemId } : null;
  }
  if (endpoint?.scope === 'core') {
    return {
      scope: 'core',
      collection: endpoint.collection,
      id: endpoint.id,
    };
  }
  if (endpoint?.scope === 'external') {
    return {
      scope: 'external',
      addonId: endpoint.addonId,
      kind: endpoint.kind,
      id: endpoint.id,
      label: endpoint.label,
    };
  }
  return null;
}

function legacyLink(link, sectionIds, conflicts) {
  const sourceId = endpointItemId(link.source, sectionIds);
  const targetId = endpointItemId(link.target, sectionIds);
  if ((link.type === 'precedes' || link.type === 'branches') && sourceId && targetId) {
    // V1 allowed `branches` from every item kind; v2 option edges require an
    // explicit branch node, so preserving the label on a normal flow is the
    // only translation that neither invents a decision nor rejects old data.
    return {
      flow: normalized(normalizePlanningFlow({
        id: link.id,
        schemaVersion: PLANNING_SCHEMA_VERSION,
        sourceId,
        targetId,
        kind: 'continues',
        label: link.name || '',
        updatedAt: timestamp(link.updatedAt),
      }, ['legacy', 'links', link.id]), conflicts, `link:${link.id}`),
      reference: null,
    };
  }
  const planningEndpoint = sourceId ? link.source : targetId ? link.target : null;
  const otherEndpoint = sourceId ? link.target : targetId ? link.source : null;
  const itemId = endpointItemId(planningEndpoint, sectionIds);
  const target = targetFromEndpoint(otherEndpoint, sectionIds);
  if (!itemId || !target) {
    conflicts.push(`link:${link.id}`);
    return { flow: null, reference: null };
  }
  return {
    flow: null,
    reference: normalized(normalizePlanningReference({
      id: link.id,
      schemaVersion: PLANNING_SCHEMA_VERSION,
      itemId,
      name: link.name,
      relation: RELATION_MAP[link.type] || 'related',
      target,
      quantity: 1,
      notes: link.notes || '',
      updatedAt: timestamp(link.updatedAt),
    }, ['legacy', 'links', link.id]), conflicts, `link:${link.id}`),
  };
}

export function buildLegacyMigration({
  scenarios = [],
  items = [],
  folders = [],
  links = [],
} = {}) {
  const conflicts = [];
  const oldItems = items.filter(item => item?.schemaVersion !== PLANNING_SCHEMA_VERSION);
  const currentItems = items.filter(item => item?.schemaVersion === PLANNING_SCHEMA_VERSION);
  const foldersResult = folderItems(folders, conflicts);
  const converted = oldItems.map(item => legacyItem(item, foldersResult.ids, conflicts));
  const migratedItems = [
    ...currentItems,
    ...foldersResult.items,
    ...converted.flatMap(value => [value.item, ...value.sections]).filter(Boolean),
  ];
  const existingIds = new Set(migratedItems.map(item => item.id));
  let migratedScenarios = 0;
  for (const scenario of scenarios) {
    if (existingIds.has(scenario?.id)) continue;
    const convertedScenario = legacyScenario(scenario, conflicts);
    if (convertedScenario) {
      existingIds.add(convertedScenario.id);
      migratedItems.push(convertedScenario);
      migratedScenarios++;
    }
  }
  const sectionIds = new Map();
  oldItems.forEach((item, itemIndex) => {
    (Array.isArray(item.sections) ? item.sections : []).forEach(section => {
      const convertedId = migrationId('event', `section:${item.id}:${section.id}`);
      if (converted[itemIndex]?.sections.some(value => value.id === convertedId)) {
        sectionIds.set(`${item.id}:${section.id}`, convertedId);
      }
    });
  });
  const migratedLinks = links.map(link => legacyLink(link, sectionIds, conflicts));
  const flowLinks = migratedLinks.map(value => value.flow).filter(Boolean);
  const references = migratedLinks.map(value => value.reference).filter(Boolean);
  const notes = converted.map(value => value.note).filter(Boolean);
  const validation = validatePlanningDataset({
    items: migratedItems,
    flowLinks,
    references,
    notes,
  });
  validation.forEach(error => conflicts.push(`${error.code}:${error.path.join('.')}`));
  return {
    items: migratedItems,
    flowLinks,
    references,
    notes,
    conflicts: [...new Set(conflicts)],
    migrated: migratedScenarios + oldItems.length + foldersResult.items.length + flowLinks.length
      + references.length + notes.length,
  };
}

export async function migratePlanningV2(host) {
  const views = host.store.collection('planning_views');
  if (views.get?.(MIGRATION_ID)) return { migrated: 0, conflicts: [] };
  const source = {
    scenarios: records(host.store.collection('scenarios').list()),
    items: records(host.store.collection('planning_items').list()),
    folders: records(host.store.collection('planning_folders').list()),
    links: records(host.store.collection('planning_links').list()),
  };
  const result = buildLegacyMigration(source);
  if (result.conflicts.length) return result;
  if (!result.migrated) {
    await views.save({
      id: MIGRATION_ID,
      schemaVersion: PLANNING_SCHEMA_VERSION,
      completedAt: Date.now(),
    });
    return result;
  }
  await host.store.transaction(COLLECTIONS, tx => {
    const itemCollection = tx.collection('planning_items');
    const flowCollection = tx.collection('planning_flow_links');
    const referenceCollection = tx.collection('planning_references');
    const noteCollection = tx.collection('dm_notes');
    const viewCollection = tx.collection('planning_views');
    result.items.forEach(item => itemCollection.put(item));
    result.flowLinks.forEach(link => flowCollection.put(link));
    result.references.forEach(reference => referenceCollection.put(reference));
    result.notes.forEach(note => noteCollection.put(note));
    viewCollection.put({
      id: MIGRATION_ID,
      schemaVersion: PLANNING_SCHEMA_VERSION,
      completedAt: Date.now(),
    });
  }, { timeoutMs: 10_000 });
  return result;
}
