export function option(document: Document, value: string, label: string): HTMLOptionElement {
  const item = document.createElement("option");
  item.value = value;
  item.textContent = label;
  return item;
}
export function textField(
  document: Document,
  label: string,
  name: string,
  value: string,
  maxLength?: number,
  hint?: string,
): HTMLLabelElement {
  const wrapper = document.createElement("label");
  wrapper.dataset["uiField"] = "";
  wrapper.dataset["uiKey"] = name;
  const text = document.createElement("span");
  text.textContent = label;
  const input = document.createElement("input");
  input.name = name;
  input.value = value;
  if (maxLength !== undefined) input.maxLength = maxLength;
  wrapper.append(text, input);
  if (hint) wrapper.append(fieldHelp(document, hint));
  return wrapper;
}
export function fieldHelp(document: Document, text: string): HTMLElement {
  const help = document.createElement("small");
  help.className = "dm-form-help";
  help.dataset["uiHelp"] = "";
  help.textContent = text;
  return help;
}
/** Two to four short choices as joined buttons over radios (the host's `choices` style). */
export function choiceField(
  document: Document,
  label: string,
  name: string,
  value: string,
  options: readonly (readonly [string, string])[],
): HTMLFieldSetElement {
  const wrapper = document.createElement("fieldset");
  wrapper.dataset["ui"] = "choices";
  wrapper.dataset["uiKey"] = name;
  const legend = document.createElement("legend");
  legend.textContent = label;
  wrapper.append(legend);
  for (const [optionValue, optionLabel] of options) {
    const choice = document.createElement("label");
    const input = document.createElement("input");
    input.type = "radio";
    input.name = name;
    input.value = optionValue;
    input.checked = optionValue === value;
    choice.append(input, document.createTextNode(optionLabel));
    wrapper.append(choice);
  }
  return wrapper;
}
/** The checked radio's value in a choice field, or "" when none is checked. */
export function choiceValue(root: ParentNode, name: string): string {
  return root.querySelector<HTMLInputElement>(`input[name="${name}"]:checked`)?.value ?? "";
}
/** Fields shown because of a choice above them; `because` names that choice. */
export function dependentGroup(
  document: Document,
  because: string,
  ...children: HTMLElement[]
): HTMLDivElement {
  const group = document.createElement("div");
  group.className = "dm-form-depends";
  const why = document.createElement("p");
  why.className = "dm-form-depends-why";
  why.textContent = `↳ ${because}`;
  group.append(why, ...children);
  return group;
}
/** A titled section of the item editor; the section bar links each one. */
export function formSection(
  document: Document,
  id: string,
  label: string,
  ...children: HTMLElement[]
): HTMLElement {
  const section = document.createElement("section");
  section.className = "dm-form-section";
  section.dataset["formSection"] = id;
  const heading = document.createElement("h3");
  heading.id = `planner-section-${crypto.randomUUID()}`;
  heading.tabIndex = -1;
  heading.textContent = label;
  section.setAttribute("aria-labelledby", heading.id);
  section.append(heading, ...children);
  return section;
}
/** A status chip beside the editor's title. */
export function formChip(document: Document, text: string, tone: "" | "accent" = ""): HTMLElement {
  const chip = document.createElement("span");
  chip.className = "dm-form-chip";
  if (tone) chip.dataset["tone"] = tone;
  chip.textContent = text;
  return chip;
}
export function textArea(
  document: Document,
  label: string,
  name: string,
  value: string,
  rows: number,
  maxLength?: number,
): HTMLLabelElement {
  const wrapper = document.createElement("label");
  wrapper.dataset["uiField"] = "";
  wrapper.dataset["uiKey"] = name;
  const text = document.createElement("span");
  text.textContent = label;
  const input = document.createElement("textarea");
  input.name = name;
  input.value = value;
  input.rows = rows;
  if (maxLength !== undefined) input.maxLength = maxLength;
  wrapper.append(text, input);
  return wrapper;
}
export function selectField(
  document: Document,
  label: string,
  name: string,
  value: string,
  options: readonly (readonly [string, string])[],
): HTMLDivElement {
  const wrapper = document.createElement("div");
  wrapper.dataset["uiField"] = "";
  wrapper.dataset["uiKey"] = name;
  const text = document.createElement("label");
  text.textContent = label;
  const input = document.createElement("select");
  input.id = `planner-${crypto.randomUUID()}`;
  text.htmlFor = input.id;
  input.name = name;
  if (options.length >= 12) input.dataset["ui"] = "combobox";
  input.setAttribute("aria-label", label);
  for (const [optionValue, optionLabel] of options) {
    const entry = option(document, optionValue, optionLabel);
    entry.selected = optionValue === value;
    input.append(entry);
  }
  wrapper.append(text, input);
  return wrapper;
}
export function messageBlock(
  document: Document,
  message: string,
  role: "status" | "alert",
): HTMLElement {
  const block = document.createElement("div");
  block.className = `dm-tools-message ${role}`;
  block.setAttribute("role", role);
  block.dataset["uiState"] = role === "alert" ? "error" : "info";
  block.textContent = message;
  return block;
}
export function actionButton(
  document: Document,
  label: string,
  action: () => void,
  style = "",
): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  if (style) button.className = style;
  if (style === "primary" || style === "danger") button.dataset["uiVariant"] = style;
  button.addEventListener("click", action);
  return button;
}
export function formText(data: FormData, name: string): string {
  const value = data.get(name);
  return typeof value === "string" ? value : "";
}
export function scalarText(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}
