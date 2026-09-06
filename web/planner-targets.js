import { messageBlock, selectField, textField } from "./planner-fields.js";
const coreCollections = ["characters", "factions", "locations", "mysteries", "artifacts", "events"];
const validId = (value) => /^[a-z0-9][a-z0-9._-]{0,119}$/u.test(value) && !["__proto__", "prototype", "constructor"].includes(value);
export function coreReferences(host) {
    const empty = { records: [], ready: false, truncated: false };
    if (!host || typeof host !== "object" || !("recordReferences" in host))
        return empty;
    const value = host.recordReferences;
    if (!value || typeof value !== "object" || !("records" in value) || !Array.isArray(value.records) || value.records.length > 1000 ||
        !("ready" in value) || typeof value.ready !== "boolean" || !("truncated" in value) || typeof value.truncated !== "boolean")
        return empty;
    const records = [];
    for (const entry of value.records) {
        if (!entry || typeof entry !== "object" || !coreCollections.includes(entry.collection) || typeof entry.id !== "string" || !validId(entry.id) ||
            typeof entry.label !== "string" || entry.label.length > 200 || typeof entry.href !== "string" || entry.href !== `#/${entry.collection}/${encodeURIComponent(entry.id)}`)
            continue;
        records.push({ collection: entry.collection, id: entry.id, label: entry.label, href: entry.href });
    }
    return { records, ready: value.ready, truncated: value.truncated };
}
export function targetLabel(target, items, core) {
    if (!target)
        return "No target";
    if (target["scope"] === "planning")
        return items.find(item => item.id === target["itemId"])?.title ?? `Unavailable planning item: ${String(target["itemId"])}`;
    if (target["scope"] === "core")
        return core.records.find(record => record.collection === target["collection"] && record.id === target["id"])?.label ?? `Unavailable ${String(target["collection"])}: ${String(target["id"])}`;
    return String(target["label"] ?? target["id"] ?? "External record");
}
export function targetFromForm(data, items, core, current, optional = false) {
    const text = (name) => String(data.get(name) ?? "").trim();
    const scope = text("targetScope");
    if (scope === "none" && optional)
        return undefined;
    if (scope === "planning") {
        const itemId = text("targetPlanningId");
        if (validId(itemId) && (items.some(item => item.id === itemId) || (current?.["scope"] === scope && current["itemId"] === itemId)))
            return { scope, itemId };
        throw new Error("Choose an existing planning item as the target.");
    }
    if (scope === "core") {
        const key = text("targetCoreId");
        const record = core.records.find(record => JSON.stringify([record.collection, record.id]) === key);
        if (record)
            return { scope, collection: record.collection, id: record.id };
        if (current?.["scope"] === scope && JSON.stringify([current["collection"], current["id"]]) === key)
            return current;
        throw new Error("Choose an available campaign record as the target.");
    }
    if (scope === "external") {
        const addonId = text("targetAddonId"), kind = text("targetKind"), id = text("targetRecordId"), label = text("targetLabel");
        if (/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u.test(addonId) && addonId.length <= 80 && kind.length > 0 && kind.length <= 80 && validId(id) && label.length > 0 && label.length <= 200)
            return { scope, addonId, kind, id, label };
        throw new Error("Enter an add-on ID, record kind, record ID, and label for the external target.");
    }
    throw new Error("Choose a target type.");
}
/** All fields stay in the form so switching target types cannot erase a draft. */
export function appendTargetFields(document, form, current, items, core, optional = false) {
    const scope = selectField(document, "Target type", "targetScope", String(current?.["scope"] ?? (optional ? "none" : "planning")), [
        ...(optional ? [["none", "No target"]] : []), ["planning", "Planning item"], ["core", "Campaign record"], ["external", "External add-on record"],
    ]);
    const planning = document.createElement("div"), campaign = document.createElement("div"), external = document.createElement("div");
    const planningOptions = items.map(item => [item.id, item.title]);
    if (current?.["scope"] === "planning" && !items.some(item => item.id === current["itemId"]))
        planningOptions.push([String(current["itemId"]), targetLabel(current, items, core)]);
    planning.append(selectField(document, "Planning target", "targetPlanningId", String(current?.["itemId"] ?? ""), [["", "Choose a planning item…"], ...planningOptions]));
    const coreOptions = core.records.map(record => [JSON.stringify([record.collection, record.id]), `${record.collection} — ${record.label}`]);
    const coreKey = current?.["scope"] === "core" ? JSON.stringify([current["collection"], current["id"]]) : "";
    if (coreKey && !coreOptions.some(([key]) => key === coreKey))
        coreOptions.push([coreKey, targetLabel(current, items, core)]);
    campaign.append(selectField(document, "Campaign target", "targetCoreId", coreKey, [["", "Choose a campaign record…"], ...coreOptions]));
    if (!core.ready || core.truncated)
        campaign.append(messageBlock(document, core.ready ? "Some campaign records are outside this list. Existing saved targets are retained." : "Campaign record choices are unavailable. Existing saved targets are retained.", "status"));
    for (const [label, name, key, limit] of [["Add-on ID", "targetAddonId", "addonId", 80], ["Record kind", "targetKind", "kind", 80], ["Record ID", "targetRecordId", "id", 120], ["Target label", "targetLabel", "label", 200]]) {
        const field = textField(document, label, name, current?.["scope"] === "external" ? String(current[key] ?? "") : "");
        field.querySelector("input").maxLength = limit;
        external.append(field);
    }
    form.append(scope, planning, campaign, external);
    const refresh = () => { const value = scope.querySelector("select").value; planning.hidden = value !== "planning"; campaign.hidden = value !== "core"; external.hidden = value !== "external"; };
    scope.addEventListener("change", refresh);
    return refresh;
}
export function targetLink(document, target, items, core, addonId) {
    const label = targetLabel(target, items, core);
    const href = target["scope"] === "planning" && items.some(item => item.id === target["itemId"])
        ? `#/addons/${encodeURIComponent(addonId)}/planner?item=${encodeURIComponent(String(target["itemId"]))}`
        : target["scope"] === "core" ? core.records.find(record => record.collection === target["collection"] && record.id === target["id"])?.href : undefined;
    if (!href) {
        const text = document.createElement("span");
        text.textContent = label;
        return text;
    }
    const link = document.createElement("a");
    link.href = href;
    link.textContent = label;
    return link;
}
