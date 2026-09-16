export function option(document, value, label) { const item = document.createElement("option"); item.value = value; item.textContent = label; return item; }
export function textField(document, label, name, value) { const wrapper = document.createElement("label"); wrapper.dataset["uiField"] = ""; wrapper.dataset["uiKey"] = name; const text = document.createElement("span"); text.textContent = label; const input = document.createElement("input"); input.name = name; input.value = value; wrapper.append(text, input); return wrapper; }
export function textArea(document, label, name, value, rows) { const wrapper = document.createElement("label"); wrapper.dataset["uiField"] = ""; wrapper.dataset["uiKey"] = name; const text = document.createElement("span"); text.textContent = label; const input = document.createElement("textarea"); input.name = name; input.value = value; input.rows = rows; wrapper.append(text, input); return wrapper; }
export function selectField(document, label, name, value, options) { const wrapper = document.createElement("div"); wrapper.dataset["uiField"] = ""; wrapper.dataset["uiKey"] = name; const text = document.createElement("label"); text.textContent = label; const input = document.createElement("select"); input.id = `planner-${crypto.randomUUID()}`; text.htmlFor = input.id; input.name = name; if (options.length >= 12)
    input.dataset["ui"] = "combobox"; input.setAttribute("aria-label", label); for (const [optionValue, optionLabel] of options) {
    const entry = option(document, optionValue, optionLabel);
    entry.selected = optionValue === value;
    input.append(entry);
} wrapper.append(text, input); return wrapper; }
export function messageBlock(document, message, role) { const block = document.createElement("div"); block.className = `dm-tools-message ${role}`; block.setAttribute("role", role); block.dataset["uiState"] = role === "alert" ? "error" : "info"; block.textContent = message; return block; }
