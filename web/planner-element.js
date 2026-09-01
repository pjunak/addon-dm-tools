import { directChildren, localFlows, newItem, scopeTrail, validatePlanning } from "./planning-model.js";
import { runtimeFor } from "./runtime.js";
export const plannerElementTag = "dm-tools-planner-page";
const cardWidth = 240;
const cardHeight = 132;
const grid = 24;
export function definePlannerElement() {
    if (customElements.get(plannerElementTag) !== undefined)
        return;
    class PlannerElement extends HTMLElement {
        #contribution;
        #runtime;
        #snapshot;
        #scopeId = null;
        #selectedId;
        #busy = false;
        #message = "";
        #messageKind = "status";
        set codexContribution(value) { this.#contribution = value; if (this.isConnected)
            void this.#connect(); }
        connectedCallback() { this.classList.add("dm-tools-planner"); void this.#connect(); }
        disconnectedCallback() { this.#runtime = undefined; }
        async #connect() {
            const contribution = this.#contribution;
            if (contribution === undefined) {
                this.#unavailable("The host did not provide a planner generation.");
                return;
            }
            const runtime = runtimeFor(contribution.addon.generation);
            if (runtime === undefined || runtime.signal.aborted) {
                this.#unavailable("This DM Tools generation is no longer active.");
                return;
            }
            this.#runtime = runtime;
            await this.#reload("Loading story planner…");
        }
        async #reload(loading) {
            const runtime = this.#runtime;
            if (runtime === undefined || this.#busy)
                return;
            this.#busy = true;
            if (loading !== undefined) {
                this.#message = loading;
                this.#messageKind = "status";
            }
            this.#render();
            try {
                this.#snapshot = await runtime.repository.load();
                if (this.#scopeId !== null && !this.#snapshot.items.some((item) => item.id === this.#scopeId))
                    this.#scopeId = null;
                if (this.#selectedId !== undefined && !this.#snapshot.items.some((item) => item.id === this.#selectedId))
                    this.#selectedId = undefined;
                this.#message = "";
            }
            catch (error) {
                this.#fail(error, "Could not load planning data.");
            }
            finally {
                this.#busy = false;
                this.#render();
            }
        }
        #render() {
            const snapshot = this.#snapshot;
            if (snapshot === undefined) {
                if (this.#message !== "")
                    this.replaceChildren(messageBlock(this.ownerDocument, this.#message, this.#messageKind));
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
            const workspace = document.createElement("div");
            workspace.className = "dm-planner-workspace";
            workspace.append(this.#atlas(document), this.#canvas(document, snapshot), this.#inspector(document, snapshot));
            root.append(workspace);
            this.replaceChildren(root);
        }
        #breadcrumbs(document, snapshot) {
            const nav = document.createElement("nav");
            nav.className = "dm-planner-breadcrumbs";
            nav.setAttribute("aria-label", "Planner scope");
            nav.append(actionButton(document, "Campaign", () => { this.#scopeId = null; this.#selectedId = undefined; this.#render(); }, this.#scopeId === null ? "active" : undefined));
            for (const item of scopeTrail(snapshot.items, this.#scopeId))
                nav.append(actionButton(document, item.title, () => { this.#scopeId = item.id; this.#selectedId = undefined; this.#render(); }, item.id === this.#scopeId ? "active" : undefined));
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
            for (const flow of localFlows(snapshot, this.#scopeId)) {
                const source = positions.get(flow.sourceId);
                const target = positions.get(flow.targetId);
                if (source === undefined || target === undefined)
                    continue;
                const path = document.createElementNS(svg.namespaceURI, "path");
                path.setAttribute("d", orthogonalPath(source.x + cardWidth, source.y + cardHeight / 2, target.x, target.y + cardHeight / 2));
                path.classList.add(flow.kind);
                path.setAttribute("aria-label", flow.label || `${flow.sourceId} to ${flow.targetId}`);
                svg.append(path);
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
                card.addEventListener("click", () => { this.#selectedId = item.id; this.#render(); });
                card.addEventListener("dblclick", () => { if (item.kind === "plotline" || item.kind === "quest") {
                    this.#scopeId = item.id;
                    this.#selectedId = undefined;
                    this.#render();
                } });
                card.addEventListener("keydown", (event) => { if (event.key === "Enter" && (item.kind === "plotline" || item.kind === "quest")) {
                    this.#scopeId = item.id;
                    this.#selectedId = undefined;
                    this.#render();
                } });
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
            form.append(textField(document, "Title", "title", selected.title), textArea(document, "Summary", "summary", selected.summary, 3), textArea(document, "Body", "body", selected.body, 7), textField(document, "Tags", "tags", selected.tags.join(", ")));
            const save = actionButton(document, "Save details", () => undefined, "primary");
            save.type = "submit";
            form.append(save);
            aside.append(form);
            if (selected.kind === "plotline" || selected.kind === "quest")
                aside.append(actionButton(document, "Enter this canvas", () => { this.#scopeId = selected.id; this.#selectedId = undefined; this.#render(); }));
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
            const label = document.createElement("input");
            label.placeholder = selected.kind === "branch" ? "Option label" : "Flow label";
            section.append(title, select, label, actionButton(document, "Create flow", () => { if (select.value !== "")
                void this.#createFlow(selected, select.value, label.value); }, "primary"));
            const attached = localFlows(snapshot, this.#scopeId).filter((flow) => flow.sourceId === selected.id || flow.targetId === selected.id);
            for (const flow of attached) {
                const peerId = flow.sourceId === selected.id ? flow.targetId : flow.sourceId;
                const peer = snapshot.items.find((item) => item.id === peerId);
                const row = document.createElement("div");
                row.className = "dm-planner-record-row";
                const description = document.createElement("span");
                description.textContent = `${flow.sourceId === selected.id ? "To" : "From"} ${peer?.title ?? peerId}${flow.label === "" ? "" : `: ${flow.label}`}`;
                row.append(description, actionButton(document, "Remove", () => void this.#deleteRecord("planning_flow_links", flow.id, "Flow removed.", selected.id), "danger"));
                section.append(row);
            }
            return section;
        }
        #annotations(document, snapshot, selected) {
            const section = document.createElement("section");
            const title = document.createElement("h3");
            title.textContent = "Planning annotations";
            section.append(title);
            const referenceTarget = document.createElement("select");
            referenceTarget.append(option(document, "", "Reference another planning item…"));
            for (const target of snapshot.items.filter((item) => item.id !== selected.id))
                referenceTarget.append(option(document, target.id, target.title));
            section.append(referenceTarget, actionButton(document, "Add planning reference", () => { if (referenceTarget.value !== "")
                void this.#addReference(selected, snapshot, referenceTarget.value); }, "primary"));
            for (const reference of snapshot.references.filter((entry) => entry.itemId === selected.id)) {
                const form = document.createElement("form");
                form.className = "dm-planner-annotation";
                form.addEventListener("submit", (event) => { event.preventDefault(); void this.#saveReference(reference, form, selected.id); });
                const relation = selectField(document, "Relation", "relation", reference.relation, [["related", "Related"], ["involves", "Involves"], ["features", "Features"], ["located-at", "Located at"], ["opposes", "Opposes"], ["supports", "Supports"], ["reveals", "Reveals"], ["requires", "Requires"], ["rewards", "Rewards"]]);
                form.append(textField(document, "Reference", "name", reference.name), relation, textArea(document, "Notes", "notes", reference.notes, 2));
                const save = actionButton(document, "Save reference", () => undefined, "primary");
                save.type = "submit";
                form.append(save, actionButton(document, "Delete reference", () => void this.#deleteRecord("planning_references", reference.id, "Reference deleted.", selected.id), "danger"));
                section.append(form);
            }
            section.append(actionButton(document, "Add consequence", () => void this.#addConsequence(selected)));
            for (const consequence of snapshot.consequences.filter((entry) => entry.anchor["scope"] === "item" && entry.anchor["itemId"] === selected.id)) {
                const form = document.createElement("form");
                form.className = "dm-planner-annotation";
                form.addEventListener("submit", (event) => { event.preventDefault(); void this.#saveConsequence(consequence, form, selected.id); });
                form.append(textField(document, "Consequence", "title", consequence.title), selectField(document, "Kind", "kind", consequence.kind, [["world", "World"], ["reward", "Reward"], ["information", "Information"], ["complication", "Complication"]]), textArea(document, "Details", "body", consequence.body, 3));
                const save = actionButton(document, "Save consequence", () => undefined, "primary");
                save.type = "submit";
                form.append(save, actionButton(document, "Delete consequence", () => void this.#deleteRecord("planning_consequences", consequence.id, "Consequence deleted.", selected.id), "danger"));
                section.append(form);
            }
            section.append(actionButton(document, "Add DM note", () => void this.#addNote(selected)));
            for (const note of snapshot.notes.filter((entry) => entry.anchorIds.includes(selected.id))) {
                const form = document.createElement("form");
                form.className = "dm-planner-annotation";
                form.addEventListener("submit", (event) => { event.preventDefault(); void this.#saveNote(note, form, selected.id); });
                form.append(textField(document, "DM note", "title", note.title), textArea(document, "Private details", "body", note.body, 4));
                const save = actionButton(document, "Save note", () => undefined, "primary");
                save.type = "submit";
                form.append(save, actionButton(document, "Delete note", () => void this.#deleteRecord("dm_notes", note.id, "DM note deleted.", selected.id), "danger"));
                section.append(form);
            }
            return section;
        }
        #makeDraggable(card, itemId, original) {
            card.addEventListener("pointerdown", (event) => {
                if (event.button !== 0 || event.target.closest("button,input,textarea,select") !== null)
                    return;
                const startX = event.clientX;
                const startY = event.clientY;
                let moved = false;
                card.setPointerCapture(event.pointerId);
                const move = (next) => { const dx = next.clientX - startX; const dy = next.clientY - startY; if (Math.abs(dx) + Math.abs(dy) > 4)
                    moved = true; card.style.left = `${snap(original.x + dx)}px`; card.style.top = `${snap(original.y + dy)}px`; };
                const end = (next) => { card.removeEventListener("pointermove", move); card.removeEventListener("pointerup", end); card.removeEventListener("pointercancel", end); if (moved)
                    void this.#savePosition(itemId, snap(original.x + next.clientX - startX), snap(original.y + next.clientY - startY)); };
                card.addEventListener("pointermove", move);
                card.addEventListener("pointerup", end);
                card.addEventListener("pointercancel", end);
            });
        }
        async #create(kind) { const item = newItem(kind, this.#scopeId); await this.#mutate(async (runtime) => runtime.repository.put("planning_items", item, 0), `Created ${item.title}.`, item.id); }
        async #saveItem(item, form) {
            const data = new FormData(form);
            const next = { ...item, title: String(data.get("title") ?? "").trim(), summary: String(data.get("summary") ?? "").trim(), body: String(data.get("body") ?? "").trim(), tags: String(data.get("tags") ?? "").split(",").map((tag) => tag.trim()).filter(Boolean).slice(0, 40), updatedAt: Date.now() };
            if (next.title === "") {
                this.#message = "A title is required.";
                this.#messageKind = "alert";
                this.#render();
                return;
            }
            const revision = this.#snapshot?.revisions.get(`planning_items:${item.id}`);
            if (revision === undefined)
                return;
            await this.#mutate(async (runtime) => runtime.repository.put("planning_items", next, revision), "Details saved.", item.id);
        }
        async #createFlow(source, targetId, label) {
            const snapshot = this.#snapshot;
            if (snapshot === undefined)
                return;
            const flow = { id: `flow-${crypto.randomUUID()}`, schemaVersion: 3, sourceId: source.id, targetId, kind: source.kind === "branch" ? "option" : "continues", label: label.trim(), updatedAt: Date.now() };
            const candidate = { ...snapshot, flows: [...snapshot.flows, flow] };
            const issues = validatePlanning(candidate);
            if (issues.length > 0) {
                this.#message = issues[0];
                this.#messageKind = "alert";
                this.#render();
                return;
            }
            await this.#mutate(async (runtime) => runtime.repository.put("planning_flow_links", flow, 0), "Flow created.", source.id);
        }
        async #savePosition(itemId, x, y) { const snapshot = this.#snapshot; if (snapshot === undefined)
            return; await this.#mutate(async (runtime) => runtime.repository.savePosition(snapshot, this.#scopeId, itemId, x, y), "Position saved.", itemId); }
        async #delete(item) { const snapshot = this.#snapshot; if (snapshot === undefined || !confirm(`Delete ${item.title} and every nested planning record?`))
            return; await this.#mutate(async (runtime) => runtime.repository.deleteSubtree(snapshot, item.id), "Planning subtree deleted."); }
        async #addReference(item, snapshot, targetId) {
            const target = snapshot.items.find((candidate) => candidate.id === targetId && candidate.id !== item.id);
            if (target === undefined) {
                this.#message = "Choose an existing planning item to reference.";
                this.#messageKind = "alert";
                this.#render();
                return;
            }
            const reference = { id: `reference-${crypto.randomUUID()}`, schemaVersion: 3, itemId: item.id, name: target.title, relation: "related", target: { scope: "planning", itemId: target.id }, quantity: 1, notes: "", updatedAt: Date.now() };
            await this.#mutate(async (runtime) => runtime.repository.put("planning_references", reference, 0), "Planning reference added.", item.id);
        }
        async #addConsequence(item) { const consequence = { id: `consequence-${crypto.randomUUID()}`, schemaVersion: 3, anchor: { scope: "item", itemId: item.id }, kind: "world", title: "Planned consequence", body: "", updatedAt: Date.now() }; await this.#mutate(async (runtime) => runtime.repository.put("planning_consequences", consequence, 0), "Consequence added.", item.id); }
        async #addNote(item) { const note = { id: `note-${crypto.randomUUID()}`, schemaVersion: 3, title: "DM note", body: "", anchorIds: [item.id], updatedAt: Date.now() }; await this.#mutate(async (runtime) => runtime.repository.put("dm_notes", note, 0), "DM note added.", item.id); }
        async #saveReference(reference, form, selectedId) { const data = new FormData(form); const next = { ...reference, name: String(data.get("name") ?? "").trim(), relation: String(data.get("relation") ?? "related"), notes: String(data.get("notes") ?? "").trim(), updatedAt: Date.now() }; if (next.name === "") {
            this.#invalid("A reference name is required.");
            return;
        } await this.#putExisting("planning_references", next, selectedId, "Reference saved."); }
        async #saveConsequence(consequence, form, selectedId) { const data = new FormData(form); const next = { ...consequence, title: String(data.get("title") ?? "").trim(), kind: String(data.get("kind") ?? "world"), body: String(data.get("body") ?? "").trim(), updatedAt: Date.now() }; if (next.title === "") {
            this.#invalid("A consequence title is required.");
            return;
        } await this.#putExisting("planning_consequences", next, selectedId, "Consequence saved."); }
        async #saveNote(note, form, selectedId) { const data = new FormData(form); const next = { ...note, title: String(data.get("title") ?? "").trim(), body: String(data.get("body") ?? "").trim(), updatedAt: Date.now() }; if (next.title === "") {
            this.#invalid("A DM note title is required.");
            return;
        } await this.#putExisting("dm_notes", next, selectedId, "DM note saved."); }
        async #putExisting(collection, value, selectedId, success) { const revision = this.#snapshot?.revisions.get(`${collection}:${value.id}`); if (revision === undefined) {
            this.#invalid("This record changed or no longer exists. Reload the planner.");
            return;
        } await this.#mutate(async (runtime) => runtime.repository.put(collection, value, revision), success, selectedId); }
        async #deleteRecord(collection, id, success, selectedId) { const revision = this.#snapshot?.revisions.get(`${collection}:${id}`); if (revision === undefined) {
            this.#invalid("This record changed or no longer exists. Reload the planner.");
            return;
        } const mutation = { operation: "delete", kind: "collection", dataId: collection, key: id, expectedRevision: revision }; await this.#mutate(async (runtime) => runtime.repository.transact([mutation]), success, selectedId); }
        #invalid(message) { this.#message = message; this.#messageKind = "alert"; this.#render(); }
        async #mutate(operation, success, selected) {
            const runtime = this.#runtime;
            if (runtime === undefined || this.#busy)
                return;
            this.#busy = true;
            this.#message = "Saving…";
            this.#messageKind = "status";
            this.#render();
            try {
                await operation(runtime);
                this.#selectedId = selected;
                this.#snapshot = await runtime.repository.load();
                this.#message = success;
            }
            catch (error) {
                this.#fail(error, "Planning change failed.");
            }
            finally {
                this.#busy = false;
                this.#render();
            }
        }
        #fail(error, fallback) { this.#message = error instanceof Error && error.message !== "" ? error.message : fallback; this.#messageKind = "alert"; }
        #unavailable(message) { this.replaceChildren(messageBlock(this.ownerDocument, message, "alert")); }
    }
    customElements.define(plannerElementTag, PlannerElement);
}
function positionsFor(views, scopeId, items) { const view = views.find((candidate) => candidate.scopeId === scopeId); return new Map(items.map((item, index) => [item.id, view?.positions[item.id] ?? { x: 72 + (index % 3) * 300, y: 72 + Math.floor(index / 3) * 190 }])); }
function orthogonalPath(sourceX, sourceY, targetX, targetY) { const middle = sourceX + (targetX - sourceX) / 2; return `M ${sourceX} ${sourceY} H ${middle} V ${targetY} H ${targetX}`; }
function snap(value) { return Math.max(24, Math.round(value / grid) * grid); }
function subtype(item) { return item.kind === "event" ? item.eventType ?? "event" : item.kind === "branch" ? item.branchType ?? "branch" : item.kind; }
function actionButton(document, label, action, style) { const button = document.createElement("button"); button.type = "button"; button.textContent = label; if (style !== undefined)
    button.className = style; button.addEventListener("click", action); return button; }
function option(document, value, label) { const item = document.createElement("option"); item.value = value; item.textContent = label; return item; }
function textField(document, label, name, value) { const wrapper = document.createElement("label"); const text = document.createElement("span"); text.textContent = label; const input = document.createElement("input"); input.name = name; input.value = value; wrapper.append(text, input); return wrapper; }
function textArea(document, label, name, value, rows) { const wrapper = document.createElement("label"); const text = document.createElement("span"); text.textContent = label; const input = document.createElement("textarea"); input.name = name; input.value = value; input.rows = rows; wrapper.append(text, input); return wrapper; }
function selectField(document, label, name, value, options) { const wrapper = document.createElement("label"); const text = document.createElement("span"); text.textContent = label; const input = document.createElement("select"); input.name = name; for (const [optionValue, optionLabel] of options) {
    const entry = option(document, optionValue, optionLabel);
    entry.selected = optionValue === value;
    input.append(entry);
} wrapper.append(text, input); return wrapper; }
function messageBlock(document, message, role) { const block = document.createElement("div"); block.className = `dm-tools-message ${role}`; block.setAttribute("role", role); block.textContent = message; return block; }
