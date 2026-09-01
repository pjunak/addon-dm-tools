export const planningKinds = ["plotline", "quest", "event", "branch"] as const;
export type PlanningKind = typeof planningKinds[number];
export type EventType = "story" | "encounter" | "puzzle";
export type BranchType = "decision" | "condition" | "random";

export interface PlanningItem {
  readonly id: string; readonly schemaVersion: 3; readonly kind: PlanningKind; readonly parentId: string | null;
  readonly title: string; readonly summary: string; readonly body: string; readonly objective: string;
  readonly setup: string; readonly resolution: string; readonly eventType?: EventType; readonly branchType?: BranchType;
  readonly tags: readonly string[]; readonly updatedAt: number;
}
export interface PlanningFlow { readonly id: string; readonly schemaVersion: 3; readonly sourceId: string; readonly targetId: string; readonly kind: "continues" | "option"; readonly label: string; readonly updatedAt: number }
export interface PlanningReference { readonly id: string; readonly schemaVersion: 3; readonly itemId: string; readonly name: string; readonly relation: string; readonly target: Record<string, unknown>; readonly quantity: number; readonly notes: string; readonly updatedAt: number }
export interface PlanningConsequence { readonly id: string; readonly schemaVersion: 3; readonly anchor: Record<string, unknown>; readonly kind: "world" | "reward" | "information" | "complication"; readonly title: string; readonly body: string; readonly target?: Record<string, unknown>; readonly updatedAt: number }
export interface DmNote { readonly id: string; readonly schemaVersion: 3; readonly title: string; readonly body: string; readonly anchorIds: readonly string[]; readonly updatedAt: number }
export interface PlanningPosition { readonly x: number; readonly y: number }
export interface PlanningView { readonly id: string; readonly schemaVersion: 3; readonly scopeId: string | null; readonly positions: Readonly<Record<string, PlanningPosition>>; readonly updatedAt: number }

export interface PlanningDataset {
  readonly items: readonly PlanningItem[]; readonly flows: readonly PlanningFlow[];
  readonly references: readonly PlanningReference[]; readonly consequences: readonly PlanningConsequence[];
  readonly notes: readonly DmNote[]; readonly views: readonly PlanningView[];
}

export function directChildren(items: readonly PlanningItem[], scopeId: string | null): readonly PlanningItem[] {
  return items.filter((item) => item.parentId === scopeId).sort((left, right) => left.title.localeCompare(right.title, "en"));
}
export function localFlows(dataset: PlanningDataset, scopeId: string | null): readonly PlanningFlow[] {
  const visible = new Set(directChildren(dataset.items, scopeId).map((item) => item.id));
  return dataset.flows.filter((flow) => visible.has(flow.sourceId) && visible.has(flow.targetId));
}
export function scopeTrail(items: readonly PlanningItem[], scopeId: string | null): readonly PlanningItem[] {
  const byId = new Map(items.map((item) => [item.id, item])); const result: PlanningItem[] = []; const seen = new Set<string>();
  let current = scopeId === null ? undefined : byId.get(scopeId);
  while (current !== undefined && !seen.has(current.id)) { seen.add(current.id); result.unshift(current); current = current.parentId === null ? undefined : byId.get(current.parentId); }
  return result;
}
export function subtreeIds(items: readonly PlanningItem[], rootId: string): ReadonlySet<string> {
  const result = new Set([rootId]); let changed = true;
  while (changed) { changed = false; for (const item of items) if (item.parentId !== null && result.has(item.parentId) && !result.has(item.id)) { result.add(item.id); changed = true; } }
  return result;
}
export function validatePlanning(dataset: PlanningDataset): readonly string[] {
  const issues: string[] = []; const byId = new Map<string, PlanningItem>();
  for (const item of dataset.items) { if (byId.has(item.id)) issues.push(`Duplicate planning item ${item.id}.`); byId.set(item.id, item); }
  for (const item of dataset.items) {
    if (item.parentId !== null) { const parent = byId.get(item.parentId); if (parent === undefined) issues.push(`${item.title} has a missing parent.`); else if (parent.kind !== "plotline" && parent.kind !== "quest") issues.push(`${item.title} has a leaf item as its parent.`); }
    const seen = new Set([item.id]); let parentId = item.parentId;
    while (parentId !== null) { if (seen.has(parentId)) { issues.push(`Ownership cycle at ${item.title}.`); break; } seen.add(parentId); parentId = byId.get(parentId)?.parentId ?? null; }
  }
  const adjacency = new Map<string, string[]>();
  for (const flow of dataset.flows) {
    const source = byId.get(flow.sourceId); const target = byId.get(flow.targetId);
    if (source === undefined || target === undefined) { issues.push(`Flow ${flow.id} has a missing endpoint.`); continue; }
    if (source.parentId !== target.parentId) issues.push(`Flow ${flow.id} crosses canvas scopes.`);
    if (flow.kind === "option" && source.kind !== "branch") issues.push(`Option flow ${flow.id} does not start at a branch.`);
    const edges = adjacency.get(source.id) ?? []; edges.push(target.id); adjacency.set(source.id, edges);
  }
  const visiting = new Set<string>(); const visited = new Set<string>();
  const visit = (id: string): void => { if (visiting.has(id)) { issues.push(`Flow cycle reaches ${id}.`); return; } if (visited.has(id)) return; visiting.add(id); for (const target of adjacency.get(id) ?? []) visit(target); visiting.delete(id); visited.add(id); };
  for (const id of adjacency.keys()) visit(id);
  return [...new Set(issues)];
}

export function newItem(kind: PlanningKind, parentId: string | null, now = Date.now()): PlanningItem {
  const id = `${kind}-${crypto.randomUUID()}`;
  return { id, schemaVersion: 3, kind, parentId, title: `New ${kind}`, summary: "", body: "", objective: "", setup: "", resolution: "", ...(kind === "event" ? { eventType: "story" as const } : {}), ...(kind === "branch" ? { branchType: "decision" as const } : {}), tags: [], updatedAt: now };
}
export function scopeViewId(scopeId: string | null): string { return scopeId === null ? "scope-root" : `scope-${scopeId}`; }
