import { PlannerError, type PlannerTranslator, plannerTranslator } from "./planner-catalogs.js";
import { planningChoices, type PlanningChoiceItem } from "./planner-choices.js";

type NoteAnchorItem = PlanningChoiceItem;
export interface NoteAnchorFilter {
  query: string;
}

export function noteAnchors(value: string, items: readonly NoteAnchorItem[]): readonly string[] {
  let ids: unknown;
  try {
    ids = JSON.parse(value);
  } catch {
    throw new PlannerError("Choose valid planning items for this note.");
  }
  if (
    !Array.isArray(ids) ||
    ids.length > 100 ||
    new Set(ids).size !== ids.length ||
    ids.some((id) => typeof id !== "string" || !items.some((item) => item.id === id))
  )
    throw new PlannerError("Choose up to 100 existing planning items for this note.");
  return ids as string[];
}

/** One hidden value lets the regular draft/revision guard cover the whole anchor set. */
export function appendNoteAnchors(
  document: Document,
  form: HTMLFormElement,
  ids: readonly string[],
  items: readonly NoteAnchorItem[],
  t: PlannerTranslator = plannerTranslator(),
  filter: NoteAnchorFilter = { query: "" },
): () => void {
  const value = document.createElement("input");
  value.type = "hidden";
  value.name = "anchorIds";
  value.value = JSON.stringify(ids);
  const group = document.createElement("fieldset");
  group.className = "dm-planner-note-anchors";
  const legend = document.createElement("legend");
  legend.textContent = t("Linked planning items");
  group.append(legend);
  const choices = document.createElement("div");
  choices.className = "dm-planner-note-choices";
  const field = document.createElement("div"),
    label = document.createElement("label"),
    search = document.createElement("input");
  field.dataset["uiField"] = "";
  field.dataset["uiKey"] = `note-anchor-search-${form.dataset["noteId"] ?? crypto.randomUUID()}`;
  search.id = `note-anchor-search-${crypto.randomUUID()}`;
  search.type = "search";
  search.dataset["ui"] = "search";
  search.maxLength = 200;
  search.value = filter.query;
  label.htmlFor = search.id;
  label.textContent = t("Find linked planning items");
  field.append(label, search);
  const status = document.createElement("p");
  status.setAttribute("role", "status");
  status.setAttribute("aria-atomic", "true");
  group.append(field, status, choices);
  form.append(value, group);
  const options = new Map(planningChoices(items).map((choice) => [choice.id, choice]));
  const rows: { text: string; label: HTMLLabelElement; checkbox: HTMLInputElement }[] = [];
  const applyFilter = (): void => {
    const query = filter.query.trim().toLocaleLowerCase();
    let matches = 0,
      linked = 0;
    for (const row of rows) {
      const match = row.text.toLocaleLowerCase().includes(query);
      if (match) matches++;
      if (row.checkbox.checked) linked++;
      row.label.hidden = !match && !row.checkbox.checked;
    }
    status.textContent =
      matches === 0
        ? `${t("No matching planning items.")} ${t("{0} linked items stay visible.", { "0": linked })}`
        : t("{0} matching planning items; {1} linked.", { "0": matches, "1": linked });
  };
  search.addEventListener("codex-query", () => {
    filter.query = search.value;
    applyFilter();
  });
  search.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.isComposing) event.preventDefault();
  });
  const refresh = (): void => {
    const selected = JSON.parse(value.value) as string[];
    choices.replaceChildren();
    rows.length = 0;
    for (const id of new Set([...items.map((item) => item.id), ...selected])) {
      const label = document.createElement("label"),
        checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.value = id;
      checkbox.checked = selected.includes(id);
      const choice = options.get(id);
      const text = choice?.label ?? t("Unavailable: {0}", { "0": id });
      label.append(checkbox, document.createTextNode(text));
      rows.push({ text: `${text} ${choice?.trail ?? ""} ${id}`, label, checkbox });
      choices.append(label);
      checkbox.addEventListener("change", () => {
        value.value = JSON.stringify(
          Array.from(
            choices.querySelectorAll<HTMLInputElement>("input:checked"),
            (input) => input.value,
          ),
        );
        value.dispatchEvent(new Event("input", { bubbles: true }));
        applyFilter();
      });
    }
    applyFilter();
  };
  return refresh;
}
