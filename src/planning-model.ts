import { type PlannerTranslator, plannerTranslator } from "./planner-catalogs.js";
const planningKinds = ["plotline", "quest", "event", "branch"] as const;
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
export function availableParents(items: readonly PlanningItem[], itemId: string): readonly PlanningItem[] {
  const excluded = subtreeIds(items, itemId);
  return items.filter(item => !excluded.has(item.id) && (item.kind === "plotline" || item.kind === "quest"))
    .sort((a, b) => a.title.localeCompare(b.title, "en") || a.id.localeCompare(b.id));
}

export function validateItemEdit(dataset: PlanningDataset, next: PlanningItem, t: PlannerTranslator = plannerTranslator()): readonly string[] {
  const current = dataset.items.find(item => item.id === next.id);
  if (!current) return [t("This planning item no longer exists. Reload the planner.")];
  if (next.kind !== "plotline" && next.kind !== "quest" && dataset.items.some(item => item.parentId === next.id)) {
    return [t("Move this item's children first, or keep it as a plotline or quest.")];
  }
  if (next.parentId !== current.parentId && dataset.flows.some(flow => flow.sourceId === next.id || flow.targetId === next.id)) {
    return [t("This item has story flows on its current canvas. Review and remove those flows before moving it.")];
  }
  if (next.kind !== "branch" && dataset.flows.some(flow => flow.sourceId === next.id && flow.kind === "option")) {
    return [t("Option flows must start at a branch. Review those flows before changing this item's kind.")];
  }
  return validatePlanning({ ...dataset, items: dataset.items.map(item => item.id === next.id ? next : item) }, t);
}

export function validatePlanning(dataset: PlanningDataset, t: PlannerTranslator = plannerTranslator()): readonly string[] {
  const issues: string[] = []; const byId = new Map<string, PlanningItem>();
  for (const item of dataset.items) { if (byId.has(item.id)) issues.push(t("Duplicate planning item {0}.", { "0": item.id })); byId.set(item.id, item); }
  for (const item of dataset.items) {
    if (item.parentId !== null) { const parent = byId.get(item.parentId); if (parent === undefined) issues.push(t("{0} has a missing parent.", { "0": item.title })); else if (parent.kind !== "plotline" && parent.kind !== "quest") issues.push(t("{0} has a leaf item as its parent.", { "0": item.title })); }
    const seen = new Set([item.id]); let parentId = item.parentId;
    while (parentId !== null) { if (seen.has(parentId)) { issues.push(t("Ownership cycle at {0}.", { "0": item.title })); break; } seen.add(parentId); parentId = byId.get(parentId)?.parentId ?? null; }
  }
  const adjacency = new Map<string, string[]>();
  for (const flow of dataset.flows) {
    const source = byId.get(flow.sourceId); const target = byId.get(flow.targetId);
    if (source === undefined || target === undefined) { issues.push(t("Flow {0} has a missing endpoint.", { "0": flow.id })); continue; }
    if (source.parentId !== target.parentId) issues.push(t("Flow {0} crosses canvas scopes.", { "0": flow.id }));
    if (flow.kind === "option" && source.kind !== "branch") issues.push(t("Option flow {0} does not start at a branch.", { "0": flow.id }));
    const edges = adjacency.get(source.id) ?? []; edges.push(target.id); adjacency.set(source.id, edges);
  }
  const visiting = new Set<string>(); const visited = new Set<string>();
  const visit = (id: string): void => { if (visiting.has(id)) { issues.push(t("Flow cycle reaches {0}.", { "0": id })); return; } if (visited.has(id)) return; visiting.add(id); for (const target of adjacency.get(id) ?? []) visit(target); visiting.delete(id); visited.add(id); };
  for (const id of adjacency.keys()) visit(id);
  for (const reference of dataset.references) {
    if (!byId.has(reference.itemId)) issues.push(t("Reference {0} has a missing item.", { "0": reference.id }));
    if (reference.target["scope"] === "planning" && !byId.has(String(reference.target["itemId"]))) issues.push(t("Reference {0} has a missing planning target.", { "0": reference.id }));
  }
  const flowIds = new Set(dataset.flows.map(flow => flow.id));
  for (const consequence of dataset.consequences) {
    const anchor = consequence.anchor;
    if (anchor["scope"] === "item") { if (!byId.has(String(anchor["itemId"]))) issues.push(t("Consequence {0} has a missing item anchor.", { "0": consequence.id })); }
    else if (anchor["scope"] === "flow") { if (!flowIds.has(String(anchor["flowId"]))) issues.push(t("Consequence {0} has a missing flow anchor.", { "0": consequence.id })); }
    else issues.push(t("Consequence {0} has an invalid anchor.", { "0": consequence.id }));
  }
  for (const note of dataset.notes) for (const id of note.anchorIds) if (!byId.has(id)) issues.push(t("Note {0} has a missing anchor {1}.", { "0": note.id, "1": id }));
  return [...new Set(issues)];
}

export function newItem(kind: PlanningKind, parentId: string | null, now = Date.now(), t: PlannerTranslator = plannerTranslator()): PlanningItem {
  const id = `${kind}-${crypto.randomUUID()}`;
  return { id, schemaVersion: 3, kind, parentId, title: t("New {0}", { "0": t(kind) }), summary: "", body: "", objective: "", setup: "", resolution: "", ...(kind === "event" ? { eventType: "story" as const } : {}), ...(kind === "branch" ? { branchType: "decision" as const } : {}), tags: [], updatedAt: now };
}
export function scopeViewId(scopeId: string | null): string { return scopeId === null ? "scope-root" : `scope-${scopeId}`; }
