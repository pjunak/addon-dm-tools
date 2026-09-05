import { directChildren, localFlows, newItem, scopeTrail, validatePlanning, type DmNote, type PlanningConsequence, type PlanningDataset, type PlanningFlow, type PlanningItem, type PlanningKind, type PlanningReference, type PlanningView } from "./planning-model.js";
import type { PlanningSnapshot } from "./planning-repository.js";
import { runtimeFor, type DmToolsRuntime } from "./runtime.js";
import type { ContributionContext, DataMutation } from "./sdk.js";
import { plannerLink, plannerSelection, plannerTarget } from "./dashboard-model.js";
import { PlannerDrafts } from "./planner-drafts.js";

export const plannerElementTag = "dm-tools-planner-page";
const cardWidth = 240; const cardHeight = 132; const grid = 24;

export function definePlannerElement(generation?: string): string {
  const tag = generation ? `${plannerElementTag}-${generation}` : plannerElementTag;
  if (customElements.get(tag) !== undefined) return tag;
  class PlannerElement extends HTMLElement {
    #contribution: ContributionContext | undefined; #runtime: DmToolsRuntime | undefined; #snapshot: PlanningSnapshot | undefined;
    #scopeId: string | null = null; #selectedId: string | undefined; #busy = false; #message = ""; #messageKind: "status" | "alert" = "status";
    #targetId: string | undefined; #targetPending = false; #readRequest: AbortController | undefined;
    #drafts = new PlannerDrafts(); #committedDrafts = new Set<string>(); #needsReload = false;

    set codexContribution(value: ContributionContext) {
      const previous = this.#contribution; this.#contribution = value;
      if (!this.isConnected) return;
      if (previous?.addon.generation !== value.addon.generation || !this.#runtime) { void this.#connect(); return; }
      try {
        const target = plannerTarget(value.host);
        if (target !== this.#targetId) { this.#targetId = target; this.#targetPending = true; if (!this.#busy && this.#snapshot) { this.#applyTarget(); this.#render(); } }
      } catch (error) { this.#invalidLink(error); }
    }
    connectedCallback(): void { this.classList.add("dm-tools-planner"); void this.#connect(); }
    disconnectedCallback(): void { this.#readRequest?.abort(); this.#readRequest = undefined; this.#runtime = undefined; }

    async #connect(): Promise<void> {
      const contribution = this.#contribution; if (contribution === undefined) { this.#unavailable("The host did not provide a planner generation."); return; }
      const runtime = runtimeFor(contribution.addon.generation); if (runtime === undefined || runtime.signal.aborted) { this.#unavailable("This DM Tools generation is no longer active."); return; }
      try { this.#targetId = plannerTarget(contribution.host); }
      catch (error) { this.#invalidLink(error); return; }
      this.#readRequest?.abort(); this.#busy = false; this.#snapshot = undefined; this.#targetPending = true;
      this.#drafts.clearAll(); this.#committedDrafts.clear(); this.#needsReload = false;
      this.#runtime = runtime; await this.#reload("Loading story planner…");
    }

    async #reload(loading?: string): Promise<void> {
      const runtime = this.#runtime; if (runtime === undefined || this.#busy) return;
      const request = new AbortController(); this.#readRequest?.abort(); this.#readRequest = request;
      this.#busy = true; if (loading !== undefined) { this.#message = loading; this.#messageKind = "status"; } this.#render();
      try {
        const snapshot = await runtime.repository.load(request.signal);
        if (this.#runtime !== runtime || this.#readRequest !== request || request.signal.aborted || !this.isConnected) return;
        this.#snapshot = snapshot;
        this.#acceptCommittedDrafts(); this.#needsReload = false;
        if (this.#scopeId !== null && !this.#snapshot.items.some((item) => item.id === this.#scopeId)) this.#scopeId = null;
        if (this.#selectedId !== undefined && !this.#snapshot.items.some((item) => item.id === this.#selectedId)) this.#selectedId = undefined;
        this.#message = "";
        if (this.#targetPending) this.#applyTarget();
      } catch (error) { if (!request.signal.aborted && this.#runtime === runtime) { this.#needsReload = true; this.#fail(error, "Could not load planning data."); } }
      finally { if (this.#runtime === runtime && this.#readRequest === request && !request.signal.aborted && this.isConnected) { this.#busy = false; this.#render(); } }
    }

    #applyTarget(): void {
      this.#targetPending = false; if (!this.#snapshot) return;
      try { const selection = plannerSelection(this.#snapshot.items, this.#targetId); this.#scopeId = selection.scopeId; this.#selectedId = selection.selectedId; this.#message = ""; }
      catch (error) { this.#scopeId = null; this.#selectedId = undefined; this.#fail(error, "This planning item no longer exists."); }
    }
    #invalidLink(error: unknown): void {
      this.#readRequest?.abort(); this.#runtime = undefined;
      this.#unavailable(error instanceof Error ? error.message : "Invalid planner link.");
    }
    #openCanvas(id?: string): void {
      const addonId = this.#contribution?.addon.id; if (!addonId) return;
      this.ownerDocument.defaultView!.location.hash = plannerLink(addonId, id);
    }

    #render(): void {
      const snapshot = this.#snapshot;
      if (snapshot === undefined) {
        this.replaceChildren(messageBlock(this.ownerDocument, this.#message, this.#messageKind));
        if (!this.#busy) this.append(actionButton(this.ownerDocument, "Reload planner", () => void this.#reload("Loading story planner…")));
        return;
      }
      const document = this.ownerDocument; const root = document.createElement("section"); root.className = "dm-planner-shell";
      const header = document.createElement("header"); const heading = document.createElement("div"); const title = document.createElement("h1"); title.textContent = "Story Planner"; const subtitle = document.createElement("p"); subtitle.textContent = "An editable tree of local story-flow canvases."; heading.append(title, subtitle); header.append(heading, this.#breadcrumbs(document, snapshot)); root.append(header);
      if (this.#message !== "") root.append(messageBlock(document, this.#message, this.#messageKind));
      const refresh = actionButton(document, "Reload planner", () => void this.#reload("Reloading planning data…")); refresh.dataset["viewAction"] = ""; refresh.className = "dm-planner-refresh"; header.append(refresh);
      if (this.#needsReload) root.append(messageBlock(document, "Reload the planner before making another change. Your edits are retained; review the saved data before retrying.", "alert"));
      this.#removedDrafts(document, root, snapshot);
      const workspace = document.createElement("div"); workspace.className = "dm-planner-workspace";
      workspace.append(this.#atlas(document), this.#canvas(document, snapshot), this.#inspector(document, snapshot)); root.append(workspace); this.replaceChildren(root);
      root.setAttribute("aria-busy", String(this.#busy));
      for (const control of root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("input,textarea,select")) {
        control.disabled = this.#busy || (this.#needsReload && control.tagName === "SELECT");
        if (control.tagName !== "SELECT") (control as HTMLInputElement | HTMLTextAreaElement).readOnly = this.#needsReload;
      }
      for (const button of root.querySelectorAll("button")) button.disabled = this.#busy || (this.#needsReload && !button.hasAttribute("data-view-action"));
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
      const help = document.createElement("p"); help.textContent = "Drag cards to arrange. Select a card to edit it or connect it to a sibling. Double-click a plotline or quest to enter its canvas."; aside.append(help); return aside;
    }

    #canvas(document: Document, snapshot: PlanningSnapshot): HTMLElement {
      const viewport = document.createElement("div"); viewport.className = "dm-planner-viewport"; const stage = document.createElement("div"); stage.className = "dm-planner-stage";
      const children = directChildren(snapshot.items, this.#scopeId); const positions = positionsFor(snapshot.views, this.#scopeId, children);
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg"); svg.classList.add("dm-planner-flows"); svg.setAttribute("aria-label", "Story flow");
      for (const flow of localFlows(snapshot, this.#scopeId)) {
        const source = positions.get(flow.sourceId); const target = positions.get(flow.targetId); if (source === undefined || target === undefined) continue;
        const path = document.createElementNS(svg.namespaceURI, "path"); path.setAttribute("d", orthogonalPath(source.x + cardWidth, source.y + cardHeight / 2, target.x, target.y + cardHeight / 2)); path.classList.add(flow.kind); path.setAttribute("aria-label", flow.label || `${flow.sourceId} to ${flow.targetId}`); svg.append(path);
      }
      stage.append(svg);
      for (const item of children) {
        const position = positions.get(item.id) as { x: number; y: number }; const card = document.createElement("article"); card.className = `dm-plan-card ${item.kind}${item.id === this.#selectedId ? " selected" : ""}`; card.dataset["itemId"] = item.id; card.style.left = `${position.x}px`; card.style.top = `${position.y}px`; card.tabIndex = 0;
        const kind = document.createElement("span"); kind.className = "kind"; kind.textContent = subtype(item); const title = document.createElement("h3"); title.textContent = item.title; const summary = document.createElement("p"); summary.textContent = item.summary || "Needs details";
        card.append(kind, title, summary); card.addEventListener("click", () => { if (!this.#busy && this.#selectedId !== item.id) { this.#selectedId = item.id; this.#render(); } }); card.addEventListener("dblclick", () => { if (!this.#busy && (item.kind === "plotline" || item.kind === "quest")) this.#openCanvas(item.id); });
        card.addEventListener("keydown", (event) => {
          if (this.#busy || (event.key !== "Enter" && event.key !== " ")) return;
          event.preventDefault();
          if (event.key === "Enter" && (item.kind === "plotline" || item.kind === "quest")) this.#openCanvas(item.id);
          else { this.#selectedId = item.id; this.#render(); }
        });
        this.#makeDraggable(card, item.id, position); stage.append(card);
      }
      if (children.length === 0) { const empty = messageBlock(document, "This canvas is empty. Add a planning item from the Atlas.", "status"); empty.classList.add("empty"); stage.append(empty); }
      viewport.append(stage); return viewport;
    }

    #inspector(document: Document, snapshot: PlanningSnapshot): HTMLElement {
      const aside = document.createElement("aside"); aside.className = "dm-planner-inspector"; const title = document.createElement("h2"); title.textContent = "Inspector"; aside.append(title);
      const selected = snapshot.items.find((item) => item.id === this.#selectedId); if (selected === undefined) { const hint = document.createElement("p"); hint.textContent = "Select a card to edit details, manage flow, or add planning annotations."; aside.append(hint); return aside; }
      const form = document.createElement("form"); form.addEventListener("submit", (event) => { event.preventDefault(); void this.#saveItem(selected, form); });
      form.setAttribute("aria-label", "Planning item details");
      if (selected.kind === "event") form.append(selectField(document, "Event type", "eventType", selected.eventType ?? "story", [["story", "Story"], ["encounter", "Encounter"], ["puzzle", "Puzzle"]]));
      if (selected.kind === "branch") form.append(selectField(document, "Branch type", "branchType", selected.branchType ?? "decision", [["decision", "Decision"], ["condition", "Condition"], ["random", "Random"]]));
      form.append(textField(document, "Title", "title", selected.title), textArea(document, "Summary", "summary", selected.summary, 3), textArea(document, "Objective", "objective", selected.objective, 3), textArea(document, "Body", "body", selected.body, 7), textArea(document, "Setup", "setup", selected.setup, 5), textArea(document, "Resolution", "resolution", selected.resolution, 5), textField(document, "Tags", "tags", selected.tags.join(", ")));
      for (const [name, limit] of Object.entries({ title: 160, summary: 2000, objective: 10000, body: 80000, setup: 30000, resolution: 30000, tags: 2440 })) form.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[name="${name}"]`)!.maxLength = limit;
      this.#bindDraft(form, `planning_items:${selected.id}`, snapshot.revisions.get(`planning_items:${selected.id}`));
      const save = actionButton(document, "Save details", () => undefined, "primary"); save.type = "submit"; form.append(save); aside.append(form);
      if (selected.kind === "plotline" || selected.kind === "quest") aside.append(actionButton(document, "Enter this canvas", () => this.#openCanvas(selected.id)));
      aside.append(this.#flowEditor(document, snapshot, selected));
      aside.append(this.#annotations(document, snapshot, selected));
      aside.append(actionButton(document, "Delete item and subtree", () => void this.#delete(selected), "danger")); return aside;
    }

    #flowEditor(document: Document, snapshot: PlanningSnapshot, selected: PlanningItem): HTMLElement {
      const section = document.createElement("section"); const title = document.createElement("h3"); title.textContent = "Story flow"; const select = document.createElement("select"); select.append(option(document, "", "Connect to sibling…"));
      for (const sibling of directChildren(snapshot.items, this.#scopeId).filter((item) => item.id !== selected.id)) select.append(option(document, sibling.id, sibling.title));
      const form = document.createElement("form"); select.name = "targetId"; select.setAttribute("aria-label", "Flow target");
      form.append(select, textField(document, "Flow label", "label", "")); form.querySelector<HTMLInputElement>("input")!.maxLength = 200;
      const create = actionButton(document, "Create flow", () => undefined, "primary"); create.type = "submit"; form.append(create);
      this.#bindDraft(form, `new-flow:${selected.id}`, 0);
      form.addEventListener("submit", event => { event.preventDefault(); if (select.value !== "") void this.#createFlow(selected, select.value, String(new FormData(form).get("label") ?? "")); }); section.append(title, form);
      const attached = localFlows(snapshot, this.#scopeId).filter((flow) => flow.sourceId === selected.id || flow.targetId === selected.id);
      for (const flow of attached) {
        const peerId = flow.sourceId === selected.id ? flow.targetId : flow.sourceId; const peer = snapshot.items.find((item) => item.id === peerId);
        const row = document.createElement("div"); row.className = "dm-planner-record-row"; const description = document.createElement("span"); description.textContent = `${flow.sourceId === selected.id ? "To" : "From"} ${peer?.title ?? peerId}${flow.label === "" ? "" : `: ${flow.label}`}`;
        row.append(description, actionButton(document, "Remove", () => void this.#deleteRecord("planning_flow_links", flow.id, "Flow removed.", selected.id), "danger")); section.append(row);
      }
      return section;
    }

    #annotations(document: Document, snapshot: PlanningSnapshot, selected: PlanningItem): HTMLElement {
      const section = document.createElement("section"); const title = document.createElement("h3"); title.textContent = "Planning annotations"; section.append(title);
      const referenceTarget = document.createElement("select"); referenceTarget.append(option(document, "", "Reference another planning item…"));
      for (const target of snapshot.items.filter((item) => item.id !== selected.id)) referenceTarget.append(option(document, target.id, target.title));
      section.append(referenceTarget, actionButton(document, "Add planning reference", () => { if (referenceTarget.value !== "") void this.#addReference(selected, snapshot, referenceTarget.value); }, "primary"));
      for (const reference of snapshot.references.filter((entry) => entry.itemId === selected.id)) {
        const form = document.createElement("form"); form.className = "dm-planner-annotation"; form.addEventListener("submit", (event) => { event.preventDefault(); void this.#saveReference(reference, form, selected.id); });
        const relation = selectField(document, "Relation", "relation", reference.relation, [["related", "Related"], ["involves", "Involves"], ["features", "Features"], ["located-at", "Located at"], ["opposes", "Opposes"], ["supports", "Supports"], ["reveals", "Reveals"], ["requires", "Requires"], ["rewards", "Rewards"]]);
        form.append(textField(document, "Reference", "name", reference.name), relation, textArea(document, "Notes", "notes", reference.notes, 2)); const save = actionButton(document, "Save reference", () => undefined, "primary"); save.type = "submit"; form.append(save, actionButton(document, "Delete reference", () => void this.#deleteRecord("planning_references", reference.id, "Reference deleted.", selected.id), "danger")); section.append(form);
        this.#bindDraft(form, `planning_references:${reference.id}`, snapshot.revisions.get(`planning_references:${reference.id}`));
      }
      section.append(actionButton(document, "Add consequence", () => void this.#addConsequence(selected)));
      for (const consequence of snapshot.consequences.filter((entry) => entry.anchor["scope"] === "item" && entry.anchor["itemId"] === selected.id)) {
        const form = document.createElement("form"); form.className = "dm-planner-annotation"; form.addEventListener("submit", (event) => { event.preventDefault(); void this.#saveConsequence(consequence, form, selected.id); });
        form.append(textField(document, "Consequence", "title", consequence.title), selectField(document, "Kind", "kind", consequence.kind, [["world", "World"], ["reward", "Reward"], ["information", "Information"], ["complication", "Complication"]]), textArea(document, "Details", "body", consequence.body, 3)); const save = actionButton(document, "Save consequence", () => undefined, "primary"); save.type = "submit"; form.append(save, actionButton(document, "Delete consequence", () => void this.#deleteRecord("planning_consequences", consequence.id, "Consequence deleted.", selected.id), "danger")); section.append(form);
        this.#bindDraft(form, `planning_consequences:${consequence.id}`, snapshot.revisions.get(`planning_consequences:${consequence.id}`));
      }
      section.append(actionButton(document, "Add DM note", () => void this.#addNote(selected)));
      for (const note of snapshot.notes.filter((entry) => entry.anchorIds.includes(selected.id))) {
        const form = document.createElement("form"); form.className = "dm-planner-annotation"; form.addEventListener("submit", (event) => { event.preventDefault(); void this.#saveNote(note, form, selected.id); });
        form.append(textField(document, "DM note", "title", note.title), textArea(document, "Private details", "body", note.body, 4)); const save = actionButton(document, "Save note", () => undefined, "primary"); save.type = "submit"; form.append(save, actionButton(document, "Delete note", () => void this.#deleteRecord("dm_notes", note.id, "DM note deleted.", selected.id), "danger")); section.append(form);
        this.#bindDraft(form, `dm_notes:${note.id}`, snapshot.revisions.get(`dm_notes:${note.id}`));
      }
      return section;
    }

    #makeDraggable(card: HTMLElement, itemId: string, original: { x: number; y: number }): void {
      card.addEventListener("pointerdown", (event) => {
        if (this.#busy || this.#needsReload || event.button !== 0 || (event.target as Element).closest("button,input,textarea,select") !== null) return;
        const startX = event.clientX; const startY = event.clientY; let moved = false; card.setPointerCapture(event.pointerId);
        const move = (next: PointerEvent): void => { if (next.pointerId !== event.pointerId) return; const dx = next.clientX - startX; const dy = next.clientY - startY; if (Math.abs(dx) + Math.abs(dy) > 4) moved = true; card.style.left = `${snap(original.x + dx)}px`; card.style.top = `${snap(original.y + dy)}px`; };
        const end = (next: PointerEvent): void => {
          if (next.pointerId !== event.pointerId) return;
          card.removeEventListener("pointermove", move); card.removeEventListener("pointerup", end); card.removeEventListener("pointercancel", end); card.removeEventListener("lostpointercapture", end);
          if (card.hasPointerCapture(event.pointerId)) card.releasePointerCapture(event.pointerId);
          if (moved && next.type === "pointerup") void this.#savePosition(itemId, snap(original.x + next.clientX - startX), snap(original.y + next.clientY - startY));
          else { card.style.left = `${original.x}px`; card.style.top = `${original.y}px`; }
        };
        card.addEventListener("pointermove", move); card.addEventListener("pointerup", end); card.addEventListener("pointercancel", end); card.addEventListener("lostpointercapture", end);
      });
    }

    async #create(kind: PlanningKind): Promise<void> { const item = newItem(kind, this.#scopeId); await this.#mutate(async (runtime) => runtime.repository.put("planning_items", item, 0), `Created ${item.title}.`, item.id); }
    async #saveItem(item: PlanningItem, form: HTMLFormElement): Promise<void> {
      const data = new FormData(form); const text = (name: string): string => String(data.get(name) ?? "").trim();
      const tags = [...new Set(text("tags").split(",").map(tag => tag.trim()).filter(Boolean))];
      if (tags.length > 40 || tags.some(tag => tag.length > 60)) { this.#invalid("Use up to 40 tags, with at most 60 characters each."); return; }
      const next: PlanningItem = { ...item, title: text("title"), summary: text("summary"), objective: text("objective"), body: text("body"), setup: text("setup"), resolution: text("resolution"), tags, updatedAt: Date.now(),
        ...(item.kind === "event" ? { eventType: text("eventType") as NonNullable<PlanningItem["eventType"]> } : {}),
        ...(item.kind === "branch" ? { branchType: text("branchType") as NonNullable<PlanningItem["branchType"]> } : {}) };
      if (next.title === "") { this.#message = "A title is required."; this.#messageKind = "alert"; this.#render(); return; }
      const revision = this.#drafts.revision(form); if (revision === undefined) return;
      await this.#mutate(async (runtime) => runtime.repository.put("planning_items", next, revision), "Details saved.", item.id, `planning_items:${item.id}`);
    }
    async #createFlow(source: PlanningItem, targetId: string, label: string): Promise<void> {
      const snapshot = this.#snapshot; if (snapshot === undefined) return; const flow: PlanningFlow = { id: `flow-${crypto.randomUUID()}`, schemaVersion: 3, sourceId: source.id, targetId, kind: source.kind === "branch" ? "option" : "continues", label: label.trim(), updatedAt: Date.now() };
      const candidate: PlanningDataset = { ...snapshot, flows: [...snapshot.flows, flow] }; const issues = validatePlanning(candidate); if (issues.length > 0) { this.#message = issues[0] as string; this.#messageKind = "alert"; this.#render(); return; }
      await this.#mutate(async (runtime) => runtime.repository.put("planning_flow_links", flow, 0), "Flow created.", source.id, `new-flow:${source.id}`);
    }
    async #savePosition(itemId: string, x: number, y: number): Promise<void> { const snapshot = this.#snapshot; if (snapshot === undefined) return; await this.#mutate(async (runtime) => runtime.repository.savePosition(snapshot, this.#scopeId, itemId, x, y), "Position saved.", itemId); }
    async #delete(item: PlanningItem): Promise<void> { const snapshot = this.#snapshot; if (snapshot === undefined || !confirm(`Delete ${item.title} and every nested planning record?`)) return; await this.#mutate(async (runtime) => runtime.repository.deleteSubtree(snapshot, item.id), "Planning subtree deleted."); }
    async #addReference(item: PlanningItem, snapshot: PlanningSnapshot, targetId: string): Promise<void> {
      const target = snapshot.items.find((candidate) => candidate.id === targetId && candidate.id !== item.id); if (target === undefined) { this.#message = "Choose an existing planning item to reference."; this.#messageKind = "alert"; this.#render(); return; }
      const reference: PlanningReference = { id: `reference-${crypto.randomUUID()}`, schemaVersion: 3, itemId: item.id, name: target.title, relation: "related", target: { scope: "planning", itemId: target.id }, quantity: 1, notes: "", updatedAt: Date.now() };
      await this.#mutate(async (runtime) => runtime.repository.put("planning_references", reference, 0), "Planning reference added.", item.id);
    }
    async #addConsequence(item: PlanningItem): Promise<void> { const consequence: PlanningConsequence = { id: `consequence-${crypto.randomUUID()}`, schemaVersion: 3, anchor: { scope: "item", itemId: item.id }, kind: "world", title: "Planned consequence", body: "", updatedAt: Date.now() }; await this.#mutate(async (runtime) => runtime.repository.put("planning_consequences", consequence, 0), "Consequence added.", item.id); }
    async #addNote(item: PlanningItem): Promise<void> { const note: DmNote = { id: `note-${crypto.randomUUID()}`, schemaVersion: 3, title: "DM note", body: "", anchorIds: [item.id], updatedAt: Date.now() }; await this.#mutate(async (runtime) => runtime.repository.put("dm_notes", note, 0), "DM note added.", item.id); }
    async #saveReference(reference: PlanningReference, form: HTMLFormElement, selectedId: string): Promise<void> { const data = new FormData(form); const next: PlanningReference = { ...reference, name: String(data.get("name") ?? "").trim(), relation: String(data.get("relation") ?? "related"), notes: String(data.get("notes") ?? "").trim(), updatedAt: Date.now() }; if (next.name === "") { this.#invalid("A reference name is required."); return; } await this.#putExisting("planning_references", next, form, selectedId, "Reference saved."); }
    async #saveConsequence(consequence: PlanningConsequence, form: HTMLFormElement, selectedId: string): Promise<void> { const data = new FormData(form); const next: PlanningConsequence = { ...consequence, title: String(data.get("title") ?? "").trim(), kind: String(data.get("kind") ?? "world") as PlanningConsequence["kind"], body: String(data.get("body") ?? "").trim(), updatedAt: Date.now() }; if (next.title === "") { this.#invalid("A consequence title is required."); return; } await this.#putExisting("planning_consequences", next, form, selectedId, "Consequence saved."); }
    async #saveNote(note: DmNote, form: HTMLFormElement, selectedId: string): Promise<void> { const data = new FormData(form); const next: DmNote = { ...note, title: String(data.get("title") ?? "").trim(), body: String(data.get("body") ?? "").trim(), updatedAt: Date.now() }; if (next.title === "") { this.#invalid("A DM note title is required."); return; } await this.#putExisting("dm_notes", next, form, selectedId, "DM note saved."); }
    async #putExisting(collection: "planning_references" | "planning_consequences" | "dm_notes", value: PlanningReference | PlanningConsequence | DmNote, form: HTMLFormElement, selectedId: string, success: string): Promise<void> {
      const revision = this.#drafts.revision(form); if (revision === undefined) { this.#invalid("This record changed or no longer exists. Reload the planner."); return; }
      await this.#mutate(async (runtime) => runtime.repository.put(collection, value, revision), success, selectedId, `${collection}:${value.id}`);
    }
    async #deleteRecord(collection: string, id: string, success: string, selectedId: string): Promise<void> { const revision = this.#snapshot?.revisions.get(`${collection}:${id}`); if (revision === undefined) { this.#invalid("This record changed or no longer exists. Reload the planner."); return; } const mutation: DataMutation = { operation: "delete", kind: "collection", dataId: collection, key: id, expectedRevision: revision }; await this.#mutate(async (runtime) => runtime.repository.transact([mutation]), success, selectedId, `${collection}:${id}`); }
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
        if (key.startsWith("new-flow:") || snapshot.revisions.has(key)) continue;
        const details = document.createElement("details"); const title = document.createElement("summary");
        title.textContent = `Unsaved edits to a removed record: ${draft.values["title"] || draft.values["name"] || "Planning record"}`;
        const content = document.createElement("pre"); content.textContent = Object.entries(draft.values).map(([field, value]) => `${field}: ${value}`).join("\n\n");
        const discard = actionButton(document, "Discard removed record edits", () => { this.#drafts.clear(key); this.#render(); }); discard.dataset["viewAction"] = "";
        details.className = "dm-planner-removed-draft"; details.append(title, content, discard); root.append(details);
      }
    }

    #acceptCommittedDrafts(): void { for (const key of this.#committedDrafts) this.#drafts.clear(key); this.#committedDrafts.clear(); }

    async #mutate(operation: (runtime: DmToolsRuntime) => Promise<unknown>, success: string, selected?: string, draftKey?: string): Promise<void> {
      const runtime = this.#runtime; if (runtime === undefined || this.#busy || this.#needsReload) return; this.#busy = true; this.#message = "Saving…"; this.#messageKind = "status"; this.#render();
      try {
        await operation(runtime); if (this.#runtime !== runtime || !this.isConnected) return;
        // A confirmed write must not be offered again if the following read fails.
        if (draftKey) this.#committedDrafts.add(draftKey);
        const request = new AbortController(); this.#readRequest?.abort(); this.#readRequest = request;
        const snapshot = await runtime.repository.load(request.signal); if (this.#runtime !== runtime || request.signal.aborted || !this.isConnected) return;
        this.#acceptCommittedDrafts();
        this.#selectedId = selected; this.#snapshot = snapshot; this.#message = success; if (this.#targetPending) this.#applyTarget();
      } catch (error) { if (this.#runtime === runtime && this.isConnected) { this.#needsReload = true; this.#fail(error, "Planning change failed."); } }
      finally { if (this.#runtime === runtime && this.isConnected) { this.#busy = false; this.#render(); } }
    }
    #fail(error: unknown, fallback: string): void { this.#message = error instanceof Error && error.message !== "" ? error.message : fallback; this.#messageKind = "alert"; }
    #unavailable(message: string): void { this.replaceChildren(messageBlock(this.ownerDocument, message, "alert")); const link = this.ownerDocument.createElement("a"); link.textContent = "Open campaign canvas"; link.href = plannerLink(this.#contribution?.addon.id ?? "dm-tools"); this.append(link); }
  }
  customElements.define(tag, PlannerElement); return tag;
}

function positionsFor(views: readonly PlanningView[], scopeId: string | null, items: readonly PlanningItem[]): Map<string, { x: number; y: number }> { const view = views.find((candidate) => candidate.scopeId === scopeId); return new Map(items.map((item, index) => [item.id, view?.positions[item.id] ?? { x: 72 + (index % 3) * 300, y: 72 + Math.floor(index / 3) * 190 }])); }
function orthogonalPath(sourceX: number, sourceY: number, targetX: number, targetY: number): string { const middle = sourceX + (targetX - sourceX) / 2; return `M ${sourceX} ${sourceY} H ${middle} V ${targetY} H ${targetX}`; }
function snap(value: number): number { return Math.max(24, Math.round(value / grid) * grid); }
function subtype(item: PlanningItem): string { return item.kind === "event" ? item.eventType ?? "event" : item.kind === "branch" ? item.branchType ?? "branch" : item.kind; }
function actionButton(document: Document, label: string, action: () => void, style?: string): HTMLButtonElement { const button = document.createElement("button"); button.type = "button"; button.textContent = label; if (style !== undefined) button.className = style; button.addEventListener("click", action); return button; }
function option(document: Document, value: string, label: string): HTMLOptionElement { const item = document.createElement("option"); item.value = value; item.textContent = label; return item; }
function textField(document: Document, label: string, name: string, value: string): HTMLLabelElement { const wrapper = document.createElement("label"); const text = document.createElement("span"); text.textContent = label; const input = document.createElement("input"); input.name = name; input.value = value; wrapper.append(text, input); return wrapper; }
function textArea(document: Document, label: string, name: string, value: string, rows: number): HTMLLabelElement { const wrapper = document.createElement("label"); const text = document.createElement("span"); text.textContent = label; const input = document.createElement("textarea"); input.name = name; input.value = value; input.rows = rows; wrapper.append(text, input); return wrapper; }
function selectField(document: Document, label: string, name: string, value: string, options: readonly (readonly [string, string])[]): HTMLLabelElement { const wrapper = document.createElement("label"); const text = document.createElement("span"); text.textContent = label; const input = document.createElement("select"); input.name = name; input.setAttribute("aria-label", label); for (const [optionValue, optionLabel] of options) { const entry = option(document, optionValue, optionLabel); entry.selected = optionValue === value; input.append(entry); } wrapper.append(text, input); return wrapper; }
function messageBlock(document: Document, message: string, role: "status" | "alert"): HTMLElement { const block = document.createElement("div"); block.className = `dm-tools-message ${role}`; block.setAttribute("role", role); block.textContent = message; return block; }
