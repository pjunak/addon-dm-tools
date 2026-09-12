import { plannerTranslator } from "./planner-catalogs.js";
const planningKinds = ["plotline", "quest", "event", "branch"];
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
export function availableParents(items, itemId) {
    const excluded = subtreeIds(items, itemId);
    return items.filter(item => !excluded.has(item.id) && (item.kind === "plotline" || item.kind === "quest"))
        .sort((a, b) => a.title.localeCompare(b.title, "en") || a.id.localeCompare(b.id));
}
export function validateItemEdit(dataset, next, t = plannerTranslator()) {
    const current = dataset.items.find(item => item.id === next.id);
    if (!current)
        return [t("This planning item no longer exists. Reload the planner.")];
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
export function validatePlanning(dataset, t = plannerTranslator()) {
    const issues = [];
    const byId = new Map();
    for (const item of dataset.items) {
        if (byId.has(item.id))
            issues.push(t("Duplicate planning item {0}.", { "0": item.id }));
        byId.set(item.id, item);
    }
    for (const item of dataset.items) {
        if (item.parentId !== null) {
            const parent = byId.get(item.parentId);
            if (parent === undefined)
                issues.push(t("{0} has a missing parent.", { "0": item.title }));
            else if (parent.kind !== "plotline" && parent.kind !== "quest")
                issues.push(t("{0} has a leaf item as its parent.", { "0": item.title }));
        }
        const seen = new Set([item.id]);
        let parentId = item.parentId;
        while (parentId !== null) {
            if (seen.has(parentId)) {
                issues.push(t("Ownership cycle at {0}.", { "0": item.title }));
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
            issues.push(t("Flow {0} has a missing endpoint.", { "0": flow.id }));
            continue;
        }
        if (source.parentId !== target.parentId)
            issues.push(t("Flow {0} crosses canvas scopes.", { "0": flow.id }));
        if (flow.kind === "option" && source.kind !== "branch")
            issues.push(t("Option flow {0} does not start at a branch.", { "0": flow.id }));
        const edges = adjacency.get(source.id) ?? [];
        edges.push(target.id);
        adjacency.set(source.id, edges);
    }
    const visiting = new Set();
    const visited = new Set();
    const visit = (id) => { if (visiting.has(id)) {
        issues.push(t("Flow cycle reaches {0}.", { "0": id }));
        return;
    } if (visited.has(id))
        return; visiting.add(id); for (const target of adjacency.get(id) ?? [])
        visit(target); visiting.delete(id); visited.add(id); };
    for (const id of adjacency.keys())
        visit(id);
    for (const reference of dataset.references) {
        if (!byId.has(reference.itemId))
            issues.push(t("Reference {0} has a missing item.", { "0": reference.id }));
        if (reference.target["scope"] === "planning" && !byId.has(String(reference.target["itemId"])))
            issues.push(t("Reference {0} has a missing planning target.", { "0": reference.id }));
    }
    const flowIds = new Set(dataset.flows.map(flow => flow.id));
    for (const consequence of dataset.consequences) {
        const anchor = consequence.anchor;
        if (anchor["scope"] === "item") {
            if (!byId.has(String(anchor["itemId"])))
                issues.push(t("Consequence {0} has a missing item anchor.", { "0": consequence.id }));
        }
        else if (anchor["scope"] === "flow") {
            if (!flowIds.has(String(anchor["flowId"])))
                issues.push(t("Consequence {0} has a missing flow anchor.", { "0": consequence.id }));
        }
        else
            issues.push(t("Consequence {0} has an invalid anchor.", { "0": consequence.id }));
    }
    for (const note of dataset.notes)
        for (const id of note.anchorIds)
            if (!byId.has(id))
                issues.push(t("Note {0} has a missing anchor {1}.", { "0": note.id, "1": id }));
    return [...new Set(issues)];
}
export function newItem(kind, parentId, now = Date.now(), t = plannerTranslator()) {
    const id = `${kind}-${crypto.randomUUID()}`;
    return { id, schemaVersion: 3, kind, parentId, title: t("New {0}", { "0": t(kind) }), summary: "", body: "", objective: "", setup: "", resolution: "", ...(kind === "event" ? { eventType: "story" } : {}), ...(kind === "branch" ? { branchType: "decision" } : {}), tags: [], updatedAt: now };
}
export function scopeViewId(scopeId) { return scopeId === null ? "scope-root" : `scope-${scopeId}`; }
