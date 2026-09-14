import { PlannerError, plannerTranslator, plannerLabel } from "./planner-catalogs.js";
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
export function targetLabel(target, items, core, t = plannerTranslator()) {
    if (!target)
        return t("No target");
    if (target["scope"] === "planning")
        return items.find(item => item.id === target["itemId"])?.title ?? t("Unavailable planning item: {0}", { "0": String(target["itemId"]) });
    if (target["scope"] === "core")
        return core.records.find(record => record.collection === target["collection"] && record.id === target["id"])?.label ?? t("Unavailable {0}: {1}", { "0": plannerLabel(String(target["collection"]), t), "1": String(target["id"]) });
    return String(target["label"] ?? target["id"] ?? t("External record"));
}
export function targetFromForm(data, items, core, current, optional = false) {
    const text = (name) => String(data.get(name) ?? "").trim();
    const scope = text("targetScope");
    if (scope === "none" && optional)
        return undefined;
    if (scope === "planning") {
        const itemId = text("targetPlanningId");
        if (validId(itemId) && items.some(item => item.id === itemId))
            return { scope, itemId };
        throw new PlannerError("Choose an existing planning item as the target.");
    }
    if (scope === "core") {
        const key = text("targetCoreId");
        const record = core.records.find(record => JSON.stringify([record.collection, record.id]) === key);
        if (record)
            return { scope, collection: record.collection, id: record.id };
        if (current?.["scope"] === scope && JSON.stringify([current["collection"], current["id"]]) === key)
            return current;
        throw new PlannerError("Choose an available campaign record as the target.");
    }
    if (scope === "external") {
        const addonId = text("targetAddonId"), kind = text("targetKind"), id = text("targetRecordId"), label = text("targetLabel");
        if (/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u.test(addonId) && addonId.length <= 80 && kind.length > 0 && kind.length <= 80 && validId(id) && label.length > 0 && label.length <= 200)
            return { scope, addonId, kind, id, label };
        throw new PlannerError("Enter an add-on ID, record kind, record ID, and label for the external target.");
    }
    throw new PlannerError("Choose a target type.");
}
/** All fields stay in the form so switching target types cannot erase a draft. */
export function appendTargetFields(document, form, current, items, core, optional = false, t = plannerTranslator()) {
    const scope = selectField(document, t("Target type"), "targetScope", String(current?.["scope"] ?? (optional ? "none" : "planning")), [
        ...(optional ? [["none", t("No target")]] : []), ["planning", t("Planning item")], ["core", t("Campaign record")], ["external", t("External add-on record")],
    ]);
    const planning = document.createElement("div"), campaign = document.createElement("div"), external = document.createElement("div");
    const planningOptions = items.map(item => [item.id, item.title]);
    if (current?.["scope"] === "planning" && !items.some(item => item.id === current["itemId"]))
        planningOptions.push([String(current["itemId"]), targetLabel(current, items, core, t)]);
    planning.append(selectField(document, t("Planning target"), "targetPlanningId", String(current?.["itemId"] ?? ""), [["", t("Choose a planning item…")], ...planningOptions]));
    const coreOptions = core.records.map(record => [JSON.stringify([record.collection, record.id]), `${plannerLabel(record.collection, t)} — ${record.label}`]);
    const coreKey = current?.["scope"] === "core" ? JSON.stringify([current["collection"], current["id"]]) : "";
    if (coreKey && !coreOptions.some(([key]) => key === coreKey))
        coreOptions.push([coreKey, targetLabel(current, items, core, t)]);
    campaign.append(selectField(document, t("Campaign target"), "targetCoreId", coreKey, [["", t("Choose a campaign record…")], ...coreOptions]));
    if (!core.ready || core.truncated)
        campaign.append(messageBlock(document, core.ready ? t("Some campaign records are outside this list. Existing saved targets are retained.") : t("Campaign record choices are unavailable. Existing saved targets are retained."), "status"));
    for (const [label, name, key, limit] of [[t("Add-on ID"), "targetAddonId", "addonId", 80], [t("Record kind"), "targetKind", "kind", 80], [t("Record ID"), "targetRecordId", "id", 120], [t("Target label"), "targetLabel", "label", 200]]) {
        const field = textField(document, label, name, current?.["scope"] === "external" ? String(current[key] ?? "") : "");
        field.querySelector("input").maxLength = limit;
        external.append(field);
    }
    form.append(scope, planning, campaign, external);
    const refresh = () => { const value = scope.querySelector("select").value; planning.hidden = value !== "planning"; campaign.hidden = value !== "core"; external.hidden = value !== "external"; };
    scope.addEventListener("change", refresh);
    return refresh;
}
export function targetLink(document, target, items, core, addonId, t = plannerTranslator()) {
    const label = targetLabel(target, items, core, t);
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
