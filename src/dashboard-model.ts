import type { PlanningDataset, PlanningItem } from "./planning-model.js";
import type { ServiceHandle } from "./sdk.js";
import { en, cs } from "./dashboard-catalogs.js";

export type DashboardLocale = "en" | "cs";
export type DashboardMessage = keyof typeof en;
export function dashboardLocale(host: unknown): DashboardLocale {
  return typeof host === "object" && host !== null && "locale" in host && host.locale === "cs" ? "cs" : "en";
}
export function dashboardText(locale: DashboardLocale, key: DashboardMessage): string { return (locale === "cs" ? cs : en)[key]; }
export function summarizePlanning(snapshot: PlanningDataset, locale: DashboardLocale) {
  return {
    counts: { total: snapshot.items.length, plotlines: snapshot.items.filter(item => item.kind === "plotline").length,
      quests: snapshot.items.filter(item => item.kind === "quest").length,
      encounters: snapshot.items.filter(item => item.kind === "event" && item.eventType === "encounter").length, notes: snapshot.notes.length },
    recent: [...snapshot.items].sort((a, b) => b.updatedAt - a.updatedAt || a.title.localeCompare(b.title, locale) || a.id.localeCompare(b.id)).slice(0, 12),
  };
}
export function plannerLink(addonId: string, itemId?: string): string {
  return `#/addons/${encodeURIComponent(addonId)}/planner${itemId === undefined ? "" : `?item=${encodeURIComponent(itemId)}`}`;
}
export function plannerTarget(host: unknown): string | undefined {
  if (typeof host !== "object" || host === null || !("contractVersion" in host) || host.contractVersion !== "addon-route-context.v1") return undefined;
  const query = "query" in host ? host.query : undefined;
  if (!Array.isArray(query) || query.length > 1) throw new Error("Invalid planner link.");
  if (query.length === 0) return undefined;
  const pair: unknown = query[0];
  if (!Array.isArray(pair) || pair.length !== 2 || pair[0] !== "item" || typeof pair[1] !== "string" ||
      !/^[a-z0-9][a-z0-9._-]{0,119}$/u.test(pair[1]) || ["__proto__", "prototype", "constructor"].includes(pair[1])) throw new Error("Invalid planner link.");
  return pair[1];
}
export function plannerSelection(items: readonly PlanningItem[], id: string | undefined) {
  if (id === undefined) return { scopeId: null, selectedId: undefined };
  const item = items.find(item => item.id === id);
  if (!item) throw new Error("This planning item no longer exists.");
  return item.kind === "plotline" || item.kind === "quest" ? { scopeId: item.id, selectedId: undefined } : { scopeId: item.parentId, selectedId: item.id };
}
export async function planningImportStatus(adapters: ServiceHandle, signal: AbortSignal): Promise<"ready" | "missing" | "error"> {
  const results = await Promise.allSettled(adapters.providers.map(provider => adapters.call<unknown>("describe", {}, { providerAddonId: provider.addonId, signal, deadlineMs: 3000 })));
  signal.throwIfAborted();
  let failed = false;
  for (const result of results) {
    if (result.status === "rejected") { failed = true; continue; }
    const value = result.value;
    if (typeof value !== "object" || value === null || !("contractVersion" in value) || value.contractVersion !== "import-adapter-description.v1" || !("formats" in value) || !Array.isArray(value.formats) || !value.formats.every(format => typeof format === "string")) { failed = true; continue; }
    if (value.formats.includes("dm-tools-planning")) return "ready";
  }
  return failed ? "error" : "missing";
}
