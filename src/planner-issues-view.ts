import type { PlannerTranslator } from "./planner-catalogs.js";
import { actionButton } from "./planner-fields.js";
import {
  planningRepair,
  type PlanningDataset,
  type PlanningIssue,
  type PlanningRepair,
} from "./planning-model.js";

export type IssueEditorTab = "details" | "links" | "notes";
export interface IssueActions {
  readonly open: boolean;
  toggle(open: boolean): void;
  repair(issue: PlanningIssue): void;
  edit(itemId: string, tab: IssueEditorTab): void;
}

/** Stored problems, each with its repair and the item editor that can fix it. */
export function issuesPanel(
  document: Document,
  dataset: PlanningDataset,
  issues: readonly PlanningIssue[],
  t: PlannerTranslator,
  actions: IssueActions,
): HTMLElement {
  const panel = document.createElement("details");
  panel.className = "dm-planner-issues";
  panel.open = actions.open;
  panel.addEventListener("toggle", () => actions.toggle(panel.open));
  const summary = document.createElement("summary"),
    help = document.createElement("p"),
    list = document.createElement("ul");
  summary.textContent = t("Planning data problems: {0}", { "0": issues.length });
  help.textContent = t(
    "Some saved planning records break planning rules. Repair them here or in the item editor. Other changes stay available while they add no new problems.",
  );
  for (const issue of issues) {
    const row = document.createElement("li"),
      message = document.createElement("p");
    row.dataset["issue"] = issue.key;
    message.textContent = t(issue.message, issue.parameters);
    row.append(message);
    const label = recordLabel(dataset, issue);
    if (label) {
      const record = document.createElement("p");
      record.className = "dm-planner-issue-record";
      record.textContent = label;
      row.append(record);
    }
    const buttons = document.createElement("div");
    buttons.dataset["uiActions"] = "";
    const repair = planningRepair(issue);
    if (repair)
      buttons.append(
        actionButton(
          document,
          repairLabel(issue, repair, t),
          () => actions.repair(issue),
          repair === "delete" ? "danger" : "",
        ),
      );
    const owner = owningItem(dataset, issue);
    if (owner) {
      const edit = actionButton(document, t("Edit item"), () => actions.edit(owner.id, owner.tab));
      edit.dataset["viewAction"] = "";
      buttons.append(edit);
    }
    if (buttons.childElementCount) row.append(buttons);
    list.append(row);
  }
  panel.append(summary, help, list);
  return panel;
}

/** The confirmation a destructive repair needs, if any. */
export function repairQuestion(
  dataset: PlanningDataset,
  issue: PlanningIssue,
  t: PlannerTranslator,
): string | undefined {
  if (planningRepair(issue) !== "delete") return undefined;
  if (issue.collection === "planning_references")
    return t("Delete the reference {0}?", { "0": recordLabel(dataset, issue) || issue.id });
  if (issue.collection === "planning_consequences")
    return t("Delete the consequence {0}?", { "0": recordLabel(dataset, issue) || issue.id });
  // Like the flow editor, a flow alone goes without asking; its consequences do not.
  const attached = dataset.consequences.filter(
    (entry) => entry.anchor["scope"] === "flow" && entry.anchor["flowId"] === issue.id,
  ).length;
  return attached
    ? t("Remove this flow and its {0} attached consequences?", { "0": attached })
    : undefined;
}

function repairLabel(issue: PlanningIssue, repair: PlanningRepair, t: PlannerTranslator): string {
  if (repair === "detach")
    return issue.collection === "dm_notes" ? t("Remove missing links") : t("Remove missing target");
  return issue.collection === "planning_references"
    ? t("Delete reference")
    : issue.collection === "planning_consequences"
      ? t("Delete consequence")
      : t("Remove flow");
}

/** The record's own name; item problems already name their item. */
function recordLabel(dataset: PlanningDataset, issue: PlanningIssue): string {
  const title = (id: string): string =>
    dataset.items.find((item) => item.id === id)?.title.trim() || id;
  switch (issue.collection) {
    case "planning_items":
      return "";
    case "planning_flow_links": {
      const flow = dataset.flows.find((entry) => entry.id === issue.id);
      return flow
        ? `${title(flow.sourceId)} → ${title(flow.targetId)}${flow.label ? `: ${flow.label}` : ""}`
        : "";
    }
    case "planning_references":
      return dataset.references.find((entry) => entry.id === issue.id)?.name.trim() ?? "";
    case "planning_consequences":
      return dataset.consequences.find((entry) => entry.id === issue.id)?.title.trim() ?? "";
    case "dm_notes":
      return dataset.notes.find((entry) => entry.id === issue.id)?.title.trim() ?? "";
  }
}

/** The existing item whose editor shows the record, if there is one. */
function owningItem(
  dataset: PlanningDataset,
  issue: PlanningIssue,
): { readonly id: string; readonly tab: IssueEditorTab } | undefined {
  const exists = (id: unknown): id is string =>
    typeof id === "string" && dataset.items.some((item) => item.id === id);
  switch (issue.collection) {
    case "planning_items":
      return { id: issue.id, tab: "details" };
    case "planning_flow_links": {
      const source = dataset.flows.find((entry) => entry.id === issue.id)?.sourceId;
      return exists(source) ? { id: source, tab: "links" } : undefined;
    }
    case "planning_references": {
      const owner = dataset.references.find((entry) => entry.id === issue.id)?.itemId;
      return exists(owner) ? { id: owner, tab: "links" } : undefined;
    }
    case "planning_consequences": {
      const anchor = dataset.consequences.find((entry) => entry.id === issue.id)?.anchor;
      const owner =
        anchor?.["scope"] === "flow"
          ? dataset.flows.find((flow) => flow.id === anchor["flowId"])?.sourceId
          : anchor?.["itemId"];
      return exists(owner) ? { id: owner, tab: "links" } : undefined;
    }
    case "dm_notes": {
      const owner = dataset.notes.find((entry) => entry.id === issue.id)?.anchorIds.find(exists);
      return owner ? { id: owner, tab: "notes" } : undefined;
    }
  }
}
