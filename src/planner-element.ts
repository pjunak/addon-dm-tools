import { stepZoom, fittedZoom, canvasBounds, nativePixel, canvasLabels, type CanvasView } from "./planner-viewport.js";
import { appendTargetFields, coreReferences, targetFromForm, targetLabel, targetLink } from "./planner-targets.js";
import { appendNoteAnchors, noteAnchors } from "./planner-note-anchors.js";
import { option, textField, textArea, selectField, messageBlock } from "./planner-fields.js";
import { availableParents, directChildren, localFlows, newItem, scopeTrail, validateItemEdit, validatePlanning, type DmNote, type PlanningConsequence, type PlanningDataset, type PlanningFlow, type PlanningItem, type PlanningKind, type PlanningReference, type PlanningView } from "./planning-model.js";
import type { PlanningSnapshot } from "./planning-repository.js";
import { runtimeFor, type DmToolsRuntime } from "./runtime.js";
import type { ContributionContext, DataMutation } from "./sdk.js";
import { dashboardLocale, plannerLink, plannerSelection, plannerTarget } from "./dashboard-model.js";
import { LiveRefresh } from "./live-refresh.js";
import { PlannerDrafts } from "./planner-drafts.js";
import { mountCanvasSelection, type CanvasSelection } from "./planner-selection.js";

export const plannerElementTag = "dm-tools-planner-page";
const cardWidth = 240; const cardHeight = 132;

export function definePlannerElement(generation?: string): string {
  const tag = generation ? `${plannerElementTag}-${generation}` : plannerElementTag;
  if (customElements.get(tag) !== undefined) return tag;
  class PlannerElement extends HTMLElement {
    #contribution: ContributionContext | undefined; #runtime: DmToolsRuntime | undefined; #snapshot: PlanningSnapshot | undefined;
    #scopeId: string | null = null; #selectedId: string | undefined; #busy = false; #message = ""; #messageKind: "status" | "alert" = "status";
    #targetId: string | undefined; #targetPending = false; #readRequest: AbortController | undefined;
    #drafts = new PlannerDrafts(() => this.#syncEdits()); #committedDrafts = new Set<string>(); #needsReload = false;
    #writing = false; #invalidTarget = false;
    #canvasViews = new Map<string, CanvasView>();
    #fullscreen = false;
    #flowMarkerId = `dm-flow-arrow-${crypto.randomUUID()}`;
    #live: LiveRefresh | undefined;
    #unsubscribe: (() => void) | undefined;
    #pointers = new Set<number>();
    #selection: CanvasSelection = { items: new Set(), flows: new Set(), primary: undefined };
    #editorId: string | undefined;
    #dialogTab = "details";
    #wakeLive = (): void => { this.#live?.wake(); };
    #pointerStart = (event: PointerEvent): void => { this.#pointers.add(event.pointerId); };
    #pointerEnd = (event: PointerEvent): void => { this.#pointers.delete(event.pointerId); this.#live?.wake(); };

    #liveSafe(): boolean {
      const focused = this.ownerDocument.activeElement;
      return !this.#needsReload && !this.#pointers.size && ![...this.#drafts.entries()].some(([key]) => !this.#committedDrafts.has(key)) &&
        !(focused && this.contains(focused) && focused.matches("input,textarea,select"));
    }
    #liveNotice(): void {
      // Keep the canvas geometry fixed until an active pointer gesture finishes.
      if (this.#pointers.size) return;
      let notice = this.querySelector<HTMLElement>("[data-live-refresh]");
      if (!this.#live?.pending) { notice?.remove(); return; }
      if (!notice) {
        notice = messageBlock(this.ownerDocument, "", "status"); notice.dataset["liveRefresh"] = "";
        (this.querySelector(".dm-planner-dialog-body") ?? this.querySelector(".dm-planner-shell"))?.prepend(notice);
      }
      notice.textContent = dashboardLocale(this.#contribution?.host) === "cs"
        ? "Plánování se změnilo. Obnovte plánovač, až budete připraveni; rozepsané úpravy zůstanou zachovány."
        : "Planning data changed. Reload when ready; your unsaved edits will be retained.";
    }

    set codexContribution(value: ContributionContext) {
      const previous = this.#contribution; this.#contribution = value;
      if (!this.isConnected) return;
      if (previous?.addon.generation !== value.addon.generation || !this.#runtime) { void this.#connect(); return; }
      try {
        const target = plannerTarget(value.host);
        if (target !== this.#targetId || this.#invalidTarget) { this.#invalidTarget = false; this.#targetId = target; this.#targetPending = true; if (!this.#busy && this.#snapshot) { this.#applyTarget(); this.#render(); } }
      } catch (error) { this.#invalidLink(error); }
    }
    #fullscreenChanged = (): void => { this.#fullscreen = this.ownerDocument.fullscreenElement === this; this.#render(); this.querySelector<HTMLButtonElement>("[data-expand-planner]")?.focus(); };
    connectedCallback(): void {
      this.addEventListener("fullscreenchange", this.#fullscreenChanged); this.addEventListener("focusout", this.#wakeLive);
      this.addEventListener("pointerdown", this.#pointerStart, true);
      for (const type of ["pointerup", "pointercancel", "lostpointercapture"] as const) this.ownerDocument.addEventListener(type, this.#pointerEnd, true);
      this.classList.add("dm-tools-planner"); void this.#connect();
    }
    disconnectedCallback(): void {
      this.removeEventListener("fullscreenchange", this.#fullscreenChanged); this.removeEventListener("focusout", this.#wakeLive);
      this.removeEventListener("pointerdown", this.#pointerStart, true);
      for (const type of ["pointerup", "pointercancel", "lostpointercapture"] as const) this.ownerDocument.removeEventListener(type, this.#pointerEnd, true);
      this.#pointers.clear(); this.#unsubscribe?.(); this.#live?.dispose(); this.#readRequest?.abort(); this.#readRequest = undefined; this.#runtime = undefined; this.#contribution?.edits?.set({ dirty: false, saving: false });
    }

    async #connect(): Promise<void> {
      const contribution = this.#contribution; if (contribution === undefined) { this.#unavailable("The host did not provide a planner generation."); return; }
      if (contribution.edits === undefined) { this.#unavailable("Update the host to protect unsaved planner edits before using this package."); return; }
      const runtime = runtimeFor(contribution.addon.generation); if (runtime === undefined || runtime.signal.aborted) { this.#unavailable("This DM Tools generation is no longer active."); return; }
      try { this.#targetId = plannerTarget(contribution.host); }
      catch (error) { this.#invalidLink(error); return; }
      this.#readRequest?.abort(); this.#busy = false; this.#writing = false; this.#invalidTarget = false; this.#snapshot = undefined; this.#targetPending = true;
      this.#drafts.clearAll(); this.#committedDrafts.clear(); this.#needsReload = false; this.#editorId = undefined;
      this.#unsubscribe?.(); this.#live?.dispose(); this.#runtime = runtime;
      this.#live = new LiveRefresh(() => { this.#liveNotice(); return !this.#busy && this.#liveSafe(); }, () => void this.#reload(undefined, true), () => this.#liveNotice());
      this.#unsubscribe = runtime.repository.subscribe(() => this.#live?.invalidate(), contribution.signal);
      await this.#reload("Loading story planner…");
    }

    async #reload(loading?: string, live = false): Promise<void> {
      const runtime = this.#runtime; if (runtime === undefined || this.#busy) return;
      const request = new AbortController(); this.#readRequest?.abort(); this.#readRequest = request;
      this.#live?.consume(); let render = !live;
      this.#busy = true; if (loading !== undefined) { this.#message = loading; this.#messageKind = "status"; } if (!live) this.#render();
      try {
        const snapshot = await runtime.repository.load(request.signal);
        if (this.#runtime !== runtime || this.#readRequest !== request || request.signal.aborted || !this.isConnected) return;
        // An edit or drag can start while the automatic HTTP read is in flight.
        if (live && !this.#liveSafe()) { this.#live?.invalidate(); return; }
        render = true; this.#snapshot = snapshot;
        this.#acceptCommittedDrafts(); this.#needsReload = false;
        if (this.#scopeId !== null && !this.#snapshot.items.some((item) => item.id === this.#scopeId)) this.#scopeId = null;
        if (this.#selectedId !== undefined && !this.#snapshot.items.some((item) => item.id === this.#selectedId)) this.#selectedId = undefined;
        if (!live) this.#message = "";
        if (this.#targetPending) this.#applyTarget();
        else {
          const selected = snapshot.items.find(item => item.id === this.#selectedId);
          if (selected && selected.parentId !== this.#scopeId) this.#revealItem(selected);
          else if (this.#scopeId !== null && snapshot.items.some(item => item.id === this.#scopeId && item.kind !== "plotline" && item.kind !== "quest")) this.#applyTarget();
        }
      } catch (error) { if (!request.signal.aborted && this.#runtime === runtime) { render = true; this.#needsReload = true; this.#fail(error, "Could not load planning data."); } }
      finally { if (this.#runtime === runtime && this.#readRequest === request && !request.signal.aborted && this.isConnected) { this.#busy = false; if (render) this.#render(); this.#live?.wake(); } }
    }

    #applyTarget(): void {
      this.#targetPending = false; if (!this.#snapshot) return;
      try { const selection = plannerSelection(this.#snapshot.items, this.#targetId); this.#scopeId = selection.scopeId; this.#selectOnly(selection.selectedId); this.#editorId = selection.selectedId; this.#dialogTab = "details"; this.#message = ""; }
      catch (error) { this.#scopeId = null; this.#selectedId = undefined; this.#fail(error, "This planning item no longer exists."); }
    }
    #invalidLink(error: unknown): void {
      if (this.#snapshot && this.#runtime) {
        this.#invalidTarget = true; this.#fail(error, "Invalid planner link."); this.#render(); return;
      }
      this.#readRequest?.abort(); this.#runtime = undefined;
      this.#unavailable(error instanceof Error ? error.message : "Invalid planner link.");
    }
    #openCanvas(id?: string): void {
      const addonId = this.#contribution?.addon.id; if (!addonId) return;
      this.#editorId = undefined;
      this.ownerDocument.defaultView!.location.hash = plannerLink(addonId, id);
    }

    #selectOnly(id?: string): void { this.#selectedId = id; this.#selection = { items: new Set(id ? [id] : []), flows: new Set(), primary: id }; }
    #edit(id: string, tab = "details"): void {
      if (this.#busy) return; this.#selectOnly(id); this.#editorId = id; this.#dialogTab = tab; this.#render();
      this.querySelector<HTMLElement>(tab === "details" ? 'dialog input[name="title"]' : `dialog [data-tab="${tab}"]`)?.focus();
    }
    #closeEditor(): void {
      if (this.#busy) return; this.#editorId = undefined; this.#render();
      (this.querySelector<HTMLElement>(`[data-item-id="${CSS.escape(this.#selectedId ?? "")}"]`) ?? this.querySelector<HTMLElement>(".dm-planner-viewport"))?.focus({ preventScroll: true });
    }

    #render(captureViewport = true): void {
      if (captureViewport) this.#captureViewport();
      const oldDialog = this.querySelector<HTMLDialogElement>("dialog"), oldBody = oldDialog?.querySelector<HTMLElement>(".dm-planner-dialog-body");
      const dialogScroll = oldBody?.scrollTop ?? 0;
      const focused = this.ownerDocument.activeElement as HTMLInputElement | null;
      const focusName = oldDialog?.contains(focused) ? focused?.getAttribute("name") : undefined;
      const snapshot = this.#snapshot;
      if (snapshot === undefined) {
        this.replaceChildren(messageBlock(this.ownerDocument, this.#message, this.#messageKind));
        if (!this.#busy) this.append(actionButton(this.ownerDocument, "Reload planner", () => void this.#reload("Loading story planner…")));
        return;
      }
      const document = this.ownerDocument; const root = document.createElement("section"); root.className = `dm-planner-shell${this.#fullscreen ? " dm-planner-expanded" : ""}`;
      const visibleItems = new Set(directChildren(snapshot.items, this.#scopeId).map(item => item.id)), visibleFlows = new Set(localFlows(snapshot, this.#scopeId).map(flow => flow.id));
      this.#selection.items = new Set([...this.#selection.items].filter(id => visibleItems.has(id)));
      this.#selection.flows = new Set([...this.#selection.flows].filter(id => visibleFlows.has(id)));
      if (!this.#selection.items.has(this.#selectedId ?? "")) this.#selectedId = [...this.#selection.items][0];
      this.#selection.primary = this.#selectedId;
      if (!snapshot.items.some(item => item.id === this.#editorId)) this.#editorId = undefined;

      const header = document.createElement("header"); const heading = document.createElement("div"); const title = document.createElement("h1"); title.textContent = "Story Planner"; const subtitle = document.createElement("p"); subtitle.textContent = "An editable tree of local story-flow canvases."; heading.append(title, subtitle); header.append(heading, this.#breadcrumbs(document, snapshot)); root.append(header);
      if (this.#message !== "" && !this.#editorId) root.append(messageBlock(document, this.#message, this.#messageKind));
      const refresh = actionButton(document, "Reload planner", () => void this.#reload("Reloading planning data…")); refresh.dataset["viewAction"] = ""; refresh.className = "dm-planner-refresh"; header.append(refresh);
      if (this.#needsReload && !this.#editorId) root.append(messageBlock(document, "Reload the planner before making another change. Your edits are retained; review the saved data before retrying.", "alert"));
      if (!this.#editorId) this.#removedDrafts(document, root, snapshot);
      const workspace = document.createElement("div"); workspace.className = "dm-planner-workspace";
      workspace.append(this.#atlas(document), this.#canvas(document, snapshot)); root.append(workspace);
      const dialog = this.#editorId ? this.#editor(document, snapshot) : undefined; if (dialog) root.append(dialog);
      if (dialog) for (const child of root.children) if (child !== dialog) { child.setAttribute("inert", ""); child.setAttribute("aria-hidden", "true"); }
      oldDialog?.close(); this.replaceChildren(root);
      this.#liveNotice();
      const viewport = root.querySelector<HTMLElement>(".dm-planner-viewport")!; const view = this.#canvasView(); viewport.scrollLeft = view.x; viewport.scrollTop = view.y;
      root.setAttribute("aria-busy", String(this.#busy));
      for (const control of root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("input,textarea,select")) {
        control.disabled = this.#busy || (this.#needsReload && control.tagName === "SELECT");
        if (control.tagName !== "SELECT") (control as HTMLInputElement | HTMLTextAreaElement).readOnly = this.#needsReload;
      }
      for (const button of root.querySelectorAll("button")) button.disabled = this.#busy || (this.#needsReload && !button.hasAttribute("data-view-action"));
      if (dialog) {
        dialog.showModal(); const body = dialog.querySelector<HTMLElement>(".dm-planner-dialog-body")!; body.scrollTop = dialogScroll;
        const control = focusName ? dialog.querySelector<HTMLElement>(`[name="${CSS.escape(focusName)}"]`) : undefined;
        control?.focus({ preventScroll: true });
      }
    }

    #breadcrumbs(document: Document, snapshot: PlanningSnapshot): HTMLElement {
      const nav = document.createElement("nav"); nav.className = "dm-planner-breadcrumbs"; nav.setAttribute("aria-label", "Planner scope");
      nav.append(actionButton(document, "Campaign", () => this.#openCanvas(), this.#scopeId === null ? "active" : undefined));
      for (const item of scopeTrail(snapshot.items, this.#scopeId)) nav.append(actionButton(document, item.title, () => this.#openCanvas(item.id), item.id === this.#scopeId ? "active" : undefined));
      for (const button of nav.querySelectorAll("button")) button.dataset["viewAction"] = "";
      return nav;
    }

    #atlas(document: Document): HTMLElement {
      const aside = document.createElement("aside"); aside.className = "dm-planner-atlas"; const title = document.createElement("h2"); title.textContent = "Atlas"; aside.append(title);
      for (const [kind, label] of [["plotline", "Plotline"], ["quest", "Quest"], ["event", "Event"], ["branch", "Branch"]] as const) aside.append(actionButton(document, `+ ${label}`, () => void this.#create(kind), kind));
      const help = document.createElement("p"); help.textContent = "Click to select; Shift-click adds to the selection. Drag empty canvas to select a group. Double-click to edit. Enter opens a plotline or quest. Middle-drag or Alt-drag pans."; aside.append(help); return aside;
    }

    #canvas(document: Document, snapshot: PlanningSnapshot): HTMLElement {
      const labels = canvasLabels(this.#contribution?.host);
      const region = document.createElement("div"); region.className = "dm-planner-canvas-region";
      const viewport = document.createElement("div"); viewport.className = "dm-planner-viewport"; viewport.tabIndex = 0; viewport.setAttribute("aria-label", labels.canvas); viewport.dataset["scope"] = this.#scopeId ?? ""; const stage = document.createElement("div"); stage.className = "dm-planner-stage";
      const children = directChildren(snapshot.items, this.#scopeId); const positions = positionsFor(snapshot.views, this.#scopeId, children);
      const view = this.#canvasView(); const zoom = view.zoom; const bounds = canvasBounds(positions.values());
      const plotted = new Map([...positions].map(([id, point]) => [id, { x: point.x - bounds.left, y: point.y - bounds.top }]));
      const width = Math.max(1100, bounds.width + 72), height = Math.max(780, bounds.height + 72);
      stage.style.width = `${nativePixel(width * zoom)}px`; stage.style.height = `${nativePixel(height * zoom)}px`; stage.dataset["zoom"] = String(zoom);
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg"); svg.classList.add("dm-planner-flows"); svg.setAttribute("aria-label", "Story flow"); svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
      const defs = document.createElementNS(svg.namespaceURI, "defs"); const marker = document.createElementNS(svg.namespaceURI, "marker");
      marker.id = this.#flowMarkerId; marker.setAttribute("viewBox", "0 0 10 8"); marker.setAttribute("refX", "10"); marker.setAttribute("refY", "4"); marker.setAttribute("markerWidth", "8"); marker.setAttribute("markerHeight", "8"); marker.setAttribute("orient", "auto");
      const arrow = document.createElementNS(svg.namespaceURI, "polygon"); arrow.setAttribute("points", "0,0 10,4 0,8"); arrow.setAttribute("fill", "context-stroke"); marker.append(arrow); defs.append(marker); svg.append(defs);
      for (const flow of localFlows(snapshot, this.#scopeId)) {
        const source = plotted.get(flow.sourceId); const target = plotted.get(flow.targetId); if (source === undefined || target === undefined) continue;
        const path = document.createElementNS(svg.namespaceURI, "path"); path.setAttribute("d", orthogonalPath(source.x + cardWidth, source.y + cardHeight / 2, target.x, target.y + cardHeight / 2)); path.classList.add(flow.kind); path.setAttribute("aria-label", flow.label || `${flow.sourceId} to ${flow.targetId}`); path.setAttribute("marker-end", `url(#${this.#flowMarkerId})`); path.setAttribute("data-flow-id", flow.id); svg.append(path);
        const hit = document.createElementNS(svg.namespaceURI, "path"); hit.setAttribute("d", path.getAttribute("d")!); hit.classList.add("dm-flow-hit"); hit.setAttribute("data-select-flow", flow.id); hit.setAttribute("role", "button"); hit.setAttribute("tabindex", "0"); hit.setAttribute("aria-label", flowDescription(snapshot, flow)); svg.append(hit);
        if (flow.label !== "") {
          const label = document.createElementNS(svg.namespaceURI, "text"); label.classList.add("dm-planner-flow-label"); label.setAttribute("x", String(Math.round((source.x + cardWidth + target.x) / 2))); label.setAttribute("y", String(Math.round((source.y + target.y + cardHeight) / 2) - 8)); label.setAttribute("text-anchor", "middle"); label.textContent = flow.label; svg.append(label);
        }
      }
      stage.append(svg);
      for (const item of children) {
        const point = plotted.get(item.id)!; const card = document.createElement("article"); card.className = `dm-plan-card ${item.kind}`; card.setAttribute("role", "button"); card.setAttribute("aria-label", item.title); card.dataset["itemId"] = item.id; card.style.left = `${nativePixel(point.x * zoom)}px`; card.style.top = `${nativePixel(point.y * zoom)}px`;
        card.style.width = `${nativePixel(cardWidth * zoom)}px`; card.style.minHeight = `${nativePixel(cardHeight * zoom)}px`; card.style.padding = `${nativePixel(12.8 * zoom)}px`; card.style.gap = `${nativePixel(7.2 * zoom)}px`; card.tabIndex = 0;
        const kind = document.createElement("span"); kind.className = "kind"; kind.textContent = subtype(item); const title = document.createElement("h3"); title.textContent = item.title; const summary = document.createElement("p"); summary.textContent = item.summary || "Needs details";
        title.style.fontSize = `${nativePixel(Math.max(9, 16 * zoom))}px`; summary.style.fontSize = `${nativePixel(Math.max(8, 13.6 * zoom))}px`; kind.style.fontSize = `${nativePixel(Math.max(8, 12 * zoom))}px`; kind.hidden = zoom < .6; summary.hidden = zoom < .8;
        card.append(kind, title, summary); stage.append(card);
      }
      if (children.length === 0) { const empty = messageBlock(document, "This canvas is empty. Add a planning item from the Atlas.", "status"); empty.classList.add("empty"); stage.append(empty); }
      const toolbar = document.createElement("div"); toolbar.className = "dm-planner-canvas-toolbar"; toolbar.setAttribute("role", "group"); toolbar.setAttribute("aria-label", labels.controls); toolbar.title = labels.help;
      const zoomTo = (next: number, x = viewport.clientWidth / 2, y = viewport.clientHeight / 2): void => {
        if (this.#busy || next === view.zoom) return; this.#captureViewport();
        view.x = (view.x + x) / view.zoom * next - x; view.y = (view.y + y) / view.zoom * next - y; view.zoom = next; this.#render(false);
      };
      const fit = (): void => {
        if (this.#busy) return; const next = fittedZoom(bounds.width, bounds.height, viewport.clientWidth, viewport.clientHeight);
        view.zoom = next; view.x = Math.max(0, (bounds.width * next - viewport.clientWidth) / 2); view.y = Math.max(0, (bounds.height * next - viewport.clientHeight) / 2); this.#render(false);
      };
      const focus = (): void => {
        const point = this.#selectedId ? plotted.get(this.#selectedId) : undefined; if (!point || this.#busy) return;
        view.x = Math.max(0, (point.x + cardWidth / 2) * zoom - viewport.clientWidth / 2); view.y = Math.max(0, (point.y + cardHeight / 2) * zoom - viewport.clientHeight / 2); this.#render(false);
      };
      toolbar.append(actionButton(document, "−", () => zoomTo(stepZoom(zoom, -1))), actionButton(document, `${Math.round(zoom * 100)}%`, () => zoomTo(1)), actionButton(document, "+", () => zoomTo(stepZoom(zoom, 1))), actionButton(document, labels.fit, fit), actionButton(document, labels.focus, focus));
      const buttons = toolbar.querySelectorAll("button"); buttons[0]!.setAttribute("aria-label", labels.out); buttons[1]!.setAttribute("aria-label", labels.reset); buttons[2]!.setAttribute("aria-label", labels.in);
      const expand = actionButton(document, this.#fullscreen ? labels.exit : labels.fullscreen, () => { if (!this.#busy) void (this.#fullscreen ? document.exitFullscreen() : this.requestFullscreen()).catch(error => this.#invalid(error instanceof Error ? error.message : "Fullscreen is unavailable.")); }); expand.dataset["expandPlanner"] = ""; expand.setAttribute("aria-pressed", String(this.#fullscreen)); toolbar.append(expand);
      for (const button of toolbar.querySelectorAll("button")) button.dataset["viewAction"] = "";
      mountCanvasSelection({ viewport, stage, positions, zoom, selection: this.#selection, available: () => !this.#busy && !this.#needsReload,
        change: selection => { this.#selection = selection; this.#selectedId = selection.primary; this.querySelector(".dm-planner-selection")?.replaceWith(this.#selectionToolbar(document, snapshot)); },
        move: values => void this.#savePositions(values), edit: id => this.#edit(id), remove: () => void this.#deleteSelection(),
        open: id => { const item = snapshot.items.find(value => value.id === id); if (item?.kind === "plotline" || item?.kind === "quest") this.#openCanvas(id); else this.#edit(id); },
      });
      viewport.addEventListener("wheel", event => { if (!event.ctrlKey && !event.metaKey) return; event.preventDefault(); const rect = viewport.getBoundingClientRect(); zoomTo(stepZoom(view.zoom, -Math.sign(event.deltaY)), event.clientX - rect.left, event.clientY - rect.top); }, { passive: false });
      viewport.addEventListener("keydown", event => {
        if (event.defaultPrevented || event.target !== viewport || this.#busy) return;
        if (["+", "=", "-", "0", "f"].includes(event.key)) { event.preventDefault(); if (event.key === "f") fit(); else zoomTo(event.key === "0" ? 1 : stepZoom(view.zoom, event.key === "-" ? -1 : 1)); this.querySelector<HTMLElement>(".dm-planner-viewport")?.focus({ preventScroll: true }); }
        else if (event.key.startsWith("Arrow")) { event.preventDefault(); const distance = event.shiftKey ? 160 : 48; viewport.scrollLeft += event.key === "ArrowRight" ? distance : event.key === "ArrowLeft" ? -distance : 0; viewport.scrollTop += event.key === "ArrowDown" ? distance : event.key === "ArrowUp" ? -distance : 0; }
      });
      viewport.append(stage); region.append(this.#selectionToolbar(document, snapshot), toolbar, viewport); return region;
    }

    #canvasView(): CanvasView {
      const key = this.#scopeId ?? ""; let view = this.#canvasViews.get(key); if (!view) { view = { zoom: 1, x: 0, y: 0 }; this.#canvasViews.set(key, view); } return view;
    }
    #captureViewport(): void {
      const viewport = this.querySelector<HTMLElement>(".dm-planner-viewport"); if (!viewport) return;
      const view = this.#canvasViews.get(viewport.dataset["scope"]!); if (view) { view.x = viewport.scrollLeft; view.y = viewport.scrollTop; }
    }

    #selectionToolbar(document: Document, snapshot: PlanningSnapshot): HTMLElement {
      const toolbar = document.createElement("div"); toolbar.className = "dm-planner-selection dm-planner-canvas-toolbar"; toolbar.setAttribute("role", "group"); toolbar.setAttribute("aria-label", "Selection actions");
      const count = this.#selection.items.size + this.#selection.flows.size, label = document.createElement("span"); label.textContent = count ? `${count} selected` : "Select a card or flow"; toolbar.append(label);
      const item = this.#selection.items.size === 1 && !this.#selection.flows.size ? snapshot.items.find(value => value.id === this.#selectedId) : undefined;
      if (item) { toolbar.append(actionButton(document, "Edit selected", () => this.#edit(item.id))); if (item.kind === "plotline" || item.kind === "quest") toolbar.append(actionButton(document, "Enter this canvas", () => this.#openCanvas(item.id))); }
      if (!this.#selection.items.size && this.#selection.flows.size === 1) {
        const flow = snapshot.flows.find(value => this.#selection.flows.has(value.id));
        if (flow) toolbar.append(actionButton(document, "Edit selected flow", () => {
          this.#edit(flow.sourceId, "links");
          const entry = this.querySelector<HTMLElement>(`.dm-planner-flow-entry[data-flow-id="${CSS.escape(flow.id)}"]`); const details = entry?.querySelector("details"); if (details) details.open = true;
          entry?.querySelector<HTMLInputElement>('input[name="label"]')?.focus();
        }));
      }
      if (this.#selection.items.size === 2 && !this.#selection.flows.size) toolbar.append(actionButton(document, "Connect selected", () => {
        const [source, target] = [...this.#selection.items]; if (!source || !target) return; this.#edit(source, "links");
        const select = this.querySelector<HTMLSelectElement>('form[aria-label="Create story flow"] select[name="targetId"]');
        if (select) { select.value = target; select.dispatchEvent(new Event("change", { bubbles: true })); select.focus(); }
      }));
      if (count) toolbar.append(actionButton(document, "Delete selection", () => void this.#deleteSelection(), "danger"));
      return toolbar;
    }

    #editor(document: Document, snapshot: PlanningSnapshot): HTMLDialogElement {
      const dialog = document.createElement("dialog"); dialog.className = "dm-planner-dialog dm-planner-inspector"; dialog.setAttribute("aria-label", "Edit planning item");
      const selected = snapshot.items.find((item) => item.id === this.#editorId)!;
      const header = document.createElement("header"), title = document.createElement("h2"); title.textContent = selected.title;
      const close = actionButton(document, "Close editor", () => this.#closeEditor()); close.dataset["viewAction"] = "";
      const reload = actionButton(document, "Reload planner", () => void this.#reload()); reload.dataset["viewAction"] = "";
      const saveItem = actionButton(document, "Save item", () => undefined, "primary"); saveItem.type = "submit"; saveItem.setAttribute("form", `${this.#flowMarkerId}-details`);
      header.append(title, saveItem, close); dialog.append(header);
      dialog.addEventListener("cancel", event => { event.preventDefault(); this.#closeEditor(); });
      dialog.addEventListener("keydown", event => {
        if (event.key !== "Tab") return;
        const controls = [...dialog.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),a[href],summary,[tabindex="0"]')].filter(control => control.tabIndex >= 0 && control.getClientRects().length > 0);
        const index = controls.indexOf(document.activeElement as HTMLElement);
        if (!controls.length) { event.preventDefault(); dialog.focus(); }
        else if (event.shiftKey && index <= 0) { event.preventDefault(); controls.at(-1)!.focus(); }
        else if (!event.shiftKey && (index === -1 || index === controls.length - 1)) { event.preventDefault(); controls[0]!.focus(); }
      });
      dialog.addEventListener("click", event => {
        if (event.target !== dialog) return; const rect = dialog.getBoundingClientRect();
        if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) this.#closeEditor();
      });
      const tabs = document.createElement("div"); tabs.className = "dm-dialog-tabs"; tabs.setAttribute("role", "tablist"); tabs.setAttribute("aria-label", "Item sections"); dialog.append(tabs);
      const body = document.createElement("div"); body.className = "dm-planner-dialog-body"; dialog.append(body); body.append(reload);
      if (this.#message) body.append(messageBlock(document, this.#message, this.#messageKind));
      if (this.#needsReload) body.append(messageBlock(document, "Reload the planner before making another change. Your edits are retained; review the saved data before retrying.", "alert"));
      this.#removedDrafts(document, body, snapshot);
      const panels = new Map<string, HTMLElement>();
      const activate = (id: string): void => {
        if (this.#dialogTab !== id) body.scrollTop = 0;
        this.#dialogTab = id;
        for (const button of tabs.querySelectorAll<HTMLButtonElement>("button")) { const active = button.dataset["tab"] === id; button.setAttribute("aria-selected", String(active)); button.tabIndex = active ? 0 : -1; }
        for (const [key, panel] of panels) panel.hidden = key !== id;
      };
      for (const [id, label] of [["details", "Details"], ["links", "Links"], ["notes", "Notes"]] as const) {
        const panel = document.createElement("section"); panel.setAttribute("role", "tabpanel"); panel.id = `${this.#flowMarkerId}-${id}-panel`; panels.set(id, panel); body.append(panel);
        const button = actionButton(document, label, () => activate(id)); button.setAttribute("role", "tab"); button.dataset["tab"] = id; button.id = `${this.#flowMarkerId}-${id}-tab`; button.setAttribute("aria-controls", panel.id); panel.setAttribute("aria-labelledby", button.id); tabs.append(button);
      }
      tabs.addEventListener("keydown", event => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault(); const buttons = [...tabs.querySelectorAll("button")], index = buttons.indexOf(event.target as HTMLButtonElement);
        const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length;
        buttons[next]!.click(); buttons[next]!.focus();
      });
      const aside = panels.get("details")!;
      const form = document.createElement("form"); form.addEventListener("submit", (event) => { event.preventDefault(); void this.#saveItem(selected, form); });
      form.id = `${this.#flowMarkerId}-details`;
      form.setAttribute("aria-label", "Planning item details");
      const refreshStructure = appendItemStructure(document, form, selected, snapshot.items);
      form.append(textField(document, "Title", "title", selected.title), textArea(document, "Summary", "summary", selected.summary, 3), textArea(document, "Objective", "objective", selected.objective, 3), textArea(document, "Body", "body", selected.body, 7), textArea(document, "Setup", "setup", selected.setup, 5), textArea(document, "Resolution", "resolution", selected.resolution, 5), textField(document, "Tags", "tags", selected.tags.join(", ")));
      for (const [name, limit] of Object.entries({ title: 160, summary: 2000, objective: 10000, body: 80000, setup: 30000, resolution: 30000, tags: 2440 })) form.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[name="${name}"]`)!.maxLength = limit;
      this.#bindDraft(form, `planning_items:${selected.id}`, snapshot.revisions.get(`planning_items:${selected.id}`));
      refreshStructure();
      const save = actionButton(document, "Save details", () => undefined, "primary"); save.type = "submit"; form.append(save); aside.append(form);
      if (selected.kind === "plotline" || selected.kind === "quest") aside.append(actionButton(document, "Enter this canvas", () => this.#openCanvas(selected.id)));
      panels.get("links")!.append(this.#flowEditor(document, snapshot, selected), this.#annotations(document, snapshot, selected));
      panels.get("notes")!.append(this.#notes(document, snapshot, selected));
      aside.append(actionButton(document, "Delete item and subtree", () => void this.#delete(selected), "danger")); activate(this.#dialogTab); return dialog;
    }

    #flowEditor(document: Document, snapshot: PlanningSnapshot, selected: PlanningItem): HTMLElement {
      const section = document.createElement("section"); const title = document.createElement("h3"); title.textContent = "Story flow"; const select = document.createElement("select"); select.append(option(document, "", "Connect to sibling…"));
      for (const sibling of directChildren(snapshot.items, this.#scopeId).filter((item) => item.id !== selected.id)) select.append(option(document, sibling.id, sibling.title));
      const form = document.createElement("form"); form.setAttribute("aria-label", "Create story flow"); select.name = "targetId"; select.setAttribute("aria-label", "Flow target");
      form.append(select, selectField(document, "Flow type", "kind", selected.kind === "branch" ? "option" : "continues", flowKindOptions(selected)), textField(document, "Flow label", "label", "")); form.querySelector<HTMLInputElement>("input")!.maxLength = 200;
      const create = actionButton(document, "Create flow", () => undefined, "primary"); create.type = "submit"; form.append(create);
      this.#bindDraft(form, `new-flow:${selected.id}`, 0);
      form.addEventListener("submit", event => { event.preventDefault(); void this.#createFlow(selected, form); }); section.append(title, form);
      const attached = localFlows(snapshot, this.#scopeId).filter((flow) => flow.sourceId === selected.id || flow.targetId === selected.id);
      for (const flow of attached) {
        const peerId = flow.sourceId === selected.id ? flow.targetId : flow.sourceId; const peer = snapshot.items.find((item) => item.id === peerId);
        const row = document.createElement("div"); row.className = "dm-planner-record-row"; const description = document.createElement("span"); description.textContent = `${flow.sourceId === selected.id ? "To" : "From"} ${peer?.title ?? peerId}${flow.label === "" ? "" : `: ${flow.label}`}`;
        const entry = document.createElement("article"); entry.className = "dm-planner-flow-entry"; entry.dataset["flowId"] = flow.id;
        row.append(description, actionButton(document, "Remove flow", () => void this.#deleteFlow(flow, selected.id), "danger")); entry.append(row);
        const editor = document.createElement("details"); const editLabel = document.createElement("summary"); editLabel.textContent = "Edit flow"; editor.append(editLabel); editor.open = this.#drafts.has(`planning_flow_links:${flow.id}`);
        const editForm = document.createElement("form"); editForm.setAttribute("aria-label", "Edit story flow");
        const source = snapshot.items.find(item => item.id === flow.sourceId)!;
        editForm.append(selectField(document, "Flow type", "kind", flow.kind, flowKindOptions(source)), textField(document, "Flow label", "label", flow.label)); editForm.querySelector<HTMLInputElement>("input")!.maxLength = 200;
        const save = actionButton(document, "Save flow", () => undefined, "primary"); save.type = "submit"; editForm.append(save);
        this.#bindDraft(editForm, `planning_flow_links:${flow.id}`, snapshot.revisions.get(`planning_flow_links:${flow.id}`));
        editForm.addEventListener("submit", event => { event.preventDefault(); void this.#saveFlow(flow, editForm, selected.id); }); editor.append(editForm); entry.append(editor); section.append(entry);
      }
      return section;
    }

    #annotations(document: Document, snapshot: PlanningSnapshot, selected: PlanningItem): HTMLElement {
      const section = document.createElement("section"); const title = document.createElement("h3"); title.textContent = "Planning annotations"; section.append(title);
      const core = coreReferences(this.#contribution?.host);
      const create = document.createElement("details"); const createLabel = document.createElement("summary"); createLabel.textContent = "Add reference"; create.append(createLabel); create.open = this.#drafts.has(`new-reference:${selected.id}`);
      const createForm = document.createElement("form"); createForm.setAttribute("aria-label", "Create reference");
      const refreshNewTarget = appendTargetFields(document, createForm, undefined, snapshot.items, core);
      createForm.append(textField(document, "Reference name (optional)", "name", "")); createForm.querySelector<HTMLInputElement>('[name="name"]')!.maxLength = 200;
      const add = actionButton(document, "Add reference", () => undefined, "primary"); add.type = "submit"; createForm.append(add);
      this.#bindDraft(createForm, `new-reference:${selected.id}`, 0); refreshNewTarget();
      createForm.addEventListener("submit", event => { event.preventDefault(); void this.#addReference(selected, createForm); }); create.append(createForm); section.append(create);
      for (const reference of snapshot.references.filter((entry) => entry.itemId === selected.id)) {
        const form = document.createElement("form"); form.className = "dm-planner-annotation"; form.dataset["referenceId"] = reference.id;
        form.addEventListener("submit", (event) => { event.preventDefault(); void this.#saveReference(reference, form, selected.id); });
        form.append(targetLink(document, reference.target, snapshot.items, core, this.#contribution!.addon.id));
        const refreshTarget = appendTargetFields(document, form, reference.target, snapshot.items, core);
        const relation = selectField(document, "Relation", "relation", reference.relation, [["related", "Related"], ["involves", "Involves"], ["features", "Features"], ["located-at", "Located at"], ["opposes", "Opposes"], ["supports", "Supports"], ["reveals", "Reveals"], ["requires", "Requires"], ["rewards", "Rewards"]]);
        const quantity = textField(document, "Quantity", "quantity", String(reference.quantity)); const input = quantity.querySelector("input")!; input.type = "number"; input.min = "1"; input.max = "1000"; input.step = "1"; input.required = true;
        form.append(textField(document, "Reference", "name", reference.name), relation, quantity, textArea(document, "Notes", "notes", reference.notes, 2));
        form.querySelector<HTMLInputElement>('[name="name"]')!.maxLength = 200; form.querySelector<HTMLTextAreaElement>('[name="notes"]')!.maxLength = 2000;
        const save = actionButton(document, "Save reference", () => undefined, "primary"); save.type = "submit"; form.append(save, actionButton(document, "Delete reference", () => void this.#deleteRecord("planning_references", reference.id, "Reference deleted.", selected.id), "danger")); section.append(form);
        this.#bindDraft(form, `planning_references:${reference.id}`, snapshot.revisions.get(`planning_references:${reference.id}`)); refreshTarget();
      }
      section.append(actionButton(document, "Add consequence", () => void this.#addConsequence(selected)));
      const attachedFlows = snapshot.flows.filter(flow => flow.sourceId === selected.id || flow.targetId === selected.id);
      const anchorOptions: [string, string][] = [[`item:${selected.id}`, "Whole item"], ...attachedFlows.map(flow => [`flow:${flow.id}`, flowDescription(snapshot, flow)] as [string, string])];
      for (const consequence of snapshot.consequences.filter(entry => entry.anchor["scope"] === "item" ? entry.anchor["itemId"] === selected.id : attachedFlows.some(flow => flow.id === entry.anchor["flowId"]))) {
        const form = document.createElement("form"); form.className = "dm-planner-annotation"; form.addEventListener("submit", (event) => { event.preventDefault(); void this.#saveConsequence(consequence, form, selected.id); });
        form.dataset["consequenceId"] = consequence.id;
        const anchorKey = consequence.anchor["scope"] === "item" ? `item:${consequence.anchor["itemId"]}` : `flow:${consequence.anchor["flowId"]}`;
        form.append(selectField(document, "Consequence applies to", "anchor", anchorKey, anchorOptions));
        form.append(textField(document, "Consequence", "title", consequence.title), selectField(document, "Kind", "kind", consequence.kind, [["world", "World"], ["reward", "Reward"], ["information", "Information"], ["complication", "Complication"]]), textArea(document, "Details", "body", consequence.body, 3)); const save = actionButton(document, "Save consequence", () => undefined, "primary"); save.type = "submit"; form.append(save, actionButton(document, "Delete consequence", () => void this.#deleteRecord("planning_consequences", consequence.id, "Consequence deleted.", selected.id), "danger")); section.append(form);
        const refreshTarget = appendTargetFields(document, form, consequence.target, snapshot.items, core, true);
        form.append(...form.querySelectorAll("button"));
        this.#bindDraft(form, `planning_consequences:${consequence.id}`, snapshot.revisions.get(`planning_consequences:${consequence.id}`)); refreshTarget();
      }
      return section;
    }
    #notes(document: Document, snapshot: PlanningSnapshot, selected: PlanningItem): HTMLElement {
      const section = document.createElement("section");
      section.append(actionButton(document, "Add DM note", () => void this.#addNote(selected)));
      for (const note of snapshot.notes.filter((entry) => entry.anchorIds.length === 0 || entry.anchorIds.includes(selected.id))) {
        const form = document.createElement("form"); form.className = "dm-planner-annotation"; form.addEventListener("submit", (event) => { event.preventDefault(); void this.#saveNote(note, form, selected.id); });
        form.append(textField(document, "DM note", "title", note.title), textArea(document, "Private details", "body", note.body, 4)); const save = actionButton(document, "Save note", () => undefined, "primary"); save.type = "submit"; form.append(save, actionButton(document, "Delete note", () => void this.#deleteRecord("dm_notes", note.id, "DM note deleted.", selected.id), "danger")); section.append(form);
        form.dataset["noteId"] = note.id;
        if (note.anchorIds.length === 0) form.prepend(messageBlock(document, "Unanchored note — link it to a planning item below.", "status"));
        const refreshAnchors = appendNoteAnchors(document, form, note.anchorIds, snapshot.items);
        form.append(...form.querySelectorAll("button"));
        this.#bindDraft(form, `dm_notes:${note.id}`, snapshot.revisions.get(`dm_notes:${note.id}`)); refreshAnchors();
      }
      return section;
    }

    async #create(kind: PlanningKind): Promise<void> { const item = newItem(kind, this.#scopeId); if (await this.#mutate(async (runtime, snapshot) => runtime.repository.put(snapshot, "planning_items", item, 0), `Created ${item.title}.`, item.id)) this.#edit(item.id); }
    async #saveItem(item: PlanningItem, form: HTMLFormElement): Promise<void> {
      const snapshot = this.#snapshot; if (!snapshot) return;
      const data = new FormData(form); const text = (name: string): string => String(data.get(name) ?? "").trim();
      const tags = [...new Set(text("tags").split(",").map(tag => tag.trim()).filter(Boolean))];
      if (tags.length > 40 || tags.some(tag => tag.length > 60)) { this.#invalid("Use up to 40 tags, with at most 60 characters each."); return; }
      const { eventType, branchType, ...common } = item;
      const kind = text("kind") as PlanningKind;
      const next: PlanningItem = { ...common, kind, parentId: text("parentId") || null, title: text("title"), summary: text("summary"), objective: text("objective"), body: text("body"), setup: text("setup"), resolution: text("resolution"), tags, updatedAt: Date.now(),
        ...(kind === "event" ? { eventType: (text("eventType") || eventType || "story") as NonNullable<PlanningItem["eventType"]> } : {}),
        ...(kind === "branch" ? { branchType: (text("branchType") || branchType || "decision") as NonNullable<PlanningItem["branchType"]> } : {}) };
      if (next.title === "") { this.#message = "A title is required."; this.#messageKind = "alert"; this.#render(); return; }
      const issues = validateItemEdit(snapshot, next); if (issues.length) { this.#invalid(issues[0]!); return; }
      const revision = this.#drafts.revision(form); if (revision === undefined) return;
      const saved = await this.#mutate(async (runtime, snapshot) => runtime.repository.saveItem(snapshot, next, revision), "Details saved.", item.id, `planning_items:${item.id}`);
      const current = saved ? this.#snapshot?.items.find(value => value.id === item.id) : undefined;
      if (current && (item.parentId !== current.parentId || item.kind !== current.kind)) this.#revealItem(current);
    }

    #revealItem(item: PlanningItem): void {
      const editor = this.#editorId; this.#scopeId = item.parentId; this.#selectOnly(item.id);
      this.#targetId = item.kind === "event" || item.kind === "branch" ? item.id : item.parentId ?? undefined;
      this.#targetPending = false; this.#invalidTarget = false;
      this.#openCanvas(this.#targetId); this.#editorId = editor; this.#render();
    }
    async #createFlow(source: PlanningItem, form: HTMLFormElement): Promise<void> {
      const snapshot = this.#snapshot; if (snapshot === undefined) return;
      const data = new FormData(form); const targetId = String(data.get("targetId") ?? "");
      if (!targetId) { this.#invalid("Choose a sibling to connect."); return; }
      const flow: PlanningFlow = { id: `flow-${crypto.randomUUID()}`, schemaVersion: 3, sourceId: source.id, targetId, kind: String(data.get("kind")) as PlanningFlow["kind"], label: String(data.get("label") ?? "").trim(), updatedAt: Date.now() };
      const candidate: PlanningDataset = { ...snapshot, flows: [...snapshot.flows, flow] }; const issues = validatePlanning(candidate); if (issues.length > 0) { this.#message = issues[0] as string; this.#messageKind = "alert"; this.#render(); return; }
      await this.#mutate(async (runtime, snapshot) => runtime.repository.put(snapshot, "planning_flow_links", flow, 0), "Flow created.", source.id, `new-flow:${source.id}`);
    }
    async #saveFlow(flow: PlanningFlow, form: HTMLFormElement, selectedId: string): Promise<void> {
      const snapshot = this.#snapshot; const revision = this.#drafts.revision(form); if (!snapshot || revision === undefined) return;
      const data = new FormData(form); const next: PlanningFlow = { ...flow, kind: String(data.get("kind")) as PlanningFlow["kind"], label: String(data.get("label") ?? "").trim(), updatedAt: Date.now() };
      const issues = validatePlanning({ ...snapshot, flows: snapshot.flows.map(value => value.id === flow.id ? next : value) });
      if (issues.length) { this.#invalid(issues[0]!); return; }
      await this.#mutate((runtime, snapshot) => runtime.repository.put(snapshot, "planning_flow_links", next, revision), "Flow saved.", selectedId, `planning_flow_links:${flow.id}`);
    }
    async #deleteFlow(flow: PlanningFlow, selectedId: string): Promise<void> {
      const snapshot = this.#snapshot; if (!snapshot) return;
      const consequences = snapshot.consequences.filter(entry => entry.anchor["scope"] === "flow" && entry.anchor["flowId"] === flow.id);
      if (consequences.length && !confirm(`Remove this flow and its ${consequences.length} attached consequences?`)) return;
      await this.#mutate(runtime => runtime.repository.deleteFlow(snapshot, flow.id), "Flow removed.", selectedId, `planning_flow_links:${flow.id}`);
    }
    async #savePositions(positions: Record<string, { x: number; y: number }>): Promise<void> { const snapshot = this.#snapshot; if (snapshot === undefined) return; await this.#mutate(runtime => runtime.repository.savePositions(snapshot, this.#scopeId, positions), "Position saved.", this.#selectedId); this.querySelector<HTMLElement>(".dm-planner-viewport")?.focus({ preventScroll: true }); }
    async #deleteSelection(): Promise<void> {
      const snapshot = this.#snapshot, items = [...this.#selection.items], flows = [...this.#selection.flows];
      if (!snapshot || this.#busy || this.#needsReload || (!items.length && !flows.length)) return;
      if (!confirm(`Delete ${items.length} selected items and ${flows.length} selected flows, including subtrees and attached annotations? Shared notes keep their other links.`)) return;
      await this.#mutate(runtime => runtime.repository.deleteSelection(snapshot, items, flows), "Selection deleted.");
    }
    async #delete(item: PlanningItem): Promise<void> { const snapshot = this.#snapshot; if (snapshot === undefined || !confirm(`Delete ${item.title} and its subtree, attached flows and consequences, and incoming planning references? Shared notes will keep their other links.`)) return; await this.#mutate(async (runtime) => runtime.repository.deleteSubtree(snapshot, item.id), "Planning subtree deleted."); }
    async #addReference(item: PlanningItem, form: HTMLFormElement): Promise<void> {
      const snapshot = this.#snapshot; if (!snapshot) return;
      const data = new FormData(form); const core = coreReferences(this.#contribution?.host);
      let target: PlanningReference["target"];
      try { target = targetFromForm(data, snapshot.items, core)!; } catch (error) { this.#invalid((error as Error).message); return; }
      const reference: PlanningReference = { id: `reference-${crypto.randomUUID()}`, schemaVersion: 3, itemId: item.id, name: String(data.get("name") ?? "").trim() || targetLabel(target, snapshot.items, core), relation: "related", target, quantity: 1, notes: "", updatedAt: Date.now() };
      await this.#mutate(async (runtime, snapshot) => runtime.repository.put(snapshot, "planning_references", reference, 0), "Reference added.", item.id, `new-reference:${item.id}`);
    }
    async #addConsequence(item: PlanningItem): Promise<void> { const consequence: PlanningConsequence = { id: `consequence-${crypto.randomUUID()}`, schemaVersion: 3, anchor: { scope: "item", itemId: item.id }, kind: "world", title: "Planned consequence", body: "", updatedAt: Date.now() }; await this.#mutate(async (runtime, snapshot) => runtime.repository.put(snapshot, "planning_consequences", consequence, 0), "Consequence added.", item.id); }
    async #addNote(item: PlanningItem): Promise<void> { const note: DmNote = { id: `note-${crypto.randomUUID()}`, schemaVersion: 3, title: "DM note", body: "", anchorIds: [item.id], updatedAt: Date.now() }; await this.#mutate(async (runtime, snapshot) => runtime.repository.put(snapshot, "dm_notes", note, 0), "DM note added.", item.id); }
    async #saveReference(reference: PlanningReference, form: HTMLFormElement, selectedId: string): Promise<void> {
      const snapshot = this.#snapshot; if (!snapshot) return;
      const data = new FormData(form); const quantity = Number(data.get("quantity"));
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > 1000) { this.#invalid("Quantity must be a whole number from 1 to 1000."); return; }
      let target: PlanningReference["target"];
      try { target = targetFromForm(data, snapshot.items, coreReferences(this.#contribution?.host), reference.target)!; } catch (error) { this.#invalid((error as Error).message); return; }
      const next: PlanningReference = { ...reference, target, quantity, name: String(data.get("name") ?? "").trim(), relation: String(data.get("relation") ?? "related"), notes: String(data.get("notes") ?? "").trim(), updatedAt: Date.now() };
      if (next.name === "") { this.#invalid("A reference name is required."); return; } await this.#putExisting("planning_references", next, form, selectedId, "Reference saved.");
    }
    async #saveConsequence(consequence: PlanningConsequence, form: HTMLFormElement, selectedId: string): Promise<void> {
      const snapshot = this.#snapshot; if (!snapshot) return;
      const data = new FormData(form); const anchorKey = String(data.get("anchor") ?? "");
      const flow = snapshot.flows.find(entry => `flow:${entry.id}` === anchorKey && (entry.sourceId === selectedId || entry.targetId === selectedId));
      if (anchorKey !== `item:${selectedId}` && !flow) { this.#invalid("Choose this item or one of its existing flows for the consequence."); return; }
      const anchor = flow ? { scope: "flow", flowId: flow.id } : { scope: "item", itemId: selectedId };
      let target: PlanningConsequence["target"];
      try { target = targetFromForm(data, snapshot.items, coreReferences(this.#contribution?.host), consequence.target, true); } catch (error) { this.#invalid((error as Error).message); return; }
      const { target: previousTarget, ...base } = consequence;
      const next: PlanningConsequence = { ...base, ...(target ? { target } : {}), anchor, title: String(data.get("title") ?? "").trim(), kind: String(data.get("kind") ?? "world") as PlanningConsequence["kind"], body: String(data.get("body") ?? "").trim(), updatedAt: Date.now() };
      if (next.title === "") { this.#invalid("A consequence title is required."); return; }
      await this.#putExisting("planning_consequences", next, form, selectedId, "Consequence saved.");
    }
    async #saveNote(note: DmNote, form: HTMLFormElement, selectedId: string): Promise<void> {
      const snapshot = this.#snapshot; if (!snapshot) return;
      const data = new FormData(form); let anchorIds: readonly string[];
      try { anchorIds = noteAnchors(String(data.get("anchorIds")), snapshot.items); } catch (error) { this.#invalid((error as Error).message); return; }
      const next: DmNote = { ...note, anchorIds, title: String(data.get("title") ?? "").trim(), body: String(data.get("body") ?? "").trim(), updatedAt: Date.now() };
      if (next.title === "") { this.#invalid("A DM note title is required."); return; } await this.#putExisting("dm_notes", next, form, selectedId, "DM note saved.");
    }
    async #putExisting(collection: "planning_references" | "planning_consequences" | "dm_notes", value: PlanningReference | PlanningConsequence | DmNote, form: HTMLFormElement, selectedId: string, success: string): Promise<void> {
      const revision = this.#drafts.revision(form); if (revision === undefined) { this.#invalid("This record changed or no longer exists. Reload the planner."); return; }
      await this.#mutate(async (runtime, snapshot) => runtime.repository.put(snapshot, collection, value, revision), success, selectedId, `${collection}:${value.id}`);
    }
    async #deleteRecord(collection: string, id: string, success: string, selectedId: string): Promise<void> { const revision = this.#snapshot?.revisions.get(`${collection}:${id}`); if (revision === undefined) { this.#invalid("This record changed or no longer exists. Reload the planner."); return; } const mutation: DataMutation = { operation: "delete", kind: "collection", dataId: collection, key: id, expectedRevision: revision }; await this.#mutate(async (runtime, snapshot) => runtime.repository.transact(snapshot, [mutation]), success, selectedId, `${collection}:${id}`); }
    #invalid(message: string): void { this.#message = message; this.#messageKind = "alert"; this.#render(); }

    #bindDraft(form: HTMLFormElement, key: string, revision: number | undefined): void {
      this.#drafts.bind(form, key, revision);
      const discard = actionButton(this.ownerDocument, "Discard edits", () => { this.#drafts.clear(key); this.#render(); });
      discard.dataset["viewAction"] = ""; discard.hidden = !this.#drafts.has(key); form.append(discard);
      const update = (): void => { discard.hidden = !this.#drafts.has(key); };
      form.addEventListener("input", update); form.addEventListener("change", update);
      const opening = this.#drafts.revision(form);
      if (opening !== revision) form.prepend(messageBlock(this.ownerDocument, "This record changed since editing began. Copy your edits, then discard them to load the saved version.", "alert"));
    }

    #removedDrafts(document: Document, root: HTMLElement, snapshot: PlanningSnapshot): void {
      for (const [key, draft] of this.#drafts.entries()) {
        if (key.startsWith("new-flow:") || key.startsWith("new-reference:") || snapshot.revisions.has(key)) continue;
        const details = document.createElement("details"); const title = document.createElement("summary");
        title.textContent = `Unsaved edits to a removed record: ${draft.values["title"] || draft.values["name"] || "Planning record"}`;
        const content = document.createElement("pre"); content.textContent = Object.entries(draft.values).map(([field, value]) => `${field}: ${value}`).join("\n\n");
        const discard = actionButton(document, "Discard removed record edits", () => { this.#drafts.clear(key); this.#render(); }); discard.dataset["viewAction"] = "";
        details.className = "dm-planner-removed-draft"; details.append(title, content, discard); root.append(details);
      }
    }

    #acceptCommittedDrafts(): void { for (const key of this.#committedDrafts) this.#drafts.clear(key); this.#committedDrafts.clear(); }

    #syncEdits(): void {
      const dirty = [...this.#drafts.entries()].some(([key]) => !this.#committedDrafts.has(key));
      this.#contribution?.edits?.set({ dirty, saving: this.#writing, retainOnQueryChange: true });
      this.#live?.wake();
    }

    async #mutate(operation: (runtime: DmToolsRuntime, snapshot: PlanningSnapshot) => Promise<unknown>, success: string, selected?: string, draftKey?: string): Promise<boolean> {
      const runtime = this.#runtime; const original = this.#snapshot; if (runtime === undefined || original === undefined || this.#busy || this.#needsReload) return false; this.#busy = true; this.#message = "Saving…"; this.#messageKind = "status"; this.#render();
      this.#writing = true; this.#syncEdits();
      try {
        await operation(runtime, original); if (this.#runtime !== runtime || !this.isConnected) return false;
        // A confirmed write must not be offered again if the following read fails.
        if (draftKey) this.#committedDrafts.add(draftKey);
        const request = new AbortController(); this.#readRequest?.abort(); this.#readRequest = request;
        this.#live?.consume();
        const snapshot = await runtime.repository.load(request.signal); if (this.#runtime !== runtime || request.signal.aborted || !this.isConnected) return false;
        this.#acceptCommittedDrafts();
        if (!selected || !this.#selection.items.has(selected)) this.#selectOnly(selected);
        this.#selectedId = selected; this.#snapshot = snapshot; this.#message = success; if (this.#targetPending) this.#applyTarget();
        return true;
      } catch (error) { if (this.#runtime === runtime && this.isConnected) { this.#needsReload = true; this.#fail(error, "Planning change failed."); } return false; }
      finally { if (this.#runtime === runtime && this.isConnected) { this.#busy = false; this.#writing = false; this.#syncEdits(); this.#render(); } }
    }
    #fail(error: unknown, fallback: string): void { this.#message = error instanceof Error && error.message !== "" ? error.message : fallback; this.#messageKind = "alert"; }
    #unavailable(message: string): void { this.replaceChildren(messageBlock(this.ownerDocument, message, "alert")); const link = this.ownerDocument.createElement("a"); link.textContent = "Open campaign canvas"; link.href = plannerLink(this.#contribution?.addon.id ?? "dm-tools"); this.append(link); }
  }
  customElements.define(tag, PlannerElement); return tag;
}

function appendItemStructure(document: Document, form: HTMLFormElement, item: PlanningItem, items: readonly PlanningItem[]): () => void {
  const row = document.createElement("div"); row.className = "dm-planner-form-row";
  const kind = selectField(document, "Kind", "kind", item.kind, [["plotline", "Plotline"], ["quest", "Quest"], ["event", "Event"], ["branch", "Branch"]]);
  const parents = availableParents(items, item.id).map(parent => [parent.id, scopeTrail(items, parent.id).map(entry => entry.title).join(" / ")] as const);
  row.append(kind, selectField(document, "Parent", "parentId", item.parentId ?? "", [["", "Campaign"], ...parents]));
  const event = document.createElement("div"), branch = document.createElement("div");
  event.append(selectField(document, "Event type", "eventType", item.eventType ?? "story", [["story", "Story"], ["encounter", "Encounter"], ["puzzle", "Puzzle"]]));
  branch.append(selectField(document, "Branch type", "branchType", item.branchType ?? "decision", [["decision", "Decision"], ["condition", "Condition"], ["random", "Random"]]));
  const help = document.createElement("small"); help.textContent = "Moving an item keeps its children and annotations. Connected story flows must stay on the same canvas.";
  form.append(row, event, branch, help);
  const refresh = (): void => { const value = kind.querySelector("select")!.value; event.hidden = value !== "event"; branch.hidden = value !== "branch"; };
  kind.addEventListener("change", refresh);
  return refresh;
}

function positionsFor(views: readonly PlanningView[], scopeId: string | null, items: readonly PlanningItem[]): Map<string, { x: number; y: number }> { const view = views.find((candidate) => candidate.scopeId === scopeId); return new Map(items.map((item, index) => [item.id, view?.positions[item.id] ?? { x: 72 + (index % 3) * 300, y: 72 + Math.floor(index / 3) * 190 }])); }
function orthogonalPath(sourceX: number, sourceY: number, targetX: number, targetY: number): string { const middle = sourceX + (targetX - sourceX) / 2; return `M ${sourceX} ${sourceY} H ${middle} V ${targetY} H ${targetX}`; }
function subtype(item: PlanningItem): string { return item.kind === "event" ? item.eventType ?? "event" : item.kind === "branch" ? item.branchType ?? "branch" : item.kind; }
function flowKindOptions(source: PlanningItem): readonly (readonly [string, string])[] { return source.kind === "branch" ? [["continues", "Continues"], ["option", "Option"]] : [["continues", "Continues"]]; }
function flowDescription(snapshot: PlanningSnapshot, flow: PlanningFlow): string { const source = snapshot.items.find(item => item.id === flow.sourceId); const target = snapshot.items.find(item => item.id === flow.targetId); return `${source?.title ?? flow.sourceId} → ${target?.title ?? flow.targetId}${flow.label ? `: ${flow.label}` : ""}`; }
function actionButton(document: Document, label: string, action: () => void, style?: string): HTMLButtonElement { const button = document.createElement("button"); button.type = "button"; button.textContent = label; if (style !== undefined) button.className = style; button.addEventListener("click", action); return button; }
