import type { MessageKeys } from "./message-keys.js";
import type { AddonContext } from "./sdk.js";

/**
 * The host's ui.i18n. DM Tools' texts live in locales/*.json; the host loads
 * them for the reader's language and falls back to English.
 */
export type I18n = AddonContext["i18n"];
export type PlannerMessage = MessageKeys["planner"];
export type PlannerParameters = Readonly<Record<string, string | number | null | undefined>>;
export type PlannerTranslator = (key: PlannerMessage, parameters?: PlannerParameters) => string;
export type CanvasMessage = MessageKeys["canvas"];
export type DashboardMessage = MessageKeys["dashboard"];
export type ImportMessage = MessageKeys["import"];
export type ImportParams = Readonly<Record<string, string | number>>;

/** The reader's language from a contribution's host context; English until the host says. */
export function hostLocale(host: unknown): string {
  return typeof host === "object" &&
    host !== null &&
    "locale" in host &&
    typeof host.locale === "string"
    ? host.locale
    : "en";
}

/**
 * Planner texts are keyed by their English wording, so without a translator
 * (in models and tests) the key itself is the English text.
 */
export function plannerTranslator(i18n?: I18n): PlannerTranslator {
  return (key, parameters = {}) => {
    if (i18n) return i18n.t(key, messageArguments(parameters));
    return key.replace(/\{(\w+)\}/gu, (token, name: string) =>
      Object.hasOwn(parameters, name) ? String(parameters[name] ?? "") : token,
    );
  };
}

export function importText(i18n: I18n, key: ImportMessage, params: ImportParams = {}): string {
  return i18n.t(key, params);
}

export function dashboardText(i18n: I18n, key: DashboardMessage): string {
  return i18n.t(key);
}

export function canvasText(i18n: I18n, key: CanvasMessage): string {
  return i18n.t(key);
}

/** A package-owned failure retains its message until the receiving view chooses its locale. */
export class PlannerError extends Error {
  readonly render: (t: PlannerTranslator) => string;
  constructor(
    key: PlannerMessage | ((t: PlannerTranslator) => string),
    parameters: PlannerParameters = {},
  ) {
    const render = typeof key === "function" ? key : (t: PlannerTranslator) => t(key, parameters);
    super(render(plannerTranslator()));
    this.render = render;
  }
}

export function plannerError(error: unknown, t: PlannerTranslator, fallback: string): string {
  return error instanceof PlannerError ? error.render(t) : fallback;
}

/**
 * Code-owned enum labels such as "plotline" are catalog keys; any other value,
 * such as an authored title, has no message and comes back unchanged.
 */
export function plannerLabel(value: string, t: PlannerTranslator): string {
  return t(value as PlannerMessage);
}

/** ui.i18n takes strings and finite numbers; an absent value reads as empty. */
function messageArguments(parameters: PlannerParameters): Record<string, string | number> {
  const result: Record<string, string | number> = {};
  for (const [name, value] of Object.entries(parameters))
    result[name] =
      typeof value === "number" && Number.isFinite(value) ? value : String(value ?? "");
  return result;
}
