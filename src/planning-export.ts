import type { PlanningDataset, PlanningItem } from "./planning-model.js";

/**
 * Current planning as a `dm-tools-planning` merge document. Every record is an
 * update at its stored timestamp, so the file gives an author exact IDs and
 * baselines and imports unchanged as a no-op. Layouts are never imported.
 */
export function planningExport(dataset: PlanningDataset, generatedAt: number) {
  return {
    format: "dm-tools-planning",
    schemaVersion: 3,
    generatedAt,
    mode: "merge",
    items: treeOrder(dataset.items).map(asUpdate),
    flowLinks: byId(dataset.flows).map(asUpdate),
    references: byId(dataset.references).map(asUpdate),
    consequences: byId(dataset.consequences).map(asUpdate),
    notes: byId(dataset.notes).map(asUpdate),
  };
}

export function planningExportName(date: Date): string {
  return `dm-tools-planning-${date.toISOString().slice(0, 10)}.json`;
}

function asUpdate<T extends { readonly updatedAt: number }>({ updatedAt, ...record }: T) {
  return { operation: "update" as const, ...record, expectedUpdatedAt: updatedAt };
}

function byId<T extends { readonly id: string }>(records: readonly T[]): T[] {
  return [...records].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Parents before their children, so the file reads like the planner tree. */
function treeOrder(items: readonly PlanningItem[]): PlanningItem[] {
  const children = new Map<string | null, PlanningItem[]>();
  for (const item of byId(items)) {
    const siblings = children.get(item.parentId) ?? [];
    siblings.push(item);
    children.set(item.parentId, siblings);
  }
  const ordered: PlanningItem[] = [];
  const visit = (parentId: string | null) => {
    for (const item of children.get(parentId) ?? []) {
      ordered.push(item);
      visit(item.id);
    }
  };
  visit(null);
  // Validated snapshots have no orphans; keep any anyway rather than drop data.
  const placed = new Set(ordered);
  return [...ordered, ...byId(items).filter((item) => !placed.has(item))];
}
