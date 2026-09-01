import type { AddonContext, AddonDocument, CollectionHandle, DataMutation } from "./sdk.js";
import { scopeViewId, subtreeIds, validatePlanning, type DmNote, type PlanningConsequence, type PlanningDataset, type PlanningFlow, type PlanningItem, type PlanningReference, type PlanningView } from "./planning-model.js";

type CollectionId = "planning_items" | "planning_flow_links" | "planning_references" | "planning_consequences" | "dm_notes" | "planning_views";
type Stored = PlanningItem | PlanningFlow | PlanningReference | PlanningConsequence | DmNote | PlanningView;
export interface PlanningSnapshot extends PlanningDataset { readonly revisions: ReadonlyMap<string, number> }

export class PlanningRepository {
  readonly #context: AddonContext;
  readonly #handles: Record<CollectionId, CollectionHandle<Stored>>;
  constructor(context: AddonContext) {
    this.#context = context;
    this.#handles = Object.fromEntries(collections.map((id) => [id, context.data.collection<Stored>(id)])) as Record<CollectionId, CollectionHandle<Stored>>;
  }
  async load(): Promise<PlanningSnapshot> {
    const pages = await Promise.all(collections.map((id) => this.#all(id)));
    const revisions = new Map<string, number>();
    pages.forEach((documents, index) => { const id = collections[index] as CollectionId; for (const document of documents) revisions.set(`${id}:${document.key}`, document.revision); });
    const snapshot: PlanningSnapshot = {
      items: (pages[0] ?? []).map((document) => document.value as PlanningItem), flows: (pages[1] ?? []).map((document) => document.value as PlanningFlow),
      references: (pages[2] ?? []).map((document) => document.value as PlanningReference), consequences: (pages[3] ?? []).map((document) => document.value as PlanningConsequence),
      notes: (pages[4] ?? []).map((document) => document.value as DmNote), views: (pages[5] ?? []).map((document) => document.value as PlanningView), revisions,
    };
    const issues = validatePlanning(snapshot); if (issues.length > 0) throw new Error(`Stored planning data is inconsistent: ${issues.slice(0, 3).join(" ")}`);
    return snapshot;
  }
  put(collection: CollectionId, value: Stored, revision: number): Promise<unknown> { return this.#handles[collection].put(value.id, value, revision, { signal: this.#context.signal }); }
  async transact(mutations: readonly DataMutation[]): Promise<void> { await this.#context.data.transact(mutations, { signal: this.#context.signal }); }
  async deleteSubtree(snapshot: PlanningSnapshot, rootId: string): Promise<void> {
    const ids = subtreeIds(snapshot.items, rootId); const flowIds = new Set(snapshot.flows.filter((flow) => ids.has(flow.sourceId) || ids.has(flow.targetId)).map((flow) => flow.id));
    const mutations: DataMutation[] = [];
    const addDeletes = (collection: CollectionId, records: readonly { readonly id: string }[]): void => { for (const record of records) { const revision = snapshot.revisions.get(`${collection}:${record.id}`); if (revision !== undefined) mutations.push({ operation: "delete", kind: "collection", dataId: collection, key: record.id, expectedRevision: revision }); } };
    addDeletes("planning_items", snapshot.items.filter((item) => ids.has(item.id))); addDeletes("planning_flow_links", snapshot.flows.filter((flow) => flowIds.has(flow.id)));
    addDeletes("planning_references", snapshot.references.filter((reference) => ids.has(reference.itemId)));
    addDeletes("planning_consequences", snapshot.consequences.filter((consequence) => { const anchor = consequence.anchor; return anchor["scope"] === "item" ? ids.has(String(anchor["itemId"])) : flowIds.has(String(anchor["flowId"])); }));
    for (const note of snapshot.notes) {
      const remaining = note.anchorIds.filter((id) => !ids.has(id));
      if (remaining.length === note.anchorIds.length) continue;
      const revision = snapshot.revisions.get(`dm_notes:${note.id}`); if (revision === undefined) continue;
      if (remaining.length === 0) mutations.push({ operation: "delete", kind: "collection", dataId: "dm_notes", key: note.id, expectedRevision: revision });
      else mutations.push({ operation: "put", kind: "collection", dataId: "dm_notes", key: note.id, expectedRevision: revision, value: { ...note, anchorIds: remaining, updatedAt: Date.now() } });
    }
    addDeletes("planning_views", snapshot.views.filter((view) => view.scopeId !== null && ids.has(view.scopeId)));
    if (mutations.length > 0) await this.transact(mutations);
  }
  async savePosition(snapshot: PlanningSnapshot, scopeId: string | null, itemId: string, x: number, y: number): Promise<void> {
    const id = scopeViewId(scopeId); const current = snapshot.views.find((view) => view.id === id);
    const next: PlanningView = { id, schemaVersion: 3, scopeId, positions: { ...(current?.positions ?? {}), [itemId]: { x, y } }, updatedAt: Date.now() };
    await this.put("planning_views", next, snapshot.revisions.get(`planning_views:${id}`) ?? 0);
  }
  async #all(id: CollectionId): Promise<readonly AddonDocument<Stored>[]> { const documents: AddonDocument<Stored>[] = []; let cursor: string | undefined; do { const page = await this.#handles[id].query({ ...(cursor === undefined ? {} : { cursor }), limit: 200, signal: this.#context.signal }); documents.push(...page.documents); cursor = page.nextCursor; } while (cursor !== undefined); return documents; }
}

const collections = ["planning_items", "planning_flow_links", "planning_references", "planning_consequences", "dm_notes", "planning_views"] as const;
