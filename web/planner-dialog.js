import { plannerTranslator } from "./planner-catalogs.js";
export function configurePlannerDialog(dialog, close) {
    dialog.dataset["uiDialog"] = "";
    dialog.addEventListener("cancel", event => { event.preventDefault(); close(); });
    dialog.addEventListener("click", event => {
        if (event.target !== dialog)
            return;
        const rect = dialog.getBoundingClientRect();
        if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)
            close();
    });
}
export function plannerShortcuts(document, close, t = plannerTranslator()) {
    const dialog = document.createElement("dialog");
    dialog.className = "dm-planner-dialog dm-planner-shortcuts";
    dialog.setAttribute("aria-label", t("Keyboard shortcuts"));
    const header = document.createElement("header"), title = document.createElement("h2"), button = document.createElement("button");
    title.textContent = t("Keyboard shortcuts");
    button.type = "button";
    button.textContent = t("Close shortcuts");
    button.dataset["viewAction"] = "";
    button.addEventListener("click", close);
    header.append(title, button);
    dialog.append(header);
    const body = document.createElement("div"), note = document.createElement("p"), list = document.createElement("dl");
    body.className = "dm-planner-dialog-body";
    note.textContent = t("These shortcuts work while the canvas is focused. Text fields keep their usual editing shortcuts.");
    for (const [keys, description] of [
        ["Enter / E", t("Edit the selected item")], ["Shift + Enter", t("Open the selected plotline or quest")],
        [t("Shift + click"), t("Add or remove a card or flow from the selection")], ["Ctrl / ⌘ + A", t("Select all cards on this canvas")],
        [t("Arrow keys"), t("Move selected cards; otherwise pan the canvas")], [t("Shift + arrows"), t("Move or pan farther")],
        ["C", t("Connect the selected card to another card")], ["Delete / Backspace", t("Delete the selection after confirmation")],
        ["Ctrl / ⌘ + Z", t("Undo the last deletion in this planner session")], ["+ / − / 0", t("Zoom in, zoom out, or return to 100%")],
        ["F", t("Fit this canvas")], ["Escape", t("Cancel a connection or clear the selection")], ["?", t("Show keyboard shortcuts")],
    ]) {
        const key = document.createElement("dt"), value = document.createElement("dd"), kbd = document.createElement("kbd");
        kbd.textContent = keys;
        key.append(kbd);
        value.textContent = description;
        list.append(key, value);
    }
    body.append(note, list);
    dialog.append(body);
    configurePlannerDialog(dialog, close);
    return dialog;
}
