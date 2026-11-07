import assert from "node:assert/strict";
import { test } from "node:test";
import { PlannerError, plannerError, plannerTranslator } from "#web/messages";
import { catalogI18n } from "./catalog-i18n.ts";
import { newItem, validatePlanning, validateItemEdit } from "#web/planning-model";
import { targetLabel } from "#web/planner-targets";

void test("planner texts keep authored interpolation and fall back to their English key", () => {
  const t = plannerTranslator(catalogI18n("cs"));
  assert.equal(t("Connect from {0}", { 0: "Title {0} $&" }), "Propojit z: Title {0} $&");
  assert.equal(plannerTranslator(catalogI18n("de"))("Save item"), "Save item");
  assert.equal(plannerTranslator()("Connect from {0}", { 0: "Title" }), "Connect from Title");
});

void test("localized planner validation keeps IDs, authored labels and dataset meaning", () => {
  const t = plannerTranslator(catalogI18n("cs")),
    item = newItem("quest", null, 1, t);
  assert.equal(item.title, "Nová položka: úkol");
  assert.equal(item.kind, "quest");
  const data = {
    items: [{ ...item, title: "Title {0} $&", parentId: "missing" }],
    flows: [],
    references: [],
    consequences: [],
    notes: [],
    views: [],
  };
  const original = structuredClone(data);
  assert.deepEqual(validatePlanning(data, t), ["Položce „Title {0} $&“ chybí nadřazená položka."]);
  assert.deepEqual(data, original);
  assert.equal(
    validateItemEdit(data, { ...item, id: "missing" }, t)[0],
    "Tato plánovací položka již neexistuje. Obnovte plánovač.",
  );
  assert.equal(
    targetLabel(
      { scope: "planning", itemId: item.id },
      data.items,
      { records: [], ready: true, truncated: false },
      t,
    ),
    "Title {0} $&",
  );
});

void test("package-owned failures translate in the receiving view without rewriting foreign diagnostics", () => {
  const error = new PlannerError("Unavailable: {0}", { 0: "Title {0} $&" });
  assert.equal(error.message, "Unavailable: Title {0} $&");
  assert.equal(
    plannerError(error, plannerTranslator(catalogI18n("cs")), "fallback"),
    "Nedostupné: Title {0} $&",
  );
  assert.equal(
    plannerError(
      new Error("Unavailable: authored"),
      plannerTranslator(catalogI18n("cs")),
      "Obnovte plánovač.",
    ),
    "Obnovte plánovač.",
  );
});
