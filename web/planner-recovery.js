import { newItem } from "./planning-model.js";
export const recoveryLimit = 2_000_000;
/** Only serialized editor values cross generations; SDK handles never do. */
export class PlannerRecoveryStore {
    #storage;
    #key;
    constructor(storage, addonId) {
        this.#storage = storage;
        this.#key = JSON.stringify(["dm-tools-planner-drafts.v1", addonId, "dm"]);
    }
    read() {
        let raw;
        try {
            raw = this.#storage().getItem(this.#key);
        }
        catch {
            return { kind: "unavailable" };
        }
        if (raw === null)
            return { kind: "empty" };
        try {
            return { kind: "ready", value: parseRecovery(raw) };
        }
        catch {
            return { kind: "invalid", raw };
        }
    }
    save(value) {
        const text = JSON.stringify(value);
        parseRecovery(text);
        this.#storage().setItem(this.#key, text);
    }
    clear() { this.#storage().removeItem(this.#key); }
}
export function provisionalItem(value) {
    return { ...newItem(value.kind, value.parentId, value.updatedAt), id: value.id, title: value.title };
}
function record(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function exact(value, keys) {
    return Object.keys(value).every(key => keys.includes(key)) && keys.every(key => Object.hasOwn(value, key));
}
function identity(value) {
    return typeof value === "string" && value.length > 0 && value.length <= 200 && !/[\u0000-\u001f\u007f]/u.test(value);
}
function draftKey(value) {
    return typeof value === "string" && /^(planning_items|planning_flow_links|planning_references|planning_consequences|dm_notes|new-item|new-flow|new-reference):/u.test(value) && identity(value.slice(value.indexOf(":") + 1));
}
function values(value) {
    return record(value) && Object.keys(value).length <= 32 && Object.entries(value).every(([key, entry]) => /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/u.test(key) && typeof entry === "string" && entry.length <= 160_000);
}
function draft(value) {
    return record(value) && Object.keys(value).every(key => ["revision", "baseline", "values"].includes(key)) &&
        (value["revision"] === undefined || (Number.isSafeInteger(value["revision"]) && Number(value["revision"]) >= 0)) &&
        values(value["baseline"]) && values(value["values"]);
}
export function parseRecovery(text) {
    const invalid = () => { throw new Error("Invalid or oversized planner recovery copy"); };
    if (text.length > recoveryLimit)
        invalid();
    const value = JSON.parse(text);
    if (!record(value) || !exact(value, ["format", "drafts", "provisional", "unconfirmed", "editor", "tab"]) ||
        value["format"] !== "dm-tools-planner-drafts.v1" ||
        !Array.isArray(value["drafts"]) || value["drafts"].length > 50 ||
        !Array.isArray(value["unconfirmed"]) || value["unconfirmed"].length > 50 ||
        (value["editor"] !== null && !identity(value["editor"])) ||
        !["details", "links", "notes"].includes(String(value["tab"])))
        return invalid();
    const keys = new Set();
    for (const entry of value["drafts"]) {
        if (!Array.isArray(entry) || entry.length !== 2 || !draftKey(entry[0]) || keys.has(entry[0]) || !draft(entry[1]))
            return invalid();
        keys.add(entry[0]);
    }
    const item = value["provisional"];
    if (item !== null) {
        if (!record(item) || !exact(item, ["id", "kind", "parentId", "title", "updatedAt"]) ||
            !identity(item["id"]) || !["plotline", "quest", "event", "branch"].includes(String(item["kind"])) ||
            (item["parentId"] !== null && !identity(item["parentId"])) ||
            typeof item["title"] !== "string" || item["title"].length > 160 ||
            !Number.isSafeInteger(item["updatedAt"]) || Number(item["updatedAt"]) < 0)
            return invalid();
        keys.add(`new-item:${item["id"]}`);
    }
    if (value["drafts"].some(entry => entry[0].startsWith("new-item:") && (!record(item) || entry[0] !== `new-item:${item["id"]}`)) ||
        value["unconfirmed"].some(key => !draftKey(key) || !keys.has(key)) ||
        new Set(value["unconfirmed"]).size !== value["unconfirmed"].length)
        return invalid();
    return {
        format: "dm-tools-planner-drafts.v1",
        drafts: value["drafts"],
        provisional: item,
        unconfirmed: value["unconfirmed"],
        editor: value["editor"],
        tab: value["tab"],
    };
}
