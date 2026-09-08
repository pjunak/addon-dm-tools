export function configurePlannerDialog(dialog: HTMLDialogElement, close: () => void): void {
  dialog.addEventListener("cancel", event => { event.preventDefault(); close(); });
  dialog.addEventListener("keydown", event => {
    if (event.key !== "Tab") return;
    const controls = [...dialog.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),a[href],summary,[tabindex="0"]')].filter(control => control.tabIndex >= 0 && control.getClientRects().length > 0);
    const index = controls.indexOf(dialog.ownerDocument.activeElement as HTMLElement);
    if (!controls.length) { event.preventDefault(); dialog.focus(); }
    else if (event.shiftKey && index <= 0) { event.preventDefault(); controls.at(-1)!.focus(); }
    else if (!event.shiftKey && (index === -1 || index === controls.length - 1)) { event.preventDefault(); controls[0]!.focus(); }
  });
  dialog.addEventListener("click", event => {
    if (event.target !== dialog) return; const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) close();
  });
}

export function plannerShortcuts(document: Document, close: () => void): HTMLDialogElement {
  const dialog = document.createElement("dialog"); dialog.className = "dm-planner-dialog dm-planner-shortcuts"; dialog.setAttribute("aria-label", "Keyboard shortcuts");
  const header = document.createElement("header"), title = document.createElement("h2"), button = document.createElement("button");
  title.textContent = "Keyboard shortcuts"; button.type = "button"; button.textContent = "Close shortcuts"; button.dataset["viewAction"] = ""; button.addEventListener("click", close);
  header.append(title, button); dialog.append(header);
  const body = document.createElement("div"), note = document.createElement("p"), list = document.createElement("dl"); body.className = "dm-planner-dialog-body";
  note.textContent = "These shortcuts work while the canvas is focused. Text fields keep their usual editing shortcuts.";
  for (const [keys, description] of [
    ["Enter / E", "Edit the selected item"], ["Shift + Enter", "Open the selected plotline or quest"],
    ["Shift + click", "Add or remove a card or flow from the selection"], ["Ctrl / ⌘ + A", "Select all cards on this canvas"],
    ["Arrow keys", "Move selected cards; otherwise pan the canvas"], ["Shift + arrows", "Move or pan farther"],
    ["C", "Connect the selected card to another card"], ["Delete / Backspace", "Delete the selection after confirmation"],
    ["Ctrl / ⌘ + Z", "Undo the last deletion in this planner session"], ["+ / − / 0", "Zoom in, zoom out, or return to 100%"],
    ["F", "Fit this canvas"], ["Escape", "Cancel a connection or clear the selection"], ["?", "Show keyboard shortcuts"],
  ]) { const key = document.createElement("dt"), value = document.createElement("dd"), kbd = document.createElement("kbd"); kbd.textContent = keys!; key.append(kbd); value.textContent = description!; list.append(key, value); }
  body.append(note, list); dialog.append(body); configurePlannerDialog(dialog, close); return dialog;
}
