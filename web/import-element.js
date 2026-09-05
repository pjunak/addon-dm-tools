import { runtimeFor } from "./runtime.js";
export const importElementTag = "dm-tools-import-center";
export function defineImportElement(generation) {
    const tag = generation ? `${importElementTag}-${generation}` : importElementTag;
    if (customElements.get(tag) !== undefined)
        return tag;
    class ImportCenterElement extends HTMLElement {
        #contribution;
        #runtime;
        #adapters = [];
        #selected;
        #preview;
        #busy = false;
        #message = "";
        #messageKind = "status";
        #request;
        set codexContribution(value) { const previous = this.#contribution; this.#contribution = value; if (this.isConnected && previous?.addon.generation !== value.addon.generation)
            void this.#connect(); }
        connectedCallback() { this.classList.add("dm-tools-import"); void this.#connect(); }
        disconnectedCallback() { this.#request?.abort(); this.#request = undefined; this.#runtime = undefined; this.#preview = undefined; this.#selected = undefined; }
        #startRequest() { this.#request?.abort(); const request = new AbortController(); this.#request = request; return request; }
        #current(runtime, request) { return this.isConnected && this.#runtime === runtime && this.#request === request && !request.signal.aborted && !runtime.signal.aborted; }
        async #connect() {
            const contribution = this.#contribution;
            if (contribution === undefined) {
                this.#unavailable("The host did not provide an import generation.");
                return;
            }
            const runtime = runtimeFor(contribution.addon.generation);
            if (runtime === undefined || runtime.signal.aborted) {
                this.#unavailable("This Import Center generation is no longer active.");
                return;
            }
            const request = this.#startRequest(), signal = AbortSignal.any([request.signal, runtime.signal]);
            this.#runtime = runtime;
            this.#adapters = [];
            this.#preview = undefined;
            this.#selected = undefined;
            this.#busy = true;
            this.#message = "Discovering import adapters…";
            this.#messageKind = "status";
            this.#render();
            try {
                const adapters = [];
                for (const provider of runtime.adapters.providers) {
                    signal.throwIfAborted();
                    try {
                        const description = await runtime.adapters.call("describe", {}, { providerAddonId: provider.addonId, deadlineMs: 3_000, signal });
                        if (description.contractVersion === "import-adapter-description.v1" && description.formats.length > 0)
                            adapters.push({ provider, description });
                    }
                    catch { /* A broken optional adapter must not hide healthy providers. */ }
                }
                if (this.#current(runtime, request)) {
                    this.#adapters = adapters.sort((left, right) => left.description.label.localeCompare(right.description.label, "en"));
                    this.#message = "";
                }
            }
            catch (error) {
                if (this.#current(runtime, request))
                    this.#fail(error, "Could not discover import adapters.");
            }
            finally {
                if (this.#current(runtime, request)) {
                    this.#busy = false;
                    this.#render();
                }
            }
        }
        #render() {
            const document = this.ownerDocument;
            const root = document.createElement("section");
            root.className = "dm-import-shell";
            const title = document.createElement("h1");
            title.textContent = "Import Center";
            const intro = document.createElement("p");
            intro.textContent = "Choose a JSON file. Its top-level format selects one owning adapter; preview is read-only until you explicitly commit it.";
            root.append(title, intro);
            if (this.#message !== "")
                root.append(messageBlock(document, this.#message, this.#messageKind));
            const adapters = document.createElement("div");
            adapters.className = "dm-import-adapters";
            const heading = document.createElement("h2");
            heading.textContent = "Available formats";
            adapters.append(heading);
            if (this.#adapters.length === 0 && !this.#busy)
                adapters.append(messageBlock(document, "No compatible import adapters are active.", "status"));
            for (const adapter of this.#adapters) {
                const card = document.createElement("article");
                const name = document.createElement("h3");
                name.textContent = adapter.description.label;
                const description = document.createElement("p");
                description.textContent = adapter.description.description;
                const formats = document.createElement("code");
                formats.textContent = adapter.description.formats.join(", ");
                card.append(name, description, formats);
                adapters.append(card);
            }
            root.append(adapters);
            const chooser = document.createElement("section");
            chooser.className = "dm-import-chooser";
            const chooserTitle = document.createElement("h2");
            chooserTitle.textContent = "Preview file";
            const input = document.createElement("input");
            input.type = "file";
            input.accept = "application/json,.json";
            input.disabled = this.#busy || this.#adapters.length === 0;
            input.addEventListener("change", () => { const file = input.files?.[0]; if (file !== undefined)
                void this.#open(file); });
            chooser.append(chooserTitle, input);
            root.append(chooser);
            if (this.#preview !== undefined && this.#selected !== undefined)
                root.append(this.#renderPreview(document, this.#preview, this.#selected));
            this.replaceChildren(root);
        }
        #renderPreview(document, preview, adapter) {
            const section = document.createElement("section");
            section.className = "dm-import-preview";
            const title = document.createElement("h2");
            title.textContent = `${adapter.description.label} preview`;
            const summary = document.createElement("p");
            summary.className = "dm-import-summary";
            summary.textContent = `${preview.summary.creates} create · ${preview.summary.updates} update · ${preview.summary.skips} unchanged · ${preview.summary.deletes} delete`;
            section.append(title, summary);
            for (const warning of preview.warnings)
                section.append(messageBlock(document, warning, "alert"));
            const list = document.createElement("ul");
            for (const change of preview.changes) {
                const item = document.createElement("li");
                item.textContent = `${change.operation}: ${change.label} (${change.collection}/${change.id})`;
                list.append(item);
            }
            section.append(list);
            const destructive = preview.summary.deletes > 0;
            const button = actionButton(document, destructive ? `Commit replacement with ${preview.summary.deletes} deletions` : "Commit reviewed import", () => void this.#commit(), destructive ? "danger" : "primary");
            button.disabled = this.#busy;
            const cancel = actionButton(document, "Cancel preview", () => { this.#preview = undefined; this.#selected = undefined; this.#message = "Preview cancelled. No campaign data has changed."; this.#messageKind = "status"; this.#render(); });
            cancel.disabled = this.#busy;
            section.append(button, cancel);
            return section;
        }
        async #open(file) {
            const runtime = this.#runtime;
            if (runtime === undefined || this.#busy)
                return;
            this.#busy = true;
            this.#preview = undefined;
            this.#selected = undefined;
            this.#message = "Reading and previewing file…";
            this.#messageKind = "status";
            this.#render();
            const request = this.#startRequest(), signal = AbortSignal.any([request.signal, runtime.signal]);
            try {
                if (file.size > 2 * 1024 * 1024)
                    throw new Error("Import files are limited to 2 MiB.");
                const source = await file.text();
                signal.throwIfAborted();
                const document = JSON.parse(source);
                if (!isRecord(document) || typeof document["format"] !== "string")
                    throw new Error("The JSON root must contain a string format field.");
                const matches = this.#adapters.filter((adapter) => adapter.description.formats.includes(document["format"]));
                if (matches.length === 0)
                    throw new Error(`No adapter owns format ${document["format"]}.`);
                if (matches.length > 1)
                    throw new Error(`More than one adapter claims format ${document["format"]}; resolve the installation conflict before importing.`);
                const selected = matches[0];
                const preview = await runtime.adapters.call("preview", { contractVersion: "import-preview.v1", format: document["format"], document }, { providerAddonId: selected.provider.addonId, deadlineMs: 15_000, signal });
                if (!this.#current(runtime, request))
                    return;
                this.#selected = selected;
                this.#preview = preview;
                this.#message = "Preview ready. No campaign data has changed.";
            }
            catch (error) {
                if (this.#current(runtime, request))
                    this.#fail(error, "Could not preview this import.");
            }
            finally {
                if (this.#current(runtime, request)) {
                    this.#busy = false;
                    this.#render();
                }
            }
        }
        async #commit() {
            const runtime = this.#runtime;
            const preview = this.#preview;
            const selected = this.#selected;
            if (runtime === undefined || preview === undefined || selected === undefined || this.#busy)
                return;
            const request = this.#startRequest(), signal = AbortSignal.any([request.signal, runtime.signal]);
            // A submitted token is single-use, including conflicts and lost replies.
            this.#preview = undefined;
            this.#selected = undefined;
            this.#busy = true;
            this.#message = "Committing the exact reviewed plan…";
            this.#messageKind = "status";
            this.#render();
            try {
                const result = await runtime.adapters.call("commit", { contractVersion: "import-commit.v1", token: preview.token }, { providerAddonId: selected.provider.addonId, deadlineMs: 15_000, idempotencyKey: preview.token, signal });
                if (!this.#current(runtime, request))
                    return;
                this.#preview = undefined;
                this.#selected = undefined;
                this.#message = `Import committed: ${result.writes} writes and ${result.deletes} deletions.`;
            }
            catch (error) {
                if (this.#current(runtime, request)) {
                    this.#message = isRecord(error) && error["code"] === "CONFLICT"
                        ? "Planning data changed. Choose the file again to review a new preview."
                        : "Could not confirm the import. Check planning data before choosing the file again for a new preview.";
                    this.#messageKind = "alert";
                }
            }
            finally {
                if (this.#current(runtime, request)) {
                    this.#busy = false;
                    this.#render();
                }
            }
        }
        #fail(error, fallback) { this.#message = error instanceof Error && error.message !== "" ? error.message : fallback; this.#messageKind = "alert"; }
        #unavailable(message) { this.replaceChildren(messageBlock(this.ownerDocument, message, "alert")); }
    }
    customElements.define(tag, ImportCenterElement);
    return tag;
}
function isRecord(value) { return typeof value === "object" && value !== null && !Array.isArray(value); }
function actionButton(document, label, action, style) { const button = document.createElement("button"); button.type = "button"; button.textContent = label; if (style !== undefined)
    button.className = style; button.addEventListener("click", action); return button; }
function messageBlock(document, message, role) { const block = document.createElement("div"); block.className = `dm-tools-message ${role}`; block.setAttribute("role", role); block.textContent = message; return block; }
