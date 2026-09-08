import type { AddonContext, AddonDocument, CollectionHandle, CommitReceipt, DataMutation, DataSetRevision } from "./sdk.js";
import { scopeViewId, subtreeIds, validateItemEdit, validatePlanning, type DmNote, type PlanningConsequence, type PlanningDataset, type PlanningFlow, type PlanningItem, type PlanningReference, type PlanningView } from "./planning-model.js";

type CollectionId = "planning_items" | "planning_flow_links" | "planning_references" | "planning_consequences" | "dm_notes" | "planning_views";
type Stored = PlanningItem | PlanningFlow | PlanningReference | PlanningConsequence | DmNote | PlanningView;
export interface PlanningSnapshot extends PlanningDataset { readonly revisions: ReadonlyMap<string, number>; readonly dataRevisions: readonly DataSetRevision[] }
export interface DeletionUndo { readonly mutations: readonly Extract<DataMutation, { operation: "put" }>[] }

export class PlanningRepository {
  readonly #context: AddonContext;
  readonly #handles: Record<CollectionId, CollectionHandle<Stored>>;
  constructor(context: AddonContext) {
    this.#context = context;
    this.#handles = Object.fromEntries(collections.map((id) => [id, context.data.collection<Stored>(id)])) as Record<CollectionId, CollectionHandle<Stored>>;
  }
  subscribe(listener: () => void, signal: AbortSignal): () => void {
    return this.#context.data.subscribe?.(change => {
      if (change.reason === "reset" || (change.kind === "collection" && collections.some(id => id === change.dataId))) listener();
    }, { signal: AbortSignal.any([signal, this.#context.signal]) }) ?? (() => undefined);
  }
  async load(signal: AbortSignal = this.#context.signal): Promise<PlanningSnapshot> {
    signal = AbortSignal.any([this.#context.signal, signal]);
    signal.throwIfAborted();
    const reads = await Promise.all(collections.map((id) => this.#all(id, signal)));
    const pages = reads.map(read => read.documents);
    const dataRevisions = Object.freeze(reads.map((read, index) => Object.freeze({ kind: "collection" as const, dataId: collections[index]!, revision: read.revision })));
    signal.throwIfAborted();
    const revisions = new Map<string, number>();
    pages.forEach((documents, index) => { const id = collections[index] as CollectionId; for (const document of documents) revisions.set(`${id}:${document.key}`, document.revision); });
    const snapshot: PlanningSnapshot = {
      items: (pages[0] ?? []).map((document) => document.value as PlanningItem), flows: (pages[1] ?? []).map((document) => document.value as PlanningFlow),
      references: (pages[2] ?? []).map((document) => document.value as PlanningReference), consequences: (pages[3] ?? []).map((document) => document.value as PlanningConsequence),
      notes: (pages[4] ?? []).map((document) => document.value as DmNote), views: (pages[5] ?? []).map((document) => document.value as PlanningView), revisions, dataRevisions,
    };
    const issues = validatePlanning(snapshot); if (issues.length > 0) throw new Error(`Stored planning data is inconsistent: ${issues.slice(0, 3).join(" ")}`);
    return snapshot;
  }
  async put(snapshot: PlanningSnapshot, collection: CollectionId, value: Stored, revision: number): Promise<void> {
    await this.transact(snapshot, [{ operation: "put", kind: "collection", dataId: collection, key: value.id, expectedRevision: revision, value }]);
  }
  async createItem(snapshot: PlanningSnapshot, item: PlanningItem): Promise<void> {
    const issues = validatePlanning({ ...snapshot, items: [...snapshot.items, item] });
    if (issues.length) throw new Error(issues[0]);
    await this.put(snapshot, "planning_items", item, 0);
  }
  async saveItem(snapshot: PlanningSnapshot, item: PlanningItem, revision: number): Promise<void> {
    const issues = validateItemEdit(snapshot, item);
    if (issues.length) throw new Error(issues[0]);
    await this.put(snapshot, "planning_items", item, revision);
  }
  async transact(snapshot: PlanningSnapshot, mutations: readonly DataMutation[]): Promise<CommitReceipt> {
    const guards = snapshot.dataRevisions;
    if (!Array.isArray(guards) || guards.length !== collections.length || collections.some(id => !guards.some(guard => guard.kind === "collection" && guard.dataId === id && Number.isSafeInteger(guard.revision) && guard.revision >= 0))) {
      throw new Error("Collection revisions are missing. Reload the planner before saving.");
    }
    return this.#context.data.transact(mutations, { signal: this.#context.signal, expectedDataSets: guards });
  }
  async deleteSubtree(snapshot: PlanningSnapshot, rootId: string): Promise<DeletionUndo | undefined> {
    return this.deleteSelection(snapshot, [rootId], []);
  }
  async deleteFlow(snapshot: PlanningSnapshot, flowId: string): Promise<DeletionUndo | undefined> {
    return this.deleteSelection(snapshot, [], [flowId]);
  }
  async deleteSelection(snapshot: PlanningSnapshot, selectedItems: readonly string[], selectedFlows: readonly string[]): Promise<DeletionUndo | undefined> {
    const ids = new Set<string>(), flowIds = new Set(selectedFlows);
    for (const id of selectedItems) {
      if (!snapshot.items.some(item => item.id === id)) throw new Error("This planning item no longer exists. Reload the planner.");
      for (const child of subtreeIds(snapshot.items, id)) ids.add(child);
    }
    for (const id of flowIds) if (!snapshot.flows.some(flow => flow.id === id)) throw new Error("This flow no longer exists. Reload the planner.");
    for (const flow of snapshot.flows) if (ids.has(flow.sourceId) || ids.has(flow.targetId)) flowIds.add(flow.id);
    if (!ids.size && !flowIds.size) return;
    const mutations = deletionMutations(snapshot, ids, flowIds), receipt = await this.transact(snapshot, mutations);
    const original = recordsByCollection(snapshot);
    // Deleted keys retain tombstone revisions. Undo must never recreate at zero
    // or borrow newer revisions from a subsequently edited record.
    return { mutations: mutations.map(mutation => {
      const results = receipt.results.filter(result => result.dataId === mutation.dataId && result.key === mutation.key), result = results[0];
      if (results.length !== 1 || !result || !Number.isSafeInteger(result.afterRevision) || result.afterRevision <= mutation.expectedRevision || result.deleted !== (mutation.operation === "delete")) throw new Error("Deletion was saved, but its undo receipt is incomplete. Reload the planner.");
      const value = original.get(`${mutation.dataId}:${mutation.key}`)!;
      return { operation: "put", kind: "collection", dataId: mutation.dataId, key: mutation.key, expectedRevision: result.afterRevision, value: structuredClone(value) };
    }) };
  }
  async undoDeletion(snapshot: PlanningSnapshot, undo: DeletionUndo): Promise<void> {
    if (!undo.mutations.length || undo.mutations.length > 256) throw new Error("This deletion cannot be restored in one transaction.");
    const records = recordsByCollection(snapshot), now = Date.now();
    const mutations = undo.mutations.map(mutation => {
      const key = `${mutation.dataId}:${mutation.key}`, current = snapshot.revisions.get(key);
      if (current !== undefined && current !== mutation.expectedRevision) throw new Error("An affected record changed after deletion. Undo cannot overwrite those changes.");
      const value = { ...(mutation.value as Stored), updatedAt: Math.max(now, (mutation.value as Stored).updatedAt + 1) };
      records.set(key, value); return { ...mutation, value };
    });
    const restored = <K extends keyof PlanningDataset>(key: K): PlanningDataset[K] => [...records].filter(([id]) => id.startsWith(`${collectionKeys[key]}:`)).map(([, value]) => value) as PlanningDataset[K];
    const issues = validatePlanning({ items: restored("items"), flows: restored("flows"), references: restored("references"), consequences: restored("consequences"), notes: restored("notes"), views: restored("views") });
    if (issues.length) throw new Error(`Cannot undo deletion: ${issues[0]}`);
    await this.transact(snapshot, mutations);
  }
  async resetLayout(snapshot: PlanningSnapshot, scopeId: string | null): Promise<void> {
    const view = snapshot.views.find(value => value.scopeId === scopeId); if (!view) return;
    const revision = snapshot.revisions.get(`planning_views:${view.id}`);
    if (revision === undefined) throw new Error("The layout revision is missing. Reload the planner.");
    // Keep the revision-bearing view so a later drag does not recreate a tombstone.
    await this.put(snapshot, "planning_views", { ...view, positions: {}, updatedAt: Date.now() }, revision);
  }
  async savePosition(snapshot: PlanningSnapshot, scopeId: string | null, itemId: string, x: number, y: number): Promise<void> {
    await this.savePositions(snapshot, scopeId, { [itemId]: { x, y } });
  }
  async savePositions(snapshot: PlanningSnapshot, scopeId: string | null, positions: Readonly<Record<string, { x: number; y: number }>>): Promise<void> {
    if (!Object.keys(positions).length) return;
    for (const [itemId, point] of Object.entries(positions)) {
      if (!snapshot.items.some(item => item.id === itemId && item.parentId === scopeId)) throw new Error("Only items on this canvas can be moved. Reload the planner.");
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) throw new Error("Canvas positions must be finite numbers.");
    }
    const id = scopeViewId(scopeId); const current = snapshot.views.find((view) => view.id === id);
    const next: PlanningView = { id, schemaVersion: 3, scopeId, positions: { ...(current?.positions ?? {}), ...positions }, updatedAt: Date.now() };
    await this.put(snapshot, "planning_views", next, snapshot.revisions.get(`planning_views:${id}`) ?? 0);
  }
  async #all(id: CollectionId, signal: AbortSignal): Promise<{ documents: readonly AddonDocument<Stored>[]; revision: number }> {
    const documents: AddonDocument<Stored>[] = []; let cursor: string | undefined; let revision: number | undefined;
    do {
      signal.throwIfAborted();
      const page = await this.#handles[id].query({ ...(cursor === undefined ? {} : { cursor }), limit: 200, signal, includeDataRevision: true, ...(revision === undefined ? {} : { expectedDataRevision: revision }) });
      signal.throwIfAborted();
      if (page.dataRevision === undefined || !Number.isSafeInteger(page.dataRevision) || page.dataRevision < 0 || (revision !== undefined && page.dataRevision !== revision)) {
        throw new Error("Planning data changed while loading, or the host lacks collection revisions. Reload after updating the host.");
      }
      revision = page.dataRevision; documents.push(...page.documents); cursor = page.nextCursor;
    } while (cursor !== undefined);
    return { documents, revision };
  }
}

const collections = ["planning_items", "planning_flow_links", "planning_references", "planning_consequences", "dm_notes", "planning_views"] as const;
const collectionKeys = { items: "planning_items", flows: "planning_flow_links", references: "planning_references", consequences: "planning_consequences", notes: "dm_notes", views: "planning_views" } as const;
function recordsByCollection(snapshot: PlanningDataset): Map<string, Stored> {
  return new Map(Object.entries(collectionKeys).flatMap(([key, collection]) => snapshot[key as keyof typeof collectionKeys].map(value => [`${collection}:${value.id}`, value] as const)));
}

function deletionMutations(snapshot: PlanningSnapshot, itemIds: ReadonlySet<string>, flowIds: ReadonlySet<string>): readonly DataMutation[] {
  const mutations: DataMutation[] = []; const now = Date.now();
  const revision = (collection: CollectionId, id: string): number => {
    const value = snapshot.revisions.get(`${collection}:${id}`);
    if (value === undefined) throw new Error("A record revision is missing. Reload the planner before deleting.");
    return value;
  };
  const remove = (collection: CollectionId, id: string): void => { mutations.push({ operation: "delete", kind: "collection", dataId: collection, key: id, expectedRevision: revision(collection, id) }); };
  const update = (collection: CollectionId, value: Stored): void => { mutations.push({ operation: "put", kind: "collection", dataId: collection, key: value.id, expectedRevision: revision(collection, value.id), value }); };
  for (const item of snapshot.items) if (itemIds.has(item.id)) remove("planning_items", item.id);
  for (const flow of snapshot.flows) if (flowIds.has(flow.id)) remove("planning_flow_links", flow.id);
  for (const reference of snapshot.references) {
    if (itemIds.has(reference.itemId) || (reference.target["scope"] === "planning" && itemIds.has(String(reference.target["itemId"])))) remove("planning_references", reference.id);
  }
  for (const consequence of snapshot.consequences) {
    const anchor = consequence.anchor;
    if (anchor["scope"] === "item" ? itemIds.has(String(anchor["itemId"])) : flowIds.has(String(anchor["flowId"]))) remove("planning_consequences", consequence.id);
  }
  for (const note of snapshot.notes) {
    const remaining = note.anchorIds.filter(id => !itemIds.has(id));
    if (remaining.length === note.anchorIds.length) continue;
    if (remaining.length === 0) remove("dm_notes", note.id);
    else update("dm_notes", { ...note, anchorIds: remaining, updatedAt: now });
  }
  for (const view of snapshot.views) {
    if (view.scopeId !== null && itemIds.has(view.scopeId)) { remove("planning_views", view.id); continue; }
    const positions = Object.fromEntries(Object.entries(view.positions).filter(([id]) => !itemIds.has(id)));
    if (Object.keys(positions).length !== Object.keys(view.positions).length) update("planning_views", { ...view, positions, updatedAt: now });
  }
  if (mutations.length > 256) throw new Error("This deletion affects more than 256 records. Delete smaller subtrees first.");
  return mutations;
}
