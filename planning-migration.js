import {
  PLANNING_SCHEMA_VERSION,
  normalizePlanningItem,
} from './planning-contract.js';

const STATUS_MAP = Object.freeze({
  planned: 'idea',
  active: 'active',
  completed: 'resolved',
});

function legacyTimestamp(value) {
  if (Number.isSafeInteger(value) && value >= 0) return value;
  const parsed = typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

export function scenarioToPlanningItem(scenario) {
  const normalized = normalizePlanningItem({
    id: scenario?.id,
    schemaVersion: PLANNING_SCHEMA_VERSION,
    kind: 'scenario',
    title: scenario?.name,
    summary: scenario?.summary || '',
    body: '',
    folderId: null,
    tags: Array.isArray(scenario?.tags) ? scenario.tags : [],
    state: STATUS_MAP[scenario?.status] || 'idea',
    pinned: false,
    sections: [],
    updatedAt: legacyTimestamp(scenario?.updatedAt),
  }, ['scenarios', scenario?.id || '']);
  return normalized.value;
}

function sameMigratedItem(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export async function migrateLegacyScenarios(host) {
  const scenarios = host.store.collection('scenarios').list();
  if (!scenarios.length) return { migrated: 0, conflicts: [] };
  const conflicts = [];
  let migrated = 0;
  for (let offset = 0; offset < scenarios.length; offset += 100) {
    const batch = scenarios.slice(offset, offset + 100);
    const result = await host.store.transaction(
      ['scenarios', 'planning_items'],
      tx => {
        const source = tx.collection('scenarios');
        const target = tx.collection('planning_items');
        let changed = 0;
        const blocked = [];
        for (const legacy of batch) {
          const currentLegacy = source.get(legacy?.id);
          if (!currentLegacy) continue;
          const item = scenarioToPlanningItem(currentLegacy);
          if (!item) {
            blocked.push(legacy?.id || '');
            continue;
          }
          const current = target.get(item.id);
          if (current) {
            const currentItem = normalizePlanningItem(
              { id: item.id, ...current },
              ['planning_items', item.id],
            ).value;
            if (!currentItem || !sameMigratedItem(currentItem, item)) {
              blocked.push(item.id);
              continue;
            }
          } else {
            target.put(item);
            changed++;
          }
        }
        return { changed, blocked };
      },
      { timeoutMs: 10_000 },
    );
    migrated += result.value?.changed || 0;
    conflicts.push(...(result.value?.blocked || []));
  }
  return { migrated, conflicts };
}
