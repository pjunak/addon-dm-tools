import { scopeViewId, subtreeIds, validatePlanning } from "./planning-model.js";
export class PlanningRepository {
    #context;
    #handles;
    constructor(context) {
        this.#context = context;
        this.#handles = Object.fromEntries(collections.map((id) => [id, context.data.collection(id)]));
    }
    async load(signal = this.#context.signal) {
        signal = AbortSignal.any([this.#context.signal, signal]);
        signal.throwIfAborted();
        const reads = await Promise.all(collections.map((id) => this.#all(id, signal)));
        const pages = reads.map(read => read.documents);
        const dataRevisions = Object.freeze(reads.map((read, index) => Object.freeze({ kind: "collection", dataId: collections[index], revision: read.revision })));
        signal.throwIfAborted();
        const revisions = new Map();
        pages.forEach((documents, index) => { const id = collections[index]; for (const document of documents)
            revisions.set(`${id}:${document.key}`, document.revision); });
        const snapshot = {
            items: (pages[0] ?? []).map((document) => document.value), flows: (pages[1] ?? []).map((document) => document.value),
            references: (pages[2] ?? []).map((document) => document.value), consequences: (pages[3] ?? []).map((document) => document.value),
            notes: (pages[4] ?? []).map((document) => document.value), views: (pages[5] ?? []).map((document) => document.value), revisions, dataRevisions,
        };
        const issues = validatePlanning(snapshot);
        if (issues.length > 0)
            throw new Error(`Stored planning data is inconsistent: ${issues.slice(0, 3).join(" ")}`);
        return snapshot;
    }
    put(snapshot, collection, value, revision) {
        return this.transact(snapshot, [{ operation: "put", kind: "collection", dataId: collection, key: value.id, expectedRevision: revision, value }]);
    }
    async transact(snapshot, mutations) {
        const guards = snapshot.dataRevisions;
        if (!Array.isArray(guards) || guards.length !== collections.length || collections.some(id => !guards.some(guard => guard.kind === "collection" && guard.dataId === id && Number.isSafeInteger(guard.revision) && guard.revision >= 0))) {
            throw new Error("Collection revisions are missing. Reload the planner before saving.");
        }
        await this.#context.data.transact(mutations, { signal: this.#context.signal, expectedDataSets: guards });
    }
    async deleteSubtree(snapshot, rootId) {
        if (!snapshot.items.some(item => item.id === rootId))
            throw new Error("This planning item no longer exists. Reload the planner.");
        const ids = subtreeIds(snapshot.items, rootId);
        const flowIds = new Set(snapshot.flows.filter((flow) => ids.has(flow.sourceId) || ids.has(flow.targetId)).map((flow) => flow.id));
        await this.transact(snapshot, deletionMutations(snapshot, ids, flowIds));
    }
    async deleteFlow(snapshot, flowId) {
        if (!snapshot.flows.some(flow => flow.id === flowId))
            throw new Error("This flow no longer exists. Reload the planner.");
        await this.transact(snapshot, deletionMutations(snapshot, new Set(), new Set([flowId])));
    }
    async savePosition(snapshot, scopeId, itemId, x, y) {
        const id = scopeViewId(scopeId);
        const current = snapshot.views.find((view) => view.id === id);
        const next = { id, schemaVersion: 3, scopeId, positions: { ...(current?.positions ?? {}), [itemId]: { x, y } }, updatedAt: Date.now() };
        await this.put(snapshot, "planning_views", next, snapshot.revisions.get(`planning_views:${id}`) ?? 0);
    }
    async #all(id, signal) {
        const documents = [];
        let cursor;
        let revision;
        do {
            signal.throwIfAborted();
            const page = await this.#handles[id].query({ ...(cursor === undefined ? {} : { cursor }), limit: 200, signal, includeDataRevision: true, ...(revision === undefined ? {} : { expectedDataRevision: revision }) });
            signal.throwIfAborted();
            if (page.dataRevision === undefined || !Number.isSafeInteger(page.dataRevision) || page.dataRevision < 0 || (revision !== undefined && page.dataRevision !== revision)) {
                throw new Error("Planning data changed while loading, or the host lacks collection revisions. Reload after updating the host.");
            }
            revision = page.dataRevision;
            documents.push(...page.documents);
            cursor = page.nextCursor;
        } while (cursor !== undefined);
        return { documents, revision };
    }
}
const collections = ["planning_items", "planning_flow_links", "planning_references", "planning_consequences", "dm_notes", "planning_views"];
function deletionMutations(snapshot, itemIds, flowIds) {
    const mutations = [];
    const now = Date.now();
    const revision = (collection, id) => {
        const value = snapshot.revisions.get(`${collection}:${id}`);
        if (value === undefined)
            throw new Error("A record revision is missing. Reload the planner before deleting.");
        return value;
    };
    const remove = (collection, id) => { mutations.push({ operation: "delete", kind: "collection", dataId: collection, key: id, expectedRevision: revision(collection, id) }); };
    const update = (collection, value) => { mutations.push({ operation: "put", kind: "collection", dataId: collection, key: value.id, expectedRevision: revision(collection, value.id), value }); };
    for (const item of snapshot.items)
        if (itemIds.has(item.id))
            remove("planning_items", item.id);
    for (const flow of snapshot.flows)
        if (flowIds.has(flow.id))
            remove("planning_flow_links", flow.id);
    for (const reference of snapshot.references) {
        if (itemIds.has(reference.itemId) || (reference.target["scope"] === "planning" && itemIds.has(String(reference.target["itemId"]))))
            remove("planning_references", reference.id);
    }
    for (const consequence of snapshot.consequences) {
        const anchor = consequence.anchor;
        if (anchor["scope"] === "item" ? itemIds.has(String(anchor["itemId"])) : flowIds.has(String(anchor["flowId"])))
            remove("planning_consequences", consequence.id);
    }
    for (const note of snapshot.notes) {
        const remaining = note.anchorIds.filter(id => !itemIds.has(id));
        if (remaining.length === note.anchorIds.length)
            continue;
        if (remaining.length === 0)
            remove("dm_notes", note.id);
        else
            update("dm_notes", { ...note, anchorIds: remaining, updatedAt: now });
    }
    for (const view of snapshot.views) {
        if (view.scopeId !== null && itemIds.has(view.scopeId)) {
            remove("planning_views", view.id);
            continue;
        }
        const positions = Object.fromEntries(Object.entries(view.positions).filter(([id]) => !itemIds.has(id)));
        if (Object.keys(positions).length !== Object.keys(view.positions).length)
            update("planning_views", { ...view, positions, updatedAt: now });
    }
    if (mutations.length > 256)
        throw new Error("This deletion affects more than 256 records. Delete smaller subtrees first.");
    return mutations;
}
