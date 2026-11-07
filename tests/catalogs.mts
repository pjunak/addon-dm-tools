import assert from "node:assert/strict";
import { test } from "node:test";
import { catalogMessages, readCatalog } from "./catalog-i18n.ts";

const placeholders = (message: unknown): string[] =>
  [...new Set([...JSON.stringify(message).matchAll(/\{\w+\}/gu)].map((match) => match[0]))].sort();

void test("the Czech catalog translates every English text in its section with the same placeholders", () => {
  const english = readCatalog("en")!,
    czech = readCatalog("cs")!;
  const czechMessages = catalogMessages(czech);
  for (const [section, messages] of Object.entries(english.sections))
    for (const [key, message] of Object.entries(messages)) {
      assert.ok(Object.hasOwn(czech.sections[section] ?? {}, key), `${section}: ${key}`);
      assert.deepEqual(placeholders(czechMessages.get(key)), placeholders(message), key);
    }
  assert.equal(
    czechMessages.size - Object.keys(czech.sections["manifest"] ?? {}).length,
    catalogMessages(english).size,
  );
});
