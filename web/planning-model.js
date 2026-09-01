export const planningKinds = ["plotline", "quest", "event", "branch"];
export function directChildren(items, scopeId) {
    return items.filter((item) => item.parentId === scopeId).sort((left, right) => left.title.localeCompare(right.title, "en"));
}
export function localFlows(dataset, scopeId) {
    const visible = new Set(directChildren(dataset.items, scopeId).map((item) => item.id));
    return dataset.flows.filter((flow) => visible.has(flow.sourceId) && visible.has(flow.targetId));
}
export function scopeTrail(items, scopeId) {
    const byId = new Map(items.map((item) => [item.id, item]));
    const result = [];
    const seen = new Set();
    let current = scopeId === null ? undefined : byId.get(scopeId);
    while (current !== undefined && !seen.has(current.id)) {
        seen.add(current.id);
        result.unshift(current);
        current = current.parentId === null ? undefined : byId.get(current.parentId);
    }
    return result;
}
export function subtreeIds(items, rootId) {
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
export function validatePlanning(dataset) {
    const issues = [];
    const byId = new Map();
    for (const item of dataset.items) {
        if (byId.has(item.id))
            issues.push(`Duplicate planning item ${item.id}.`);
        byId.set(item.id, item);
    }
    for (const item of dataset.items) {
        if (item.parentId !== null) {
            const parent = byId.get(item.parentId);
            if (parent === undefined)
                issues.push(`${item.title} has a missing parent.`);
            else if (parent.kind !== "plotline" && parent.kind !== "quest")
                issues.push(`${item.title} has a leaf item as its parent.`);
        }
        const seen = new Set([item.id]);
        let parentId = item.parentId;
        while (parentId !== null) {
            if (seen.has(parentId)) {
                issues.push(`Ownership cycle at ${item.title}.`);
                break;
            }
            seen.add(parentId);
            parentId = byId.get(parentId)?.parentId ?? null;
        }
    }
    const adjacency = new Map();
    for (const flow of dataset.flows) {
        const source = byId.get(flow.sourceId);
        const target = byId.get(flow.targetId);
        if (source === undefined || target === undefined) {
            issues.push(`Flow ${flow.id} has a missing endpoint.`);
            continue;
        }
        if (source.parentId !== target.parentId)
            issues.push(`Flow ${flow.id} crosses canvas scopes.`);
        if (flow.kind === "option" && source.kind !== "branch")
            issues.push(`Option flow ${flow.id} does not start at a branch.`);
        const edges = adjacency.get(source.id) ?? [];
        edges.push(target.id);
        adjacency.set(source.id, edges);
    }
    const visiting = new Set();
    const visited = new Set();
    const visit = (id) => { if (visiting.has(id)) {
        issues.push(`Flow cycle reaches ${id}.`);
        return;
    } if (visited.has(id))
        return; visiting.add(id); for (const target of adjacency.get(id) ?? [])
        visit(target); visiting.delete(id); visited.add(id); };
    for (const id of adjacency.keys())
        visit(id);
    return [...new Set(issues)];
}
export function newItem(kind, parentId, now = Date.now()) {
    const id = `${kind}-${crypto.randomUUID()}`;
    return { id, schemaVersion: 3, kind, parentId, title: `New ${kind}`, summary: "", body: "", objective: "", setup: "", resolution: "", ...(kind === "event" ? { eventType: "story" } : {}), ...(kind === "branch" ? { branchType: "decision" } : {}), tags: [], updatedAt: now };
}
export function scopeViewId(scopeId) { return scopeId === null ? "scope-root" : `scope-${scopeId}`; }
