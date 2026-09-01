import { runtimeFor, type DmToolsRuntime } from "./runtime.js";
import type { ContributionContext, ServiceProvider } from "./sdk.js";

export const importElementTag = "dm-tools-import-center";
interface AdapterDescription { readonly contractVersion: "import-adapter-description.v1"; readonly id: string; readonly label: string; readonly description: string; readonly formats: readonly string[] }
interface Adapter { readonly provider: ServiceProvider; readonly description: AdapterDescription }
interface ImportPreview {
  readonly contractVersion: "import-preview-result.v1"; readonly token: string; readonly format: string; readonly mode: "merge" | "replace";
  readonly summary: { readonly creates: number; readonly updates: number; readonly skips: number; readonly deletes: number };
  readonly warnings: readonly string[]; readonly changes: readonly { readonly collection: string; readonly id: string; readonly operation: "create" | "update" | "delete"; readonly label: string }[];
}

export function defineImportElement(): void {
  if (customElements.get(importElementTag) !== undefined) return;
  class ImportCenterElement extends HTMLElement {
    #contribution: ContributionContext | undefined; #runtime: DmToolsRuntime | undefined; #adapters: readonly Adapter[] = []; #selected: Adapter | undefined; #preview: ImportPreview | undefined; #busy = false; #message = ""; #messageKind: "status" | "alert" = "status";
    set codexContribution(value: ContributionContext) { this.#contribution = value; if (this.isConnected) void this.#connect(); }
    connectedCallback(): void { this.classList.add("dm-tools-import"); void this.#connect(); }
    disconnectedCallback(): void { this.#runtime = undefined; }

    async #connect(): Promise<void> {
      const contribution = this.#contribution; if (contribution === undefined) { this.#unavailable("The host did not provide an import generation."); return; }
      const runtime = runtimeFor(contribution.addon.generation); if (runtime === undefined || runtime.signal.aborted) { this.#unavailable("This Import Center generation is no longer active."); return; }
      this.#runtime = runtime; this.#busy = true; this.#message = "Discovering import adapters…"; this.#render();
      try {
        const adapters: Adapter[] = [];
        for (const provider of runtime.adapters.providers) {
          try {
            const description = await runtime.adapters.call<AdapterDescription>("describe", {}, { providerAddonId: provider.addonId, deadlineMs: 3_000, signal: runtime.signal });
            if (description.contractVersion === "import-adapter-description.v1" && description.formats.length > 0) adapters.push({ provider, description });
          } catch { /* A broken optional adapter must not hide healthy providers. */ }
        }
        this.#adapters = adapters.sort((left, right) => left.description.label.localeCompare(right.description.label, "en")); this.#message = "";
      } catch (error) { this.#fail(error, "Could not discover import adapters."); }
      finally { this.#busy = false; this.#render(); }
    }

    #render(): void {
      const document = this.ownerDocument; const root = document.createElement("section"); root.className = "dm-import-shell";
      const title = document.createElement("h1"); title.textContent = "Import Center"; const intro = document.createElement("p"); intro.textContent = "Choose a JSON file. Its top-level format selects one owning adapter; preview is read-only until you explicitly commit it."; root.append(title, intro);
      if (this.#message !== "") root.append(messageBlock(document, this.#message, this.#messageKind));
      const adapters = document.createElement("div"); adapters.className = "dm-import-adapters"; const heading = document.createElement("h2"); heading.textContent = "Available formats"; adapters.append(heading);
      if (this.#adapters.length === 0 && !this.#busy) adapters.append(messageBlock(document, "No compatible import adapters are active.", "status"));
      for (const adapter of this.#adapters) { const card = document.createElement("article"); const name = document.createElement("h3"); name.textContent = adapter.description.label; const description = document.createElement("p"); description.textContent = adapter.description.description; const formats = document.createElement("code"); formats.textContent = adapter.description.formats.join(", "); card.append(name, description, formats); adapters.append(card); }
      root.append(adapters);
      const chooser = document.createElement("section"); chooser.className = "dm-import-chooser"; const chooserTitle = document.createElement("h2"); chooserTitle.textContent = "Preview file"; const input = document.createElement("input"); input.type = "file"; input.accept = "application/json,.json"; input.disabled = this.#busy || this.#adapters.length === 0; input.addEventListener("change", () => { const file = input.files?.[0]; if (file !== undefined) void this.#open(file); }); chooser.append(chooserTitle, input); root.append(chooser);
      if (this.#preview !== undefined && this.#selected !== undefined) root.append(this.#renderPreview(document, this.#preview, this.#selected));
      this.replaceChildren(root);
    }

    #renderPreview(document: Document, preview: ImportPreview, adapter: Adapter): HTMLElement {
      const section = document.createElement("section"); section.className = "dm-import-preview"; const title = document.createElement("h2"); title.textContent = `${adapter.description.label} preview`;
      const summary = document.createElement("p"); summary.className = "dm-import-summary"; summary.textContent = `${preview.summary.creates} create · ${preview.summary.updates} update · ${preview.summary.skips} unchanged · ${preview.summary.deletes} delete`;
      section.append(title, summary);
      for (const warning of preview.warnings) section.append(messageBlock(document, warning, "alert"));
      const list = document.createElement("ul"); for (const change of preview.changes) { const item = document.createElement("li"); item.textContent = `${change.operation}: ${change.label} (${change.collection}/${change.id})`; list.append(item); } section.append(list);
      const destructive = preview.summary.deletes > 0; const button = actionButton(document, destructive ? `Commit replacement with ${preview.summary.deletes} deletions` : "Commit reviewed import", () => void this.#commit(), destructive ? "danger" : "primary"); button.disabled = this.#busy; section.append(button); return section;
    }

    async #open(file: File): Promise<void> {
      const runtime = this.#runtime; if (runtime === undefined || this.#busy) return; this.#busy = true; this.#preview = undefined; this.#selected = undefined; this.#message = "Reading and previewing file…"; this.#messageKind = "status"; this.#render();
      try {
        if (file.size > 2 * 1024 * 1024) throw new Error("Import files are limited to 2 MiB.");
        const document = JSON.parse(await file.text()) as unknown; if (!isRecord(document) || typeof document["format"] !== "string") throw new Error("The JSON root must contain a string format field.");
        const matches = this.#adapters.filter((adapter) => adapter.description.formats.includes(document["format"] as string));
        if (matches.length === 0) throw new Error(`No adapter owns format ${document["format"]}.`); if (matches.length > 1) throw new Error(`More than one adapter claims format ${document["format"]}; resolve the installation conflict before importing.`);
        const selected = matches[0] as Adapter;
        const preview = await runtime.adapters.call<ImportPreview>("preview", { contractVersion: "import-preview.v1", format: document["format"], document }, { providerAddonId: selected.provider.addonId, deadlineMs: 15_000, signal: runtime.signal });
        this.#selected = selected; this.#preview = preview; this.#message = "Preview ready. No campaign data has changed.";
      } catch (error) { this.#fail(error, "Could not preview this import."); }
      finally { this.#busy = false; this.#render(); }
    }

    async #commit(): Promise<void> {
      const runtime = this.#runtime; const preview = this.#preview; const selected = this.#selected; if (runtime === undefined || preview === undefined || selected === undefined || this.#busy) return;
      this.#busy = true; this.#message = "Committing the exact reviewed plan…"; this.#messageKind = "status"; this.#render();
      try {
        const result = await runtime.adapters.call<{ readonly committed: true; readonly writes: number; readonly deletes: number }>("commit", { contractVersion: "import-commit.v1", token: preview.token }, { providerAddonId: selected.provider.addonId, deadlineMs: 15_000, idempotencyKey: preview.token, signal: runtime.signal });
        this.#preview = undefined; this.#selected = undefined; this.#message = `Import committed: ${result.writes} writes and ${result.deletes} deletions.`;
      } catch (error) { this.#fail(error, "The import was not committed."); }
      finally { this.#busy = false; this.#render(); }
    }

    #fail(error: unknown, fallback: string): void { this.#message = error instanceof Error && error.message !== "" ? error.message : fallback; this.#messageKind = "alert"; }
    #unavailable(message: string): void { this.replaceChildren(messageBlock(this.ownerDocument, message, "alert")); }
  }
  customElements.define(importElementTag, ImportCenterElement);
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function actionButton(document: Document, label: string, action: () => void, style?: string): HTMLButtonElement { const button = document.createElement("button"); button.type = "button"; button.textContent = label; if (style !== undefined) button.className = style; button.addEventListener("click", action); return button; }
function messageBlock(document: Document, message: string, role: "status" | "alert"): HTMLElement { const block = document.createElement("div"); block.className = `dm-tools-message ${role}`; block.setAttribute("role", role); block.textContent = message; return block; }
