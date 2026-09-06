export function noteAnchors(value, items) {
    let ids;
    try {
        ids = JSON.parse(value);
    }
    catch {
        throw new Error("Choose valid planning items for this note.");
    }
    if (!Array.isArray(ids) || ids.length > 100 || new Set(ids).size !== ids.length || ids.some(id => typeof id !== "string" || !items.some(item => item.id === id)))
        throw new Error("Choose up to 100 existing planning items for this note.");
    return ids;
}
/** One hidden value lets the regular draft/revision guard cover the whole anchor set. */
export function appendNoteAnchors(document, form, ids, items) {
    const value = document.createElement("input");
    value.type = "hidden";
    value.name = "anchorIds";
    value.value = JSON.stringify(ids);
    const group = document.createElement("fieldset");
    group.className = "dm-planner-note-anchors";
    const legend = document.createElement("legend");
    legend.textContent = "Linked planning items";
    group.append(legend);
    const choices = document.createElement("div");
    group.append(choices);
    form.append(value, group);
    const refresh = () => {
        const selected = JSON.parse(value.value);
        choices.replaceChildren();
        for (const id of [...new Set([...items.map(item => item.id), ...selected])]) {
            const label = document.createElement("label"), checkbox = document.createElement("input");
            checkbox.type = "checkbox";
            checkbox.value = id;
            checkbox.checked = selected.includes(id);
            label.append(checkbox, document.createTextNode(items.find(item => item.id === id)?.title ?? `Unavailable: ${id}`));
            choices.append(label);
            checkbox.addEventListener("change", () => {
                value.value = JSON.stringify(Array.from(choices.querySelectorAll("input:checked"), input => input.value));
                value.dispatchEvent(new Event("input", { bubbles: true }));
            });
        }
    };
    return refresh;
}
