import { existsSync, readFileSync } from "node:fs";
import type { I18n } from "../src/messages.ts";
import { fakeI18n, type Catalog } from "./i18n-fake.ts";

export { catalogMessages, type Catalog } from "./i18n-fake.ts";

export function readCatalog(locale: string): Catalog | undefined {
  const file = new URL(`../locales/${locale}.json`, import.meta.url);
  return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as Catalog) : undefined;
}

/** ui.i18n in `locale` over this package's own catalogs. */
export function catalogI18n(locale: string): I18n {
  const catalogs = [locale, "en"]
    .map(readCatalog)
    .filter((catalog): catalog is Catalog => catalog !== undefined);
  return fakeI18n(catalogs, () => locale);
}
