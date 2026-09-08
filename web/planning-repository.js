import { PlannerError } from "./planner-catalogs.js";
import { scopeViewId, subtreeIds, validateItemEdit, validatePlanning } from "./planning-model.js";
export class PlanningRepository {
    #context;
    #handles;
    constructor(context) {
        this.#context = context;
        this.#handles = Object.fromEntries(collections.map((id) => [id, context.data.collection(id)]));
    }
    subscribe(listener, signal) {
        return this.#context.data.subscribe?.(change => {
            if (change.reason === "reset" || (change.kind === "collection" && collections.some(id => id === change.dataId)))
                listener();
        }, { signal: AbortSignal.any([signal, this.#context.signal]) }) ?? (() => undefined);
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
            throw new PlannerError(t => t("Stored planning data is inconsistent: {0}", { "0": validatePlanning(snapshot, t).slice(0, 3).join(" ") }));
        return snapshot;
    }
    async put(snapshot, collection, value, revision) {
        await this.transact(snapshot, [{ operation: "put", kind: "collection", dataId: collection, key: value.id, expectedRevision: revision, value }]);
    }
    async createItem(snapshot, item) {
        const issues = validatePlanning({ ...snapshot, items: [...snapshot.items, item] });
        if (issues.length)
            throw new PlannerError(t => validatePlanning({ ...snapshot, items: [...snapshot.items, item] }, t)[0]);
        await this.put(snapshot, "planning_items", item, 0);
    }
    async saveItem(snapshot, item, revision) {
        const issues = validateItemEdit(snapshot, item);
        if (issues.length)
            throw new PlannerError(t => validateItemEdit(snapshot, item, t)[0]);
        await this.put(snapshot, "planning_items", item, revision);
    }
    async transact(snapshot, mutations) {
        const guards = snapshot.dataRevisions;
        if (!Array.isArray(guards) || guards.length !== collections.length || collections.some(id => !guards.some(guard => guard.kind === "collection" && guard.dataId === id && Number.isSafeInteger(guard.revision) && guard.revision >= 0))) {
            throw new PlannerError("Collection revisions are missing. Reload the planner before saving.");
        }
        return this.#context.data.transact(mutations, { signal: this.#context.signal, expectedDataSets: guards });
    }
    async deleteSubtree(snapshot, rootId) {
        return this.deleteSelection(snapshot, [rootId], []);
    }
    async deleteFlow(snapshot, flowId) {
        return this.deleteSelection(snapshot, [], [flowId]);
    }
    async deleteSelection(snapshot, selectedItems, selectedFlows) {
        const ids = new Set(), flowIds = new Set(selectedFlows);
        for (const id of selectedItems) {
            if (!snapshot.items.some(item => item.id === id))
                throw new PlannerError("This planning item no longer exists. Reload the planner.");
            for (const child of subtreeIds(snapshot.items, id))
                ids.add(child);
        }
        for (const id of flowIds)
            if (!snapshot.flows.some(flow => flow.id === id))
                throw new PlannerError("This flow no longer exists. Reload the planner.");
        for (const flow of snapshot.flows)
            if (ids.has(flow.sourceId) || ids.has(flow.targetId))
                flowIds.add(flow.id);
        if (!ids.size && !flowIds.size)
            return;
        const mutations = deletionMutations(snapshot, ids, flowIds), receipt = await this.transact(snapshot, mutations);
        const original = recordsByCollection(snapshot);
        // Deleted keys retain tombstone revisions. Undo must never recreate at zero
        // or borrow newer revisions from a subsequently edited record.
        return { mutations: mutations.map(mutation => {
                const results = receipt.results.filter(result => result.dataId === mutation.dataId && result.key === mutation.key), result = results[0];
                if (results.length !== 1 || !result || !Number.isSafeInteger(result.afterRevision) || result.afterRevision <= mutation.expectedRevision || result.deleted !== (mutation.operation === "delete"))
                    throw new PlannerError("Deletion was saved, but its undo receipt is incomplete. Reload the planner.");
                const value = original.get(`${mutation.dataId}:${mutation.key}`);
                return { operation: "put", kind: "collection", dataId: mutation.dataId, key: mutation.key, expectedRevision: result.afterRevision, value: structuredClone(value) };
            }) };
    }
    async undoDeletion(snapshot, undo) {
        if (!undo.mutations.length || undo.mutations.length > 256)
            throw new PlannerError("This deletion cannot be restored in one transaction.");
        const records = recordsByCollection(snapshot), now = Date.now();
        const mutations = undo.mutations.map(mutation => {
            const key = `${mutation.dataId}:${mutation.key}`, current = snapshot.revisions.get(key);
            if (current !== undefined && current !== mutation.expectedRevision)
                throw new PlannerError("An affected record changed after deletion. Undo cannot overwrite those changes.");
            const value = { ...mutation.value, updatedAt: Math.max(now, mutation.value.updatedAt + 1) };
            records.set(key, value);
            return { ...mutation, value };
        });
        const restored = (key) => [...records].filter(([id]) => id.startsWith(`${collectionKeys[key]}:`)).map(([, value]) => value);
        const restoredDataset = { items: restored("items"), flows: restored("flows"), references: restored("references"), consequences: restored("consequences"), notes: restored("notes"), views: restored("views") };
        const issues = validatePlanning(restoredDataset);
        if (issues.length)
            throw new PlannerError(t => t("Cannot undo deletion: {0}", { "0": validatePlanning(restoredDataset, t)[0] }));
        await this.transact(snapshot, mutations);
    }
    async resetLayout(snapshot, scopeId) {
        const view = snapshot.views.find(value => value.scopeId === scopeId);
        if (!view)
            return;
        const revision = snapshot.revisions.get(`planning_views:${view.id}`);
        if (revision === undefined)
            throw new PlannerError("The layout revision is missing. Reload the planner.");
        // Keep the revision-bearing view so a later drag does not recreate a tombstone.
        await this.put(snapshot, "planning_views", { ...view, positions: {}, updatedAt: Date.now() }, revision);
    }
    async savePosition(snapshot, scopeId, itemId, x, y) {
        await this.savePositions(snapshot, scopeId, { [itemId]: { x, y } });
    }
    async savePositions(snapshot, scopeId, positions) {
        if (!Object.keys(positions).length)
            return;
        for (const [itemId, point] of Object.entries(positions)) {
            if (!snapshot.items.some(item => item.id === itemId && item.parentId === scopeId))
                throw new PlannerError("Only items on this canvas can be moved. Reload the planner.");
            if (!Number.isFinite(point.x) || !Number.isFinite(point.y))
                throw new PlannerError("Canvas positions must be finite numbers.");
        }
        const id = scopeViewId(scopeId);
        const current = snapshot.views.find((view) => view.id === id);
        const next = { id, schemaVersion: 3, scopeId, positions: { ...(current?.positions ?? {}), ...positions }, updatedAt: Date.now() };
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
                throw new PlannerError("Planning data changed while loading, or the host lacks collection revisions. Reload after updating the host.");
            }
            revision = page.dataRevision;
            documents.push(...page.documents);
            cursor = page.nextCursor;
        } while (cursor !== undefined);
        return { documents, revision };
    }
}
const collections = ["planning_items", "planning_flow_links", "planning_references", "planning_consequences", "dm_notes", "planning_views"];
const collectionKeys = { items: "planning_items", flows: "planning_flow_links", references: "planning_references", consequences: "planning_consequences", notes: "dm_notes", views: "planning_views" };
function recordsByCollection(snapshot) {
    return new Map(Object.entries(collectionKeys).flatMap(([key, collection]) => snapshot[key].map(value => [`${collection}:${value.id}`, value])));
}
function deletionMutations(snapshot, itemIds, flowIds) {
    const mutations = [];
    const now = Date.now();
    const revision = (collection, id) => {
        const value = snapshot.revisions.get(`${collection}:${id}`);
        if (value === undefined)
            throw new PlannerError("A record revision is missing. Reload the planner before deleting.");
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
        throw new PlannerError("This deletion affects more than 256 records. Delete smaller subtrees first.");
    return mutations;
}
