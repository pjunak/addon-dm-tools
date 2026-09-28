import assert from "node:assert/strict";
import test from "node:test";
import { planningChoices } from "#web/planner-choices";

void test("planning choices distinguish repeated titles without changing stored identities", () => {
  const items = [
    { id: "harbor", title: "Harbor", parentId: null },
    { id: "inland", title: "Inland", parentId: null },
    { id: "arrival-a", title: "Arrival", parentId: "harbor" },
    { id: "arrival-b", title: "Arrival", parentId: "inland" },
    { id: "arrival-c", title: "Arrival", parentId: "inland" },
    { id: "unique", title: "A unique clue", parentId: "harbor" },
  ];
  const before = structuredClone(items),
    choices = planningChoices(items);
  assert.deepEqual(
    choices.map(({ id, label }) => [id, label]),
    [
      ["harbor", "Harbor"],
      ["inland", "Inland"],
      ["arrival-a", "Harbor / Arrival"],
      ["arrival-b", "Inland / Arrival (arrival-b)"],
      ["arrival-c", "Inland / Arrival (arrival-c)"],
      ["unique", "A unique clue"],
    ],
  );
  assert.equal(choices.at(-1)!.trail, "Harbor / A unique clue");
  assert.deepEqual(items, before);
});

void test("choice labels remain bounded for incomplete or cyclic display catalogs", () => {
  const choices = planningChoices([
    { id: "a", title: "A", parentId: "b" },
    { id: "b", title: "B", parentId: "a" },
    { id: "c", title: "C", parentId: "missing" },
  ]);
  assert.deepEqual(
    choices.map(({ trail }) => trail),
    ["B / A", "A / B", "C"],
  );
});
