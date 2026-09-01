import { scopeViewId, subtreeIds, validatePlanning } from "./planning-model.js";
export class PlanningRepository {
    #context;
    #handles;
    constructor(context) {
        this.#context = context;
        this.#handles = Object.fromEntries(collections.map((id) => [id, context.data.collection(id)]));
    }
    async load() {
        const pages = await Promise.all(collections.map((id) => this.#all(id)));
        const revisions = new Map();
        pages.forEach((documents, index) => { const id = collections[index]; for (const document of documents)
            revisions.set(`${id}:${document.key}`, document.revision); });
        const snapshot = {
            items: (pages[0] ?? []).map((document) => document.value), flows: (pages[1] ?? []).map((document) => document.value),
            references: (pages[2] ?? []).map((document) => document.value), consequences: (pages[3] ?? []).map((document) => document.value),
            notes: (pages[4] ?? []).map((document) => document.value), views: (pages[5] ?? []).map((document) => document.value), revisions,
        };
        const issues = validatePlanning(snapshot);
        if (issues.length > 0)
            throw new Error(`Stored planning data is inconsistent: ${issues.slice(0, 3).join(" ")}`);
        return snapshot;
    }
    put(collection, value, revision) { return this.#handles[collection].put(value.id, value, revision, { signal: this.#context.signal }); }
    async transact(mutations) { await this.#context.data.transact(mutations, { signal: this.#context.signal }); }
    async deleteSubtree(snapshot, rootId) {
        const ids = subtreeIds(snapshot.items, rootId);
        const flowIds = new Set(snapshot.flows.filter((flow) => ids.has(flow.sourceId) || ids.has(flow.targetId)).map((flow) => flow.id));
        const mutations = [];
        const addDeletes = (collection, records) => { for (const record of records) {
            const revision = snapshot.revisions.get(`${collection}:${record.id}`);
            if (revision !== undefined)
                mutations.push({ operation: "delete", kind: "collection", dataId: collection, key: record.id, expectedRevision: revision });
        } };
        addDeletes("planning_items", snapshot.items.filter((item) => ids.has(item.id)));
        addDeletes("planning_flow_links", snapshot.flows.filter((flow) => flowIds.has(flow.id)));
        addDeletes("planning_references", snapshot.references.filter((reference) => ids.has(reference.itemId)));
        addDeletes("planning_consequences", snapshot.consequences.filter((consequence) => { const anchor = consequence.anchor; return anchor["scope"] === "item" ? ids.has(String(anchor["itemId"])) : flowIds.has(String(anchor["flowId"])); }));
        for (const note of snapshot.notes) {
            const remaining = note.anchorIds.filter((id) => !ids.has(id));
            if (remaining.length === note.anchorIds.length)
                continue;
            const revision = snapshot.revisions.get(`dm_notes:${note.id}`);
            if (revision === undefined)
                continue;
            if (remaining.length === 0)
                mutations.push({ operation: "delete", kind: "collection", dataId: "dm_notes", key: note.id, expectedRevision: revision });
            else
                mutations.push({ operation: "put", kind: "collection", dataId: "dm_notes", key: note.id, expectedRevision: revision, value: { ...note, anchorIds: remaining, updatedAt: Date.now() } });
        }
        addDeletes("planning_views", snapshot.views.filter((view) => view.scopeId !== null && ids.has(view.scopeId)));
        if (mutations.length > 0)
            await this.transact(mutations);
    }
    async savePosition(snapshot, scopeId, itemId, x, y) {
        const id = scopeViewId(scopeId);
        const current = snapshot.views.find((view) => view.id === id);
        const next = { id, schemaVersion: 3, scopeId, positions: { ...(current?.positions ?? {}), [itemId]: { x, y } }, updatedAt: Date.now() };
        await this.put("planning_views", next, snapshot.revisions.get(`planning_views:${id}`) ?? 0);
    }
    async #all(id) { const documents = []; let cursor; do {
        const page = await this.#handles[id].query({ ...(cursor === undefined ? {} : { cursor }), limit: 200, signal: this.#context.signal });
        documents.push(...page.documents);
        cursor = page.nextCursor;
    } while (cursor !== undefined); return documents; }
}
const collections = ["planning_items", "planning_flow_links", "planning_references", "planning_consequences", "dm_notes", "planning_views"];
