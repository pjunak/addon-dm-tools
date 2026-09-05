import { defineImportElement } from "./import-element.js";
import { defineDashboardElement } from "./dashboard-element.js";
import { definePlannerElement } from "./planner-element.js";
import { PlanningRepository } from "./planning-repository.js";
import { registerRuntime } from "./runtime.js";
export async function activate(context) {
    context.capabilities.require("data.transactions");
    context.capabilities.require("ui.contributions");
    context.signal.throwIfAborted();
    const adapters = await context.services.connect("codex.import-adapter", { range: "^2.0.0", cardinality: "many", signal: context.signal });
    const unregister = registerRuntime(context.addon.generation, { repository: new PlanningRepository(context), adapters, signal: context.signal });
    const plannerElementTag = definePlannerElement(context.addon.generation), importElementTag = defineImportElement(context.addon.generation);
    const bindings = [context.ui.bind("planner.route", { kind: "element", tag: plannerElementTag }), context.ui.bind("imports.route", { kind: "element", tag: importElementTag }),
        context.ui.bind("dashboard.slot", { kind: "element", tag: defineDashboardElement(context.addon.generation) })];
    let disposed = false;
    return Object.freeze({ dispose() { if (disposed)
            return; disposed = true; for (const binding of bindings.reverse())
            binding.dispose(); unregister(); } });
}
