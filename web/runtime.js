const key = "__ttrpgCodexDmToolsV3";
export function registerRuntime(generation, runtime) { const registry = getRegistry(); registry.generations.set(generation, runtime); return () => { if (registry.generations.get(generation) === runtime)
    registry.generations.delete(generation); }; }
export function runtimeFor(generation) { return getRegistry().generations.get(generation); }
function getRegistry() { const root = globalThis; const current = root[key]; if (typeof current === "object" && current !== null && current.generations instanceof Map)
    return current; const created = { generations: new Map() }; root[key] = created; return created; }
