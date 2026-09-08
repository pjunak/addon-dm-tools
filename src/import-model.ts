import type { ServiceProvider } from "./sdk.js";
import { en, cs } from "./import-catalogs.js";

export interface AdapterDescription { readonly contractVersion: "import-adapter-description.v1"; readonly id: string; readonly label: string; readonly description: string; readonly formats: readonly string[] }
export interface Adapter { readonly provider: ServiceProvider; readonly description: AdapterDescription }
export interface ImportPreview {
  readonly contractVersion: "import-preview-result.v1"; readonly token: string; readonly format: string; readonly mode: "merge" | "replace";
  readonly summary: { readonly creates: number; readonly updates: number; readonly skips: number; readonly deletes: number };
  readonly warnings: readonly string[]; readonly changes: readonly { readonly collection: string; readonly id: string; readonly operation: "create" | "update" | "delete"; readonly label: string }[];
}
export type ImportMessage = keyof typeof en;
export type ImportParams = Readonly<Record<string, string | number>>;
export function importText(locale: "en" | "cs", key: ImportMessage, params: ImportParams = {}): string {
  return (locale === "cs" ? cs : en)[key].replace(/\{([a-z]+)\}/g, (placeholder, name: string) => String(params[name] ?? placeholder));
}
export class ImportProblem extends Error {
  constructor(readonly key: ImportMessage, readonly params: ImportParams = {}) { super(key); }
}
export function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
export function parseImportSource(source: string): { format: string; document: Record<string, unknown> } {
  let document: unknown;
  try { document = JSON.parse(source); } catch { throw new ImportProblem("center.invalidJson"); }
  if (!isRecord(document) || typeof document["format"] !== "string" || !/^[a-z][a-z0-9.-]{1,99}$/.test(document["format"])) throw new ImportProblem("center.formatMissing");
  return { document, format: document["format"] };
}
export function selectAdapter(adapters: readonly Adapter[], format: string): Adapter {
  const matches = adapters.filter(adapter => adapter.description.formats.includes(format));
  if (!matches.length) throw new ImportProblem("center.formatUnsupported", { format });
  if (matches.length !== 1) throw new ImportProblem("center.formatAmbiguous", { format });
  return matches[0]!;
}
export function parseAdapterDescription(value: unknown): AdapterDescription {
  if (!isRecord(value) || value["contractVersion"] !== "import-adapter-description.v1" ||
    typeof value["id"] !== "string" || !/^[a-z][a-z0-9._-]{1,99}$/.test(value["id"]) ||
    typeof value["label"] !== "string" || !value["label"].trim() || value["label"].length > 120 ||
    typeof value["description"] !== "string" || value["description"].length > 500 ||
    !Array.isArray(value["formats"]) || !value["formats"].length || value["formats"].length > 20 ||
    !value["formats"].every(format => typeof format === "string" && /^[a-z][a-z0-9.-]{1,99}$/.test(format)) ||
    new Set(value["formats"]).size !== value["formats"].length) throw new ImportProblem("invalidResponse");
  return value as unknown as AdapterDescription;
}
export function parseImportPreview(value: unknown, format: string): ImportPreview {
  const summary = isRecord(value) ? value["summary"] : undefined;
  const count = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
  const text = (value: unknown, maximum: number): value is string => typeof value === "string" && value.length <= maximum;
  if (!isRecord(value) || value["contractVersion"] !== "import-preview-result.v1" || value["format"] !== format ||
    !text(value["token"], 200) || value["token"].length < 20 || !["merge", "replace"].includes(String(value["mode"])) ||
    !isRecord(summary) || !["creates", "updates", "skips", "deletes"].every(key => count(summary[key])) ||
    !Array.isArray(value["warnings"]) || value["warnings"].length > 100 || !value["warnings"].every(warning => text(warning, 500)) ||
    !Array.isArray(value["changes"]) || value["changes"].length > 256 ||
    !value["changes"].every(change => isRecord(change) && text(change["collection"], 100) && text(change["id"], 120) && text(change["label"], 200) && ["create", "update", "delete"].includes(String(change["operation"])))) throw new ImportProblem("invalidResponse");
  const preview = value as unknown as ImportPreview;
  for (const [operation, summary] of [["create", "creates"], ["update", "updates"], ["delete", "deletes"]] as const) {
    if (preview.changes.filter(change => change.operation === operation).length !== preview.summary[summary]) throw new ImportProblem("invalidResponse");
  }
  return preview;
}
