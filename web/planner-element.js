import { stepZoom, fittedZoom, canvasBounds, nativePixel, canvasLabels, positionsFor } from "./planner-viewport.js";
import { appendTargetFields, coreReferences, targetFromForm, targetLabel, targetLink } from "./planner-targets.js";
import { appendNoteAnchors, noteAnchors } from "./planner-note-anchors.js";
import { option, textField, textArea, selectField, messageBlock } from "./planner-fields.js";
import { availableParents, directChildren, localFlows, newItem, scopeTrail, validateItemEdit, validatePlanning } from "./planning-model.js";
import { runtimeFor } from "./runtime.js";
import { dashboardLocale, plannerLink, plannerSelection, plannerTarget } from "./dashboard-model.js";
import { LiveRefresh } from "./live-refresh.js";
import { PlannerDrafts } from "./planner-drafts.js";
import { mountCanvasSelection } from "./planner-selection.js";
import { mountCanvasConnections } from "./planner-connections.js";
import { configurePlannerDialog, plannerShortcuts } from "./planner-dialog.js";
export const plannerElementTag = "dm-tools-planner-page";
const cardWidth = 240;
const cardHeight = 132;
export function definePlannerElement(generation) {
    const tag = generation ? `${plannerElementTag}-${generation}` : plannerElementTag;
    if (customElements.get(tag) !== undefined)
        return tag;
    class PlannerElement extends HTMLElement {
        #contribution;
        #runtime;
        #snapshot;
        #scopeId = null;
        #selectedId;
        #busy = false;
        #message = "";
        #messageKind = "status";
        #targetId;
        #targetPending = false;
        #readRequest;
        #drafts = new PlannerDrafts(() => this.#syncEdits());
        #committedDrafts = new Set();
        #needsReload = false;
        #writing = false;
        #invalidTarget = false;
        #canvasViews = new Map();
        #fullscreen = false;
        #flowMarkerId = `dm-flow-arrow-${crypto.randomUUID()}`;
        #live;
        #unsubscribe;
        #pointers = new Set();
        #selection = { items: new Set(), flows: new Set(), primary: undefined };
        #editorId;
        #dialogTab = "details";
        #newItem;
        #undoDelete;
        #helpOpen = false;
        #connecting = false;
        #disposeConnection;
        #wakeLive = () => { this.#live?.wake(); };
        #pointerStart = (event) => { this.#pointers.add(event.pointerId); };
        #pointerEnd = (event) => { this.#pointers.delete(event.pointerId); this.#live?.wake(); };
        #liveSafe() {
            const focused = this.ownerDocument.activeElement;
            return !this.#needsReload && !this.#newItem && !this.#helpOpen && !this.#connecting && !this.#pointers.size && ![...this.#drafts.entries()].some(([key]) => !this.#committedDrafts.has(key)) &&
                !(focused && this.contains(focused) && focused.matches("input,textarea,select"));
        }
        #liveNotice() {
            // Keep the canvas geometry fixed until an active pointer gesture finishes.
            if (this.#pointers.size || this.#connecting)
                return;
            let notice = this.querySelector("[data-live-refresh]");
            if (!this.#live?.pending) {
                notice?.remove();
                return;
            }
            if (!notice) {
                notice = messageBlock(this.ownerDocument, "", "status");
                notice.dataset["liveRefresh"] = "";
                (this.querySelector(".dm-planner-dialog-body") ?? this.querySelector(".dm-planner-shell"))?.prepend(notice);
            }
            notice.textContent = dashboardLocale(this.#contribution?.host) === "cs"
                ? "Plánování se změnilo. Obnovte plánovač, až budete připraveni; rozepsané úpravy zůstanou zachovány."
                : "Planning data changed. Reload when ready; your unsaved edits will be retained.";
        }
        set codexContribution(value) {
            const previous = this.#contribution;
            this.#contribution = value;
            if (!this.isConnected)
                return;
            if (previous?.addon.generation !== value.addon.generation || !this.#runtime) {
                void this.#connect();
                return;
            }
            try {
                const target = plannerTarget(value.host);
                if (target !== this.#targetId || this.#invalidTarget) {
                    this.#invalidTarget = false;
                    this.#targetId = target;
                    this.#targetPending = true;
                    if (!this.#busy && this.#snapshot) {
                        this.#applyTarget();
                        this.#render();
                    }
                }
            }
            catch (error) {
                this.#invalidLink(error);
            }
        }
        #fullscreenChanged = () => { this.#fullscreen = this.ownerDocument.fullscreenElement === this; this.#render(); this.querySelector("[data-expand-planner]")?.focus(); };
        connectedCallback() {
            this.addEventListener("fullscreenchange", this.#fullscreenChanged);
            this.addEventListener("focusout", this.#wakeLive);
            this.addEventListener("pointerdown", this.#pointerStart, true);
            for (const type of ["pointerup", "pointercancel", "lostpointercapture"])
                this.ownerDocument.addEventListener(type, this.#pointerEnd, true);
            this.classList.add("dm-tools-planner");
            void this.#connect();
        }
        disconnectedCallback() {
            this.#disposeConnection?.();
            this.#disposeConnection = undefined;
            this.removeEventListener("fullscreenchange", this.#fullscreenChanged);
            this.removeEventListener("focusout", this.#wakeLive);
            this.removeEventListener("pointerdown", this.#pointerStart, true);
            for (const type of ["pointerup", "pointercancel", "lostpointercapture"])
                this.ownerDocument.removeEventListener(type, this.#pointerEnd, true);
            this.#pointers.clear();
            this.#unsubscribe?.();
            this.#live?.dispose();
            this.#readRequest?.abort();
            this.#readRequest = undefined;
            this.#runtime = undefined;
            this.#contribution?.edits?.set({ dirty: false, saving: false });
        }
        async #connect() {
            const contribution = this.#contribution;
            if (contribution === undefined) {
                this.#unavailable("The host did not provide a planner generation.");
                return;
            }
            if (contribution.edits === undefined) {
                this.#unavailable("Update the host to protect unsaved planner edits before using this package.");
                return;
            }
            const runtime = runtimeFor(contribution.addon.generation);
            if (runtime === undefined || runtime.signal.aborted) {
                this.#unavailable("This DM Tools generation is no longer active.");
                return;
            }
            try {
                this.#targetId = plannerTarget(contribution.host);
            }
            catch (error) {
                this.#invalidLink(error);
                return;
            }
            this.#readRequest?.abort();
            this.#busy = false;
            this.#writing = false;
            this.#invalidTarget = false;
            this.#snapshot = undefined;
            this.#targetPending = true;
            this.#newItem = undefined;
            this.#undoDelete = undefined;
            this.#helpOpen = false;
            this.#drafts.clearAll();
            this.#committedDrafts.clear();
            this.#needsReload = false;
            this.#editorId = undefined;
            this.#unsubscribe?.();
            this.#live?.dispose();
            this.#runtime = runtime;
            this.#live = new LiveRefresh(() => { this.#liveNotice(); return !this.#busy && this.#liveSafe(); }, () => void this.#reload(undefined, true), () => this.#liveNotice());
            this.#unsubscribe = runtime.repository.subscribe(() => this.#live?.invalidate(), contribution.signal);
            await this.#reload("Loading story planner…");
        }
        async #reload(loading, live = false) {
            const runtime = this.#runtime;
            if (runtime === undefined || this.#busy)
                return;
            const request = new AbortController();
            this.#readRequest?.abort();
            this.#readRequest = request;
            this.#live?.consume();
            let render = !live;
            this.#busy = true;
            if (loading !== undefined) {
                this.#message = loading;
                this.#messageKind = "status";
            }
            if (!live)
                this.#render();
            try {
                const snapshot = await runtime.repository.load(request.signal);
                if (this.#runtime !== runtime || this.#readRequest !== request || request.signal.aborted || !this.isConnected)
                    return;
                // An edit or drag can start while the automatic HTTP read is in flight.
                if (live && !this.#liveSafe()) {
                    this.#live?.invalidate();
                    return;
                }
                render = true;
                this.#snapshot = snapshot;
                if (this.#newItem && snapshot.items.some(item => item.id === this.#newItem.id) && !this.#committedDrafts.has(`new-item:${this.#newItem.id}`)) {
                    // A lost creation response is reconciled as a stale edit of the saved
                    // record, never retried as another new item or rebased silently.
                    this.#drafts.rekey(`new-item:${this.#newItem.id}`, `planning_items:${this.#newItem.id}`);
                    this.#newItem = undefined;
                }
                this.#acceptCommittedDrafts();
                this.#needsReload = false;
                if (this.#scopeId !== null && !this.#snapshot.items.some((item) => item.id === this.#scopeId))
                    this.#scopeId = null;
                if (this.#selectedId !== undefined && !this.#snapshot.items.some((item) => item.id === this.#selectedId))
                    this.#selectedId = undefined;
                if (!live)
                    this.#message = "";
                if (this.#targetPending)
                    this.#applyTarget();
                else {
                    const selected = snapshot.items.find(item => item.id === this.#selectedId);
                    if (selected && selected.parentId !== this.#scopeId)
                        this.#revealItem(selected);
                    else if (this.#scopeId !== null && snapshot.items.some(item => item.id === this.#scopeId && item.kind !== "plotline" && item.kind !== "quest"))
                        this.#applyTarget();
                }
            }
            catch (error) {
                if (!request.signal.aborted && this.#runtime === runtime) {
                    render = true;
                    this.#needsReload = true;
                    this.#fail(error, "Could not load planning data.");
                }
            }
            finally {
                if (this.#runtime === runtime && this.#readRequest === request && !request.signal.aborted && this.isConnected) {
                    this.#busy = false;
                    if (render)
                        this.#render();
                    this.#live?.wake();
                }
            }
        }
        #applyTarget() {
            this.#targetPending = false;
            if (!this.#snapshot)
                return;
            try {
                const selection = plannerSelection(this.#snapshot.items, this.#targetId);
                this.#scopeId = selection.scopeId;
                this.#selectOnly(selection.selectedId);
                this.#editorId = selection.selectedId;
                this.#dialogTab = "details";
                this.#message = "";
            }
            catch (error) {
                this.#scopeId = null;
                this.#selectedId = undefined;
                this.#fail(error, "This planning item no longer exists.");
            }
        }
        #invalidLink(error) {
            if (this.#snapshot && this.#runtime) {
                this.#invalidTarget = true;
                this.#fail(error, "Invalid planner link.");
                this.#render();
                return;
            }
            this.#readRequest?.abort();
            this.#runtime = undefined;
            this.#unavailable(error instanceof Error ? error.message : "Invalid planner link.");
        }
        #openCanvas(id) {
            const addonId = this.#contribution?.addon.id;
            if (!addonId)
                return;
            this.#editorId = undefined;
            this.ownerDocument.defaultView.location.hash = plannerLink(addonId, id);
        }
        #selectOnly(id) { this.#selectedId = id; this.#selection = { items: new Set(id ? [id] : []), flows: new Set(), primary: id }; }
        #edit(id, tab = "details") {
            if (this.#busy)
                return;
            this.#selectOnly(id);
            this.#editorId = id;
            this.#dialogTab = tab;
            this.#render();
            this.querySelector(tab === "details" ? 'dialog input[name="title"]' : `dialog [data-tab="${tab}"]`)?.focus();
        }
        #closeEditor() {
            if (this.#busy)
                return;
            this.#editorId = undefined;
            this.#render();
            (this.querySelector(`[data-item-id="${CSS.escape(this.#selectedId ?? "")}"]`) ?? this.querySelector(".dm-planner-viewport"))?.focus({ preventScroll: true });
        }
        #cancelCreation() {
            if (this.#busy || !this.#newItem)
                return;
            const key = `new-item:${this.#newItem.id}`;
            this.#newItem = undefined;
            this.#drafts.clear(key);
            this.#syncEdits();
            this.#closeEditor();
        }
        #showHelp() { if (this.#busy)
            return; this.#helpOpen = true; this.#render(); }
        #closeHelp() { this.#helpOpen = false; this.#render(); this.querySelector("[data-planner-shortcuts]")?.focus(); this.#live?.wake(); }
        #render(captureViewport = true) {
            if (captureViewport)
                this.#captureViewport();
            this.#disposeConnection?.();
            this.#disposeConnection = undefined;
            const oldDialog = this.querySelector("dialog"), oldBody = oldDialog?.querySelector(".dm-planner-dialog-body");
            const dialogScroll = oldBody?.scrollTop ?? 0;
            const focused = this.ownerDocument.activeElement;
            const focusName = oldDialog?.contains(focused) ? focused?.getAttribute("name") : undefined;
            const snapshot = this.#snapshot;
            if (snapshot === undefined) {
                this.replaceChildren(messageBlock(this.ownerDocument, this.#message, this.#messageKind));
                if (!this.#busy)
                    this.append(actionButton(this.ownerDocument, "Reload planner", () => void this.#reload("Loading story planner…")));
                return;
            }
            const document = this.ownerDocument;
            const root = document.createElement("section");
            root.className = `dm-planner-shell${this.#fullscreen ? " dm-planner-expanded" : ""}`;
            const visibleItems = new Set(directChildren(snapshot.items, this.#scopeId).map(item => item.id)), visibleFlows = new Set(localFlows(snapshot, this.#scopeId).map(flow => flow.id));
            this.#selection.items = new Set([...this.#selection.items].filter(id => visibleItems.has(id)));
            this.#selection.flows = new Set([...this.#selection.flows].filter(id => visibleFlows.has(id)));
            if (!this.#selection.items.has(this.#selectedId ?? ""))
                this.#selectedId = [...this.#selection.items][0];
            this.#selection.primary = this.#selectedId;
            if (!snapshot.items.some(item => item.id === this.#editorId) && this.#newItem?.id !== this.#editorId)
                this.#editorId = undefined;
            const header = document.createElement("header");
            const heading = document.createElement("div");
            const title = document.createElement("h1");
            title.textContent = "Story Planner";
            const subtitle = document.createElement("p");
            subtitle.textContent = "An editable tree of local story-flow canvases.";
            heading.append(title, subtitle);
            header.append(heading, this.#breadcrumbs(document, snapshot));
            root.append(header);
            if (this.#message !== "" && !this.#editorId)
                root.append(messageBlock(document, this.#message, this.#messageKind));
            const refresh = actionButton(document, "Reload planner", () => void this.#reload("Reloading planning data…"));
            refresh.dataset["viewAction"] = "";
            refresh.className = "dm-planner-refresh";
            header.append(refresh);
            if (this.#needsReload && !this.#editorId)
                root.append(messageBlock(document, "Reload the planner before making another change. Your edits are retained; review the saved data before retrying.", "alert"));
            if (!this.#editorId)
                this.#removedDrafts(document, root, snapshot);
            const workspace = document.createElement("div");
            workspace.className = "dm-planner-workspace";
            workspace.append(this.#atlas(document), this.#canvas(document, snapshot));
            root.append(workspace);
            const dialog = this.#helpOpen ? plannerShortcuts(document, () => this.#closeHelp()) : this.#editorId ? this.#editor(document, snapshot) : undefined;
            if (dialog)
                root.append(dialog);
            if (dialog)
                for (const child of root.children)
                    if (child !== dialog) {
                        child.setAttribute("inert", "");
                        child.setAttribute("aria-hidden", "true");
                    }
            oldDialog?.close();
            this.replaceChildren(root);
            this.#liveNotice();
            const viewport = root.querySelector(".dm-planner-viewport");
            const view = this.#canvasView();
            viewport.scrollLeft = view.x;
            viewport.scrollTop = view.y;
            root.setAttribute("aria-busy", String(this.#busy));
            for (const control of root.querySelectorAll("input,textarea,select")) {
                control.disabled = this.#busy || (this.#needsReload && control.tagName === "SELECT");
                if (control.tagName !== "SELECT")
                    control.readOnly = this.#needsReload;
            }
            for (const button of root.querySelectorAll("button"))
                button.disabled = this.#busy || button.hasAttribute("data-unavailable") || (this.#needsReload && !button.hasAttribute("data-view-action"));
            if (dialog) {
                dialog.showModal();
                const body = dialog.querySelector(".dm-planner-dialog-body");
                body.scrollTop = dialogScroll;
                const control = focusName ? dialog.querySelector(`[name="${CSS.escape(focusName)}"]`) : undefined;
                control?.focus({ preventScroll: true });
            }
        }
        #breadcrumbs(document, snapshot) {
            const nav = document.createElement("nav");
            nav.className = "dm-planner-breadcrumbs";
            nav.setAttribute("aria-label", "Planner scope");
            nav.append(actionButton(document, "Campaign", () => this.#openCanvas(), this.#scopeId === null ? "active" : undefined));
            for (const item of scopeTrail(snapshot.items, this.#scopeId))
                nav.append(actionButton(document, item.title, () => this.#openCanvas(item.id), item.id === this.#scopeId ? "active" : undefined));
            for (const button of nav.querySelectorAll("button"))
                button.dataset["viewAction"] = "";
            return nav;
        }
        #atlas(document) {
            const aside = document.createElement("aside");
            aside.className = "dm-planner-atlas";
            const title = document.createElement("h2");
            title.textContent = "Atlas";
            aside.append(title);
            for (const [kind, label] of [["plotline", "Plotline"], ["quest", "Quest"], ["event", "Event"], ["branch", "Branch"]])
                aside.append(actionButton(document, `+ ${label}`, () => void this.#create(kind), kind));
            if (this.#newItem)
                aside.append(actionButton(document, "Resume new item", () => this.#create(this.#newItem.kind)));
            const help = document.createElement("p");
            help.textContent = "Click to select; Shift-click adds to the selection. Drag empty canvas to select a group. Double-click or Enter to edit. Shift+Enter opens a plotline or quest. Middle-drag or Alt-drag pans.";
            aside.append(help);
            return aside;
        }
        #canvas(document, snapshot) {
            const labels = canvasLabels(this.#contribution?.host);
            const region = document.createElement("div");
            region.className = "dm-planner-canvas-region";
            const viewport = document.createElement("div");
            viewport.className = "dm-planner-viewport";
            viewport.tabIndex = 0;
            viewport.setAttribute("aria-label", labels.canvas);
            viewport.dataset["scope"] = this.#scopeId ?? "";
            const stage = document.createElement("div");
            stage.className = "dm-planner-stage";
            const children = directChildren(snapshot.items, this.#scopeId);
            const positions = positionsFor(snapshot.views, this.#scopeId, children);
            const view = this.#canvasView();
            const zoom = view.zoom;
            const bounds = canvasBounds(positions.values());
            const plotted = new Map([...positions].map(([id, point]) => [id, { x: point.x - bounds.left, y: point.y - bounds.top }]));
            const width = Math.max(1100, bounds.width + 72), height = Math.max(780, bounds.height + 72);
            stage.style.width = `${nativePixel(width * zoom)}px`;
            stage.style.height = `${nativePixel(height * zoom)}px`;
            stage.dataset["zoom"] = String(zoom);
            const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
            svg.classList.add("dm-planner-flows");
            svg.setAttribute("aria-label", "Story flow");
            svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
            const defs = document.createElementNS(svg.namespaceURI, "defs");
            const marker = document.createElementNS(svg.namespaceURI, "marker");
            marker.id = this.#flowMarkerId;
            marker.setAttribute("viewBox", "0 0 10 8");
            marker.setAttribute("refX", "10");
            marker.setAttribute("refY", "4");
            marker.setAttribute("markerWidth", "8");
            marker.setAttribute("markerHeight", "8");
            marker.setAttribute("orient", "auto");
            const arrow = document.createElementNS(svg.namespaceURI, "polygon");
            arrow.setAttribute("points", "0,0 10,4 0,8");
            arrow.setAttribute("fill", "context-stroke");
            marker.append(arrow);
            defs.append(marker);
            svg.append(defs);
            for (const flow of localFlows(snapshot, this.#scopeId)) {
                const source = plotted.get(flow.sourceId);
                const target = plotted.get(flow.targetId);
                if (source === undefined || target === undefined)
                    continue;
                const path = document.createElementNS(svg.namespaceURI, "path");
                path.setAttribute("d", orthogonalPath(source.x + cardWidth, source.y + cardHeight / 2, target.x, target.y + cardHeight / 2));
                path.classList.add(flow.kind);
                path.setAttribute("aria-label", flow.label || `${flow.sourceId} to ${flow.targetId}`);
                path.setAttribute("marker-end", `url(#${this.#flowMarkerId})`);
                path.setAttribute("data-flow-id", flow.id);
                svg.append(path);
                const hit = document.createElementNS(svg.namespaceURI, "path");
                hit.setAttribute("d", path.getAttribute("d"));
                hit.classList.add("dm-flow-hit");
                hit.setAttribute("data-select-flow", flow.id);
                hit.setAttribute("role", "button");
                hit.setAttribute("tabindex", "0");
                hit.setAttribute("aria-label", flowDescription(snapshot, flow));
                svg.append(hit);
                if (flow.label !== "") {
                    const label = document.createElementNS(svg.namespaceURI, "text");
                    label.classList.add("dm-planner-flow-label");
                    label.setAttribute("x", String(Math.round((source.x + cardWidth + target.x) / 2)));
                    label.setAttribute("y", String(Math.round((source.y + target.y + cardHeight) / 2) - 8));
                    label.setAttribute("text-anchor", "middle");
                    label.textContent = flow.label;
                    svg.append(label);
                }
            }
            stage.append(svg);
            for (const item of children) {
                const point = plotted.get(item.id);
                const card = document.createElement("article");
                card.className = `dm-plan-card ${item.kind}`;
                card.setAttribute("role", "button");
                card.setAttribute("aria-label", item.title);
                card.dataset["itemId"] = item.id;
                card.style.left = `${nativePixel(point.x * zoom)}px`;
                card.style.top = `${nativePixel(point.y * zoom)}px`;
                card.style.width = `${nativePixel(cardWidth * zoom)}px`;
                card.style.minHeight = `${nativePixel(cardHeight * zoom)}px`;
                card.style.padding = `${nativePixel(12.8 * zoom)}px`;
                card.style.gap = `${nativePixel(7.2 * zoom)}px`;
                card.tabIndex = 0;
                const kind = document.createElement("span");
                kind.className = "kind";
                kind.textContent = subtype(item);
                const title = document.createElement("h3");
                title.textContent = item.title;
                const summary = document.createElement("p");
                summary.textContent = item.summary || "Needs details";
                title.style.fontSize = `${nativePixel(Math.max(9, 16 * zoom))}px`;
                summary.style.fontSize = `${nativePixel(Math.max(8, 13.6 * zoom))}px`;
                kind.style.fontSize = `${nativePixel(Math.max(8, 12 * zoom))}px`;
                kind.hidden = zoom < .6;
                summary.hidden = zoom < .8;
                const port = document.createElement("button");
                port.type = "button";
                port.className = "dm-flow-port";
                port.dataset["flowPort"] = item.id;
                port.setAttribute("aria-label", `Connect from ${item.title}`);
                port.title = "Click or drag to connect to another card";
                card.append(kind, title, summary, port);
                stage.append(card);
            }
            if (children.length === 0) {
                const empty = messageBlock(document, "This canvas is empty. Add a planning item from the Atlas.", "status");
                empty.classList.add("empty");
                stage.append(empty);
            }
            const toolbar = document.createElement("div");
            toolbar.className = "dm-planner-canvas-toolbar";
            toolbar.setAttribute("role", "group");
            toolbar.setAttribute("aria-label", labels.controls);
            toolbar.title = labels.help;
            const zoomTo = (next, x = viewport.clientWidth / 2, y = viewport.clientHeight / 2) => {
                if (this.#busy || next === view.zoom)
                    return;
                this.#captureViewport();
                view.x = (view.x + x) / view.zoom * next - x;
                view.y = (view.y + y) / view.zoom * next - y;
                view.zoom = next;
                this.#render(false);
            };
            const fit = () => {
                if (this.#busy)
                    return;
                const next = fittedZoom(bounds.width, bounds.height, viewport.clientWidth, viewport.clientHeight);
                view.zoom = next;
                view.x = Math.max(0, (bounds.width * next - viewport.clientWidth) / 2);
                view.y = Math.max(0, (bounds.height * next - viewport.clientHeight) / 2);
                this.#render(false);
            };
            const focus = () => {
                const point = this.#selectedId ? plotted.get(this.#selectedId) : undefined;
                if (!point || this.#busy)
                    return;
                view.x = Math.max(0, (point.x + cardWidth / 2) * zoom - viewport.clientWidth / 2);
                view.y = Math.max(0, (point.y + cardHeight / 2) * zoom - viewport.clientHeight / 2);
                this.#render(false);
            };
            toolbar.append(actionButton(document, "−", () => zoomTo(stepZoom(zoom, -1))), actionButton(document, `${Math.round(zoom * 100)}%`, () => zoomTo(1)), actionButton(document, "+", () => zoomTo(stepZoom(zoom, 1))), actionButton(document, labels.fit, fit), actionButton(document, labels.focus, focus));
            const buttons = toolbar.querySelectorAll("button");
            buttons[0].setAttribute("aria-label", labels.out);
            buttons[1].setAttribute("aria-label", labels.reset);
            buttons[2].setAttribute("aria-label", labels.in);
            const expand = actionButton(document, this.#fullscreen ? labels.exit : labels.fullscreen, () => { if (!this.#busy)
                void (this.#fullscreen ? document.exitFullscreen() : this.requestFullscreen()).catch(error => this.#invalid(error instanceof Error ? error.message : "Fullscreen is unavailable.")); });
            expand.dataset["expandPlanner"] = "";
            expand.setAttribute("aria-pressed", String(this.#fullscreen));
            toolbar.append(expand);
            for (const button of toolbar.querySelectorAll("button"))
                button.dataset["viewAction"] = "";
            const help = actionButton(document, "Keyboard shortcuts", () => this.#showHelp());
            help.dataset["viewAction"] = "";
            help.dataset["plannerShortcuts"] = "";
            toolbar.append(help);
            const reset = actionButton(document, "Reset layout", () => void this.#resetLayout());
            toolbar.append(reset);
            if (this.#undoDelete)
                toolbar.append(actionButton(document, "Undo last deletion", () => void this.#undoDeletion()));
            const connection = mountCanvasConnections({ viewport, stage, svg, zoom, available: () => !this.#busy && !this.#needsReload,
                active: value => { this.#connecting = value; if (!value)
                    this.#live?.wake(); }, connect: (source, target) => void this.#connectBetween(source, target),
            });
            this.#disposeConnection = connection.dispose;
            mountCanvasSelection({ viewport, stage, positions, zoom, selection: this.#selection, available: () => !this.#busy && !this.#needsReload && !this.#connecting,
                change: selection => { this.#selection = selection; this.#selectedId = selection.primary; this.querySelector(".dm-planner-selection")?.replaceWith(this.#selectionToolbar(document, snapshot)); },
                move: values => void this.#savePositions(values), edit: id => this.#edit(id), remove: () => void this.#deleteSelection(),
                connect: connection.start, undo: () => void this.#undoDeletion(), help: () => this.#showHelp(),
                open: id => { const item = snapshot.items.find(value => value.id === id); if (item?.kind === "plotline" || item?.kind === "quest")
                    this.#openCanvas(id);
                else
                    this.#edit(id); },
            });
            viewport.addEventListener("wheel", event => { if (!event.ctrlKey && !event.metaKey)
                return; event.preventDefault(); const rect = viewport.getBoundingClientRect(); zoomTo(stepZoom(view.zoom, -Math.sign(event.deltaY)), event.clientX - rect.left, event.clientY - rect.top); }, { passive: false });
            viewport.addEventListener("keydown", event => {
                if (event.defaultPrevented || event.target !== viewport || this.#busy || this.#connecting || event.altKey || ((event.ctrlKey || event.metaKey) && !event.key.startsWith("Arrow")))
                    return;
                if (["+", "=", "-", "0", "f"].includes(event.key)) {
                    event.preventDefault();
                    if (event.key === "f")
                        fit();
                    else
                        zoomTo(event.key === "0" ? 1 : stepZoom(view.zoom, event.key === "-" ? -1 : 1));
                    this.querySelector(".dm-planner-viewport")?.focus({ preventScroll: true });
                }
                else if (event.key.startsWith("Arrow")) {
                    event.preventDefault();
                    const distance = event.shiftKey ? 160 : 48;
                    viewport.scrollLeft += event.key === "ArrowRight" ? distance : event.key === "ArrowLeft" ? -distance : 0;
                    viewport.scrollTop += event.key === "ArrowDown" ? distance : event.key === "ArrowUp" ? -distance : 0;
                }
            });
            viewport.append(stage);
            region.append(this.#selectionToolbar(document, snapshot), toolbar, viewport);
            return region;
        }
        #canvasView() {
            const key = this.#scopeId ?? "";
            let view = this.#canvasViews.get(key);
            if (!view) {
                view = { zoom: 1, x: 0, y: 0 };
                this.#canvasViews.set(key, view);
            }
            return view;
        }
        #captureViewport() {
            const viewport = this.querySelector(".dm-planner-viewport");
            if (!viewport)
                return;
            const view = this.#canvasViews.get(viewport.dataset["scope"]);
            if (view) {
                view.x = viewport.scrollLeft;
                view.y = viewport.scrollTop;
            }
        }
        #selectionToolbar(document, snapshot) {
            const toolbar = document.createElement("div");
            toolbar.className = "dm-planner-selection dm-planner-canvas-toolbar";
            toolbar.setAttribute("role", "group");
            toolbar.setAttribute("aria-label", "Selection actions");
            const count = this.#selection.items.size + this.#selection.flows.size, label = document.createElement("span");
            label.textContent = count ? `${count} selected` : "Select a card or flow";
            toolbar.append(label);
            const item = this.#selection.items.size === 1 && !this.#selection.flows.size ? snapshot.items.find(value => value.id === this.#selectedId) : undefined;
            if (item) {
                toolbar.append(actionButton(document, "Edit selected", () => this.#edit(item.id)));
                if (item.kind === "plotline" || item.kind === "quest")
                    toolbar.append(actionButton(document, "Enter this canvas", () => this.#openCanvas(item.id)));
            }
            if (!this.#selection.items.size && this.#selection.flows.size === 1) {
                const flow = snapshot.flows.find(value => this.#selection.flows.has(value.id));
                if (flow)
                    toolbar.append(actionButton(document, "Edit selected flow", () => {
                        this.#edit(flow.sourceId, "links");
                        const entry = this.querySelector(`.dm-planner-flow-entry[data-flow-id="${CSS.escape(flow.id)}"]`);
                        const details = entry?.querySelector("details");
                        if (details)
                            details.open = true;
                        entry?.querySelector('input[name="label"]')?.focus();
                    }));
            }
            if (this.#selection.items.size === 2 && !this.#selection.flows.size)
                toolbar.append(actionButton(document, "Connect selected", () => {
                    const [source, target] = [...this.#selection.items];
                    if (!source || !target)
                        return;
                    this.#edit(source, "links");
                    const select = this.querySelector('form[aria-label="Create story flow"] select[name="targetId"]');
                    if (select) {
                        select.value = target;
                        select.dispatchEvent(new Event("change", { bubbles: true }));
                        select.focus();
                    }
                }));
            if (count)
                toolbar.append(actionButton(document, "Delete selection", () => void this.#deleteSelection(), "danger"));
            return toolbar;
        }
        #editor(document, snapshot) {
            const dialog = document.createElement("dialog");
            dialog.className = "dm-planner-dialog dm-planner-inspector";
            dialog.setAttribute("aria-label", "Edit planning item");
            const isNew = this.#newItem?.id === this.#editorId;
            const selected = isNew ? this.#newItem : snapshot.items.find((item) => item.id === this.#editorId);
            const header = document.createElement("header"), title = document.createElement("h2");
            title.textContent = selected.title;
            const closeEditor = () => { if (isNew)
                this.#cancelCreation();
            else
                this.#closeEditor(); };
            const close = actionButton(document, isNew ? "Cancel creation" : "Close editor", closeEditor);
            close.dataset["viewAction"] = "";
            const reload = actionButton(document, "Reload planner", () => void this.#reload());
            reload.dataset["viewAction"] = "";
            const saveItem = actionButton(document, "Save item", () => undefined, "primary");
            saveItem.type = "submit";
            saveItem.setAttribute("form", `${this.#flowMarkerId}-details`);
            header.append(title, saveItem, close);
            dialog.append(header);
            configurePlannerDialog(dialog, closeEditor);
            const tabs = document.createElement("div");
            tabs.className = "dm-dialog-tabs";
            tabs.setAttribute("role", "tablist");
            tabs.setAttribute("aria-label", "Item sections");
            dialog.append(tabs);
            const body = document.createElement("div");
            body.className = "dm-planner-dialog-body";
            dialog.append(body);
            body.append(reload);
            if (this.#message)
                body.append(messageBlock(document, this.#message, this.#messageKind));
            if (this.#needsReload)
                body.append(messageBlock(document, "Reload the planner before making another change. Your edits are retained; review the saved data before retrying.", "alert"));
            this.#removedDrafts(document, body, snapshot);
            const panels = new Map();
            const activate = (id) => {
                if (isNew && id !== "details")
                    return;
                if (this.#dialogTab !== id)
                    body.scrollTop = 0;
                this.#dialogTab = id;
                for (const button of tabs.querySelectorAll("button")) {
                    const active = button.dataset["tab"] === id;
                    button.setAttribute("aria-selected", String(active));
                    button.tabIndex = active ? 0 : -1;
                }
                for (const [key, panel] of panels)
                    panel.hidden = key !== id;
            };
            for (const [id, label] of [["details", "Details"], ["links", "Links"], ["notes", "Notes"]]) {
                const panel = document.createElement("section");
                panel.setAttribute("role", "tabpanel");
                panel.id = `${this.#flowMarkerId}-${id}-panel`;
                panels.set(id, panel);
                body.append(panel);
                const button = actionButton(document, label, () => activate(id));
                button.setAttribute("role", "tab");
                button.dataset["tab"] = id;
                button.id = `${this.#flowMarkerId}-${id}-tab`;
                button.setAttribute("aria-controls", panel.id);
                panel.setAttribute("aria-labelledby", button.id);
                tabs.append(button);
                if (isNew && id !== "details") {
                    button.dataset["unavailable"] = "";
                    button.disabled = true;
                }
            }
            tabs.addEventListener("keydown", event => {
                if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key))
                    return;
                event.preventDefault();
                const buttons = [...tabs.querySelectorAll("button:not(:disabled)")], index = buttons.indexOf(event.target);
                if (!buttons.length)
                    return;
                const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length;
                buttons[next].click();
                buttons[next].focus();
            });
            const aside = panels.get("details");
            const form = document.createElement("form");
            form.addEventListener("submit", (event) => { event.preventDefault(); void this.#saveItem(selected, form); });
            form.id = `${this.#flowMarkerId}-details`;
            form.setAttribute("aria-label", "Planning item details");
            const refreshStructure = appendItemStructure(document, form, selected, snapshot.items);
            form.append(textField(document, "Title", "title", selected.title), textArea(document, "Summary", "summary", selected.summary, 3), textArea(document, "Objective", "objective", selected.objective, 3), textArea(document, "Body", "body", selected.body, 7), textArea(document, "Setup", "setup", selected.setup, 5), textArea(document, "Resolution", "resolution", selected.resolution, 5), textField(document, "Tags", "tags", selected.tags.join(", ")));
            for (const [name, limit] of Object.entries({ title: 160, summary: 2000, objective: 10000, body: 80000, setup: 30000, resolution: 30000, tags: 2440 }))
                form.querySelector(`[name="${name}"]`).maxLength = limit;
            this.#bindDraft(form, isNew ? `new-item:${selected.id}` : `planning_items:${selected.id}`, isNew ? 0 : snapshot.revisions.get(`planning_items:${selected.id}`));
            refreshStructure();
            const save = actionButton(document, "Save details", () => undefined, "primary");
            save.type = "submit";
            form.append(save);
            aside.append(form);
            if (isNew)
                aside.prepend(messageBlock(document, "This item is not saved yet. Save it before adding links or notes; Cancel creation leaves the campaign unchanged.", "status"));
            else {
                if (selected.kind === "plotline" || selected.kind === "quest")
                    aside.append(actionButton(document, "Enter this canvas", () => this.#openCanvas(selected.id)));
                panels.get("links").append(this.#flowEditor(document, snapshot, selected), this.#annotations(document, snapshot, selected));
                panels.get("notes").append(this.#notes(document, snapshot, selected));
                aside.append(actionButton(document, "Delete item and subtree", () => void this.#delete(selected), "danger"));
            }
            activate(this.#dialogTab);
            return dialog;
        }
        #flowEditor(document, snapshot, selected) {
            const section = document.createElement("section");
            const title = document.createElement("h3");
            title.textContent = "Story flow";
            const select = document.createElement("select");
            select.append(option(document, "", "Connect to sibling…"));
            for (const sibling of directChildren(snapshot.items, this.#scopeId).filter((item) => item.id !== selected.id))
                select.append(option(document, sibling.id, sibling.title));
            const form = document.createElement("form");
            form.setAttribute("aria-label", "Create story flow");
            select.name = "targetId";
            select.setAttribute("aria-label", "Flow target");
            form.append(select, selectField(document, "Flow type", "kind", selected.kind === "branch" ? "option" : "continues", flowKindOptions(selected)), textField(document, "Flow label", "label", ""));
            form.querySelector("input").maxLength = 200;
            const create = actionButton(document, "Create flow", () => undefined, "primary");
            create.type = "submit";
            form.append(create);
            this.#bindDraft(form, `new-flow:${selected.id}`, 0);
            form.addEventListener("submit", event => { event.preventDefault(); void this.#createFlow(selected, form); });
            section.append(title, form);
            const attached = localFlows(snapshot, this.#scopeId).filter((flow) => flow.sourceId === selected.id || flow.targetId === selected.id);
            for (const flow of attached) {
                const peerId = flow.sourceId === selected.id ? flow.targetId : flow.sourceId;
                const peer = snapshot.items.find((item) => item.id === peerId);
                const row = document.createElement("div");
                row.className = "dm-planner-record-row";
                const description = document.createElement("span");
                description.textContent = `${flow.sourceId === selected.id ? "To" : "From"} ${peer?.title ?? peerId}${flow.label === "" ? "" : `: ${flow.label}`}`;
                const entry = document.createElement("article");
                entry.className = "dm-planner-flow-entry";
                entry.dataset["flowId"] = flow.id;
                row.append(description, actionButton(document, "Remove flow", () => void this.#deleteFlow(flow, selected.id), "danger"));
                entry.append(row);
                const editor = document.createElement("details");
                const editLabel = document.createElement("summary");
                editLabel.textContent = "Edit flow";
                editor.append(editLabel);
                editor.open = this.#drafts.has(`planning_flow_links:${flow.id}`);
                const editForm = document.createElement("form");
                editForm.setAttribute("aria-label", "Edit story flow");
                const source = snapshot.items.find(item => item.id === flow.sourceId);
                editForm.append(selectField(document, "Flow type", "kind", flow.kind, flowKindOptions(source)), textField(document, "Flow label", "label", flow.label));
                editForm.querySelector("input").maxLength = 200;
                const save = actionButton(document, "Save flow", () => undefined, "primary");
                save.type = "submit";
                editForm.append(save);
                this.#bindDraft(editForm, `planning_flow_links:${flow.id}`, snapshot.revisions.get(`planning_flow_links:${flow.id}`));
                editForm.addEventListener("submit", event => { event.preventDefault(); void this.#saveFlow(flow, editForm, selected.id); });
                editor.append(editForm);
                entry.append(editor);
                section.append(entry);
            }
            return section;
        }
        #annotations(document, snapshot, selected) {
            const section = document.createElement("section");
            const title = document.createElement("h3");
            title.textContent = "Planning annotations";
            section.append(title);
            const core = coreReferences(this.#contribution?.host);
            const create = document.createElement("details");
            const createLabel = document.createElement("summary");
            createLabel.textContent = "Add reference";
            create.append(createLabel);
            create.open = this.#drafts.has(`new-reference:${selected.id}`);
            const createForm = document.createElement("form");
            createForm.setAttribute("aria-label", "Create reference");
            const refreshNewTarget = appendTargetFields(document, createForm, undefined, snapshot.items, core);
            createForm.append(textField(document, "Reference name (optional)", "name", ""));
            createForm.querySelector('[name="name"]').maxLength = 200;
            const add = actionButton(document, "Add reference", () => undefined, "primary");
            add.type = "submit";
            createForm.append(add);
            this.#bindDraft(createForm, `new-reference:${selected.id}`, 0);
            refreshNewTarget();
            createForm.addEventListener("submit", event => { event.preventDefault(); void this.#addReference(selected, createForm); });
            create.append(createForm);
            section.append(create);
            for (const reference of snapshot.references.filter((entry) => entry.itemId === selected.id)) {
                const form = document.createElement("form");
                form.className = "dm-planner-annotation";
                form.dataset["referenceId"] = reference.id;
                form.addEventListener("submit", (event) => { event.preventDefault(); void this.#saveReference(reference, form, selected.id); });
                form.append(targetLink(document, reference.target, snapshot.items, core, this.#contribution.addon.id));
                const refreshTarget = appendTargetFields(document, form, reference.target, snapshot.items, core);
                const relation = selectField(document, "Relation", "relation", reference.relation, [["related", "Related"], ["involves", "Involves"], ["features", "Features"], ["located-at", "Located at"], ["opposes", "Opposes"], ["supports", "Supports"], ["reveals", "Reveals"], ["requires", "Requires"], ["rewards", "Rewards"]]);
                const quantity = textField(document, "Quantity", "quantity", String(reference.quantity));
                const input = quantity.querySelector("input");
                input.type = "number";
                input.min = "1";
                input.max = "1000";
                input.step = "1";
                input.required = true;
                form.append(textField(document, "Reference", "name", reference.name), relation, quantity, textArea(document, "Notes", "notes", reference.notes, 2));
                form.querySelector('[name="name"]').maxLength = 200;
                form.querySelector('[name="notes"]').maxLength = 2000;
                const save = actionButton(document, "Save reference", () => undefined, "primary");
                save.type = "submit";
                form.append(save, actionButton(document, "Delete reference", () => void this.#deleteRecord("planning_references", reference.id, "Reference deleted.", selected.id), "danger"));
                section.append(form);
                this.#bindDraft(form, `planning_references:${reference.id}`, snapshot.revisions.get(`planning_references:${reference.id}`));
                refreshTarget();
            }
            section.append(actionButton(document, "Add consequence", () => void this.#addConsequence(selected)));
            const attachedFlows = snapshot.flows.filter(flow => flow.sourceId === selected.id || flow.targetId === selected.id);
            const anchorOptions = [[`item:${selected.id}`, "Whole item"], ...attachedFlows.map(flow => [`flow:${flow.id}`, flowDescription(snapshot, flow)])];
            for (const consequence of snapshot.consequences.filter(entry => entry.anchor["scope"] === "item" ? entry.anchor["itemId"] === selected.id : attachedFlows.some(flow => flow.id === entry.anchor["flowId"]))) {
                const form = document.createElement("form");
                form.className = "dm-planner-annotation";
                form.addEventListener("submit", (event) => { event.preventDefault(); void this.#saveConsequence(consequence, form, selected.id); });
                form.dataset["consequenceId"] = consequence.id;
                const anchorKey = consequence.anchor["scope"] === "item" ? `item:${consequence.anchor["itemId"]}` : `flow:${consequence.anchor["flowId"]}`;
                form.append(selectField(document, "Consequence applies to", "anchor", anchorKey, anchorOptions));
                form.append(textField(document, "Consequence", "title", consequence.title), selectField(document, "Kind", "kind", consequence.kind, [["world", "World"], ["reward", "Reward"], ["information", "Information"], ["complication", "Complication"]]), textArea(document, "Details", "body", consequence.body, 3));
                const save = actionButton(document, "Save consequence", () => undefined, "primary");
                save.type = "submit";
                form.append(save, actionButton(document, "Delete consequence", () => void this.#deleteRecord("planning_consequences", consequence.id, "Consequence deleted.", selected.id), "danger"));
                section.append(form);
                const refreshTarget = appendTargetFields(document, form, consequence.target, snapshot.items, core, true);
                form.append(...form.querySelectorAll("button"));
                this.#bindDraft(form, `planning_consequences:${consequence.id}`, snapshot.revisions.get(`planning_consequences:${consequence.id}`));
                refreshTarget();
            }
            return section;
        }
        #notes(document, snapshot, selected) {
            const section = document.createElement("section");
            section.append(actionButton(document, "Add DM note", () => void this.#addNote(selected)));
            for (const note of snapshot.notes.filter((entry) => entry.anchorIds.length === 0 || entry.anchorIds.includes(selected.id))) {
                const form = document.createElement("form");
                form.className = "dm-planner-annotation";
                form.addEventListener("submit", (event) => { event.preventDefault(); void this.#saveNote(note, form, selected.id); });
                form.append(textField(document, "DM note", "title", note.title), textArea(document, "Private details", "body", note.body, 4));
                const save = actionButton(document, "Save note", () => undefined, "primary");
                save.type = "submit";
                form.append(save, actionButton(document, "Delete note", () => void this.#deleteRecord("dm_notes", note.id, "DM note deleted.", selected.id), "danger"));
                section.append(form);
                form.dataset["noteId"] = note.id;
                if (note.anchorIds.length === 0)
                    form.prepend(messageBlock(document, "Unanchored note — link it to a planning item below.", "status"));
                const refreshAnchors = appendNoteAnchors(document, form, note.anchorIds, snapshot.items);
                form.append(...form.querySelectorAll("button"));
                this.#bindDraft(form, `dm_notes:${note.id}`, snapshot.revisions.get(`dm_notes:${note.id}`));
                refreshAnchors();
            }
            return section;
        }
        #create(kind) {
            if (this.#busy || this.#needsReload)
                return;
            this.#newItem ??= newItem(kind, this.#scopeId);
            this.#editorId = this.#newItem.id;
            this.#dialogTab = "details";
            this.#message = "";
            this.#syncEdits();
            this.#render();
            this.querySelector('dialog input[name="title"]')?.focus();
        }
        async #saveItem(item, form) {
            const snapshot = this.#snapshot;
            if (!snapshot)
                return;
            const data = new FormData(form);
            const text = (name) => String(data.get(name) ?? "").trim();
            const tags = [...new Set(text("tags").split(",").map(tag => tag.trim()).filter(Boolean))];
            if (tags.length > 40 || tags.some(tag => tag.length > 60)) {
                this.#invalid("Use up to 40 tags, with at most 60 characters each.");
                return;
            }
            const { eventType, branchType, ...common } = item;
            const kind = text("kind");
            const next = { ...common, kind, parentId: text("parentId") || null, title: text("title"), summary: text("summary"), objective: text("objective"), body: text("body"), setup: text("setup"), resolution: text("resolution"), tags, updatedAt: Date.now(),
                ...(kind === "event" ? { eventType: (text("eventType") || eventType || "story") } : {}),
                ...(kind === "branch" ? { branchType: (text("branchType") || branchType || "decision") } : {}) };
            if (next.title === "") {
                this.#message = "A title is required.";
                this.#messageKind = "alert";
                this.#render();
                return;
            }
            const isNew = item.id === this.#newItem?.id;
            const issues = isNew ? validatePlanning({ ...snapshot, items: [...snapshot.items, next] }) : validateItemEdit(snapshot, next);
            if (issues.length) {
                this.#invalid(issues[0]);
                return;
            }
            const revision = this.#drafts.revision(form);
            if (revision === undefined)
                return;
            const saved = await this.#mutate(async (runtime, snapshot) => isNew ? runtime.repository.createItem(snapshot, next) : runtime.repository.saveItem(snapshot, next, revision), "Details saved.", item.id, isNew ? `new-item:${item.id}` : `planning_items:${item.id}`);
            const current = saved ? this.#snapshot?.items.find(value => value.id === item.id) : undefined;
            if (current && (isNew || item.parentId !== current.parentId || item.kind !== current.kind))
                this.#revealItem(current);
        }
        #revealItem(item) {
            const editor = this.#editorId;
            this.#scopeId = item.parentId;
            this.#selectOnly(item.id);
            this.#targetId = item.kind === "event" || item.kind === "branch" ? item.id : item.parentId ?? undefined;
            this.#targetPending = false;
            this.#invalidTarget = false;
            this.#openCanvas(this.#targetId);
            this.#editorId = editor;
            this.#render();
        }
        async #createFlow(source, form) {
            const snapshot = this.#snapshot;
            if (snapshot === undefined)
                return;
            const data = new FormData(form);
            const targetId = String(data.get("targetId") ?? "");
            if (!targetId) {
                this.#invalid("Choose a sibling to connect.");
                return;
            }
            const flow = { id: `flow-${crypto.randomUUID()}`, schemaVersion: 3, sourceId: source.id, targetId, kind: String(data.get("kind")), label: String(data.get("label") ?? "").trim(), updatedAt: Date.now() };
            const candidate = { ...snapshot, flows: [...snapshot.flows, flow] };
            const issues = validatePlanning(candidate);
            if (issues.length > 0) {
                this.#message = issues[0];
                this.#messageKind = "alert";
                this.#render();
                return;
            }
            await this.#mutate(async (runtime, snapshot) => runtime.repository.put(snapshot, "planning_flow_links", flow, 0), "Flow created.", source.id, `new-flow:${source.id}`);
        }
        async #connectBetween(sourceId, targetId) {
            const snapshot = this.#snapshot, source = snapshot?.items.find(item => item.id === sourceId);
            if (!snapshot || !source)
                return;
            const flow = { id: `flow-${crypto.randomUUID()}`, schemaVersion: 3, sourceId, targetId, kind: source.kind === "branch" ? "option" : "continues", label: "", updatedAt: Date.now() };
            const issues = validatePlanning({ ...snapshot, flows: [...snapshot.flows, flow] });
            if (issues.length) {
                this.#invalid(issues[0]);
                return;
            }
            await this.#mutate((runtime, current) => runtime.repository.put(current, "planning_flow_links", flow, 0), "Flow created.", sourceId);
        }
        async #saveFlow(flow, form, selectedId) {
            const snapshot = this.#snapshot;
            const revision = this.#drafts.revision(form);
            if (!snapshot || revision === undefined)
                return;
            const data = new FormData(form);
            const next = { ...flow, kind: String(data.get("kind")), label: String(data.get("label") ?? "").trim(), updatedAt: Date.now() };
            const issues = validatePlanning({ ...snapshot, flows: snapshot.flows.map(value => value.id === flow.id ? next : value) });
            if (issues.length) {
                this.#invalid(issues[0]);
                return;
            }
            await this.#mutate((runtime, snapshot) => runtime.repository.put(snapshot, "planning_flow_links", next, revision), "Flow saved.", selectedId, `planning_flow_links:${flow.id}`);
        }
        async #deleteFlow(flow, selectedId) {
            const snapshot = this.#snapshot;
            if (!snapshot)
                return;
            const consequences = snapshot.consequences.filter(entry => entry.anchor["scope"] === "flow" && entry.anchor["flowId"] === flow.id);
            if (consequences.length && !confirm(`Remove this flow and its ${consequences.length} attached consequences?`))
                return;
            await this.#mutate(async (runtime) => { this.#undoDelete = await runtime.repository.deleteFlow(snapshot, flow.id); }, "Flow removed.", selectedId, `planning_flow_links:${flow.id}`);
        }
        async #savePositions(positions) { const snapshot = this.#snapshot; if (snapshot === undefined)
            return; await this.#mutate(runtime => runtime.repository.savePositions(snapshot, this.#scopeId, positions), "Position saved.", this.#selectedId); this.querySelector(".dm-planner-viewport")?.focus({ preventScroll: true }); }
        async #deleteSelection() {
            const snapshot = this.#snapshot, items = [...this.#selection.items], flows = [...this.#selection.flows];
            if (!snapshot || this.#busy || this.#needsReload || (!items.length && !flows.length))
                return;
            if (!confirm(`Delete ${items.length} selected items and ${flows.length} selected flows, including subtrees and attached annotations? Shared notes keep their other links.`))
                return;
            await this.#mutate(async (runtime) => { this.#undoDelete = await runtime.repository.deleteSelection(snapshot, items, flows); }, "Selection deleted.");
        }
        async #delete(item) { const snapshot = this.#snapshot; if (snapshot === undefined || !confirm(`Delete ${item.title} and its subtree, attached flows and consequences, and incoming planning references? Shared notes will keep their other links.`))
            return; await this.#mutate(async (runtime) => { this.#undoDelete = await runtime.repository.deleteSubtree(snapshot, item.id); }, "Planning subtree deleted."); }
        async #undoDeletion() {
            const undo = this.#undoDelete;
            if (!undo)
                return;
            await this.#mutate(async (runtime, snapshot) => { await runtime.repository.undoDeletion(snapshot, undo); this.#undoDelete = undefined; }, "Deletion undone.");
        }
        async #resetLayout() {
            if (this.#busy || this.#needsReload || !confirm("Reset the positions on this canvas? Items, links and other canvases will stay unchanged."))
                return;
            await this.#mutate((runtime, snapshot) => runtime.repository.resetLayout(snapshot, this.#scopeId), "Layout reset.", this.#selectedId);
        }
        async #addReference(item, form) {
            const snapshot = this.#snapshot;
            if (!snapshot)
                return;
            const data = new FormData(form);
            const core = coreReferences(this.#contribution?.host);
            let target;
            try {
                target = targetFromForm(data, snapshot.items, core);
            }
            catch (error) {
                this.#invalid(error.message);
                return;
            }
            const reference = { id: `reference-${crypto.randomUUID()}`, schemaVersion: 3, itemId: item.id, name: String(data.get("name") ?? "").trim() || targetLabel(target, snapshot.items, core), relation: "related", target, quantity: 1, notes: "", updatedAt: Date.now() };
            await this.#mutate(async (runtime, snapshot) => runtime.repository.put(snapshot, "planning_references", reference, 0), "Reference added.", item.id, `new-reference:${item.id}`);
        }
        async #addConsequence(item) { const consequence = { id: `consequence-${crypto.randomUUID()}`, schemaVersion: 3, anchor: { scope: "item", itemId: item.id }, kind: "world", title: "Planned consequence", body: "", updatedAt: Date.now() }; await this.#mutate(async (runtime, snapshot) => runtime.repository.put(snapshot, "planning_consequences", consequence, 0), "Consequence added.", item.id); }
        async #addNote(item) { const note = { id: `note-${crypto.randomUUID()}`, schemaVersion: 3, title: "DM note", body: "", anchorIds: [item.id], updatedAt: Date.now() }; await this.#mutate(async (runtime, snapshot) => runtime.repository.put(snapshot, "dm_notes", note, 0), "DM note added.", item.id); }
        async #saveReference(reference, form, selectedId) {
            const snapshot = this.#snapshot;
            if (!snapshot)
                return;
            const data = new FormData(form);
            const quantity = Number(data.get("quantity"));
            if (!Number.isInteger(quantity) || quantity < 1 || quantity > 1000) {
                this.#invalid("Quantity must be a whole number from 1 to 1000.");
                return;
            }
            let target;
            try {
                target = targetFromForm(data, snapshot.items, coreReferences(this.#contribution?.host), reference.target);
            }
            catch (error) {
                this.#invalid(error.message);
                return;
            }
            const next = { ...reference, target, quantity, name: String(data.get("name") ?? "").trim(), relation: String(data.get("relation") ?? "related"), notes: String(data.get("notes") ?? "").trim(), updatedAt: Date.now() };
            if (next.name === "") {
                this.#invalid("A reference name is required.");
                return;
            }
            await this.#putExisting("planning_references", next, form, selectedId, "Reference saved.");
        }
        async #saveConsequence(consequence, form, selectedId) {
            const snapshot = this.#snapshot;
            if (!snapshot)
                return;
            const data = new FormData(form);
            const anchorKey = String(data.get("anchor") ?? "");
            const flow = snapshot.flows.find(entry => `flow:${entry.id}` === anchorKey && (entry.sourceId === selectedId || entry.targetId === selectedId));
            if (anchorKey !== `item:${selectedId}` && !flow) {
                this.#invalid("Choose this item or one of its existing flows for the consequence.");
                return;
            }
            const anchor = flow ? { scope: "flow", flowId: flow.id } : { scope: "item", itemId: selectedId };
            let target;
            try {
                target = targetFromForm(data, snapshot.items, coreReferences(this.#contribution?.host), consequence.target, true);
            }
            catch (error) {
                this.#invalid(error.message);
                return;
            }
            const { target: previousTarget, ...base } = consequence;
            const next = { ...base, ...(target ? { target } : {}), anchor, title: String(data.get("title") ?? "").trim(), kind: String(data.get("kind") ?? "world"), body: String(data.get("body") ?? "").trim(), updatedAt: Date.now() };
            if (next.title === "") {
                this.#invalid("A consequence title is required.");
                return;
            }
            await this.#putExisting("planning_consequences", next, form, selectedId, "Consequence saved.");
        }
        async #saveNote(note, form, selectedId) {
            const snapshot = this.#snapshot;
            if (!snapshot)
                return;
            const data = new FormData(form);
            let anchorIds;
            try {
                anchorIds = noteAnchors(String(data.get("anchorIds")), snapshot.items);
            }
            catch (error) {
                this.#invalid(error.message);
                return;
            }
            const next = { ...note, anchorIds, title: String(data.get("title") ?? "").trim(), body: String(data.get("body") ?? "").trim(), updatedAt: Date.now() };
            if (next.title === "") {
                this.#invalid("A DM note title is required.");
                return;
            }
            await this.#putExisting("dm_notes", next, form, selectedId, "DM note saved.");
        }
        async #putExisting(collection, value, form, selectedId, success) {
            const revision = this.#drafts.revision(form);
            if (revision === undefined) {
                this.#invalid("This record changed or no longer exists. Reload the planner.");
                return;
            }
            await this.#mutate(async (runtime, snapshot) => runtime.repository.put(snapshot, collection, value, revision), success, selectedId, `${collection}:${value.id}`);
        }
        async #deleteRecord(collection, id, success, selectedId) { const revision = this.#snapshot?.revisions.get(`${collection}:${id}`); if (revision === undefined) {
            this.#invalid("This record changed or no longer exists. Reload the planner.");
            return;
        } const mutation = { operation: "delete", kind: "collection", dataId: collection, key: id, expectedRevision: revision }; await this.#mutate(async (runtime, snapshot) => runtime.repository.transact(snapshot, [mutation]), success, selectedId, `${collection}:${id}`); }
        #invalid(message) { this.#message = message; this.#messageKind = "alert"; this.#render(); }
        #bindDraft(form, key, revision) {
            this.#drafts.bind(form, key, revision);
            const discard = actionButton(this.ownerDocument, "Discard edits", () => { this.#drafts.clear(key); this.#render(); });
            discard.dataset["viewAction"] = "";
            discard.hidden = !this.#drafts.has(key);
            form.append(discard);
            const update = () => { discard.hidden = !this.#drafts.has(key); };
            form.addEventListener("input", update);
            form.addEventListener("change", update);
            const opening = this.#drafts.revision(form);
            if (opening !== revision)
                form.prepend(messageBlock(this.ownerDocument, "This record changed since editing began. Copy your edits, then discard them to load the saved version.", "alert"));
        }
        #removedDrafts(document, root, snapshot) {
            for (const [key, draft] of this.#drafts.entries()) {
                if (key.startsWith("new-item:") || key.startsWith("new-flow:") || key.startsWith("new-reference:") || snapshot.revisions.has(key))
                    continue;
                const details = document.createElement("details");
                const title = document.createElement("summary");
                title.textContent = `Unsaved edits to a removed record: ${draft.values["title"] || draft.values["name"] || "Planning record"}`;
                const content = document.createElement("pre");
                content.textContent = Object.entries(draft.values).map(([field, value]) => `${field}: ${value}`).join("\n\n");
                const discard = actionButton(document, "Discard removed record edits", () => { this.#drafts.clear(key); this.#render(); });
                discard.dataset["viewAction"] = "";
                details.className = "dm-planner-removed-draft";
                details.append(title, content, discard);
                root.append(details);
            }
        }
        #acceptCommittedDrafts() { for (const key of this.#committedDrafts) {
            if (key === `new-item:${this.#newItem?.id}`)
                this.#newItem = undefined;
            this.#drafts.clear(key);
        } this.#committedDrafts.clear(); this.#syncEdits(); }
        #syncEdits() {
            const dirty = (!!this.#newItem && !this.#committedDrafts.has(`new-item:${this.#newItem.id}`)) || [...this.#drafts.entries()].some(([key]) => !this.#committedDrafts.has(key));
            this.#contribution?.edits?.set({ dirty, saving: this.#writing, retainOnQueryChange: true });
            this.#live?.wake();
        }
        async #mutate(operation, success, selected, draftKey) {
            const runtime = this.#runtime;
            const original = this.#snapshot;
            if (runtime === undefined || original === undefined || this.#busy || this.#needsReload)
                return false;
            this.#busy = true;
            this.#message = "Saving…";
            this.#messageKind = "status";
            this.#render();
            this.#writing = true;
            this.#syncEdits();
            try {
                await operation(runtime, original);
                if (this.#runtime !== runtime || !this.isConnected)
                    return false;
                // A confirmed write must not be offered again if the following read fails.
                if (draftKey)
                    this.#committedDrafts.add(draftKey);
                const request = new AbortController();
                this.#readRequest?.abort();
                this.#readRequest = request;
                this.#live?.consume();
                const snapshot = await runtime.repository.load(request.signal);
                if (this.#runtime !== runtime || request.signal.aborted || !this.isConnected)
                    return false;
                this.#acceptCommittedDrafts();
                if (!selected || !this.#selection.items.has(selected))
                    this.#selectOnly(selected);
                this.#selectedId = selected;
                this.#snapshot = snapshot;
                this.#message = success;
                if (this.#targetPending)
                    this.#applyTarget();
                return true;
            }
            catch (error) {
                if (this.#runtime === runtime && this.isConnected) {
                    this.#needsReload = true;
                    this.#fail(error, "Planning change failed.");
                }
                return false;
            }
            finally {
                if (this.#runtime === runtime && this.isConnected) {
                    this.#busy = false;
                    this.#writing = false;
                    this.#syncEdits();
                    this.#render();
                }
            }
        }
        #fail(error, fallback) { this.#message = error instanceof Error && error.message !== "" ? error.message : fallback; this.#messageKind = "alert"; }
        #unavailable(message) { this.replaceChildren(messageBlock(this.ownerDocument, message, "alert")); const link = this.ownerDocument.createElement("a"); link.textContent = "Open campaign canvas"; link.href = plannerLink(this.#contribution?.addon.id ?? "dm-tools"); this.append(link); }
    }
    customElements.define(tag, PlannerElement);
    return tag;
}
function appendItemStructure(document, form, item, items) {
    const row = document.createElement("div");
    row.className = "dm-planner-form-row";
    const kind = selectField(document, "Kind", "kind", item.kind, [["plotline", "Plotline"], ["quest", "Quest"], ["event", "Event"], ["branch", "Branch"]]);
    const parents = availableParents(items, item.id).map(parent => [parent.id, scopeTrail(items, parent.id).map(entry => entry.title).join(" / ")]);
    row.append(kind, selectField(document, "Parent", "parentId", item.parentId ?? "", [["", "Campaign"], ...parents]));
    const event = document.createElement("div"), branch = document.createElement("div");
    event.append(selectField(document, "Event type", "eventType", item.eventType ?? "story", [["story", "Story"], ["encounter", "Encounter"], ["puzzle", "Puzzle"]]));
    branch.append(selectField(document, "Branch type", "branchType", item.branchType ?? "decision", [["decision", "Decision"], ["condition", "Condition"], ["random", "Random"]]));
    const help = document.createElement("small");
    help.textContent = "Moving an item keeps its children and annotations. Connected story flows must stay on the same canvas.";
    form.append(row, event, branch, help);
    const refresh = () => { const value = kind.querySelector("select").value; event.hidden = value !== "event"; branch.hidden = value !== "branch"; };
    kind.addEventListener("change", refresh);
    return refresh;
}
function orthogonalPath(sourceX, sourceY, targetX, targetY) { const middle = sourceX + (targetX - sourceX) / 2; return `M ${sourceX} ${sourceY} H ${middle} V ${targetY} H ${targetX}`; }
function subtype(item) { return item.kind === "event" ? item.eventType ?? "event" : item.kind === "branch" ? item.branchType ?? "branch" : item.kind; }
function flowKindOptions(source) { return source.kind === "branch" ? [["continues", "Continues"], ["option", "Option"]] : [["continues", "Continues"]]; }
function flowDescription(snapshot, flow) { const source = snapshot.items.find(item => item.id === flow.sourceId); const target = snapshot.items.find(item => item.id === flow.targetId); return `${source?.title ?? flow.sourceId} → ${target?.title ?? flow.targetId}${flow.label ? `: ${flow.label}` : ""}`; }
function actionButton(document, label, action, style) { const button = document.createElement("button"); button.type = "button"; button.textContent = label; if (style !== undefined)
    button.className = style; button.addEventListener("click", action); return button; }
