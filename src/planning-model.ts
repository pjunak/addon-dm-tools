import {
  type PlannerMessage,
  type PlannerParameters,
  type PlannerTranslator,
  plannerTranslator,
} from "./planner-catalogs.js";
const planningKinds = ["plotline", "quest", "event", "branch"] as const;
export type PlanningKind = (typeof planningKinds)[number];
export type EventType = "story" | "encounter" | "puzzle";
export type BranchType = "decision" | "condition" | "random";

export interface PlanningItem {
  readonly id: string;
  readonly schemaVersion: 3;
  readonly kind: PlanningKind;
  readonly parentId: string | null;
  readonly title: string;
  readonly summary: string;
  readonly body: string;
  readonly objective: string;
  readonly setup: string;
  readonly resolution: string;
  readonly eventType?: EventType;
  readonly branchType?: BranchType;
  readonly tags: readonly string[];
  readonly updatedAt: number;
}
export interface PlanningFlow {
  readonly id: string;
  readonly schemaVersion: 3;
  readonly sourceId: string;
  readonly targetId: string;
  readonly kind: "continues" | "option";
  readonly label: string;
  readonly updatedAt: number;
}
export interface PlanningReference {
  readonly id: string;
  readonly schemaVersion: 3;
  readonly itemId: string;
  readonly name: string;
  readonly relation: string;
  readonly target: Record<string, unknown>;
  readonly quantity: number;
  readonly notes: string;
  readonly updatedAt: number;
}
export interface PlanningConsequence {
  readonly id: string;
  readonly schemaVersion: 3;
  readonly anchor: Record<string, unknown>;
  readonly kind: "world" | "reward" | "information" | "complication";
  readonly title: string;
  readonly body: string;
  readonly target?: Record<string, unknown>;
  readonly updatedAt: number;
}
export interface DmNote {
  readonly id: string;
  readonly schemaVersion: 3;
  readonly title: string;
  readonly body: string;
  readonly anchorIds: readonly string[];
  readonly updatedAt: number;
}
export interface PlanningPosition {
  readonly x: number;
  readonly y: number;
}
export interface PlanningView {
  readonly id: string;
  readonly schemaVersion: 3;
  readonly scopeId: string | null;
  readonly positions: Readonly<Record<string, PlanningPosition>>;
  readonly updatedAt: number;
}

export interface PlanningDataset {
  readonly items: readonly PlanningItem[];
  readonly flows: readonly PlanningFlow[];
  readonly references: readonly PlanningReference[];
  readonly consequences: readonly PlanningConsequence[];
  readonly notes: readonly DmNote[];
  readonly views: readonly PlanningView[];
}

export type PlanningIssueCollection =
  | "planning_items"
  | "planning_flow_links"
  | "planning_references"
  | "planning_consequences"
  | "dm_notes";
export type PlanningIssueCode =
  | "duplicate"
  | "blank"
  | "tags"
  | "missing-parent"
  | "leaf-parent"
  | "ownership-cycle"
  | "missing-endpoint"
  | "cross-scope"
  | "option-source"
  | "flow-cycle"
  | "missing-owner"
  | "missing-target"
  | "missing-anchor"
  | "invalid-anchor";
/** A stored record that breaks a planning rule. */
export interface PlanningIssue {
  /** Names the problem, not its wording, so datasets can be compared. */
  readonly key: string;
  readonly collection: PlanningIssueCollection;
  readonly id: string;
  readonly code: PlanningIssueCode;
  readonly message: PlannerMessage;
  readonly parameters: PlannerParameters;
}
/** How the planner can fix a problem without an editor. */
export type PlanningRepair = "detach" | "delete";

/** A planning record ID as the worker stores it; never an object-prototype name. */
export function validPlanningId(value: string): boolean {
  return (
    /^[a-z0-9][a-z0-9._-]{0,119}$/u.test(value) &&
    !["__proto__", "prototype", "constructor"].includes(value)
  );
}

export function directChildren(
  items: readonly PlanningItem[],
  scopeId: string | null,
): readonly PlanningItem[] {
  return items
    .filter((item) => item.parentId === scopeId)
    .sort((left, right) => left.title.localeCompare(right.title, "en"));
}
export function localFlows(
  dataset: PlanningDataset,
  scopeId: string | null,
): readonly PlanningFlow[] {
  const visible = new Set(directChildren(dataset.items, scopeId).map((item) => item.id));
  return dataset.flows.filter((flow) => visible.has(flow.sourceId) && visible.has(flow.targetId));
}
export function scopeTrail(
  items: readonly PlanningItem[],
  scopeId: string | null,
): readonly PlanningItem[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  const result: PlanningItem[] = [];
  const seen = new Set<string>();
  let current = scopeId === null ? undefined : byId.get(scopeId);
  while (current !== undefined && !seen.has(current.id)) {
    seen.add(current.id);
    result.unshift(current);
    current = current.parentId === null ? undefined : byId.get(current.parentId);
  }
  return result;
}
export function subtreeIds(items: readonly PlanningItem[], rootId: string): ReadonlySet<string> {
  const result = new Set([rootId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const item of items)
      if (item.parentId !== null && result.has(item.parentId) && !result.has(item.id)) {
        result.add(item.id);
        changed = true;
      }
  }
  return result;
}
export function availableParents(
  items: readonly PlanningItem[],
  itemId: string,
): readonly PlanningItem[] {
  const excluded = subtreeIds(items, itemId);
  return items
    .filter((item) => !excluded.has(item.id) && (item.kind === "plotline" || item.kind === "quest"))
    .sort((a, b) => a.title.localeCompare(b.title, "en") || a.id.localeCompare(b.id));
}

export function validateItemEdit(
  dataset: PlanningDataset,
  next: PlanningItem,
  t: PlannerTranslator = plannerTranslator(),
): readonly string[] {
  const current = dataset.items.find((item) => item.id === next.id);
  if (!current) return [t("This planning item no longer exists. Reload the planner.")];
  if (
    next.kind !== "plotline" &&
    next.kind !== "quest" &&
    dataset.items.some((item) => item.parentId === next.id)
  ) {
    return [t("Move this item's children first, or keep it as a plotline or quest.")];
  }
  if (
    next.parentId !== current.parentId &&
    dataset.flows.some((flow) => flow.sourceId === next.id || flow.targetId === next.id)
  ) {
    return [
      t(
        "This item has story flows on its current canvas. Review and remove those flows before moving it.",
      ),
    ];
  }
  if (
    next.kind !== "branch" &&
    dataset.flows.some((flow) => flow.sourceId === next.id && flow.kind === "option")
  ) {
    return [
      t(
        "Option flows must start at a branch. Review those flows before changing this item's kind.",
      ),
    ];
  }
  return validateChange(
    dataset,
    { ...dataset, items: dataset.items.map((item) => (item.id === next.id ? next : item)) },
    t,
  );
}

/** Every rule a stored record breaks, matching the Go importer's dataset validation. */
export function planningIssues(dataset: PlanningDataset): readonly PlanningIssue[] {
  const issues = new Map<string, PlanningIssue>();
  const add = (
    collection: PlanningIssueCollection,
    id: string,
    code: PlanningIssueCode,
    message: PlannerMessage,
    parameters: PlannerParameters,
    detail?: string,
  ): void => {
    const key = [collection, id, code, ...(detail === undefined ? [] : [detail])].join(":");
    if (!issues.has(key)) issues.set(key, { key, collection, id, code, message, parameters });
  };
  const byId = new Map<string, PlanningItem>();
  for (const item of dataset.items) {
    if (byId.has(item.id))
      add("planning_items", item.id, "duplicate", "Duplicate planning item {0}.", {
        "0": item.id,
      });
    byId.set(item.id, item);
  }
  for (const item of dataset.items) {
    const name = item.title.trim() || item.id;
    if (!item.title.trim())
      add("planning_items", item.id, "blank", "Planning item {0} has a blank title.", {
        "0": item.id,
      });
    const tags = new Set(item.tags.map((tag) => tag.toLowerCase()));
    if (tags.size !== item.tags.length || item.tags.some((tag) => !tag.trim()))
      add("planning_items", item.id, "tags", "{0} has blank or repeated tags.", { "0": name });
    if (item.parentId !== null) {
      const parent = byId.get(item.parentId);
      if (parent === undefined)
        add(
          "planning_items",
          item.id,
          "missing-parent",
          "{0} has a missing parent.",
          { "0": name },
          item.parentId,
        );
      else if (parent.kind !== "plotline" && parent.kind !== "quest")
        add("planning_items", item.id, "leaf-parent", "{0} has a leaf item as its parent.", {
          "0": name,
        });
    }
    const seen = new Set([item.id]);
    let parentId = item.parentId;
    while (parentId !== null) {
      if (seen.has(parentId)) {
        add("planning_items", item.id, "ownership-cycle", "Ownership cycle at {0}.", {
          "0": name,
        });
        break;
      }
      seen.add(parentId);
      parentId = byId.get(parentId)?.parentId ?? null;
    }
  }
  const next = new Map<string, string[]>();
  for (const flow of dataset.flows) {
    const source = byId.get(flow.sourceId);
    const target = byId.get(flow.targetId);
    if (source === undefined || target === undefined) {
      add("planning_flow_links", flow.id, "missing-endpoint", "Flow {0} has a missing endpoint.", {
        "0": flow.id,
      });
      continue;
    }
    if (source.parentId !== target.parentId)
      add("planning_flow_links", flow.id, "cross-scope", "Flow {0} crosses canvas scopes.", {
        "0": flow.id,
      });
    if (flow.kind === "option" && source.kind !== "branch")
      add(
        "planning_flow_links",
        flow.id,
        "option-source",
        "Option flow {0} does not start at a branch.",
        { "0": flow.id },
      );
    const edges = next.get(source.id) ?? [];
    edges.push(target.id);
    next.set(source.id, edges);
  }
  // Each flow on a cycle is reported, a flow to itself included, so the report
  // does not depend on the order the flows are read in.
  const reaches = (from: string, to: string): boolean => {
    const queue = [from],
      seen = new Set(queue);
    for (const id of queue) {
      if (id === to) return true;
      for (const target of next.get(id) ?? [])
        if (!seen.has(target)) {
          seen.add(target);
          queue.push(target);
        }
    }
    return false;
  };
  for (const flow of dataset.flows)
    if (byId.has(flow.sourceId) && byId.has(flow.targetId) && reaches(flow.targetId, flow.sourceId))
      add("planning_flow_links", flow.id, "flow-cycle", "Flow {0} is part of a cycle.", {
        "0": flow.id,
      });
  for (const reference of dataset.references) {
    const id = reference.id;
    if (!reference.name.trim())
      add("planning_references", id, "blank", "Reference {0} has a blank name.", { "0": id });
    if (!byId.has(reference.itemId))
      add("planning_references", id, "missing-owner", "Reference {0} has a missing item.", {
        "0": id,
      });
    if (reference.target["scope"] === "planning" && !byId.has(String(reference.target["itemId"])))
      add(
        "planning_references",
        id,
        "missing-target",
        "Reference {0} has a missing planning target.",
        { "0": id },
      );
  }
  const flowIds = new Set(dataset.flows.map((flow) => flow.id));
  for (const consequence of dataset.consequences) {
    const id = consequence.id;
    if (!consequence.title.trim())
      add("planning_consequences", id, "blank", "Consequence {0} has a blank title.", { "0": id });
    if (
      consequence.target?.["scope"] === "planning" &&
      !byId.has(String(consequence.target["itemId"]))
    )
      add(
        "planning_consequences",
        id,
        "missing-target",
        "Consequence {0} has a missing planning target.",
        { "0": id },
      );
    const anchor = consequence.anchor;
    if (anchor["scope"] === "item") {
      if (!byId.has(String(anchor["itemId"])))
        add(
          "planning_consequences",
          id,
          "missing-anchor",
          "Consequence {0} has a missing item anchor.",
          { "0": id },
        );
    } else if (anchor["scope"] === "flow") {
      if (!flowIds.has(String(anchor["flowId"])))
        add(
          "planning_consequences",
          id,
          "missing-anchor",
          "Consequence {0} has a missing flow anchor.",
          { "0": id },
        );
    } else
      add("planning_consequences", id, "invalid-anchor", "Consequence {0} has an invalid anchor.", {
        "0": id,
      });
  }
  for (const note of dataset.notes) {
    if (!note.title.trim())
      add("dm_notes", note.id, "blank", "Note {0} has a blank title.", { "0": note.id });
    for (const id of note.anchorIds)
      if (!byId.has(id))
        add(
          "dm_notes",
          note.id,
          "missing-anchor",
          "Note {0} has a missing anchor {1}.",
          { "0": note.id, "1": id },
          id,
        );
  }
  return [...issues.values()];
}

/** Problems `next` has that `current` does not. A write may keep a stored problem but never add one. */
export function introducedIssues(
  current: PlanningDataset,
  next: PlanningDataset,
): readonly PlanningIssue[] {
  const known = new Set(planningIssues(current).map((issue) => issue.key));
  return planningIssues(next).filter((issue) => !known.has(issue.key));
}

export function validateChange(
  current: PlanningDataset,
  next: PlanningDataset,
  t: PlannerTranslator = plannerTranslator(),
): readonly string[] {
  return introducedIssues(current, next).map((issue) => t(issue.message, issue.parameters));
}

export function validatePlanning(
  dataset: PlanningDataset,
  t: PlannerTranslator = plannerTranslator(),
): readonly string[] {
  return planningIssues(dataset).map((issue) => t(issue.message, issue.parameters));
}

/**
 * Detach drops only the missing link and keeps the record's text; delete
 * removes a link record that cannot exist without its target. Other problems
 * are fixed in the item editor.
 */
export function planningRepair(issue: PlanningIssue): PlanningRepair | undefined {
  switch (issue.collection) {
    case "planning_flow_links":
      return "delete";
    case "planning_references":
      return issue.code === "blank" ? undefined : "delete";
    case "planning_consequences":
      return issue.code === "missing-target"
        ? "detach"
        : issue.code === "blank"
          ? undefined
          : "delete";
    case "dm_notes":
      return issue.code === "missing-anchor" ? "detach" : undefined;
    case "planning_items":
      return undefined;
  }
}

/** Counts the notes deleted with these items because they lose every anchor. */
export function notesDeletedWith(
  dataset: Pick<PlanningDataset, "items" | "notes">,
  rootIds: readonly string[],
): number {
  const ids = new Set<string>();
  for (const id of rootIds) for (const child of subtreeIds(dataset.items, id)) ids.add(child);
  return dataset.notes.filter(
    (note) => note.anchorIds.length > 0 && note.anchorIds.every((id) => ids.has(id)),
  ).length;
}

// Tags are unique ignoring case, like the importer requires; the first
// spelling wins.
export function parseTags(text: string): string[] {
  const seen = new Set<string>();
  return text
    .split(",")
    .map((tag) => tag.trim())
    .filter((tag) => {
      const key = tag.toLowerCase();
      if (tag === "" || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export function newItem(
  kind: PlanningKind,
  parentId: string | null,
  now = Date.now(),
  t: PlannerTranslator = plannerTranslator(),
): PlanningItem {
  const id = `${kind}-${crypto.randomUUID()}`;
  return {
    id,
    schemaVersion: 3,
    kind,
    parentId,
    title: t("New {0}", { "0": t(kind) }),
    summary: "",
    body: "",
    objective: "",
    setup: "",
    resolution: "",
    ...(kind === "event" ? { eventType: "story" as const } : {}),
    ...(kind === "branch" ? { branchType: "decision" as const } : {}),
    tags: [],
    updatedAt: now,
  };
}
// Planning IDs allow 120 characters, so "scope-" plus a long item ID can exceed
// that. Such IDs keep a readable prefix and a stable hash of the full ID.
export function scopeViewId(scopeId: string | null): string {
  if (scopeId === null) return "scope-root";
  const id = `scope-${scopeId}`;
  if (id.length <= 120) return id;
  let hash = 0x811c9dc5;
  for (let index = 0; index < scopeId.length; index++)
    hash = Math.imul(hash ^ scopeId.charCodeAt(index), 0x01000193);
  return `scope-${scopeId.slice(0, 100)}-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}
