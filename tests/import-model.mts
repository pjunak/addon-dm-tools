import test from "node:test";
import assert from "node:assert/strict";
import { en, cs } from "#web/import-catalogs";
import {
  importText,
  parseAdapterDescription,
  parseImportPreview,
  parseImportSource,
  parseSavedReceipt,
  selectAdapter,
} from "#web/import-model";
import type { AdapterDescription } from "../src/import-model.ts";

const description = {
  contractVersion: "import-adapter-description.v1",
  id: "stories",
  label: "Stories",
  description: "",
  formats: ["story-json"],
} satisfies AdapterDescription;
const preview = {
  contractVersion: "import-preview-result.v1",
  token: "a".repeat(24),
  format: "story-json",
  mode: "merge",
  summary: { creates: 1, updates: 0, deletes: 0, skips: 3 },
  warnings: [],
  changes: [{ operation: "create", collection: "stories", id: "trail", label: "Trail" }],
};
void test("routing uses only the advertised format and never the provider ID or document filename", () => {
  const parsed = parseImportSource('{"format":"story-json","data":{"arbitrary":true}}');
  assert.ok(
    typeof parsed.document.data === "object" &&
      parsed.document.data !== null &&
      "arbitrary" in parsed.document.data,
  );
  assert.equal(parsed.document.data.arbitrary, true);
  const first = {
    provider: { addonId: "unrelated-name" },
    description: parseAdapterDescription(description),
  };
  const other = {
    provider: { addonId: "dm-tools" },
    description: { ...description, formats: ["different-format"] },
  };
  assert.equal(selectAdapter([other, first], parsed.format), first);
  assert.throws(
    () => selectAdapter([first, first], parsed.format),
    (error) =>
      typeof error === "object" &&
      error !== null &&
      "key" in error &&
      error.key === "center.formatAmbiguous",
  );
  assert.throws(
    () => selectAdapter([other], parsed.format),
    (error) =>
      typeof error === "object" &&
      error !== null &&
      "key" in error &&
      error.key === "center.formatUnsupported",
  );
  for (const value of ["invalid", "[]", "{}", '{"format":4}'])
    assert.throws(() => parseImportSource(value));
});
void test("broken descriptions and inconsistent reviews cannot offer a commit", () => {
  for (const patch of [
    { label: "" },
    { formats: [] },
    { formats: ["story-json", "story-json"] },
    { formats: ["bad/format"] },
  ])
    assert.throws(() => parseAdapterDescription({ ...description, ...patch }));
  assert.deepEqual(parseImportPreview(preview, "story-json"), preview);
  for (const patch of [
    { format: "other-json" },
    { token: "short" },
    { summary: { ...preview.summary, deletes: 1 } },
    { summary: { ...preview.summary, skips: -1 } },
    { changes: [] },
    { warnings: [5] },
    { changes: [{ ...preview.changes[0], operation: "execute" }] },
  ])
    assert.throws(() => parseImportPreview({ ...preview, ...patch }, "story-json"));
});
void test("a saved commit receipt keeps any token the import contract allows", () => {
  const receipt = (token: unknown, providerAddonId: unknown = "codex-core") =>
    parseSavedReceipt(JSON.stringify({ token, providerAddonId }));
  // The host issues 24 random bytes as hex; the planning worker as base64url.
  const bytes = Buffer.from(Array.from({ length: 24 }, (_, index) => 250 - index * 9));
  for (const token of [
    bytes.toString("hex"),
    bytes.toString("base64url"),
    "t".repeat(20),
    "t".repeat(200),
  ]) {
    assert.deepEqual(receipt(token), { token, providerAddonId: "codex-core" });
    assert.equal(parseImportPreview({ ...preview, token }, "story-json").token, token);
  }
  for (const token of ["t".repeat(19), "t".repeat(201), 48, null])
    assert.equal(receipt(token), undefined);
  assert.equal(receipt("t".repeat(32), 7), undefined);
  for (const stored of [null, "", "{", "[]", '"token"'])
    assert.equal(parseSavedReceipt(stored), undefined);
});
void test("English and Czech catalogs retain placeholders and literal imported labels", () => {
  assert.deepEqual(Object.keys(en), Object.keys(cs));
  for (const key of Object.keys(en) as Array<keyof typeof en>) {
    assert.ok(cs[key].trim());
    assert.deepEqual(en[key].match(/\{[^}]+\}/g) ?? [], cs[key].match(/\{[^}]+\}/g) ?? [], key);
  }
  assert.equal(importText("cs", "center.title"), "Centrum importu");
  assert.equal(
    importText("en", "previewTitle", { label: "<b>{format}</b>" }),
    "<b>{format}</b> preview",
  );
});
