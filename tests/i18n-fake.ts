import type { I18n } from "../src/messages.ts";

type Message = string | Readonly<Record<string, string>>;
export interface Catalog {
  readonly locale: string;
  readonly sections: Readonly<Record<string, Readonly<Record<string, Message>>>>;
}

export function catalogMessages(catalog: Catalog): Map<string, Message> {
  return new Map(Object.values(catalog.sections).flatMap((section) => Object.entries(section)));
}

/**
 * The host's ui.i18n over this package's catalogs: the current language, then
 * English, then the key itself.
 */
export function fakeI18n(catalogs: readonly Catalog[], locale: () => string): I18n {
  const messages = new Map(catalogs.map((catalog) => [catalog.locale, catalogMessages(catalog)]));
  const fill = (text: string, args: Readonly<Record<string, string | number>>): string =>
    text.replace(/\{(\w+)\}/gu, (match, name: string) =>
      Object.hasOwn(args, name) ? String(args[name]) : match,
    );
  const pick = (message: Message, count: number | undefined): string =>
    typeof message === "string"
      ? message
      : ((count === undefined
          ? undefined
          : message[new Intl.PluralRules(locale()).select(count)]) ?? message["other"]!);
  const lookup = (key: string): Message | undefined =>
    messages.get(locale())?.get(key) ?? messages.get("en")?.get(key);
  return {
    get locale() {
      return locale();
    },
    t: (key, args = {}) => {
      const message = lookup(key);
      return message === undefined ? key : fill(pick(message, undefined), args);
    },
    plural: (key, count, args = {}) => {
      const message = lookup(key);
      return message === undefined ? key : fill(pick(message, count), { n: count, ...args });
    },
    message: ({ text, key, args = {} }) => {
      const message = key === undefined ? undefined : lookup(key);
      const count = args["n"];
      return message === undefined
        ? text
        : fill(pick(message, typeof count === "number" ? count : undefined), args);
    },
    onChange: () => () => {},
  };
}
