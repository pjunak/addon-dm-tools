import { plannerLabel } from "./planner-catalogs.js";
import { coreReferences, targetLink } from "./planner-targets.js";
import { configurePlannerDialog } from "./planner-dialog.js";
export function itemAnnotations(dataset, id) {
    const flows = dataset.flows.filter(flow => flow.sourceId === id || flow.targetId === id);
    return {
        flows,
        references: dataset.references.filter(reference => reference.itemId === id),
        consequences: dataset.consequences.filter(value => value.anchor["scope"] === "item" ? value.anchor["itemId"] === id : flows.some(flow => flow.id === value.anchor["flowId"])),
        notes: dataset.notes.filter(note => note.anchorIds.includes(id)),
    };
}
/** Prose is passed to the public host component; this package never parses HTML. */
function markdown(document, source) {
    const element = document.createElement("codex-addon-markdown");
    element.source = source;
    return element;
}
export function planningReader(document, dataset, item, host, addonId, t, actions) {
    const dialog = document.createElement("dialog");
    dialog.className = "dm-planner-dialog dm-planning-reader";
    dialog.setAttribute("aria-label", item.title);
    dialog.dataset["readerItem"] = item.id;
    const header = document.createElement("header"), title = document.createElement("h2");
    title.textContent = item.title;
    title.tabIndex = -1;
    title.autofocus = true;
    const button = (label, action) => { const node = document.createElement("button"); node.type = "button"; node.textContent = label; node.dataset["viewAction"] = ""; node.addEventListener("click", action); return node; };
    const expand = button(t("Expand reader"), () => { const expanded = dialog.classList.toggle("dm-reader-expanded"); expand.textContent = t(expanded ? "Reduce reader" : "Expand reader"); expand.setAttribute("aria-pressed", String(expanded)); });
    expand.setAttribute("aria-pressed", "false");
    header.append(title, button(t("Reload planner"), actions.reload), button(t("Edit item"), actions.edit), expand, button(t("Close reader"), actions.close));
    dialog.append(header);
    const body = document.createElement("div");
    body.className = "dm-planner-dialog-body";
    dialog.append(body);
    if (actions.drafted) {
        const notice = document.createElement("p");
        notice.setAttribute("role", "status");
        notice.textContent = t("Showing saved content. Unsaved planner edits remain in the editor.");
        body.append(notice);
    }
    const section = (label) => { const node = document.createElement("section"), heading = document.createElement("h3"); heading.textContent = label; node.append(heading); body.append(node); return node; };
    const kind = document.createElement("p");
    kind.className = "dm-reader-kind";
    kind.textContent = plannerLabel(item.eventType ?? item.branchType ?? item.kind, t);
    body.append(kind);
    for (const [label, source] of [[t("Summary"), item.summary], [t("Objective"), item.objective], [t("Body"), item.body],
        [item.eventType === "puzzle" ? t("Clues and setup") : item.eventType === "encounter" ? t("Environment and setup") : t("Setup"), item.setup],
        [item.eventType === "puzzle" ? t("Solutions and outcomes") : t("Resolution"), item.resolution]]) {
        if (source.trim())
            section(label).append(markdown(document, source));
    }
    if (item.tags.length) {
        const tags = section(t("Tags")), list = document.createElement("ul");
        for (const tag of item.tags) {
            const row = document.createElement("li");
            row.textContent = tag;
            list.append(row);
        }
        tags.append(list);
    }
    const annotations = itemAnnotations(dataset, item.id), core = coreReferences(host);
    const target = (value) => targetLink(document, value, dataset.items, core, addonId, t);
    if (annotations.references.length) {
        const references = section(t("References"));
        for (const reference of annotations.references) {
            const article = document.createElement("article"), heading = document.createElement("h4"), detail = document.createElement("p");
            heading.textContent = reference.name;
            detail.textContent = `${plannerLabel(reference.relation, t)} · ${reference.quantity}`;
            article.append(heading, target(reference.target), detail, markdown(document, reference.notes));
            references.append(article);
        }
    }
    if (annotations.flows.length) {
        const flows = section(t("Story flow")), list = document.createElement("ul");
        for (const flow of annotations.flows) {
            const row = document.createElement("li");
            row.append(target({ scope: "planning", itemId: flow.sourceId }), " → ", target({ scope: "planning", itemId: flow.targetId }));
            if (flow.label)
                row.append(` · ${flow.label}`);
            list.append(row);
        }
        flows.append(list);
    }
    if (annotations.consequences.length) {
        const consequences = section(t("Consequences"));
        for (const consequence of annotations.consequences) {
            const article = document.createElement("article"), heading = document.createElement("h4");
            heading.textContent = consequence.title;
            article.append(heading, plannerLabel(consequence.kind, t));
            const flow = annotations.flows.find(value => value.id === consequence.anchor["flowId"]);
            if (flow) {
                const anchor = document.createElement("p");
                anchor.append(target({ scope: "planning", itemId: flow.sourceId }), " → ", target({ scope: "planning", itemId: flow.targetId }));
                if (flow.label)
                    anchor.append(` · ${flow.label}`);
                article.append(anchor);
            }
            article.append(markdown(document, consequence.body));
            if (consequence.target)
                article.append(target(consequence.target));
            consequences.append(article);
        }
    }
    if (annotations.notes.length) {
        const notes = section(t("Notes"));
        for (const note of annotations.notes) {
            const article = document.createElement("article"), heading = document.createElement("h4");
            heading.textContent = note.title;
            article.append(heading, markdown(document, note.body));
            notes.append(article);
        }
    }
    if (![item.summary, item.objective, item.body, item.setup, item.resolution].some(value => value.trim())) {
        const empty = document.createElement("p");
        empty.textContent = t("No prose has been added to this item yet.");
        body.append(empty);
    }
    configurePlannerDialog(dialog, actions.close);
    return dialog;
}
