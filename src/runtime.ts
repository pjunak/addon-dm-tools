import type { AddonContext, ServiceHandle } from "./sdk.js";
import type { PlanningRepository } from "./planning-repository.js";
export interface DmToolsRuntime { readonly repository: PlanningRepository; readonly adapters: ServiceHandle; readonly signal: AbortSignal; readonly ui: AddonContext["ui"] }
interface Registry { readonly generations: Map<string, DmToolsRuntime> }
const key = "__ttrpgCodexDmToolsV3";
export function registerRuntime(generation: string, runtime: DmToolsRuntime): () => void { const registry = getRegistry(); registry.generations.set(generation, runtime); return () => { if (registry.generations.get(generation) === runtime) registry.generations.delete(generation); }; }
export function runtimeFor(generation: string): DmToolsRuntime | undefined { return getRegistry().generations.get(generation); }
function getRegistry(): Registry { const root = globalThis as typeof globalThis & Record<string, unknown>; const current = root[key]; if (typeof current === "object" && current !== null && (current as { generations?: unknown }).generations instanceof Map) return current as Registry; const created: Registry = { generations: new Map() }; root[key] = created; return created; }
