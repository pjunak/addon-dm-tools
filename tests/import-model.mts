import test from "node:test";
import assert from "node:assert/strict";
import { importText } from "#web/messages";
import { catalogI18n } from "./catalog-i18n.ts";
import {
  ImportProblem,
  parseAdapterDescription,
  parseImportPreview,
  parseImportSource,
  parseSavedReceipt,
  previewFailure,
  previewWarning,
  providerText,
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
void test("import texts translate and keep literal imported labels", () => {
  assert.equal(importText(catalogI18n("cs"), "center.title"), "Centrum importu");
  assert.equal(
    importText(catalogI18n("en"), "previewTitle", { label: "<b>{format}</b>" }),
    "<b>{format}</b> preview",
  );
});
void test("a rejected preview shows the importer's own problem as plain text", () => {
  const issue = 'items[3]: effect 1: target "<img src=x onerror=alert(1)>" is not supported';
  const failure = previewFailure({ name: "AddonServiceHTTPError", code: "INVALID_REQUEST", issue });
  assert.deepEqual(failure, { key: "previewRejected", params: { issue } });
  assert.equal(
    importText(catalogI18n("en"), failure.key, failure.params),
    `Fix this problem in the file, then choose it again: ${issue}`,
  );
  assert.equal(
    importText(catalogI18n("cs"), "previewRejected", { issue: "{issue} {count}" }),
    "Opravte v souboru tento problém a vyberte ho znovu: {issue} {count}",
  );
  for (const error of [
    { code: "INVALID_REQUEST" },
    { code: "INVALID_REQUEST", issue: "" },
    { code: "INVALID_REQUEST", issue: 42 },
    { code: "CONFLICT", issue },
    new Error(issue),
    undefined,
  ])
    assert.deepEqual(previewFailure(error), { key: "previewFailed", params: {} });
  assert.deepEqual(previewFailure(new ImportProblem("tooLarge")), {
    key: "tooLarge",
    params: {},
  });
});

void test("providers' labels, warnings and rejections carry keys into their own catalogs", () => {
  const provider = { addonId: "homebrew" };
  const keyed = parseAdapterDescription({
    ...description,
    labelKey: "adapter.label",
    descriptionKey: "adapter.description",
  });
  assert.deepEqual(providerText(keyed.label, keyed.labelKey, provider), {
    text: "Stories",
    key: "adapter.label",
    addon: "homebrew",
  });
  assert.deepEqual(providerText("Stories", undefined, provider), { text: "Stories" });
  for (const value of [{ labelKey: "" }, { labelKey: 3 }, { descriptionKey: "x".repeat(501) }])
    assert.throws(() => parseAdapterDescription({ ...description, ...value }), ImportProblem);
  const warned = parseImportPreview(
    {
      ...preview,
      warnings: ["Imports write drafts.", "Plain."],
      warningTexts: [
        { text: "Imports write drafts.", key: "Imports write drafts." },
        { text: "Plain." },
      ],
    },
    "story-json",
  );
  assert.deepEqual(previewWarning(warned, 0, provider), {
    text: "Imports write drafts.",
    key: "Imports write drafts.",
    addon: "homebrew",
  });
  assert.deepEqual(previewWarning(warned, 1, provider), { text: "Plain." });
  assert.deepEqual(previewWarning({ ...warned, warningTexts: [] }, 0, provider), {
    text: "Imports write drafts.",
  });
  // Warning texts must match the warnings and cannot name another catalog.
  for (const warningTexts of [[], [{ text: "x", addon: "other" }], [{ key: "no text" }]])
    assert.throws(
      () => parseImportPreview({ ...preview, warnings: ["x"], warningTexts }, "story-json"),
      ImportProblem,
    );
  const issueText = {
    text: "items/a: bad",
    key: "worker.staleUpdate",
    args: { record: "items/a" },
    addon: "dm-tools",
  };
  assert.deepEqual(previewFailure({ code: "INVALID_REQUEST", issue: "items/a: bad", issueText }), {
    key: "previewRejected",
    params: { issue: "items/a: bad" },
    issue: issueText,
  });
});
