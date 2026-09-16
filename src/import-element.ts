import { runtimeFor, type DmToolsRuntime } from "./runtime.js";
import type { ContributionContext } from "./sdk.js";
import { dashboardLocale } from "./dashboard-model.js";
import { ImportProblem, importText, isRecord, parseAdapterDescription, parseImportPreview, parseImportSource, selectAdapter, type Adapter, type ImportPreview, type ImportMessage, type ImportParams } from "./import-model.js";

export const importElementTag = "dm-tools-import-center";
type Phase = "idle" | "discovering" | "previewing" | "committing";

export function defineImportElement(generation?: string): string {
  const tag = generation ? `${importElementTag}-${generation}` : importElementTag;
  if (customElements.get(tag)) return tag;
  class ImportCenterElement extends HTMLElement {
    #controls: ReturnType<DmToolsRuntime["ui"]["enhance"]> | undefined;
    #contribution: ContributionContext | undefined;
    #runtime: DmToolsRuntime | undefined;
    #adapters: readonly Adapter[] = [];
    #failedProviders: readonly string[] = [];
    #selected: Adapter | undefined;
    #preview: ImportPreview | undefined;
    #outcome: { token: string; adapter: Adapter } | undefined;
    #fileName = "";
    #format = "";
    #phase: Phase = "idle";
    #message: ImportMessage | undefined;
    #params: ImportParams = {};
    #messageKind: "status" | "alert" = "status";
    #request: AbortController | undefined;

    set codexContribution(value: ContributionContext) {
      const previous = this.#contribution; this.#contribution = value;
      if (!this.isConnected) return;
      if (previous?.addon.generation !== value.addon.generation) void this.#connect();
      else if (dashboardLocale(previous.host) !== dashboardLocale(value.host)) this.#render();
    }
    connectedCallback(): void { this.classList.add("dm-tools-import"); void this.#connect(); }
    disconnectedCallback(): void {
      this.#controls?.dispose(); this.#controls = undefined;
      this.#request?.abort(); this.#request = undefined; this.#runtime = undefined;
      this.#outcome = undefined; this.#preview = undefined; this.#selected = undefined; this.#contribution?.edits?.set({ dirty: false, saving: false });
    }
    #t(key: ImportMessage, params: ImportParams = {}): string { return importText(dashboardLocale(this.#contribution?.host), key, params); }
    #startRequest(): AbortController { this.#request?.abort(); const request = new AbortController(); this.#request = request; return request; }
    #signal(runtime: DmToolsRuntime, request: AbortController): AbortSignal { return AbortSignal.any([request.signal, runtime.signal, this.#contribution!.signal]); }
    #current(runtime: DmToolsRuntime, request: AbortController): boolean { return this.isConnected && this.#runtime === runtime && this.#request === request && !this.#signal(runtime, request).aborted; }
    #notice(key: ImportMessage | undefined, kind: "status" | "alert" = "status", params: ImportParams = {}): void { this.#message = key; this.#messageKind = kind; this.#params = params; }
    #setPhase(phase: Phase): void { this.#phase = phase; this.#contribution?.edits?.set({ dirty: false, saving: phase === "committing" }); }

    async #connect(): Promise<void> {
      const contribution = this.#contribution, runtime = contribution && runtimeFor(contribution.addon.generation);
      if (!runtime || runtime.signal.aborted) { this.#notice("missingGeneration", "alert"); this.#render(); return; }
      const request = this.#startRequest(), signal = this.#signal(runtime, request);
      this.#controls?.dispose(); this.#controls = runtime.ui.enhance(this);
      this.#runtime = runtime; this.#adapters = []; this.#failedProviders = []; this.#preview = undefined; this.#selected = undefined; this.#fileName = "";
      this.#setPhase("discovering"); this.#notice("discovering"); this.#render();
      // Optional providers are independent; one timeout must not serialize all discovery.
      const results = await Promise.allSettled(runtime.adapters.providers.map(async provider => ({ provider,
        description: parseAdapterDescription(await runtime.adapters.call<unknown>("describe", {}, { providerAddonId: provider.addonId, deadlineMs: 3_000, signal })),
      })));
      if (!this.#current(runtime, request)) return;
      const adapters: Adapter[] = [], failed: string[] = [];
      results.forEach((result, index) => { if (result.status === "fulfilled") adapters.push(result.value); else failed.push(runtime.adapters.providers[index]!.addonId); });
      this.#adapters = adapters; this.#failedProviders = failed;
      try {
        const saved: unknown = JSON.parse(sessionStorage.getItem("dm-tools.import-receipt") ?? "null");
        if (isRecord(saved) && typeof saved["token"] === "string" && /^[a-f0-9]{48}$/.test(saved["token"])) {
          const adapter = adapters.find(adapter => adapter.provider.addonId === saved["providerAddonId"] && adapter.description.features?.includes("receipt-status"));
          if (adapter) { this.#outcome = { token: saved["token"], adapter }; await this.#readResult(runtime, request); }
        }
      } catch { /* Receipt storage is optional; never block import discovery. */ }
      if (!this.#current(runtime, request)) return;
      if (this.#outcome && this.#message === "discovering") this.#notice("uncertain", "alert");
      this.#setPhase("idle"); if (!this.#outcome && this.#message === "discovering") this.#notice(undefined); this.#render();
    }

    #render(): void {
      this.lang = dashboardLocale(this.#contribution?.host);
      const document = this.ownerDocument, root = node(document, "section", "dm-import-shell");
      root.setAttribute("aria-busy", String(this.#phase !== "idle"));
      const heading = node(document, "header", "dm-import-heading");
      heading.append(node(document, "p", "dm-import-meta", this.#t("center.kicker")), node(document, "h1", "", this.#t("center.title")), node(document, "p", "dm-import-hint", this.#t("center.intro"))); root.append(heading);
      if (this.#message) root.append(messageBlock(document, this.#t(this.#message, this.#params), this.#messageKind));
      if (this.#outcome) {
        const retry = actionButton(document, this.#t("checkResult"), () => void this.#checkResult()); retry.disabled = this.#phase !== "idle"; root.append(retry);
      }
      if (this.#selected && this.#fileName) {
        const routing = node(document, "section", "dm-import-routing"); routing.setAttribute("aria-label", this.#t("center.routeTitle"));
        const file = node(document), owner = node(document);
        file.append(node(document, "span", "dm-import-meta", this.#t("center.document")), node(document, "strong", "", this.#fileName), node(document, "code", "dm-import-badge", this.#format));
        owner.append(node(document, "span", "dm-import-meta", this.#t("center.handledBy")), node(document, "strong", "", this.#selected.description.label));
        const arrow = node(document, "span", "", "→"); arrow.setAttribute("aria-hidden", "true");
        const another = actionButton(document, this.#t("center.chooseAnother"), () => this.#cancel()); another.disabled = this.#phase === "committing";
        routing.append(file, arrow, owner, another); root.append(routing);
      }
      const chooser = this.#chooser(document); chooser.hidden = this.#selected !== undefined; root.append(chooser);
      if (this.#phase === "previewing") root.append(actionButton(document, this.#t("cancel"), () => this.#cancel()));
      if (this.#preview && this.#selected) root.append(this.#renderPreview(document, this.#preview, this.#selected));
      this.replaceChildren(root);
    }

    #chooser(document: Document): HTMLElement {
      const chooser = node(document, "div", "dm-import-chooser"), dropzone = node(document, "section", "dm-import-dropzone");
      const icon = node(document, "div", "dm-import-drop-icon", "⌁"); icon.setAttribute("aria-hidden", "true");
      dropzone.append(icon, node(document, "h2", "", this.#t("center.chooseTitle")), node(document, "p", "dm-import-hint", this.#t("center.chooseBody")), node(document, "p", "dm-import-hint", this.#t("dropHint")));
      const input = document.createElement("input"); input.type = "file"; input.accept = "application/json,.json"; input.setAttribute("aria-label", this.#t("center.chooseFile"));
      input.disabled = this.#phase !== "idle" || !this.#adapters.length;
      input.addEventListener("change", () => { const file = input.files?.[0]; if (file) void this.#open(file); });
      const label = node(document, "label", "dm-import-file-button", this.#t("center.chooseFile")); label.append(input); dropzone.append(label);
      dropzone.addEventListener("dragover", event => { event.preventDefault(); if (!input.disabled) dropzone.classList.add("is-dragging"); });
      dropzone.addEventListener("dragleave", () => dropzone.classList.remove("is-dragging"));
      dropzone.addEventListener("drop", event => {
        event.preventDefault(); dropzone.classList.remove("is-dragging"); if (input.disabled) return;
        const files = event.dataTransfer?.files;
        if (files?.length !== 1) { this.#notice("oneFile", "alert"); this.#render(); return; }
        void this.#open(files[0]!);
      }); chooser.append(dropzone);
      const supported = node(document, "section", "dm-import-adapters"), head = node(document, "div", "dm-import-section-head");
      head.append(node(document, "h2", "", this.#t("center.supportedTitle")));
      const retry = actionButton(document, this.#t("refresh"), () => void this.#connect()); retry.disabled = this.#phase !== "idle";
      head.append(retry); supported.append(head, node(document, "p", "dm-import-hint", this.#t("center.supportedBody")));
      if (this.#failedProviders.length) supported.append(messageBlock(document, this.#t("failedProviders", { providers: this.#failedProviders.join(", ") }), "alert"));
      if (!this.#adapters.length && this.#phase === "idle") {
        const empty = node(document, "div", "dm-import-empty"); empty.append(node(document, "h3", "", this.#t("center.noneTitle")), node(document, "p", "dm-import-hint", this.#t("center.noneBody"))); supported.append(empty);
      }
      for (const adapter of [...this.#adapters].sort((a, b) => a.description.label.localeCompare(b.description.label, dashboardLocale(this.#contribution?.host)))) {
        const card = node(document, "article", "dm-import-adapter"), description = node(document), formats = node(document, "div", "dm-import-formats");
        description.append(node(document, "h3", "", adapter.description.label), node(document, "p", "dm-import-hint", adapter.description.description));
        for (const format of adapter.description.formats) formats.append(node(document, "code", "dm-import-badge", format));
        card.append(description, formats); supported.append(card);
      }
      chooser.append(supported); return chooser;
    }

    #renderPreview(document: Document, preview: ImportPreview, adapter: Adapter): HTMLElement {
      const section = node(document, "section", "dm-import-preview"), head = node(document, "header", "dm-import-section-head");
      const title = node(document, "h2", "", this.#t("previewTitle", { label: adapter.description.label })); title.tabIndex = -1;
      head.append(title, node(document, "span", "dm-import-badge", this.#t(preview.mode))); section.append(head);
      if (adapter.description.features?.includes("record-views")) section.dataset["recordViews"] = "";
      const metrics = node(document, "div", "dm-import-summary");
      for (const key of ["creates", "updates", "skips", "deletes"] as const) {
        const metric = node(document); metric.append(node(document, "strong", "", new Intl.NumberFormat(dashboardLocale(this.#contribution?.host)).format(preview.summary[key])), node(document, "span", "", this.#t(key))); metrics.append(metric);
      } section.append(metrics);
      if (preview.warnings.length) {
        const warnings = node(document, "section", "dm-import-review-section"); warnings.append(node(document, "h3", "", this.#t("warnings")));
        for (const warning of preview.warnings) warnings.append(messageBlock(document, warning, "alert")); section.append(warnings);
      }
      if (adapter.description.features?.includes("record-views")) {
        section.append(messageBlock(document, this.#t("reviewViews"), "status"));
        if (preview.expiresAt) section.append(node(document, "p", "dm-import-hint", this.#t("expires", { time: new Date(preview.expiresAt).toLocaleTimeString(this.lang) })));
      }
      if (preview.references?.length) {
        const mappings = node(document, "details", "dm-import-review-section"); mappings.append(node(document, "summary", "", this.#t("reservedIds")));
        const list = node(document, "ul");
        for (const ref of preview.references) list.append(node(document, "li", "dm-import-ref", `${ref.ref} → ${ref.collection}: ${ref.id}`));
        mappings.append(list); section.append(mappings);
      }
      const changes = node(document, "section", "dm-import-review-section"); changes.append(node(document, "h3", "", this.#t("changes")));
      const list = document.createElement("ul");
      for (const change of preview.changes) {
        const item = node(document, "li", "dm-import-change"), details = document.createElement("details"), summary = document.createElement("summary");
        const operation = { create: "creates", update: "updates", delete: "deletes" } as const;
        summary.append(node(document, "span", "dm-import-badge", this.#t(operation[change.operation])), node(document, "strong", "", change.label));
        details.append(summary, node(document, "p", "dm-import-hint", `${this.#t("collection")}: ${change.collection} · ${this.#t("record")}: ${change.id}`));
        let viewsBuilt = false;
        details.addEventListener("toggle", () => {
        if (details.open && !viewsBuilt && adapter.description.features?.includes("record-views")) {
          viewsBuilt = true;
          for (const view of ["dm", "player"] as const) {
            const reading = node(document, "section", "dm-import-record-view"); reading.append(node(document, "h4", "", this.#t(view === "dm" ? "dmView" : "playerView")));
            const value = change[view];
            if (value) {
              const fields = node(document, "dl");
              for (const [key, field] of Object.entries(value).filter(([key]) => !["id", "updatedAt", "lastChange"].includes(key))) fields.append(node(document, "dt", "", key), node(document, "dd", "", typeof field === "string" ? field : JSON.stringify(field, null, 2)));
              reading.append(fields);
            } else reading.append(node(document, "p", "dm-import-hint", this.#t(change.operation === "delete" ? "removedView" : "privateView")));
            details.append(reading);
          }
        }
        });
        item.append(details); list.append(item);
      }
      changes.append(preview.changes.length ? list : node(document, "p", "dm-import-hint", this.#t("noChanges"))); section.append(changes);
      const actions = node(document, "footer", "dm-import-actions"), destructive = preview.summary.deletes > 0;
      const commit = actionButton(document, this.#t(destructive ? "commitDelete" : "commit", { count: preview.summary.deletes }), () => void this.#commit(), destructive ? "danger" : "primary");
      const cancel = actionButton(document, this.#t("cancel"), () => this.#cancel()); commit.disabled = cancel.disabled = this.#phase !== "idle";
      actions.append(commit, cancel); section.append(actions); return section;
    }

    #cancel(): void {
      if (this.#phase === "committing") return;
      const cancelledPreview = this.#phase === "previewing" || this.#preview !== undefined;
      if (this.#preview && this.#runtime && this.#selected?.description.features?.includes("cancel")) {
        void this.#runtime.adapters.call("cancel", { contractVersion: "import-cancel.v1", token: this.#preview.token }, { providerAddonId: this.#selected.provider.addonId, deadlineMs: 3_000, signal: this.#runtime.signal }).catch(() => undefined);
      }
      this.#rememberOutcome(undefined);
      this.#request?.abort(); this.#request = undefined; this.#preview = undefined; this.#selected = undefined; this.#fileName = ""; this.#format = "";
      this.#setPhase("idle"); this.#notice(cancelledPreview ? "cancelled" : undefined); this.#render(); this.querySelector<HTMLInputElement>('input[type="file"]')?.focus();
    }
    async #open(file: File): Promise<void> {
      const runtime = this.#runtime; if (!runtime || this.#phase !== "idle") return;
      const request = this.#startRequest(), signal = this.#signal(runtime, request);
      this.#preview = undefined; this.#selected = undefined; this.#fileName = file.name; this.#format = "";
      this.#setPhase("previewing"); this.#notice("reading"); this.#render();
      try {
        if (file.size > 2 * 1024 * 1024) throw new ImportProblem("tooLarge");
        const source = await file.text(); signal.throwIfAborted();
        const { document, format } = parseImportSource(source), selected = selectAdapter(this.#adapters, format);
        this.#selected = selected; this.#format = format; this.#render();
        const response = await runtime.adapters.call<unknown>("preview", { contractVersion: "import-preview.v1", format, document }, { providerAddonId: selected.provider.addonId, deadlineMs: 15_000, signal });
        if (!this.#current(runtime, request)) return;
        this.#preview = parseImportPreview(response, format); this.#notice("ready");
      } catch (error) {
        if (this.#current(runtime, request)) { this.#selected = undefined; this.#notice(error instanceof ImportProblem ? error.key : "previewFailed", "alert", error instanceof ImportProblem ? error.params : {}); }
      } finally {
        if (this.#current(runtime, request)) { this.#setPhase("idle"); this.#render(); this.querySelector<HTMLElement>(".dm-import-preview h2")?.focus({ preventScroll: true }); }
      }
    }

    async #commit(): Promise<void> {
      const runtime = this.#runtime, preview = this.#preview, selected = this.#selected;
      if (!runtime || !preview || !selected || this.#phase !== "idle") return;
      const request = this.#startRequest(), signal = this.#signal(runtime, request);
      // A submitted token is single-use, including conflicts and lost replies.
      this.#preview = undefined; this.#setPhase("committing"); this.#notice("committing"); this.#render();
      try {
        this.#rememberOutcome(selected.description.features?.includes("receipt-status") ? { token: preview.token, adapter: selected } : undefined);
        const result = await runtime.adapters.call<unknown>("commit", { contractVersion: "import-commit.v1", token: preview.token }, { providerAddonId: selected.provider.addonId, deadlineMs: 15_000, idempotencyKey: preview.token, signal });
        if (!this.#current(runtime, request)) return;
        if (!isRecord(result) || result["contractVersion"] !== "import-commit-result.v1" || result["committed"] !== true ||
          !Number.isSafeInteger(result["writes"]) || Number(result["writes"]) < 0 || !Number.isSafeInteger(result["deletes"]) || Number(result["deletes"]) < 0) throw new Error("Invalid commit receipt");
        this.#rememberOutcome(undefined);
        this.#notice("committed", "status", { writes: Number(result["writes"]), deletes: Number(result["deletes"]) });
      } catch (error) {
        if (this.#current(runtime, request)) {
          this.#notice(isRecord(error) && error["code"] === "CONFLICT" ? "conflict" : "uncertain", "alert");
          if (this.#outcome) await this.#readResult(runtime, request);
        }
      }
      finally { if (this.#current(runtime, request)) { this.#setPhase("idle"); this.#render(); } }
    }
    #rememberOutcome(outcome: { token: string; adapter: Adapter } | undefined): void {
      this.#outcome = outcome;
      try {
        if (outcome) sessionStorage.setItem("dm-tools.import-receipt", JSON.stringify({ token: outcome.token, providerAddonId: outcome.adapter.provider.addonId }));
        else sessionStorage.removeItem("dm-tools.import-receipt");
      } catch { /* Continue using the in-memory receipt if browser storage is unavailable. */ }
    }
    async #readResult(runtime: DmToolsRuntime, request: AbortController): Promise<void> {
      const outcome = this.#outcome; if (!outcome) return;
      try {
        const status = await runtime.adapters.call<unknown>("status", { contractVersion: "import-status.v1", token: outcome.token }, { providerAddonId: outcome.adapter.provider.addonId, deadlineMs: 3_000, signal: this.#signal(runtime, request) });
        if (!this.#current(runtime, request) || !isRecord(status) || status["contractVersion"] !== "import-status.v1") return;
        const result = status["result"];
        if (status["status"] === "committed" && isRecord(result) && result["contractVersion"] === "import-commit-result.v1" && result["committed"] === true && Number.isSafeInteger(result["writes"]) && Number(result["writes"]) >= 0 && Number.isSafeInteger(result["deletes"]) && Number(result["deletes"]) >= 0) {
          this.#rememberOutcome(undefined); this.#notice("committed", "status", { writes: Number(result["writes"]), deletes: Number(result["deletes"]) });
        } else if (status["status"] === "failed") {
          this.#rememberOutcome(undefined); this.#notice("notCommitted", "alert");
        }
      } catch { /* Retain the receipt check action; never resubmit a consumed plan. */ }
    }
    async #checkResult(): Promise<void> {
      const runtime = this.#runtime; if (!runtime || !this.#outcome || this.#phase !== "idle") return;
      const request = this.#startRequest(); this.#setPhase("committing"); this.#notice("checkingResult"); this.#render();
      await this.#readResult(runtime, request);
      if (this.#current(runtime, request)) { if (this.#outcome) this.#notice("uncertain", "alert"); this.#setPhase("idle"); this.#render(); }
    }
  }
  customElements.define(tag, ImportCenterElement); return tag;
}

function node(document: Document, tag = "div", className = "", text?: string): HTMLElement { const element = document.createElement(tag); element.className = className; if (text !== undefined) element.textContent = text; return element; }
function actionButton(document: Document, label: string, action: () => void, style = ""): HTMLButtonElement { const button = document.createElement("button"); button.type = "button"; button.textContent = label; button.className = style; if (style === "primary" || style === "danger") button.dataset["uiVariant"] = style; button.addEventListener("click", action); return button; }
function messageBlock(document: Document, message: string, role: "status" | "alert"): HTMLElement { const block = node(document, "div", `dm-tools-message ${role}`, message); block.setAttribute("role", role); block.dataset["uiState"] = role === "alert" ? "error" : "info"; return block; }
