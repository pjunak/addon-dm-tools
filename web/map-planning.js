import { itemAnnotations } from "./planning-reader.js";
import { dashboardLocale, plannerLink } from "./dashboard-model.js";
import { plannerTranslator } from "./planner-catalogs.js";
import { runtimeFor } from "./runtime.js";
import { LiveRefresh } from "./live-refresh.js";
export function relatedPlanning(dataset, locationId) {
    const matches = (target) => target?.["scope"] === "core" && target["collection"] === "locations" && target["id"] === locationId;
    return dataset.items.filter(item => { const annotations = itemAnnotations(dataset, item.id); return annotations.references.some(value => matches(value.target)) || annotations.consequences.some(value => matches(value.target)); });
}
function locationId(host) {
    if (!host || typeof host !== "object" || !("contractVersion" in host) || host.contractVersion !== "record-context.v1" || !("readOnly" in host) || host.readOnly !== true || !("record" in host))
        return undefined;
    const record = host.record;
    return record && typeof record === "object" && "collection" in record && record.collection === "locations" && "id" in record && typeof record.id === "string" ? record.id : undefined;
}
export function defineMapPlanningElement(generation) {
    const tag = `dm-tools-map-planning-${generation}`;
    if (customElements.get(tag))
        return tag;
    class MapPlanning extends HTMLElement {
        #context;
        #snapshot;
        #request;
        #unsubscribe;
        #live;
        #status = "loading";
        set codexContribution(value) { const previous = this.#context; this.#context = value; if (!this.isConnected)
            return; if (previous?.addon.generation !== value.addon.generation || locationId(previous?.host) !== locationId(value.host))
            this.#connect();
        else if (dashboardLocale(previous?.host) !== dashboardLocale(value.host))
            this.#render(); }
        connectedCallback() { this.classList.add("dm-map-planning"); this.#connect(); }
        disconnectedCallback() { this.#request?.abort(); this.#unsubscribe?.(); this.#live?.dispose(); }
        #connect() {
            this.#request?.abort();
            this.#unsubscribe?.();
            this.#live?.dispose();
            this.#snapshot = undefined;
            const context = this.#context, runtime = context && runtimeFor(context.addon.generation);
            this.#live = new LiveRefresh(() => this.#status !== "loading", () => void this.#load());
            if (context && runtime)
                this.#unsubscribe = runtime.repository.subscribe(() => this.#live?.invalidate(), context.signal);
            void this.#load();
        }
        async #load() {
            this.#live?.consume();
            this.#request?.abort();
            const request = new AbortController();
            this.#request = request;
            this.#status = "loading";
            this.#render();
            const context = this.#context, runtime = context && runtimeFor(context.addon.generation);
            try {
                if (!context || !runtime || !locationId(context.host))
                    throw new Error("Map context unavailable.");
                const signal = AbortSignal.any([request.signal, context.signal, runtime.signal]);
                const snapshot = await runtime.repository.load(signal);
                signal.throwIfAborted();
                this.#snapshot = snapshot;
                this.#status = "ready";
            }
            catch {
                if (request.signal.aborted || this.#request !== request || !this.isConnected)
                    return;
                this.#snapshot = undefined;
                this.#status = "error";
            }
            if (this.#request === request && this.isConnected) {
                this.#render();
                this.#live?.wake();
            }
        }
        #render() {
            const document = this.ownerDocument, t = plannerTranslator(dashboardLocale(this.#context?.host)), root = document.createElement("div");
            root.setAttribute("aria-busy", String(this.#status === "loading"));
            if (this.#status !== "ready") {
                const message = document.createElement("p");
                message.setAttribute("role", this.#status === "error" ? "alert" : "status");
                message.textContent = t(this.#status === "error" ? "Could not load planning data." : "Loading story planner…");
                root.append(message);
            }
            if (this.#status === "error") {
                const retry = document.createElement("button");
                retry.type = "button";
                retry.textContent = t("Reload planner");
                retry.addEventListener("click", () => void this.#load());
                root.append(retry);
            }
            if (this.#snapshot && this.#status === "ready") {
                const items = relatedPlanning(this.#snapshot, locationId(this.#context?.host) ?? "");
                if (!items.length) {
                    const empty = document.createElement("p");
                    empty.textContent = t("No planning items reference this location.");
                    root.append(empty);
                }
                const list = document.createElement("ul");
                for (const item of [...items].sort((a, b) => a.title.localeCompare(b.title, dashboardLocale(this.#context?.host)) || a.id.localeCompare(b.id))) {
                    const row = document.createElement("li"), link = document.createElement("a");
                    link.href = plannerLink(this.#context.addon.id, item.id);
                    link.textContent = item.title;
                    row.append(link);
                    list.append(row);
                }
                root.append(list);
            }
            this.replaceChildren(root);
        }
    }
    customElements.define(tag, MapPlanning);
    return tag;
}
