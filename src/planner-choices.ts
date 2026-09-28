import type { PlanningItem } from "./planning-model.js";

export type PlanningChoiceItem = Pick<PlanningItem, "id" | "title"> &
  Partial<Pick<PlanningItem, "parentId">>;

/** Keep short unique titles; disambiguate repeated titles by ownership, then identity. */
export function planningChoices(items: readonly PlanningChoiceItem[]): readonly {
  id: string;
  label: string;
  trail: string;
}[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  const titleCounts = new Map<string, number>();
  for (const item of items) titleCounts.set(item.title, (titleCounts.get(item.title) ?? 0) + 1);
  const choices = items.map((item) => {
    const seen = new Set<string>(),
      names: string[] = [];
    let current: PlanningChoiceItem | undefined = item;
    while (current && !seen.has(current.id)) {
      seen.add(current.id);
      names.unshift(current.title);
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
    const trail = names.join(" / ");
    return { id: item.id, label: titleCounts.get(item.title)! > 1 ? trail : item.title, trail };
  });
  const labelCounts = new Map<string, number>();
  for (const choice of choices)
    labelCounts.set(choice.label, (labelCounts.get(choice.label) ?? 0) + 1);
  return choices.map((choice) => ({
    ...choice,
    label: labelCounts.get(choice.label)! > 1 ? `${choice.label} (${choice.id})` : choice.label,
  }));
}
