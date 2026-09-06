import { appendTargetFields, coreReferences, targetFromForm, targetLabel, targetLink } from "./planner-targets.js";
import { appendNoteAnchors, noteAnchors } from "./planner-note-anchors.js";
import { option, textField, textArea, selectField, messageBlock } from "./planner-fields.js";
import { availableParents, directChildren, localFlows, newItem, scopeTrail, validateItemEdit, validatePlanning } from "./planning-model.js";
import { runtimeFor } from "./runtime.js";
import { plannerLink, plannerSelection, plannerTarget } from "./dashboard-model.js";
import { PlannerDrafts } from "./planner-drafts.js";
export const plannerElementTag = "dm-tools-planner-page";
const cardWidth = 240;
const cardHeight = 132;
const grid = 24;
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
        #flowMarkerId = `dm-flow-arrow-${crypto.randomUUID()}`;
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
        connectedCallback() { this.classList.add("dm-tools-planner"); void this.#connect(); }
        disconnectedCallback() { this.#readRequest?.abort(); this.#readRequest = undefined; this.#runtime = undefined; this.#contribution?.edits?.set({ dirty: false, saving: false }); }
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
            this.#drafts.clearAll();
            this.#committedDrafts.clear();
            this.#needsReload = false;
            this.#runtime = runtime;
            await this.#reload("Loading story planner…");
        }
        async #reload(loading) {
            const runtime = this.#runtime;
            if (runtime === undefined || this.#busy)
                return;
            const request = new AbortController();
            this.#readRequest?.abort();
            this.#readRequest = request;
            this.#busy = true;
            if (loading !== undefined) {
                this.#message = loading;
                this.#messageKind = "status";
            }
            this.#render();
            try {
                const snapshot = await runtime.repository.load(request.signal);
                if (this.#runtime !== runtime || this.#readRequest !== request || request.signal.aborted || !this.isConnected)
                    return;
                this.#snapshot = snapshot;
                this.#acceptCommittedDrafts();
                this.#needsReload = false;
                if (this.#scopeId !== null && !this.#snapshot.items.some((item) => item.id === this.#scopeId))
                    this.#scopeId = null;
                if (this.#selectedId !== undefined && !this.#snapshot.items.some((item) => item.id === this.#selectedId))
                    this.#selectedId = undefined;
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
                    this.#needsReload = true;
                    this.#fail(error, "Could not load planning data.");
                }
            }
            finally {
                if (this.#runtime === runtime && this.#readRequest === request && !request.signal.aborted && this.isConnected) {
                    this.#busy = false;
                    this.#render();
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
                this.#selectedId = selection.selectedId;
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
            this.ownerDocument.defaultView.location.hash = plannerLink(addonId, id);
        }
        #render() {
            const snapshot = this.#snapshot;
            if (snapshot === undefined) {
                this.replaceChildren(messageBlock(this.ownerDocument, this.#message, this.#messageKind));
                if (!this.#busy)
                    this.append(actionButton(this.ownerDocument, "Reload planner", () => void this.#reload("Loading story planner…")));
                return;
            }
            const document = this.ownerDocument;
            const root = document.createElement("section");
            root.className = "dm-planner-shell";
            const header = document.createElement("header");
            const heading = document.createElement("div");
            const title = document.createElement("h1");
            title.textContent = "Story Planner";
            const subtitle = document.createElement("p");
            subtitle.textContent = "An editable tree of local story-flow canvases.";
            heading.append(title, subtitle);
            header.append(heading, this.#breadcrumbs(document, snapshot));
            root.append(header);
            if (this.#message !== "")
                root.append(messageBlock(document, this.#message, this.#messageKind));
            const refresh = actionButton(document, "Reload planner", () => void this.#reload("Reloading planning data…"));
            refresh.dataset["viewAction"] = "";
            refresh.className = "dm-planner-refresh";
            header.append(refresh);
            if (this.#needsReload)
                root.append(messageBlock(document, "Reload the planner before making another change. Your edits are retained; review the saved data before retrying.", "alert"));
            this.#removedDrafts(document, root, snapshot);
            const workspace = document.createElement("div");
            workspace.className = "dm-planner-workspace";
            workspace.append(this.#atlas(document), this.#canvas(document, snapshot), this.#inspector(document, snapshot));
            root.append(workspace);
            this.replaceChildren(root);
            root.setAttribute("aria-busy", String(this.#busy));
            for (const control of root.querySelectorAll("input,textarea,select")) {
                control.disabled = this.#busy || (this.#needsReload && control.tagName === "SELECT");
                if (control.tagName !== "SELECT")
                    control.readOnly = this.#needsReload;
            }
            for (const button of root.querySelectorAll("button"))
                button.disabled = this.#busy || (this.#needsReload && !button.hasAttribute("data-view-action"));
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
            const help = document.createElement("p");
            help.textContent = "Drag cards to arrange. Select a card to edit it or connect it to a sibling. Double-click a plotline or quest to enter its canvas.";
            aside.append(help);
            return aside;
        }
        #canvas(document, snapshot) {
            const viewport = document.createElement("div");
            viewport.className = "dm-planner-viewport";
            const stage = document.createElement("div");
            stage.className = "dm-planner-stage";
            const children = directChildren(snapshot.items, this.#scopeId);
            const positions = positionsFor(snapshot.views, this.#scopeId, children);
            const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
            svg.classList.add("dm-planner-flows");
            svg.setAttribute("aria-label", "Story flow");
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
                const source = positions.get(flow.sourceId);
                const target = positions.get(flow.targetId);
                if (source === undefined || target === undefined)
                    continue;
                const path = document.createElementNS(svg.namespaceURI, "path");
                path.setAttribute("d", orthogonalPath(source.x + cardWidth, source.y + cardHeight / 2, target.x, target.y + cardHeight / 2));
                path.classList.add(flow.kind);
                path.setAttribute("aria-label", flow.label || `${flow.sourceId} to ${flow.targetId}`);
                path.setAttribute("marker-end", `url(#${this.#flowMarkerId})`);
                path.setAttribute("data-flow-id", flow.id);
                svg.append(path);
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
                const position = positions.get(item.id);
                const card = document.createElement("article");
                card.className = `dm-plan-card ${item.kind}${item.id === this.#selectedId ? " selected" : ""}`;
                card.dataset["itemId"] = item.id;
                card.style.left = `${position.x}px`;
                card.style.top = `${position.y}px`;
                card.tabIndex = 0;
                const kind = document.createElement("span");
                kind.className = "kind";
                kind.textContent = subtype(item);
                const title = document.createElement("h3");
                title.textContent = item.title;
                const summary = document.createElement("p");
                summary.textContent = item.summary || "Needs details";
                card.append(kind, title, summary);
                card.addEventListener("click", () => { if (!this.#busy && this.#selectedId !== item.id) {
                    this.#selectedId = item.id;
                    this.#render();
                } });
                card.addEventListener("dblclick", () => { if (!this.#busy && (item.kind === "plotline" || item.kind === "quest"))
                    this.#openCanvas(item.id); });
                card.addEventListener("keydown", (event) => {
                    if (this.#busy || (event.key !== "Enter" && event.key !== " "))
                        return;
                    event.preventDefault();
                    if (event.key === "Enter" && (item.kind === "plotline" || item.kind === "quest"))
                        this.#openCanvas(item.id);
                    else {
                        this.#selectedId = item.id;
                        this.#render();
                    }
                });
                this.#makeDraggable(card, item.id, position);
                stage.append(card);
            }
            if (children.length === 0) {
                const empty = messageBlock(document, "This canvas is empty. Add a planning item from the Atlas.", "status");
                empty.classList.add("empty");
                stage.append(empty);
            }
            viewport.append(stage);
            return viewport;
        }
        #inspector(document, snapshot) {
            const aside = document.createElement("aside");
            aside.className = "dm-planner-inspector";
            const title = document.createElement("h2");
            title.textContent = "Inspector";
            aside.append(title);
            const selected = snapshot.items.find((item) => item.id === this.#selectedId);
            if (selected === undefined) {
                const hint = document.createElement("p");
                hint.textContent = "Select a card to edit details, manage flow, or add planning annotations.";
                aside.append(hint);
                return aside;
            }
            const form = document.createElement("form");
            form.addEventListener("submit", (event) => { event.preventDefault(); void this.#saveItem(selected, form); });
            form.setAttribute("aria-label", "Planning item details");
            const refreshStructure = appendItemStructure(document, form, selected, snapshot.items);
            form.append(textField(document, "Title", "title", selected.title), textArea(document, "Summary", "summary", selected.summary, 3), textArea(document, "Objective", "objective", selected.objective, 3), textArea(document, "Body", "body", selected.body, 7), textArea(document, "Setup", "setup", selected.setup, 5), textArea(document, "Resolution", "resolution", selected.resolution, 5), textField(document, "Tags", "tags", selected.tags.join(", ")));
            for (const [name, limit] of Object.entries({ title: 160, summary: 2000, objective: 10000, body: 80000, setup: 30000, resolution: 30000, tags: 2440 }))
                form.querySelector(`[name="${name}"]`).maxLength = limit;
            this.#bindDraft(form, `planning_items:${selected.id}`, snapshot.revisions.get(`planning_items:${selected.id}`));
            refreshStructure();
            const save = actionButton(document, "Save details", () => undefined, "primary");
            save.type = "submit";
            form.append(save);
            aside.append(form);
            if (selected.kind === "plotline" || selected.kind === "quest")
                aside.append(actionButton(document, "Enter this canvas", () => this.#openCanvas(selected.id)));
            aside.append(this.#flowEditor(document, snapshot, selected));
            aside.append(this.#annotations(document, snapshot, selected));
            aside.append(actionButton(document, "Delete item and subtree", () => void this.#delete(selected), "danger"));
            return aside;
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
        #makeDraggable(card, itemId, original) {
            card.addEventListener("pointerdown", (event) => {
                if (this.#busy || this.#needsReload || event.button !== 0 || event.target.closest("button,input,textarea,select") !== null)
                    return;
                const startX = event.clientX;
                const startY = event.clientY;
                let moved = false;
                card.setPointerCapture(event.pointerId);
                const move = (next) => { if (next.pointerId !== event.pointerId)
                    return; const dx = next.clientX - startX; const dy = next.clientY - startY; if (Math.abs(dx) + Math.abs(dy) > 4)
                    moved = true; card.style.left = `${snap(original.x + dx)}px`; card.style.top = `${snap(original.y + dy)}px`; };
                const end = (next) => {
                    if (next.pointerId !== event.pointerId)
                        return;
                    card.removeEventListener("pointermove", move);
                    card.removeEventListener("pointerup", end);
                    card.removeEventListener("pointercancel", end);
                    card.removeEventListener("lostpointercapture", end);
                    if (card.hasPointerCapture(event.pointerId))
                        card.releasePointerCapture(event.pointerId);
                    if (moved && next.type === "pointerup")
                        void this.#savePosition(itemId, snap(original.x + next.clientX - startX), snap(original.y + next.clientY - startY));
                    else {
                        card.style.left = `${original.x}px`;
                        card.style.top = `${original.y}px`;
                    }
                };
                card.addEventListener("pointermove", move);
                card.addEventListener("pointerup", end);
                card.addEventListener("pointercancel", end);
                card.addEventListener("lostpointercapture", end);
            });
        }
        async #create(kind) { const item = newItem(kind, this.#scopeId); await this.#mutate(async (runtime, snapshot) => runtime.repository.put(snapshot, "planning_items", item, 0), `Created ${item.title}.`, item.id); }
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
            const issues = validateItemEdit(snapshot, next);
            if (issues.length) {
                this.#invalid(issues[0]);
                return;
            }
            const revision = this.#drafts.revision(form);
            if (revision === undefined)
                return;
            const saved = await this.#mutate(async (runtime, snapshot) => runtime.repository.saveItem(snapshot, next, revision), "Details saved.", item.id, `planning_items:${item.id}`);
            const current = saved ? this.#snapshot?.items.find(value => value.id === item.id) : undefined;
            if (current && (item.parentId !== current.parentId || item.kind !== current.kind))
                this.#revealItem(current);
        }
        #revealItem(item) {
            this.#scopeId = item.parentId;
            this.#selectedId = item.id;
            this.#targetId = item.kind === "event" || item.kind === "branch" ? item.id : item.parentId ?? undefined;
            this.#targetPending = false;
            this.#invalidTarget = false;
            this.#openCanvas(this.#targetId);
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
            await this.#mutate(runtime => runtime.repository.deleteFlow(snapshot, flow.id), "Flow removed.", selectedId, `planning_flow_links:${flow.id}`);
        }
        async #savePosition(itemId, x, y) { const snapshot = this.#snapshot; if (snapshot === undefined)
            return; await this.#mutate(async (runtime) => runtime.repository.savePosition(snapshot, this.#scopeId, itemId, x, y), "Position saved.", itemId); }
        async #delete(item) { const snapshot = this.#snapshot; if (snapshot === undefined || !confirm(`Delete ${item.title} and its subtree, attached flows and consequences, and incoming planning references? Shared notes will keep their other links.`))
            return; await this.#mutate(async (runtime) => runtime.repository.deleteSubtree(snapshot, item.id), "Planning subtree deleted."); }
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
                if (key.startsWith("new-flow:") || key.startsWith("new-reference:") || snapshot.revisions.has(key))
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
        #acceptCommittedDrafts() { for (const key of this.#committedDrafts)
            this.#drafts.clear(key); this.#committedDrafts.clear(); }
        #syncEdits() {
            const dirty = [...this.#drafts.entries()].some(([key]) => !this.#committedDrafts.has(key));
            this.#contribution?.edits?.set({ dirty, saving: this.#writing, retainOnQueryChange: true });
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
                const snapshot = await runtime.repository.load(request.signal);
                if (this.#runtime !== runtime || request.signal.aborted || !this.isConnected)
                    return false;
                this.#acceptCommittedDrafts();
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
function positionsFor(views, scopeId, items) { const view = views.find((candidate) => candidate.scopeId === scopeId); return new Map(items.map((item, index) => [item.id, view?.positions[item.id] ?? { x: 72 + (index % 3) * 300, y: 72 + Math.floor(index / 3) * 190 }])); }
function orthogonalPath(sourceX, sourceY, targetX, targetY) { const middle = sourceX + (targetX - sourceX) / 2; return `M ${sourceX} ${sourceY} H ${middle} V ${targetY} H ${targetX}`; }
function snap(value) { return Math.max(24, Math.round(value / grid) * grid); }
function subtype(item) { return item.kind === "event" ? item.eventType ?? "event" : item.kind === "branch" ? item.branchType ?? "branch" : item.kind; }
function flowKindOptions(source) { return source.kind === "branch" ? [["continues", "Continues"], ["option", "Option"]] : [["continues", "Continues"]]; }
function flowDescription(snapshot, flow) { const source = snapshot.items.find(item => item.id === flow.sourceId); const target = snapshot.items.find(item => item.id === flow.targetId); return `${source?.title ?? flow.sourceId} → ${target?.title ?? flow.targetId}${flow.label ? `: ${flow.label}` : ""}`; }
function actionButton(document, label, action, style) { const button = document.createElement("button"); button.type = "button"; button.textContent = label; if (style !== undefined)
    button.className = style; button.addEventListener("click", action); return button; }
