import { runtimeFor } from "./runtime.js";
import { dashboardLocale } from "./dashboard-model.js";
import { ImportProblem, importText, isRecord, parseAdapterDescription, parseImportPreview, parseImportSource, selectAdapter } from "./import-model.js";
export const importElementTag = "dm-tools-import-center";
export function defineImportElement(generation) {
    const tag = generation ? `${importElementTag}-${generation}` : importElementTag;
    if (customElements.get(tag))
        return tag;
    class ImportCenterElement extends HTMLElement {
        #contribution;
        #runtime;
        #adapters = [];
        #failedProviders = [];
        #selected;
        #preview;
        #fileName = "";
        #format = "";
        #phase = "idle";
        #message;
        #params = {};
        #messageKind = "status";
        #request;
        set codexContribution(value) {
            const previous = this.#contribution;
            this.#contribution = value;
            if (!this.isConnected)
                return;
            if (previous?.addon.generation !== value.addon.generation)
                void this.#connect();
            else if (dashboardLocale(previous.host) !== dashboardLocale(value.host))
                this.#render();
        }
        connectedCallback() { this.classList.add("dm-tools-import"); void this.#connect(); }
        disconnectedCallback() {
            this.#request?.abort();
            this.#request = undefined;
            this.#runtime = undefined;
            this.#preview = undefined;
            this.#selected = undefined;
            this.#contribution?.edits?.set({ dirty: false, saving: false });
        }
        #t(key, params = {}) { return importText(dashboardLocale(this.#contribution?.host), key, params); }
        #startRequest() { this.#request?.abort(); const request = new AbortController(); this.#request = request; return request; }
        #signal(runtime, request) { return AbortSignal.any([request.signal, runtime.signal, this.#contribution.signal]); }
        #current(runtime, request) { return this.isConnected && this.#runtime === runtime && this.#request === request && !this.#signal(runtime, request).aborted; }
        #notice(key, kind = "status", params = {}) { this.#message = key; this.#messageKind = kind; this.#params = params; }
        #setPhase(phase) { this.#phase = phase; this.#contribution?.edits?.set({ dirty: false, saving: phase === "committing" }); }
        async #connect() {
            const contribution = this.#contribution, runtime = contribution && runtimeFor(contribution.addon.generation);
            if (!runtime || runtime.signal.aborted) {
                this.#notice("missingGeneration", "alert");
                this.#render();
                return;
            }
            const request = this.#startRequest(), signal = this.#signal(runtime, request);
            this.#runtime = runtime;
            this.#adapters = [];
            this.#failedProviders = [];
            this.#preview = undefined;
            this.#selected = undefined;
            this.#fileName = "";
            this.#setPhase("discovering");
            this.#notice("discovering");
            this.#render();
            // Optional providers are independent; one timeout must not serialize all discovery.
            const results = await Promise.allSettled(runtime.adapters.providers.map(async (provider) => ({ provider,
                description: parseAdapterDescription(await runtime.adapters.call("describe", {}, { providerAddonId: provider.addonId, deadlineMs: 3_000, signal })),
            })));
            if (!this.#current(runtime, request))
                return;
            const adapters = [], failed = [];
            results.forEach((result, index) => { if (result.status === "fulfilled")
                adapters.push(result.value);
            else
                failed.push(runtime.adapters.providers[index].addonId); });
            this.#adapters = adapters;
            this.#failedProviders = failed;
            this.#setPhase("idle");
            this.#notice(undefined);
            this.#render();
        }
        #render() {
            const document = this.ownerDocument, root = node(document, "section", "dm-import-shell");
            root.setAttribute("aria-busy", String(this.#phase !== "idle"));
            const heading = node(document, "header", "dm-import-heading");
            heading.append(node(document, "p", "dm-import-meta", this.#t("center.kicker")), node(document, "h1", "", this.#t("center.title")), node(document, "p", "dm-import-hint", this.#t("center.intro")));
            root.append(heading);
            if (this.#message)
                root.append(messageBlock(document, this.#t(this.#message, this.#params), this.#messageKind));
            if (this.#selected && this.#fileName) {
                const routing = node(document, "section", "dm-import-routing");
                routing.setAttribute("aria-label", this.#t("center.routeTitle"));
                const file = node(document), owner = node(document);
                file.append(node(document, "span", "dm-import-meta", this.#t("center.document")), node(document, "strong", "", this.#fileName), node(document, "code", "dm-import-badge", this.#format));
                owner.append(node(document, "span", "dm-import-meta", this.#t("center.handledBy")), node(document, "strong", "", this.#selected.description.label));
                const arrow = node(document, "span", "", "→");
                arrow.setAttribute("aria-hidden", "true");
                const another = actionButton(document, this.#t("center.chooseAnother"), () => this.#cancel());
                another.disabled = this.#phase === "committing";
                routing.append(file, arrow, owner, another);
                root.append(routing);
            }
            const chooser = this.#chooser(document);
            chooser.hidden = this.#selected !== undefined;
            root.append(chooser);
            if (this.#phase === "previewing")
                root.append(actionButton(document, this.#t("cancel"), () => this.#cancel()));
            if (this.#preview && this.#selected)
                root.append(this.#renderPreview(document, this.#preview, this.#selected));
            this.replaceChildren(root);
        }
        #chooser(document) {
            const chooser = node(document, "div", "dm-import-chooser"), dropzone = node(document, "section", "dm-import-dropzone");
            const icon = node(document, "div", "dm-import-drop-icon", "⌁");
            icon.setAttribute("aria-hidden", "true");
            dropzone.append(icon, node(document, "h2", "", this.#t("center.chooseTitle")), node(document, "p", "dm-import-hint", this.#t("center.chooseBody")), node(document, "p", "dm-import-hint", this.#t("dropHint")));
            const input = document.createElement("input");
            input.type = "file";
            input.accept = "application/json,.json";
            input.setAttribute("aria-label", this.#t("center.chooseFile"));
            input.disabled = this.#phase !== "idle" || !this.#adapters.length;
            input.addEventListener("change", () => { const file = input.files?.[0]; if (file)
                void this.#open(file); });
            const label = node(document, "label", "dm-import-file-button", this.#t("center.chooseFile"));
            label.append(input);
            dropzone.append(label);
            dropzone.addEventListener("dragover", event => { event.preventDefault(); if (!input.disabled)
                dropzone.classList.add("is-dragging"); });
            dropzone.addEventListener("dragleave", () => dropzone.classList.remove("is-dragging"));
            dropzone.addEventListener("drop", event => {
                event.preventDefault();
                dropzone.classList.remove("is-dragging");
                if (input.disabled)
                    return;
                const files = event.dataTransfer?.files;
                if (files?.length !== 1) {
                    this.#notice("oneFile", "alert");
                    this.#render();
                    return;
                }
                void this.#open(files[0]);
            });
            chooser.append(dropzone);
            const supported = node(document, "section", "dm-import-adapters"), head = node(document, "div", "dm-import-section-head");
            head.append(node(document, "h2", "", this.#t("center.supportedTitle")));
            const retry = actionButton(document, this.#t("refresh"), () => void this.#connect());
            retry.disabled = this.#phase !== "idle";
            head.append(retry);
            supported.append(head, node(document, "p", "dm-import-hint", this.#t("center.supportedBody")));
            if (this.#failedProviders.length)
                supported.append(messageBlock(document, this.#t("failedProviders", { providers: this.#failedProviders.join(", ") }), "alert"));
            if (!this.#adapters.length && this.#phase === "idle") {
                const empty = node(document, "div", "dm-import-empty");
                empty.append(node(document, "h3", "", this.#t("center.noneTitle")), node(document, "p", "dm-import-hint", this.#t("center.noneBody")));
                supported.append(empty);
            }
            for (const adapter of [...this.#adapters].sort((a, b) => a.description.label.localeCompare(b.description.label, dashboardLocale(this.#contribution?.host)))) {
                const card = node(document, "article", "dm-import-adapter"), description = node(document), formats = node(document, "div", "dm-import-formats");
                description.append(node(document, "h3", "", adapter.description.label), node(document, "p", "dm-import-hint", adapter.description.description));
                for (const format of adapter.description.formats)
                    formats.append(node(document, "code", "dm-import-badge", format));
                card.append(description, formats);
                supported.append(card);
            }
            chooser.append(supported);
            return chooser;
        }
        #renderPreview(document, preview, adapter) {
            const section = node(document, "section", "dm-import-preview"), head = node(document, "header", "dm-import-section-head");
            const title = node(document, "h2", "", this.#t("previewTitle", { label: adapter.description.label }));
            title.tabIndex = -1;
            head.append(title, node(document, "span", "dm-import-badge", this.#t(preview.mode)));
            section.append(head);
            const metrics = node(document, "div", "dm-import-summary");
            for (const key of ["creates", "updates", "skips", "deletes"]) {
                const metric = node(document);
                metric.append(node(document, "strong", "", new Intl.NumberFormat(dashboardLocale(this.#contribution?.host)).format(preview.summary[key])), node(document, "span", "", this.#t(key)));
                metrics.append(metric);
            }
            section.append(metrics);
            if (preview.warnings.length) {
                const warnings = node(document, "section", "dm-import-review-section");
                warnings.append(node(document, "h3", "", this.#t("warnings")));
                for (const warning of preview.warnings)
                    warnings.append(messageBlock(document, warning, "alert"));
                section.append(warnings);
            }
            const changes = node(document, "section", "dm-import-review-section");
            changes.append(node(document, "h3", "", this.#t("changes")));
            const list = document.createElement("ul");
            for (const change of preview.changes) {
                const item = node(document, "li", "dm-import-change"), details = document.createElement("details"), summary = document.createElement("summary");
                const operation = { create: "creates", update: "updates", delete: "deletes" };
                summary.append(node(document, "span", "dm-import-badge", this.#t(operation[change.operation])), node(document, "strong", "", change.label));
                details.append(summary, node(document, "p", "dm-import-hint", `${this.#t("collection")}: ${change.collection} · ${this.#t("record")}: ${change.id}`));
                item.append(details);
                list.append(item);
            }
            changes.append(preview.changes.length ? list : node(document, "p", "dm-import-hint", this.#t("noChanges")));
            section.append(changes);
            const actions = node(document, "footer", "dm-import-actions"), destructive = preview.summary.deletes > 0;
            const commit = actionButton(document, this.#t(destructive ? "commitDelete" : "commit", { count: preview.summary.deletes }), () => void this.#commit(), destructive ? "danger" : "primary");
            const cancel = actionButton(document, this.#t("cancel"), () => this.#cancel());
            commit.disabled = cancel.disabled = this.#phase !== "idle";
            actions.append(commit, cancel);
            section.append(actions);
            return section;
        }
        #cancel() {
            if (this.#phase === "committing")
                return;
            const cancelledPreview = this.#phase === "previewing" || this.#preview !== undefined;
            this.#request?.abort();
            this.#request = undefined;
            this.#preview = undefined;
            this.#selected = undefined;
            this.#fileName = "";
            this.#format = "";
            this.#setPhase("idle");
            this.#notice(cancelledPreview ? "cancelled" : undefined);
            this.#render();
            this.querySelector('input[type="file"]')?.focus();
        }
        async #open(file) {
            const runtime = this.#runtime;
            if (!runtime || this.#phase !== "idle")
                return;
            const request = this.#startRequest(), signal = this.#signal(runtime, request);
            this.#preview = undefined;
            this.#selected = undefined;
            this.#fileName = file.name;
            this.#format = "";
            this.#setPhase("previewing");
            this.#notice("reading");
            this.#render();
            try {
                if (file.size > 2 * 1024 * 1024)
                    throw new ImportProblem("tooLarge");
                const source = await file.text();
                signal.throwIfAborted();
                const { document, format } = parseImportSource(source), selected = selectAdapter(this.#adapters, format);
                this.#selected = selected;
                this.#format = format;
                this.#render();
                const response = await runtime.adapters.call("preview", { contractVersion: "import-preview.v1", format, document }, { providerAddonId: selected.provider.addonId, deadlineMs: 15_000, signal });
                if (!this.#current(runtime, request))
                    return;
                this.#preview = parseImportPreview(response, format);
                this.#notice("ready");
            }
            catch (error) {
                if (this.#current(runtime, request)) {
                    this.#selected = undefined;
                    this.#notice(error instanceof ImportProblem ? error.key : "previewFailed", "alert", error instanceof ImportProblem ? error.params : {});
                }
            }
            finally {
                if (this.#current(runtime, request)) {
                    this.#setPhase("idle");
                    this.#render();
                    this.querySelector(".dm-import-preview h2")?.focus({ preventScroll: true });
                }
            }
        }
        async #commit() {
            const runtime = this.#runtime, preview = this.#preview, selected = this.#selected;
            if (!runtime || !preview || !selected || this.#phase !== "idle")
                return;
            const request = this.#startRequest(), signal = this.#signal(runtime, request);
            // A submitted token is single-use, including conflicts and lost replies.
            this.#preview = undefined;
            this.#setPhase("committing");
            this.#notice("committing");
            this.#render();
            try {
                const result = await runtime.adapters.call("commit", { contractVersion: "import-commit.v1", token: preview.token }, { providerAddonId: selected.provider.addonId, deadlineMs: 15_000, idempotencyKey: preview.token, signal });
                if (!this.#current(runtime, request))
                    return;
                if (!isRecord(result) || result["contractVersion"] !== "import-commit-result.v1" || result["committed"] !== true ||
                    !Number.isSafeInteger(result["writes"]) || Number(result["writes"]) < 0 || !Number.isSafeInteger(result["deletes"]) || Number(result["deletes"]) < 0)
                    throw new Error("Invalid commit receipt");
                this.#notice("committed", "status", { writes: Number(result["writes"]), deletes: Number(result["deletes"]) });
            }
            catch (error) {
                if (this.#current(runtime, request))
                    this.#notice(isRecord(error) && error["code"] === "CONFLICT" ? "conflict" : "uncertain", "alert");
            }
            finally {
                if (this.#current(runtime, request)) {
                    this.#setPhase("idle");
                    this.#render();
                }
            }
        }
    }
    customElements.define(tag, ImportCenterElement);
    return tag;
}
function node(document, tag = "div", className = "", text) { const element = document.createElement(tag); element.className = className; if (text !== undefined)
    element.textContent = text; return element; }
function actionButton(document, label, action, style = "") { const button = document.createElement("button"); button.type = "button"; button.textContent = label; button.className = style; button.addEventListener("click", action); return button; }
function messageBlock(document, message, role) { const block = node(document, "div", `dm-tools-message ${role}`, message); block.setAttribute("role", role); return block; }
