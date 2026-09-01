import { defineImportElement, importElementTag } from "./import-element.js";
import { definePlannerElement, plannerElementTag } from "./planner-element.js";
import { PlanningRepository } from "./planning-repository.js";
import { registerRuntime } from "./runtime.js";
export async function activate(context) {
    context.capabilities.require("data.transactions");
    context.capabilities.require("ui.contributions");
    context.signal.throwIfAborted();
    const adapters = await context.services.connect("codex.import-adapter", { range: "^2.0.0", cardinality: "many", signal: context.signal });
    const unregister = registerRuntime(context.addon.generation, { repository: new PlanningRepository(context), adapters, signal: context.signal });
    definePlannerElement();
    defineImportElement();
    const bindings = [context.ui.bind("planner.route", { kind: "element", tag: plannerElementTag }), context.ui.bind("imports.route", { kind: "element", tag: importElementTag })];
    let disposed = false;
    return Object.freeze({ dispose() { if (disposed)
            return; disposed = true; for (const binding of bindings.reverse())
            binding.dispose(); unregister(); } });
}
