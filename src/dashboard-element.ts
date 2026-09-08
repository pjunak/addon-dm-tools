import { dashboardLocale, dashboardText, plannerLink, planningImportStatus, summarizePlanning, type DashboardLocale, type DashboardMessage } from "./dashboard-model.js";
import type { PlanningSnapshot } from "./planning-repository.js";
import { runtimeFor } from "./runtime.js";
import type { ContributionContext } from "./sdk.js";
import { LiveRefresh } from "./live-refresh.js";

export function defineDashboardElement(generation: string): string {
  const tag = `dm-tools-dashboard-${generation}`;
  if (customElements.get(tag)) return tag;
  class DashboardElement extends HTMLElement {
    #context: ContributionContext | undefined;
    #request: AbortController | undefined;
    #snapshot: PlanningSnapshot | undefined;
    #locale: DashboardLocale = "en";
    #status: "loading" | "ready" | "error" = "loading";
    #provider: "ready" | "missing" | "error" = "ready";
    #live: LiveRefresh | undefined;
    #unsubscribe: (() => void) | undefined;
    set codexContribution(value: ContributionContext) {
      const previous = this.#context; this.#context = value;
      const locale = dashboardLocale(value.host), changed = locale !== this.#locale; this.#locale = locale;
      if (!this.isConnected) return;
      if (previous?.addon.generation !== value.addon.generation) this.#connect();
      else if (changed) this.#render();
    }
    connectedCallback(): void { this.classList.add("dm-tools-dashboard"); this.#connect(); }
    disconnectedCallback(): void { this.#unsubscribe?.(); this.#live?.dispose(); this.#request?.abort(); this.#request = undefined; }
    #connect(): void {
      this.#unsubscribe?.(); this.#live?.dispose();
      const context = this.#context, runtime = context && runtimeFor(context.addon.generation);
      this.#live = new LiveRefresh(() => this.#status !== "loading", () => void this.#load());
      if (context && runtime) this.#unsubscribe = runtime.repository.subscribe(() => this.#live?.invalidate(), context.signal);
      void this.#load();
    }
    async #load(): Promise<void> {
      this.#live?.consume();
      this.#request?.abort(); const request = new AbortController(); this.#request = request;
      this.#status = "loading"; this.#render();
      const context = this.#context, runtime = context && runtimeFor(context.addon.generation);
      try {
        if (!runtime || !context) throw new Error("Dashboard unavailable.");
        const signal = AbortSignal.any([request.signal, context.signal, runtime.signal]);
        const [snapshot, provider] = await Promise.all([runtime.repository.load(signal), planningImportStatus(runtime.adapters, signal)]);
        signal.throwIfAborted(); this.#snapshot = snapshot; this.#provider = provider; this.#status = "ready";
      } catch {
        if (request.signal.aborted || this.#request !== request || !this.isConnected) return;
        this.#snapshot = undefined; this.#status = "error";
      }
      if (this.#request === request && this.isConnected) { this.#render(); this.#live?.wake(); }
    }
    #render(): void {
      const document = this.ownerDocument, root = document.createElement("div"); root.className = "dm-dashboard-stack";
      root.setAttribute("aria-busy", String(this.#status === "loading"));
      const t = (key: DashboardMessage) => dashboardText(this.#locale, key);
      const element = (tag: string, text: string, className = "") => { const node = document.createElement(tag); node.textContent = text; node.className = className; return node; };
      const section = (title: DashboardMessage, level = "h3") => { const node = document.createElement("section"); node.className = "dm-dashboard-section"; node.append(element(level, t(title))); return node; };
      const overview = section("dashboard.title", "h2"); overview.append(element("p", t("dashboard.description"), "dm-dashboard-hint"));
      if (this.#status === "loading") { const loading = element("p", t("dashboard.loading"), "dm-dashboard-hint"); loading.setAttribute("role", "status"); overview.append(loading); }
      if (this.#status === "error") { const error = element("p", t("dashboard.error.body"), "dm-dashboard-warning"); error.setAttribute("role", "alert"); overview.append(element("h3", t("dashboard.error.title")), error); }
      const summary = this.#snapshot && summarizePlanning(this.#snapshot, this.#locale);
      if (summary) {
        const totals = document.createElement("div"); totals.className = "dm-dashboard-totals";
        for (const [key, count] of Object.entries(summary.counts)) {
          const tile = document.createElement("div"); tile.className = `dm-dashboard-tile${key === "total" ? " accent" : ""}`; tile.dataset["stat"] = key;
          tile.append(element("div", t(`dashboard.status.${key}` as DashboardMessage), "dm-dashboard-label"), element("div", new Intl.NumberFormat(this.#locale).format(count), "dm-dashboard-value")); totals.append(tile);
        }
        overview.append(totals);
      }
      const refresh = document.createElement("button"); refresh.className = "dm-dashboard-refresh"; refresh.textContent = t("dashboard.refresh"); refresh.disabled = this.#status === "loading"; refresh.addEventListener("click", () => void this.#load()); overview.append(refresh); root.append(overview);
      const addonId = this.#context?.addon.id ?? "dm-tools";
      const workflows = section("dashboard.workflow.title"); workflows.append(element("p", t("dashboard.workflow.body"), "dm-dashboard-hint"));
      if (this.#status !== "loading" && this.#provider !== "ready") workflows.append(element("p", t(this.#provider === "missing" ? "dashboard.importMissing" : "dashboard.importError"), "dm-dashboard-warning"));
      const nav = document.createElement("nav"); nav.className = "dm-dashboard-workflows"; nav.setAttribute("aria-label", t("dashboard.workflow.label"));
      for (const [kind, href] of [["planning", plannerLink(addonId)], ["import", `#/addons/${encodeURIComponent(addonId)}/imports`]] as const) {
        const link = document.createElement("a"); link.href = href; link.append(element("strong", t(`dashboard.${kind}.title`)), element("span", t(`dashboard.${kind}.body`), "dm-dashboard-hint")); nav.append(link);
      }
      workflows.append(nav); root.append(workflows);
      if (summary) {
        const recent = section("dashboard.items.title");
        if (!summary.recent.length) {
          recent.append(element("p", t("dashboard.empty.body")));
          const link = document.createElement("a"); link.className = "dm-dashboard-refresh"; link.href = plannerLink(addonId); link.textContent = t("dashboard.empty.action"); recent.append(link);
        } else {
          const list = document.createElement("div"); list.className = "dm-dashboard-recent";
          for (const item of summary.recent) {
            const link = document.createElement("a"); link.href = plannerLink(addonId, item.id); link.dataset["recentItem"] = item.id;
            const text = document.createElement("div"); text.append(element("strong", item.title)); if (item.summary) text.append(element("div", item.summary, "dm-dashboard-hint"));
            const key = item.kind === "event" ? `planner.eventType.${item.eventType}` : item.kind === "branch" ? `planner.branchType.${item.branchType}` : `planner.kind.${item.kind}`;
            link.append(text, element("span", t(key as DashboardMessage), "dm-dashboard-badge")); list.append(link);
          }
          recent.append(list);
        }
        root.append(recent);
      }
      this.replaceChildren(root);
    }
  }
  customElements.define(tag, DashboardElement); return tag;
}
