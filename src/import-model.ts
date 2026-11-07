import type { LocalizedText, ServiceProvider } from "./sdk.js";
import type { ImportMessage, ImportParams } from "./messages.js";

export interface AdapterDescription {
  readonly contractVersion: "import-adapter-description.v1";
  readonly id: string;
  readonly label: string;
  /** `label`'s key in the provider's message catalog. */
  readonly labelKey?: string;
  readonly description: string;
  /** `description`'s key in the provider's message catalog. */
  readonly descriptionKey?: string;
  readonly formats: readonly string[];
  readonly features?: readonly string[];
}
export interface Adapter {
  readonly provider: Pick<ServiceProvider, "addonId">;
  readonly description: AdapterDescription;
}
export interface ImportPreview {
  readonly contractVersion: "import-preview-result.v1";
  readonly token: string;
  readonly format: string;
  readonly mode: "merge" | "replace";
  readonly summary: {
    readonly creates: number;
    readonly updates: number;
    readonly skips: number;
    readonly deletes: number;
  };
  readonly warnings: readonly string[];
  /** The warnings in order, keyed in the provider's message catalog. */
  readonly warningTexts?: readonly LocalizedText[];
  readonly changes: readonly {
    readonly collection: string;
    readonly id: string;
    readonly operation: "create" | "update" | "delete";
    readonly label: string;
    readonly dm?: Record<string, unknown>;
    readonly player?: Record<string, unknown>;
  }[];
  readonly references?: readonly {
    readonly ref: string;
    readonly collection: string;
    readonly id: string;
  }[];
  readonly expiresAt?: string;
}
export class ImportProblem extends Error {
  readonly key: ImportMessage;
  readonly params: ImportParams;

  constructor(key: ImportMessage, params: ImportParams = {}) {
    super(key);
    this.key = key;
    this.params = params;
  }
}
/**
 * The notice for a failed preview. An importer that rejects the document may
 * name the problem (the host's ServiceError.issue, and issueText with its key
 * in the provider's catalog); it is plain text from the provider and must
 * only ever be shown as text.
 */
export function previewFailure(error: unknown): {
  readonly key: ImportMessage;
  readonly params: ImportParams;
  readonly issue?: LocalizedText;
} {
  if (error instanceof ImportProblem) return { key: error.key, params: error.params };
  if (
    isRecord(error) &&
    error["code"] === "INVALID_REQUEST" &&
    typeof error["issue"] === "string" &&
    error["issue"] !== ""
  ) {
    const issue = error["issueText"];
    return {
      key: "previewRejected",
      params: { issue: error["issue"] },
      ...(localizedText(issue) ? { issue } : {}),
    };
  }
  return { key: "previewFailed", params: {} };
}
/** A provider's text keyed in its own catalog; without a key it is the text itself. */
export function providerText(
  text: string,
  key: string | undefined,
  provider: Pick<ServiceProvider, "addonId">,
): LocalizedText {
  return key === undefined ? { text } : { text, key, addon: provider.addonId };
}
/** The warning at `index` with its key in the provider's catalog when it sent one. */
export function previewWarning(
  preview: ImportPreview,
  index: number,
  provider: Pick<ServiceProvider, "addonId">,
): LocalizedText {
  const keyed = preview.warningTexts?.[index];
  return keyed?.key === undefined
    ? { text: preview.warnings[index] ?? "" }
    : { ...keyed, addon: provider.addonId };
}
function localizedText(value: unknown): value is LocalizedText {
  const args = isRecord(value) ? value["args"] : undefined;
  return (
    isRecord(value) &&
    typeof value["text"] === "string" &&
    value["text"].length <= 500 &&
    (value["key"] === undefined ||
      (typeof value["key"] === "string" &&
        value["key"].length > 0 &&
        value["key"].length <= 500)) &&
    (args === undefined ||
      (isRecord(args) &&
        Object.keys(args).length <= 16 &&
        Object.values(args).every(
          (arg) =>
            (typeof arg === "string" && arg.length <= 300) ||
            (typeof arg === "number" && Number.isFinite(arg)),
        ))) &&
    (value["addon"] === undefined || typeof value["addon"] === "string")
  );
}
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
/** The import-adapter contract allows any token of 20 to 200 characters. */
export function validImportToken(value: unknown): value is string {
  return typeof value === "string" && value.length >= 20 && value.length <= 200;
}
/** The commit receipt kept in this tab, when one is stored and well formed. */
export function parseSavedReceipt(
  stored: string | null,
): { readonly token: string; readonly providerAddonId: string } | undefined {
  let saved: unknown;
  try {
    saved = JSON.parse(stored ?? "null");
  } catch {
    return undefined;
  }
  return isRecord(saved) &&
    validImportToken(saved["token"]) &&
    typeof saved["providerAddonId"] === "string"
    ? { token: saved["token"], providerAddonId: saved["providerAddonId"] }
    : undefined;
}
export function parseImportSource(source: string): {
  format: string;
  document: Record<string, unknown>;
} {
  let document: unknown;
  try {
    document = JSON.parse(source);
  } catch {
    throw new ImportProblem("center.invalidJson");
  }
  if (
    !isRecord(document) ||
    typeof document["format"] !== "string" ||
    !/^[a-z][a-z0-9.-]{1,99}$/.test(document["format"])
  )
    throw new ImportProblem("center.formatMissing");
  return { document, format: document["format"] };
}
export function selectAdapter(adapters: readonly Adapter[], format: string): Adapter {
  const matches = adapters.filter((adapter) => adapter.description.formats.includes(format));
  if (!matches.length) throw new ImportProblem("center.formatUnsupported", { format });
  if (matches.length !== 1) throw new ImportProblem("center.formatAmbiguous", { format });
  return matches[0]!;
}
export function parseAdapterDescription(value: unknown): AdapterDescription {
  if (
    !isRecord(value) ||
    value["contractVersion"] !== "import-adapter-description.v1" ||
    typeof value["id"] !== "string" ||
    !/^[a-z][a-z0-9._-]{1,99}$/.test(value["id"]) ||
    typeof value["label"] !== "string" ||
    !value["label"].trim() ||
    value["label"].length > 120 ||
    typeof value["description"] !== "string" ||
    value["description"].length > 500 ||
    !Array.isArray(value["formats"]) ||
    !value["formats"].length ||
    value["formats"].length > 20 ||
    !value["formats"].every(
      (format) => typeof format === "string" && /^[a-z][a-z0-9.-]{1,99}$/.test(format),
    ) ||
    new Set(value["formats"]).size !== value["formats"].length
  )
    throw new ImportProblem("invalidResponse");
  if (
    value["features"] !== undefined &&
    (!Array.isArray(value["features"]) ||
      value["features"].length > 20 ||
      !value["features"].every((feature) => typeof feature === "string" && feature.length < 100))
  )
    throw new ImportProblem("invalidResponse");
  for (const name of ["labelKey", "descriptionKey"])
    if (
      value[name] !== undefined &&
      (typeof value[name] !== "string" || !value[name] || value[name].length > 500)
    )
      throw new ImportProblem("invalidResponse");
  return value as unknown as AdapterDescription;
}
export function parseImportPreview(value: unknown, format: string): ImportPreview {
  const summary = isRecord(value) ? value["summary"] : undefined;
  const count = (value: unknown): value is number =>
    typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
  const text = (value: unknown, maximum: number): value is string =>
    typeof value === "string" && value.length <= maximum;
  if (
    !isRecord(value) ||
    value["contractVersion"] !== "import-preview-result.v1" ||
    value["format"] !== format ||
    !validImportToken(value["token"]) ||
    !["merge", "replace"].includes(String(value["mode"])) ||
    !isRecord(summary) ||
    !["creates", "updates", "skips", "deletes"].every((key) => count(summary[key])) ||
    !Array.isArray(value["warnings"]) ||
    value["warnings"].length > 100 ||
    !value["warnings"].every((warning) => text(warning, 500)) ||
    !Array.isArray(value["changes"]) ||
    value["changes"].length > 256 ||
    !value["changes"].every(
      (change) =>
        isRecord(change) &&
        text(change["collection"], 100) &&
        text(change["id"], 1024) &&
        text(change["label"], 200) &&
        ["create", "update", "delete"].includes(String(change["operation"])),
    )
  )
    throw new ImportProblem("invalidResponse");
  if (
    value["references"] !== undefined &&
    (!Array.isArray(value["references"]) ||
      value["references"].length > 128 ||
      !value["references"].every(
        (ref) =>
          isRecord(ref) &&
          text(ref["ref"], 100) &&
          text(ref["collection"], 100) &&
          text(ref["id"], 1024),
      ))
  )
    throw new ImportProblem("invalidResponse");
  if (
    value["warningTexts"] !== undefined &&
    (!Array.isArray(value["warningTexts"]) ||
      value["warningTexts"].length !== value["warnings"].length ||
      !value["warningTexts"].every(
        (warning) => localizedText(warning) && warning.addon === undefined,
      ))
  )
    throw new ImportProblem("invalidResponse");
  if (
    value["expiresAt"] !== undefined &&
    (!text(value["expiresAt"], 40) || !Number.isFinite(Date.parse(value["expiresAt"])))
  )
    throw new ImportProblem("invalidResponse");
  if (
    value["changes"].some(
      (change) =>
        !isRecord(change) ||
        ["dm", "player"].some((view) => change[view] !== undefined && !isRecord(change[view])),
    )
  )
    throw new ImportProblem("invalidResponse");
  const preview = value as unknown as ImportPreview;
  for (const [operation, summary] of [
    ["create", "creates"],
    ["update", "updates"],
    ["delete", "deletes"],
  ] as const) {
    if (
      preview.changes.filter((change) => change.operation === operation).length !==
      preview.summary[summary]
    )
      throw new ImportProblem("invalidResponse");
  }
  return preview;
}
